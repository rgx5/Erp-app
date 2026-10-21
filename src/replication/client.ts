import { COLLECTIONS, type Changes, type DataState } from '@/data/state'
import type { StoreSettings } from '@/domain/types'
import { collectionMeta, ownedFields } from './registry'
import type { Doc, Mutation, PullResult } from './types'
import './core'

/** The business settings live in `DataState.store`; on the wire they are the single document `settings/store`. */
export const SETTINGS_COLL = 'settings'
export const SETTINGS_ID = 'store'

export const settingsToDoc = (s: StoreSettings): Doc => ({ ...s, id: SETTINGS_ID, storeId: s.id })
export function docToSettings(d: Doc, fallbackId: string): StoreSettings {
  const { storeId, id: _id, ...rest } = d as Doc & { storeId?: string }
  void _id
  return { ...(rest as unknown as StoreSettings), id: storeId ?? fallbackId }
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** What changed between two versions of a record: the changed fields, with `null` for a field that was removed. */
export function diffDoc(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(after)) if (k !== 'id' && !same(before[k], after[k])) out[k] = after[k] === undefined ? null : after[k]
  for (const k of Object.keys(before)) if (k !== 'id' && !(k in after)) out[k] = null
  return out
}

/**
 * A variant created together with its opening-stock move already shows that stock locally, but the server adds the move
 * to the variant itself — so the variant is sent without the quantity those moves bring.
 */
function withoutOwnMoves(row: Doc, changes: Changes): Doc {
  const moved = ((changes.put?.moves ?? []) as unknown as Array<{ variantId: string; qty: number }>)
    .filter((m) => m.variantId === row.id).reduce((n, m) => n + m.qty, 0)
  const stock = typeof row.stock === 'number' ? row.stock : 0
  return moved ? { ...row, stock: Math.round((stock - moved) * 1000) / 1000 } : row
}

export interface DeriveOpts {
  deviceId: string
  nextSeq: () => number
}

/**
 * Turns what a business operation changed into the writes a Kosh server needs, using each collection's rules: a new
 * record is sent whole; an edit to an editable record sends only the fields that changed (and never the ones the server
 * keeps); a posted document is never edited; a parked bill never leaves the phone. Derived numbers such as stock and
 * customer balances are not sent at all — the server works them out from the posted documents.
 */
export function mutationsFromChanges(before: DataState, changes: Changes, o: DeriveOpts): Mutation[] {
  const at = Date.now()
  const out: Mutation[] = []
  const push = (coll: string, id: string, op: Mutation['op'], data?: Record<string, unknown>) =>
    out.push({ mid: `${o.deviceId}:${o.nextSeq()}`, coll, id, op, ...(data ? { data } : {}), at })

  if (changes.store && before.store) {
    const next = { ...before.store, ...changes.store }
    const patch = diffDoc(settingsToDoc(before.store), settingsToDoc(next))
    delete patch.storeId
    if (Object.keys(patch).length) push(SETTINGS_COLL, SETTINGS_ID, 'patch', patch)
  } else if (changes.store && !before.store) {
    push(SETTINGS_COLL, SETTINGS_ID, 'create', settingsToDoc(changes.store as StoreSettings))
  }

  for (const coll of COLLECTIONS) {
    const meta = collectionMeta(coll)
    if (!meta || meta.local || meta.kind === 'managed') continue
    const prev = before[coll] as unknown as Record<string, Doc>
    for (const row of (changes.put?.[coll] ?? []) as unknown as Doc[]) {
      if (coll === 'bills' && (row as { status?: string }).status === 'held') continue
      const old = prev[row.id]
      if (!old) { push(coll, row.id, 'create', coll === 'variants' ? withoutOwnMoves(row, changes) : row); continue }
      const patch = diffDoc(old, row)
      const allowed = meta.kind === 'ledger' ? meta.patchable ?? [] : null
      for (const k of Object.keys(patch)) {
        if (allowed ? !allowed.includes(k) : ownedFields(meta).includes(k)) delete patch[k]
      }
      if (Object.keys(patch).length) push(coll, row.id, 'patch', patch)
    }
    if (meta.kind === 'master') {
      for (const id of changes.del?.[coll] ?? []) if (prev[id]) push(coll, id, 'delete')
    }
  }
  return out
}

/** The (collection, id) pairs a list of waiting mutations will overwrite — a pull must not clobber those. */
export const touched = (muts: Array<Pick<Mutation, 'coll' | 'id'>>) => new Set(muts.map((m) => `${m.coll}\u0000${m.id}`))

/**
 * Folds a pull into the local state: server copies replace local ones, deletes remove them. A record this phone has a
 * waiting change for is left alone; the server's answer to that change arrives on the next pull.
 */
export function applyPull(state: DataState, pull: Pick<PullResult, 'upserts' | 'deletes'>, pending: Set<string> = new Set(), fallbackStoreId = ''): DataState {
  const next = { ...state } as unknown as Record<string, unknown>
  const copies = new Map<string, Record<string, unknown>>()
  const coll = (name: string) => {
    let c = copies.get(name)
    if (!c) { c = { ...(state as unknown as Record<string, Record<string, unknown>>)[name] }; copies.set(name, c) }
    return c
  }
  let store = state.store
  for (const u of pull.upserts) {
    if (pending.has(`${u.coll}\u0000${u.id}`)) continue
    if (u.coll === SETTINGS_COLL) { store = docToSettings(u.data, state.store?.id ?? fallbackStoreId); continue }
    if (!(COLLECTIONS as string[]).includes(u.coll)) continue
    coll(u.coll)[u.id] = u.data
  }
  for (const d of pull.deletes) {
    if (pending.has(`${d.coll}\u0000${d.id}`)) continue
    if (!(COLLECTIONS as string[]).includes(d.coll)) continue
    delete coll(d.coll)[d.id]
  }
  for (const [name, c] of copies) next[name] = c
  next.store = store
  return next as unknown as DataState
}
