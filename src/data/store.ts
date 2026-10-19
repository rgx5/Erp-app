import { create } from 'zustand'
import type { OutboxEntry, User } from '@/domain/types'
import { can as roleCan, type Permission } from '@/domain/permissions'
import { applyChanges, COLLECTIONS, emptyData, type Changes, type Coll, type DataState } from './state'
import { getStorage } from './storage'
import type { WriteBatch } from './storage.types'
import { initialSyncState, type SyncState } from './sync'
import type { OpCtx } from './ops'

/** One business on this phone. Either an offline workspace (everything stays on the phone) or a connected one (synced to a server). */
export interface Workspace {
  id: string
  name: string
  mode: 'local' | 'remote'
  /** Industry pack id (see src/industries). */
  industry: string
  apiUrl?: string
  /** The server's id for this business. */
  storeId?: string
  /** Email used to sign in, so an expired session can be renewed with just the password. */
  loginEmail?: string
  /** Short tag that makes this phone's invoice numbers unique (INV-M4X-0001). Connected workspaces only. */
  deviceTag: string
  barcodeBase: number
  createdAt: number
  /** Created from sample data to explore the app. */
  demo?: boolean
}

export interface Prefs {
  theme: 'system' | 'light' | 'dark'
  /** Ask for fingerprint / face / device PIN when the app opens or returns after being away. */
  appLock: boolean
  haptics: boolean
}
export const DEFAULT_PREFS: Prefs = { theme: 'system', appLock: false, haptics: true }

interface AppStore {
  ready: boolean
  workspace: Workspace | null
  data: DataState
  outbox: OutboxEntry[]
  /** The person using this phone right now. */
  session: { userId: string } | null
  prefs: Prefs
  sync: SyncState
  /** The app lock screen is showing. */
  locked: boolean
  persistError: string | null

  boot: () => Promise<void>
  commit: (changes: Changes) => void
  /** Replace everything (first sign-in, or a fresh snapshot from the server). */
  replaceData: (data: DataState, opts?: { keepOutbox?: boolean }) => Promise<void>
  setWorkspace: (ws: Workspace | null) => Promise<void>
  setSession: (s: { userId: string } | null) => Promise<void>
  setPrefs: (p: Partial<Prefs>) => Promise<void>
  setLocked: (v: boolean) => void
  patchSync: (p: Partial<SyncState>) => void
  updateOutbox: (id: number, patch: Partial<OutboxEntry>) => Promise<void>
  resetRejected: () => Promise<void>
  /** Forget this business on this phone. */
  wipe: () => Promise<void>
}

// ───────────────────────────── ordered, serialised persistence ─────────────────────────────

let chain: Promise<void> = Promise.resolve()
let lastError: ((m: string | null) => void) | null = null

function persist(batch: WriteBatch) {
  chain = chain.then(() => getStorage().write(batch)).then(
    () => lastError?.(null),
    (e: unknown) => { lastError?.(e instanceof Error ? e.message : 'Could not save to the phone') },
  )
  return chain
}

/** Resolves once every queued write has reached storage (used by tests and before sign-out). */
export const flushWrites = () => chain

const json = (v: unknown) => JSON.stringify(v)

function toBatch(c: Changes, store: DataState['store'], outbox: OutboxEntry[]): WriteBatch {
  const b: WriteBatch = { put: [], del: [], outboxPut: outbox }
  if (c.store && store) b.put!.push({ coll: 'store', id: 'store', json: json(store) })
  for (const coll of COLLECTIONS) {
    for (const row of (c.put?.[coll] ?? []) as Array<{ id: string }>) b.put!.push({ coll, id: row.id, json: json(row) })
    for (const rid of c.del?.[coll] ?? []) b.del!.push({ coll, id: rid })
  }
  return b
}

let outboxSeq = 0
let afterCommit: (() => void) | null = null
/** The sync runtime registers here so a new outbox row starts an upload without store.ts importing it. */
export const onOutboxAdded = (fn: (() => void) | null) => { afterCommit = fn }

