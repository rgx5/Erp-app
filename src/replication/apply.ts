import { allCollectionMetas, collectionMeta, permits, type CollectionMeta, type Effect } from './registry'
import type { Actor, Doc, DocStore, Mutation, MutationResult, PullResult, RejectCode } from './types'

/** The largest document the server accepts (a bill with a few hundred lines is well under this). */
export const MAX_DOC_BYTES = 256 * 1024

class Refusal extends Error {
  constructor(readonly code: RejectCode, message: string) { super(message) }
}

const clean = (n: number) => Math.round(n * 10_000) / 10_000
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Applies a device's writes in order. Each is judged on its own: one refusal never holds up the ones behind it, and a
 * refused write leaves no trace. Returns one result per mutation.
 */
export async function applyMutations(db: DocStore, muts: Mutation[], actor: Actor, now = Date.now()): Promise<MutationResult[]> {
  const out: MutationResult[] = []
  for (const m of muts) out.push(await applyOne(db, m, actor, now))
  return out
}

async function applyOne(db: DocStore, m: Mutation, actor: Actor, now: number): Promise<MutationResult> {
  const refuse = (code: RejectCode, message: string): MutationResult => ({ mid: String(m?.mid ?? ''), status: 'rejected', code, message })
  if (!m || typeof m.mid !== 'string' || !m.mid || typeof m.coll !== 'string' || typeof m.id !== 'string' || !m.id || !['create', 'patch', 'delete'].includes(m.op)) {
    return refuse('invalid', 'Malformed write')
  }
  if (await db.hasMutation(m.mid)) return { mid: m.mid, status: 'duplicate' }

  const meta = collectionMeta(m.coll)
  if (!meta || meta.local) return refuse('unknown_collection', `Unknown collection “${m.coll}”`)
  if (meta.kind === 'managed') return refuse('managed', `“${m.coll}” is changed through its own API, not by sync`)
  if (!permits(actor.can, meta.perm)) return refuse('forbidden', `Your role cannot change ${m.coll}`)

  try {
    return await db.atomic(async () => {
      const r = await run(db, meta, m, actor, now)
      await db.rememberMutation(m.mid, r.rev ?? 0)
      return { mid: m.mid, ...r }
    })
  } catch (e) {
    if (e instanceof Refusal) return refuse(e.code, e.message)
    throw e
  }
}

type Outcome = { status: 'ok' | 'duplicate'; rev?: number }

async function run(db: DocStore, meta: CollectionMeta, m: Mutation, actor: Actor, now: number): Promise<Outcome> {
  const existing = await db.get(m.coll, m.id)
  const live = existing?.data ?? null

  const branchOf = (doc: Doc | null) => {
    if (!meta.branched) return null
    const b = doc?.branchId
    return typeof b === 'string' && b ? b : null
  }
  const checkBranch = (b: string | null) => {
    if (b && actor.branches !== 'all' && !actor.branches.includes(b)) throw new Refusal('branch_forbidden', 'You do not have access to that branch')
  }
  const checkDoc = (doc: Doc) => {
    if (JSON.stringify(doc).length > MAX_DOC_BYTES) throw new Refusal('too_large', 'That record is too large')
    const why = meta.validate?.(doc)
    if (why) throw new Refusal('invalid', why)
  }

  if (m.op === 'create') {
    const doc = m.data as Doc | undefined
    if (!doc || typeof doc !== 'object' || doc.id !== m.id) throw new Refusal('invalid', 'A new record needs its id')
    if (live && meta.kind === 'ledger') return { status: 'duplicate', rev: existing!.rev }
    const keepOwned: Record<string, unknown> = {}
    if (live) for (const f of meta.owned ?? []) if (f in live) keepOwned[f] = live[f]
    const next = { ...doc, ...keepOwned } as Doc
    const branch = branchOf(next)
    checkBranch(branch)
    checkDoc(next)
    const rev = await db.put(m.coll, m.id, next, { branchId: branch, by: actor.userId })
    if (!live && meta.effects) await runEffects(db, meta.effects(next, { now }), actor, now)
    return { status: 'ok', rev }
  }

  if (m.op === 'patch') {
    if (!live) throw new Refusal('not_found', `${m.coll}/${m.id} does not exist`)
    const allowed = meta.kind === 'ledger' ? meta.patchable ?? [] : null
    const owned = new Set(meta.owned ?? [])
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(m.data ?? {})) {
      if (k === 'id') continue
      if (allowed ? !allowed.includes(k) : owned.has(k)) continue
      patch[k] = v
    }
    if (!Object.keys(patch).length) {
      if (meta.kind === 'ledger' && Object.keys(m.data ?? {}).some((k) => k !== 'id')) throw new Refusal('immutable', `${m.coll} cannot be edited once posted`)
      return { status: 'ok', rev: existing!.rev }
    }
    const next: Doc = { ...live }
    for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v }
    checkBranch(branchOf(next))
    checkDoc(next)
    const rev = await db.put(m.coll, m.id, next, { branchId: existing!.branchId ?? branchOf(next), by: actor.userId })
    return { status: 'ok', rev }
  }

  // delete
  if (meta.kind === 'ledger') throw new Refusal('immutable', `${m.coll} cannot be deleted once posted`)
  if (!live) return { status: 'duplicate', rev: existing?.rev }
  checkBranch(existing!.branchId ?? null)
  const rev = await db.put(m.coll, m.id, null, { branchId: existing!.branchId ?? null, by: actor.userId })
  return { status: 'ok', rev }
}

/** Runs what a posted document does to other documents. Missing targets are skipped (a deleted customer, say). */
export async function runEffects(db: DocStore, effects: Effect[], actor: Actor, now: number): Promise<void> {
  void now
  for (const e of effects) {
    const cur = await db.get(e.coll, e.id)
    if (e.kind === 'inc') {
      let doc = cur?.data ?? null
      if (!doc) { if (!e.init) continue; doc = { ...e.init } }
      let v = clean(num(doc[e.field]) + e.by)
      if (e.min !== undefined && v < e.min) v = e.min
      await db.put(e.coll, e.id, { ...doc, [e.field]: v }, { branchId: cur?.branchId ?? null, by: actor.userId })
    } else {
      const doc = cur?.data
      if (!doc) continue
      const patch = e.fn(doc)
      if (!patch) continue
      await db.put(e.coll, e.id, { ...doc, ...patch, id: doc.id }, { branchId: cur?.branchId ?? null, by: actor.userId })
    }
  }
}

/** The collections a person receives: those whose read permission their role has. */
export function readableCollections(actor: Actor): string[] {
  return allCollectionMetas().filter((m) => !m.local && permits(actor.can, m.readPerm ?? m.perm)).map((m) => m.name)
}

/** Everything that changed since `since`, limited to what this person may see. */
export async function pullChanges(db: DocStore, actor: Actor, since: number, limit = 500): Promise<PullResult> {
  const { docs, cursor, hasMore } = await db.changesSince(since, Math.max(1, Math.min(limit, 2000)), { colls: readableCollections(actor), branches: actor.branches })
  const out: PullResult = { cursor, hasMore, upserts: [], deletes: [] }
  for (const d of docs) {
    if (d.data) out.upserts.push({ coll: d.coll, id: d.id, data: d.data, rev: d.rev })
    else out.deletes.push({ coll: d.coll, id: d.id, rev: d.rev })
  }
  return out
}
