import type {
  AuditLog, Bill, Category, Coupon, Customer, DaySession, Expense, OutboxEntry, Product, Purchase, StockMove,
  StoreSettings, Supplier, SyncEntity, User, Variant,
} from '@/domain/types'

/** Every record collection the app holds. Each is a map keyed by id, so one write never copies the whole table. */
export interface CollMap {
  users: User
  categories: Category
  products: Product
  variants: Variant
  customers: Customer
  coupons: Coupon
  suppliers: Supplier
  purchases: Purchase
  bills: Bill
  moves: StockMove
  expenses: Expense
  sessions: DaySession
  audit: AuditLog
}
export type Coll = keyof CollMap
export const COLLECTIONS: Coll[] = [
  'users', 'categories', 'products', 'variants', 'customers', 'coupons', 'suppliers', 'purchases', 'bills',
  'moves', 'expenses', 'sessions', 'audit',
]

export type DataState = { store: StoreSettings | null } & { [K in Coll]: Record<string, CollMap[K]> }

export const emptyData = (): DataState => ({
  store: null,
  users: {}, categories: {}, products: {}, variants: {}, customers: {}, coupons: {}, suppliers: {}, purchases: {},
  bills: {}, moves: {}, expenses: {}, sessions: {}, audit: {},
})

/** A write queued for the server. The id and bookkeeping are added when it is stored. */
export interface OutboxDraft { entity: SyncEntity; payload: unknown }

/** The result of one business operation: what to write locally and what to tell the server. */
export interface Changes {
  store?: Partial<StoreSettings>
  put?: { [K in Coll]?: CollMap[K][] }
  del?: { [K in Coll]?: string[] }
  outbox?: OutboxDraft[]
}

export const emptyChanges = (): Changes => ({})

/** Applies changes to a state, copying only the collections that actually changed. */
export function applyChanges(state: DataState, c: Changes): DataState {
  let next: DataState = state
  const ensure = () => { if (next === state) next = { ...state } }

  if (c.store && state.store) { ensure(); next.store = { ...state.store, ...c.store } }
  for (const [coll, rows] of Object.entries(c.put ?? {}) as Array<[Coll, Array<{ id: string }>]>) {
    if (!rows?.length) continue
    ensure()
    const copy = { ...(next[coll] as Record<string, unknown>) }
    for (const r of rows) copy[r.id] = r
    ;(next as unknown as Record<string, unknown>)[coll] = copy
  }
  for (const [coll, ids] of Object.entries(c.del ?? {}) as Array<[Coll, string[]]>) {
    if (!ids?.length) continue
    ensure()
    const copy = { ...(next[coll] as Record<string, unknown>) }
    for (const i of ids) delete copy[i]
    ;(next as unknown as Record<string, unknown>)[coll] = copy
  }
  return next
}

/** Combines several changes into one, in order (later writes to the same record win). */
export function mergeChanges(...list: Changes[]): Changes {
  const out: Changes = {}
  for (const c of list) {
    if (c.store) out.store = { ...out.store, ...c.store }
    for (const [coll, rows] of Object.entries(c.put ?? {})) {
      out.put ??= {}
      const o = out.put as Record<string, Array<{ id: string }>>
      const merged = new Map((o[coll] ?? []).map((r) => [r.id, r]))
      for (const r of rows as Array<{ id: string }>) merged.set(r.id, r)
      o[coll] = [...merged.values()]
    }
    for (const [coll, ids] of Object.entries(c.del ?? {})) {
      out.del ??= {}
      const o = out.del as Record<string, string[]>
      o[coll] = [...(o[coll] ?? []), ...(ids as string[])]
      // A record deleted after being written in the same batch is simply gone.
      if (out.put) {
        const p = out.put as Record<string, Array<{ id: string }>>
        if (p[coll]) p[coll] = p[coll].filter((r) => !(ids as string[]).includes(r.id))
      }
    }
    if (c.outbox?.length) out.outbox = [...(out.outbox ?? []), ...c.outbox]
  }
  return out
}

/** A read-model with no hot-path cost: the values of a record map, cached per map instance. */
const listCache = new WeakMap<object, unknown[]>()
export function listOf<T>(rec: Record<string, T>): T[] {
  let l = listCache.get(rec) as T[] | undefined
  if (!l) { l = Object.values(rec); listCache.set(rec, l) }
  return l
}

export type OutboxRow = OutboxEntry