export const useApp = create<AppStore>((set, get) => {
  lastError = (m) => { if (get().persistError !== m) set({ persistError: m }) }

  return {
    ready: false,
    workspace: null,
    data: emptyData(),
    outbox: [],
    session: null,
    prefs: DEFAULT_PREFS,
    sync: initialSyncState(),
    locked: false,
    persistError: null,

    async boot() {
      const saved = await getStorage().load()
      const data = emptyData()
      data.store = saved.store
      for (const coll of COLLECTIONS) {
        const rows = (saved.docs[coll] ?? []) as Array<{ id: string }>
        const rec: Record<string, unknown> = {}
        for (const r of rows) rec[r.id] = r
        ;(data as unknown as Record<string, unknown>)[coll] = rec
      }
      const outbox = [...saved.outbox].sort((a, b) => a.id - b.id)
      outboxSeq = outbox.reduce((m, o) => Math.max(m, o.id), 0)
      const ws = saved.kv.workspace ? (JSON.parse(saved.kv.workspace) as Workspace) : null
      const prefs = { ...DEFAULT_PREFS, ...(saved.kv.prefs ? JSON.parse(saved.kv.prefs) : {}) } as Prefs
      const session = saved.kv.session ? (JSON.parse(saved.kv.session) as { userId: string }) : null
      set({
        data, outbox, workspace: ws, prefs, ready: true,
        // Only keep a session that still points at a real, active person.
        session: session && data.users[session.userId]?.active ? session : null,
        locked: !!ws && prefs.appLock,
      })
    },

    commit(changes) {
      const s = get()
      const { outbox: drafts, ...rest } = changes
      const data = applyChanges(s.data, rest)
      const connected = s.workspace?.mode === 'remote'
      const rows: OutboxEntry[] = connected
        ? (drafts ?? []).map((d) => ({ id: ++outboxSeq, entity: d.entity, payload: d.payload, createdAt: Date.now(), synced: 0 as const, attempts: 0 }))
        : []
      set({ data, ...(rows.length ? { outbox: [...s.outbox, ...rows] } : {}) })
      void persist(toBatch(changes, data.store, rows))
      if (rows.length) afterCommit?.()
    },

    async replaceData(data, opts) {
      const s = get()
      const batch: WriteBatch = { put: [], del: [] }
      // Remove what is no longer there, write what is.
      for (const coll of COLLECTIONS) {
        const before = s.data[coll as Coll] as Record<string, unknown>
        const after = data[coll as Coll] as Record<string, unknown>
        for (const rid of Object.keys(before)) if (!(rid in after)) batch.del!.push({ coll, id: rid })
        for (const [rid, row] of Object.entries(after)) batch.put!.push({ coll, id: rid, json: json(row) })
      }
      if (data.store) batch.put!.push({ coll: 'store', id: 'store', json: json(data.store) })
      if (!opts?.keepOutbox) {
        batch.outboxDel = s.outbox.map((o) => o.id)
        outboxSeq = 0
      }
      set({ data, ...(opts?.keepOutbox ? {} : { outbox: [] }) })
      await persist(batch)
    },

    async setWorkspace(ws) {
      set({ workspace: ws })
      await persist({ kv: { workspace: ws ? json(ws) : null } })
    },

    async setSession(sess) {
      set({ session: sess })
      await persist({ kv: { session: sess ? json(sess) : null } })
    },

    async setPrefs(p) {
      const prefs = { ...get().prefs, ...p }
      set({ prefs })
      await persist({ kv: { prefs: json(prefs) } })
    },

    setLocked: (locked) => set({ locked }),
    patchSync: (p) => set((s) => ({ sync: { ...s.sync, ...p } })),

    async updateOutbox(id, patch) {
      const cur = get().outbox.find((o) => o.id === id)
      if (!cur) return
      const next = { ...cur, ...patch }
      set((s) => ({ outbox: s.outbox.map((o) => (o.id === id ? next : o)) }))
      await persist({ outboxPut: [next] })
    },

    async resetRejected() {
      const rows = get().outbox.filter((o) => o.synced === 2).map((o) => ({ ...o, synced: 0 as const, attempts: 0 }))
      if (!rows.length) return
      set((s) => ({ outbox: s.outbox.map((o) => rows.find((r) => r.id === o.id) ?? o) }))
      await persist({ outboxPut: rows })
    },

    async wipe() {
      await chain
      await getStorage().wipe()
      outboxSeq = 0
      set({ workspace: null, data: emptyData(), outbox: [], session: null, sync: initialSyncState(), locked: false })
    },
  }
})

// ───────────────────────────── selectors & helpers ─────────────────────────────

export const useData = <T,>(select: (d: DataState) => T): T => useApp((s) => select(s.data))

export const currentUser = (s: { data: DataState; session: { userId: string } | null }): User | null =>
  (s.session ? s.data.users[s.session.userId] ?? null : null)

export const useUser = (): User | null => useApp((s) => (s.session ? s.data.users[s.session.userId] ?? null : null))

export const useCan = (perm: Permission): boolean => useApp((s) => roleCan(currentUser(s)?.role, perm))

/** The context every operation runs in: who is doing it, and this phone's numbering series. */
export function makeCtx(now = Date.now()): OpCtx {
  const s = useApp.getState()
  const ws = s.workspace
  const remote = ws?.mode === 'remote'
  return { now, userId: s.session?.userId ?? '', series: remote ? ws!.deviceTag : '', barcodeBase: remote ? ws!.barcodeBase : 1 }
}

/**
 * Runs a business operation against the live state and commits what it returns. Operations are pure, so they throw an
 * `OpError` (shown to the person) before anything is written if the request is not allowed.
 */
export function perform<R extends { changes: Changes }>(fn: (state: DataState, ctx: OpCtx) => R): R
export function perform(fn: (state: DataState, ctx: OpCtx) => Changes): Changes
export function perform(fn: (state: DataState, ctx: OpCtx) => Changes | { changes: Changes }) {
  const s = useApp.getState()
  const result = fn(s.data, makeCtx())
  // A `Changes` has no `changes` key, so its presence marks an operation that also returns something (a bill, an item…).
  s.commit('changes' in result ? result.changes : result)
  return result
}

export const isConnected = () => useApp.getState().workspace?.mode === 'remote'
