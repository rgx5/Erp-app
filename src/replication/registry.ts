import type { Doc } from './types'

/**
 * master  — editable records (an item, a customer, a quotation). Concurrent edits merge field by field, last writer wins.
 * ledger  — posted documents (a bill, a stock movement, a voucher). Created once, never edited or deleted; a mistake is
 *           fixed by a new document that reverses it.
 * managed — written only through the server's own API, not by replication (users, roles).
 */
export type CollectionKind = 'master' | 'ledger' | 'managed'

/** A permission name, or several of which any one is enough. 'any' means every signed-in person. */
export type PermSpec = string | string[]

export interface EffectCtx { now: number }

/** What posting a document does to *other* documents. The same pure function runs on the phone and on the server. */
export type Effect =
  /** Add to a number. `min` stops it going below a floor; `init` creates the target when it does not exist yet. */
  | { kind: 'inc'; coll: string; id: string; field: string; by: number; min?: number; init?: Doc }
  /** Change a document from its current state (return what to merge in, or null for nothing). */
  | { kind: 'update'; coll: string; id: string; fn: (current: Doc) => Partial<Doc> | null }

export interface CollectionMeta {
  name: string
  kind: CollectionKind
  /** Needed to create / patch / delete. */
  perm: PermSpec
  /** Needed to receive the collection on a pull (default: the write permission). */
  readPerm?: PermSpec
  /** Fields the server maintains through effects. A client's patch to them is ignored. */
  owned?: string[]
  /** Ledger only: fields that may still be patched after posting (a note). */
  patchable?: string[]
  /** Stays on the phone; never replicated. */
  local?: boolean
  /** The document belongs to a branch through its `branchId` field (multi-store). */
  branched?: boolean
  /** Pure sanity check run on create (and on the result of a patch). Return a message to refuse the write. */
  validate?: (doc: Doc) => string | null
  /** Effects of a created document. Pure. */
  effects?: (doc: Doc, ctx: EffectCtx) => Effect[]
}

const metas = new Map<string, CollectionMeta>()

/** A collection name belongs to exactly one module; registering it twice is a mistake that would silently drop rules. */
export function registerCollectionMeta(...list: CollectionMeta[]) {
  for (const m of list) {
    const cur = metas.get(m.name)
    if (cur && cur !== m) throw new Error(`The collection “${m.name}” is registered twice`)
    metas.set(m.name, m)
  }
}
export const collectionMeta = (name: string) => metas.get(name)
export const allCollectionMetas = () => [...metas.values()]

const extraOwned = new Map<string, string[]>()
/** Declares more server-maintained fields on a collection another module owns (the credit module adds `customers.dueBalance`). */
export function addOwnedFields(coll: string, fields: string[]) {
  extraOwned.set(coll, [...new Set([...(extraOwned.get(coll) ?? []), ...fields])])
}
/** Every field of the collection that clients may not set: the collection's own plus those other modules added. */
export const ownedFields = (meta: CollectionMeta): string[] => [...(meta.owned ?? []), ...(extraOwned.get(meta.name) ?? [])]

const extra = new Map<string, Array<(doc: Doc, ctx: EffectCtx) => Effect[]>>()
/** Adds an effect to a collection another module owns (purchase orders react to goods received, ledgers react to bills…). */
export function addEffects(coll: string, fn: (doc: Doc, ctx: EffectCtx) => Effect[]) {
  const list = extra.get(coll) ?? []
  list.push(fn)
  extra.set(coll, list)
}
/** Everything that posting `doc` does: the collection's own effects plus any other module's. */
export function effectsFor(meta: CollectionMeta, doc: Doc, ctx: EffectCtx): Effect[] {
  return [...(meta.effects?.(doc, ctx) ?? []), ...(extra.get(meta.name) ?? []).flatMap((fn) => fn(doc, ctx))]
}

export const permList = (p: PermSpec): string[] => (Array.isArray(p) ? p : [p])
export const permits = (can: (perm: string) => boolean, p: PermSpec) => permList(p).some((x) => x === 'any' || can(x))
