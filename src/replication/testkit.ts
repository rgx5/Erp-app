import { applyChanges, emptyData, type Changes, type DataState } from '@/data/state'
import { applyMutations, pullChanges } from './apply'
import { applyPull, mutationsFromChanges, settingsToDoc } from './client'
import { MemoryDocStore } from './memory'
import type { Actor, Mutation } from './types'

/** An actor with every permission (the owner), or only the listed ones. */
export const actorWith = (perms: string[] | 'all' = 'all', userId = 'u_owner'): Actor => ({ userId, can: (p) => perms === 'all' || perms.includes(p), branches: 'all' })

/**
 * A phone and a server side by side, for tests: every operation runs on the phone, its writes go through the same rules the
 * real server runs, and `serverView()` is what a fresh device would download. A module proves its collections replicate by
 * comparing `serverView()` with `phone` after a sequence of operations.
 *
 *   const r = rig(baseState()); await r.seed()
 *   const out = await r.run((s) => saveQuotation(s, input, ctx()))
 *   expect((await r.serverView()).quotations).toEqual(r.phone.quotations)
 */
export function rig(initial: DataState, actor: Actor = actorWith()) {
  const db = new MemoryDocStore()
  let seq = 0
  let phone = initial
  const send = async (muts: Mutation[], as: Actor = actor) => {
    const res = await applyMutations(db, muts, as)
    const bad = res.filter((r) => r.status === 'rejected')
    if (bad.length) throw new Error(`the server refused: ${JSON.stringify(bad)}`)
    return res
  }
  const run = async <R extends { changes: Changes }>(fn: (s: DataState) => R): Promise<R> => {
    const r = fn(phone)
    const muts = mutationsFromChanges(phone, r.changes, { deviceId: 'dev1', nextSeq: () => ++seq })
    phone = applyChanges(phone, r.changes)
    await send(muts)
    return r
  }
  /** First sign-in: upload the starting documents. */
  const seed = async () => {
    const put: Record<string, unknown[]> = {}
    for (const [k, v] of Object.entries(initial)) if (k !== 'store' && k !== 'users') put[k] = Object.values(v as object)
    const muts = mutationsFromChanges(emptyData(), { put: put as Changes['put'] }, { deviceId: 'seed', nextSeq: () => ++seq })
    if (initial.store) muts.push({ mid: 'seed:settings', coll: 'settings', id: 'store', op: 'create', data: settingsToDoc(initial.store), at: 1 })
    await send(muts)
  }
  const serverView = async (as: Actor = actor): Promise<DataState> => {
    const pulled = await pullChanges(db, as, 0, 5000)
    return applyPull({ ...emptyData(), store: initial.store }, pulled)
  }
  return { db, run, seed, send, serverView, get phone() { return phone } }
}
