import type { OutboxEntry } from '@/domain/types'
import type { Mutation, PullResult } from '@/replication/types'
import { touched } from '@/replication/client'
import { CloudError, tokenLifeMs } from '../api'
import { initialSyncState, MAX_ATTEMPTS, withoutPin, type SyncState } from '../sync'
import type { KoshApi } from './api'

const BATCH = 100
const PULL_PAGE = 500
const REFRESH_BELOW_MS = 3 * 3_600_000

export interface KoshSyncDeps {
  api: () => KoshApi | null
  token: () => string | null
  setToken: (t: string) => void
  outbox: () => OutboxEntry[]
  updateOutbox: (id: number, patch: Partial<OutboxEntry>) => Promise<void>
  /** Folds a page of changes into the local data. `pending` are records with a write still waiting: leave those alone. */
  applyRemote: (pull: PullResult, pending: Set<string>) => Promise<void>
  getCursor: () => number
  setCursor: (n: number) => Promise<void>
  isOnline: () => boolean
  getState: () => SyncState
  setState: (patch: Partial<SyncState>) => void
  now?: () => number
}

/**
 * Sync with a Kosh server: upload the waiting writes in order, then download what changed since the last cursor. Writes are
 * idempotent on the server, so a retry after a lost reply is harmless; one the server refuses is set aside (with its reason)
 * so it cannot hold up the rest.
 */
export function createKoshSync(d: KoshSyncDeps) {
  let flushing = false
  let pulling = false
  const now = d.now ?? Date.now

  const recount = () => {
    const rows = d.outbox()
    const waiting = rows.filter((o) => o.synced === 0)
    d.setState({
      pending: waiting.length,
      oldestPendingAt: waiting.length ? Math.min(...waiting.map((o) => o.createdAt)) : null,
      rejected: rows.filter((o) => o.synced === 2).length,
    })
  }

  async function refreshIfNeeded(api: KoshApi) {
    const t = d.token()
    if (!t) return
    const life = tokenLifeMs(t, now())
    if (life === 0 || life > REFRESH_BELOW_MS) return
    try { d.setToken((await api.refresh()).token) } catch { /* offline right now — next tick */ }
  }

  const pendingMuts = () => d.outbox().filter((o) => o.synced === 0 && o.entity === 'mut').map((o) => o.payload as Mutation)

  async function flush(): Promise<void> {
    const api = d.api()
    if (flushing || !api) return
    if (!d.isOnline()) { d.setState({ online: false }); return }
    flushing = true
    d.setState({ busy: true, online: true })
    try {
      await refreshIfNeeded(api)
      const seen = new Set<number>()
      for (;;) {
        recount()
        const waiting = d.outbox().filter((o) => o.synced === 0 && !seen.has(o.id)).sort((a, b) => a.id - b.id)
        if (!waiting.length) break

        if (waiting[0].entity !== 'mut') {
          // A staff account: not a document, so it goes through its own endpoint.
          const e = waiting[0]
          seen.add(e.id)
          const p = e.payload as Record<string, unknown>
          let res: Response
          try { res = e.entity === 'user' ? await api.raw('POST', '/users', p) : await api.raw('PUT', `/users/${p.id}`, p) } catch { d.setState({ online: false, lastError: 'The server is unreachable' }); break }
          if (res.status === 401) { d.setState({ authenticated: false, lastError: 'Your session expired — sign in again to keep syncing' }); break }
          if (res.ok || res.status === 409) { await d.updateOutbox(e.id, { synced: 1, payload: withoutPin(e.payload) }); continue }
          const body = await res.text().catch(() => '')
          const attempts = e.attempts + 1
          if ([400, 403, 404, 422].includes(res.status) && attempts >= MAX_ATTEMPTS) { await d.updateOutbox(e.id, { synced: 2, attempts, lastError: `${res.status} ${body}`.slice(0, 300) }); continue }
          await d.updateOutbox(e.id, { attempts, lastError: `${res.status} ${body}`.slice(0, 300) })
          d.setState({ lastError: `Sync stalled on a staff change (${res.status})` })
          break
        }

        const batch: OutboxEntry[] = []
        for (const o of waiting) { if (o.entity !== 'mut' || batch.length >= BATCH) break; batch.push(o) }
        for (const o of batch) seen.add(o.id)
        let out: Awaited<ReturnType<KoshApi['push']>>
        try {
          out = await api.push(batch.map((o) => o.payload as Mutation))
        } catch (e) {
          if (e instanceof CloudError && e.status === 401) { d.setState({ authenticated: false, lastError: 'Your session expired — sign in again to keep syncing' }); break }
          if (e instanceof CloudError && e.status === 0) { d.setState({ online: false, lastError: 'The server is unreachable' }); break }
          // Something wrong with the whole batch (a 5xx, a rate limit): stop here, keep order, try again on the next tick.
          for (const o of batch) await d.updateOutbox(o.id, { attempts: o.attempts + 1, lastError: e instanceof Error ? e.message.slice(0, 300) : 'Server error' })
          d.setState({ lastError: e instanceof Error ? e.message : 'Sync stalled' })
          break
        }
        const byMid = new Map(out.results.map((r) => [r.mid, r]))
        let refused = 0
        for (const o of batch) {
          const r = byMid.get((o.payload as Mutation).mid)
          if (!r) { await d.updateOutbox(o.id, { attempts: o.attempts + 1, lastError: 'No answer from the server for this change' }); continue }
          if (r.status === 'rejected') {
            refused++
            await d.updateOutbox(o.id, { synced: 2, attempts: o.attempts + 1, lastError: `${r.code ?? 'rejected'}: ${r.message ?? 'refused by the server'}`.slice(0, 300) })
          } else {
            await d.updateOutbox(o.id, { synced: 1 })
          }
        }
        d.setState({ lastSyncedAt: now(), ...(refused ? { lastError: `${refused} ${refused === 1 ? 'change was' : 'changes were'} refused by the server and set aside` } : d.getState().rejected === 0 ? { lastError: null } : {}) })
      }
      recount()
    } finally {
      flushing = false
      d.setState({ busy: false })
    }
  }

  /** Downloads everything that changed since the saved cursor, page by page. Records with a write still waiting are left alone. */
  async function pull(): Promise<boolean> {
    const api = d.api()
    if (pulling || !api) return false
    if (!d.isOnline()) { d.setState({ online: false }); return false }
    pulling = true
    d.setState({ busy: true })
    try {
      for (;;) {
        const page = await api.pull(d.getCursor(), PULL_PAGE)
        await d.applyRemote(page, touched(pendingMuts()))
        await d.setCursor(page.cursor)
        if (!page.hasMore) break
      }
      d.setState({ lastPulledAt: now(), lastError: d.getState().rejected ? d.getState().lastError : null, online: true, authenticated: true })
      return true
    } catch (e) {
      if (e instanceof CloudError && e.status === 401) d.setState({ authenticated: false, lastError: 'Your session expired — sign in again' })
      else d.setState({ lastError: e instanceof Error ? e.message : 'Could not refresh' })
      return false
    } finally {
      pulling = false
      d.setState({ busy: false })
    }
  }

  /** Upload everything waiting, then download the latest — also what brings back the numbers the server keeps (stock, balances). */
  async function syncNow(): Promise<SyncState> {
    await flush()
    await pull()
    return d.getState()
  }

  return { flush, pull, syncNow, recount, retryRejected: async (reset: () => Promise<void>) => { await reset(); await flush() } }
}
export type KoshSync = ReturnType<typeof createKoshSync>
export { initialSyncState }
