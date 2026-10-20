import type { Doc, DocStore, ReadFilter, StoredDoc } from './types'

/** The whole store in a Map: what the tests (and a phone checking its own work) run the rules against. */
export class MemoryDocStore implements DocStore {
  docs = new Map<string, StoredDoc>()
  mids = new Set<string>()
  private rev = 0

  private key = (coll: string, id: string) => `${coll}\u0000${id}`

  async get(coll: string, id: string) {
    const d = this.docs.get(this.key(coll, id))
    return d ? { ...d } : undefined
  }

  async put(coll: string, id: string, data: Doc | null, opts: { branchId?: string | null; by: string }) {
    void opts.by
    const rev = ++this.rev
    this.docs.set(this.key(coll, id), { coll, id, data, rev, branchId: opts.branchId ?? null })
    return rev
  }

  async hasMutation(mid: string) { return this.mids.has(mid) }
  async rememberMutation(mid: string) { this.mids.add(mid) }

  async atomic<T>(fn: () => Promise<T>): Promise<T> {
    const docs = new Map(this.docs)
    const mids = new Set(this.mids)
    const rev = this.rev
    try { return await fn() } catch (e) { this.docs = docs; this.mids = mids; this.rev = rev; throw e }
  }

  async changesSince(since: number, limit: number, filter: ReadFilter) {
    const rows = [...this.docs.values()]
      .filter((d) => d.rev > since && filter.colls.includes(d.coll) && (filter.branches === 'all' || !d.branchId || filter.branches.includes(d.branchId)))
      .sort((a, b) => a.rev - b.rev)
    const page = rows.slice(0, limit)
    return { docs: page, cursor: page.length ? page[page.length - 1].rev : since, hasMore: rows.length > limit }
  }

  /** Test helper: the live (not deleted) documents of a collection. */
  list(coll: string): Doc[] {
    return [...this.docs.values()].filter((d) => d.coll === coll && d.data).map((d) => d.data!)
  }
}
