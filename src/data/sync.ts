import type { OutboxEntry, SyncEntity } from '@/domain/types'
import { CloudError, tokenLifeMs, type Api, type Snapshot } from './api'
import { variantToWire } from './wire'

export interface SyncState {
  online: boolean
  authenticated: boolean
  /** True while a flush or pull is running. */
  busy: boolean
  pending: number
  /** When the oldest change still waiting to upload was made — how long data has been unprotected. */
  oldestPendingAt: number | null
  /** Changes the server refused for good (bad data) and that were set aside so the rest could continue. */
  rejected: number
  lastError: string | null
  lastSyncedAt: number | null
  lastPulledAt: number | null
}

export const initialSyncState = (): SyncState => ({
  online: true, authenticated: false, busy: false, pending: 0, oldestPendingAt: null, rejected: 0,
  lastError: null, lastSyncedAt: null, lastPulledAt: null,
})

type Endpoint = { method: string; path: string | ((p: Record<string, unknown>) => string) }

/** One write endpoint per entity — the exact routes the cloud API exposes (see docs/API-CONTRACT.md). */
export const ENDPOINT: Record<Exclude<SyncEntity, 'mut'>, Endpoint> = {
  bill: { method: 'POST', path: '/bills' },
  billReturn: { method: 'POST', path: (p) => `/bills/${p.refundOfBillId}/return` },
  customer: { method: 'POST', path: '/customers' },
  customerUpdate: { method: 'PUT', path: (p) => `/customers/${p.id}` },
  product: { method: 'POST', path: '/products' },
  productUpdate: { method: 'PUT', path: (p) => `/products/${p.id}` },
  productDelete: { method: 'DELETE', path: (p) => `/products/${p.id}` },
  variant: { method: 'POST', path: '/variants' },
  variantUpdate: { method: 'PUT', path: (p) => `/variants/${p.id}` },
  expense: { method: 'POST', path: '/expenses' },
  stockAdjust: { method: 'POST', path: '/stock/adjust' },
  storeUpdate: { method: 'PUT', path: '/store' },
  user: { method: 'POST', path: '/users' },
  userUpdate: { method: 'PUT', path: (p) => `/users/${p.id}` },
  category: { method: 'POST', path: '/categories' },
  categoryDelete: { method: 'DELETE', path: (p) => `/categories/${p.id}` },
  coupon: { method: 'POST', path: '/coupons' },
  couponUpdate: { method: 'PUT', path: (p) => `/coupons/${p.id}` },
  supplier: { method: 'POST', path: '/suppliers' },
  supplierUpdate: { method: 'PUT', path: (p) => `/suppliers/${p.id}` },
  purchase: { method: 'POST', path: '/purchases' },
  session: { method: 'POST', path: '/sessions' },
  sessionUpdate: { method: 'PUT', path: (p) => `/sessions/${p.id}` },
}

/** Statuses that mean "this exact request will never be accepted" (as opposed to a server hiccup, rate limit or expired sign-in). */
export const PERMANENT = new Set([400, 403, 404, 405, 410, 413, 422])
/** A permanently-refused change is retried this many times before it is set aside. */
export const MAX_ATTEMPTS = 3
/** Swap the token for a fresh one when less than this much life is left. */
const REFRESH_BELOW_MS = 3 * 3_600_000

/** A staff PIN only has to sit in the queue until the server has it. */
export function withoutPin(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || !('pin' in payload)) return payload
  const { pin: _pin, ...rest } = payload as Record<string, unknown>
  void _pin
  return rest
}

/** Entities where a 409 must be double-checked: "already there" is only true if it is *this* bill, not another one that took the number. */
const VERIFY_ON_CONFLICT = new Set<SyncEntity>(['bill', 'billReturn'])

export interface SyncDeps {
  /** The API client for the signed-in server, or null when not connected. */
  api: () => Api | null
  token: () => string | null
  setToken: (t: string) => void
  outbox: () => OutboxEntry[]
  updateOutbox: (id: number, patch: Partial<OutboxEntry>) => Promise<void>
  /** Hands a fresh server snapshot to the app to replace local data. */
  applySnapshot: (snap: Snapshot) => Promise<void>
  isOnline: () => boolean
  getState: () => SyncState
  setState: (patch: Partial<SyncState>) => void
  now?: () => number
}

/**
 * Pushes queued writes to the server in order and pulls fresh data back. Ordered on purpose — a product must arrive
 * before its variants, an item's variant before the bill that sells it — so a server hiccup, lost connection or expired
 * sign-in stops the queue right there and it resumes on the next tick. A change refused for good is retried a few times
 * and then set aside so one bad row cannot hold up every sale behind it; it stays visible and can be retried.
 */
