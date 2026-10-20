import './core'
import { COLLECTIONS, applyChanges, mergeChanges, type Changes, type DataState } from '@/data/state'
import { collectionMeta, effectsFor, type Effect } from './registry'
import type { Doc } from './types'

const clean = (n: number) => Math.round(n * 10_000) / 10_000
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * What posting documents does to *other* documents, applied to the phone's own copy — the same effects the server runs, so
 * the phone shows the right numbers before it has talked to anyone. Give it the changes an operation produced; get back the
 * extra changes to merge in.
 *
 * Only the collections you name are considered: an operation that already updates some documents itself (the core stock and
 * customer rules do) must not have them updated twice.
 */
export function localEffects(state: DataState, changes: Changes, colls: string[], now = Date.now()): Changes {
  const next = applyChanges(state, changes)
  const puts: Record<string, Record<string, Doc>> = {}
  const current = (coll: string, id: string): Doc | undefined => puts[coll]?.[id] ?? ((next as unknown as Record<string, Record<string, Doc>>)[coll]?.[id])
  const save = (coll: string, doc: Doc) => { (puts[coll] ??= {})[doc.id] = doc }

  for (const coll of COLLECTIONS) {
    if (!colls.includes(coll)) continue
    const meta = collectionMeta(coll)
    if (!meta || meta.kind !== 'ledger') continue
    const before = state[coll] as unknown as Record<string, unknown>
    for (const row of (changes.put?.[coll] ?? []) as unknown as Doc[]) {
      if (before[row.id]) continue // posted once: effects only for a document that is new
      for (const e of effectsFor(meta, row, { now }) as Effect[]) {
        let doc = current(e.coll, e.id)
        if (e.kind === 'inc') {
          if (!doc) { if (!e.init) continue; doc = { ...e.init } }
          let v = clean(num(doc[e.field]) + e.by)
          if (e.min !== undefined && v < e.min) v = e.min
          save(e.coll, { ...doc, [e.field]: v })
        } else {
          if (!doc) continue
          const patch = e.fn(doc)
          if (patch) save(e.coll, { ...doc, ...patch, id: doc.id })
        }
      }
    }
  }
  const out: Changes = {}
  for (const [coll, docs] of Object.entries(puts)) { out.put ??= {}; (out.put as Record<string, unknown[]>)[coll] = Object.values(docs) }
  return out
}

/** `changes` plus the local effects of the named collections' new documents, as one `Changes`. */
export const withEffects = (state: DataState, changes: Changes, colls: string[], now = Date.now()): Changes =>
  mergeChanges(changes, localEffects(state, changes, colls, now))