export function createSyncEngine(d: SyncDeps) {
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

  /** While the token still works, quietly swap it for a fresh one (12 h tokens would otherwise lapse mid-shift). */
  async function refreshIfNeeded(api: Api) {
    const t = d.token()
    if (!t || tokenLifeMs(t, now()) > REFRESH_BELOW_MS || tokenLifeMs(t, now()) === 0) return
    try { d.setToken((await api.refresh()).token) } catch { /* offline right now — try again next tick */ }
  }

  async function flush(): Promise<void> {
    const api = d.api()
    if (flushing || !api) return
    if (!d.isOnline()) { d.setState({ online: false }); return }
    flushing = true
    d.setState({ busy: true, online: true })
    try {
      await refreshIfNeeded(api)
      // An entry is looked at once per pass: if storing its result fails, stop rather than resend it forever.
      const seen = new Set<number>()
      for (;;) {
        recount()
        const entry = d.outbox().filter((o) => o.synced === 0).sort((a, b) => a.id - b.id)[0]
        if (!entry || seen.has(entry.id)) break
        seen.add(entry.id)

        if (entry.entity === 'mut') { await d.updateOutbox(entry.id, { synced: 2, attempts: entry.attempts + 1, lastError: 'A Kosh-server write reached a Krishna-compatible connection' }); continue }
        const def = ENDPOINT[entry.entity]
        const payload = entry.payload as Record<string, unknown>
        const path = typeof def.path === 'function' ? def.path(payload) : def.path
        // What goes over the wire can differ from what the phone keeps (see wire.ts); the stored entry is left as it was.
        const body = entry.entity === 'variant' || entry.entity === 'variantUpdate' ? variantToWire(payload) : payload

        let res: Response
        try {
          res = await api.raw(def.method, path, def.method === 'DELETE' ? undefined : body)
        } catch {
          d.setState({ online: false, lastError: 'The server is unreachable' })
          break
        }

        if (res.status === 401) {
          d.setState({ authenticated: false, lastError: 'Your session expired — sign in again to keep syncing' })
          break
        }

        let done = res.ok
        if (res.status === 409) {
          done = true
          if (VERIFY_ON_CONFLICT.has(entry.entity)) {
            // 409 normally means "a retried request that already landed". But a bill number is unique per store, so another
            // device taking the same number would also answer 409 — and silently dropping the sale must never happen.
            const mine = await api.bill(String(payload.id)).then(() => true).catch((e: unknown) => (e instanceof CloudError && e.status === 404 ? false : true))
            if (!mine) {
              await d.updateOutbox(entry.id, { synced: 2, attempts: entry.attempts + 1, lastError: '409 This invoice number was already used on another device' })
              recount()
              d.setState({ lastError: `Bill ${String(payload.no ?? '')} was not saved: its number is taken by another device` })
              continue
            }
          }
        }

        if (!done) {
          const body = await res.text().catch(() => '')
          const attempts = entry.attempts + 1
          const lastError = `${res.status} ${body}`.slice(0, 300)
          if (PERMANENT.has(res.status) && attempts >= MAX_ATTEMPTS) {
            await d.updateOutbox(entry.id, { synced: 2, attempts, lastError })
            recount()
            d.setState({ lastError: `A ${entry.entity} change was refused by the server (${res.status}) and set aside` })
            continue
          }
          // Anything else (server error, rate limit, or a refusal still being retried) stops here so order is preserved.
          await d.updateOutbox(entry.id, { attempts, lastError })
          d.setState({ lastError: `Sync stalled on ${entry.entity} (${res.status})` })
          break
        }

        await d.updateOutbox(entry.id, { synced: 1, payload: withoutPin(entry.payload) })
        // A set-aside change keeps its warning up: later successes must not hide that something was not saved.
        d.setState({ lastSyncedAt: now(), ...(d.getState().rejected === 0 ? { lastError: null } : {}) })
      }
      recount()
    } finally {
      flushing = false
      d.setState({ busy: false })
    }
  }

  /** Replaces local data with the server's. Only when nothing is waiting to upload, so no local work is ever overwritten. */
  async function pull(): Promise<boolean> {
    const api = d.api()
    if (pulling || !api) return false
    if (!d.isOnline()) { d.setState({ online: false }); return false }
    if (d.outbox().some((o) => o.synced === 0)) return false
    pulling = true
    d.setState({ busy: true })
    try {
      const snap = await api.snapshot()
      // A bill rung up while the download was in flight must not be wiped by it.
      if (d.outbox().some((o) => o.synced === 0)) return false
      await d.applySnapshot(snap)
      d.setState({ lastPulledAt: now(), lastError: null, online: true, authenticated: true })
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

  /** Upload everything waiting, then download the latest — the pull-to-refresh and "Sync now" action. */
  async function syncNow(): Promise<SyncState> {
    await flush()
    await pull()
    return d.getState()
  }

  async function retryRejected(updateAll: () => Promise<void>) {
    await updateAll()
    await flush()
  }

  return { flush, pull, syncNow, retryRejected, recount }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>
