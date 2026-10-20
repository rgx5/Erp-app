import type { PoolClient } from 'pg'
import type { Doc, DocStore, ReadFilter, StoredDoc } from '@/replication/types'

interface DocRow { coll: string; id: string; data: Doc | null; rev: number; branch_id: string | null }

/**
 * The replication rules' storage, on PostgreSQL. One instance per request transaction, bound to one organisation: every statement
 * carries `org_id`, so a bug elsewhere cannot reach another tenant's documents.
 *
 * Writers to an organisation are serialised by locking its `orgs` row (`lockOrg`) before they read anything, so a read-modify-write
 * (an effect adding to a stock figure) can never interleave with another request's. Revisions come from that row's counter, so
 * they commit in the order they were issued.
 */
export class PgDocStore implements DocStore {
  private savepoints = 0

  constructor(private readonly c: PoolClient, readonly orgId: string) {}

  /** Take the organisation's write lock. Call first in any transaction that writes documents. */
  async lockOrg(): Promise<void> {
    const r = await this.c.query('SELECT 1 FROM orgs WHERE id = $1 FOR UPDATE', [this.orgId])
    if (!r.rowCount) throw new Error('organisation not found')
  }

  async get(coll: string, id: string): Promise<StoredDoc | undefined> {
    const r = await this.c.query<DocRow>('SELECT coll, id, data, rev, branch_id FROM docs WHERE org_id = $1 AND coll = $2 AND id = $3', [this.orgId, coll, id])
    const d = r.rows[0]
    return d ? { coll: d.coll, id: d.id, data: d.data, rev: d.rev, branchId: d.branch_id } : undefined
  }

  async put(coll: string, id: string, data: Doc | null, opts: { branchId?: string | null; by: string }): Promise<number> {
    const rev = (await this.c.query<{ rev: number }>('UPDATE orgs SET rev = rev + 1 WHERE id = $1 RETURNING rev', [this.orgId])).rows[0]?.rev
    if (rev === undefined) throw new Error('organisation not found')
    await this.c.query(
      `INSERT INTO docs (org_id, coll, id, branch_id, data, rev, deleted, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now(), $8)
       ON CONFLICT (org_id, coll, id) DO UPDATE
         SET branch_id = EXCLUDED.branch_id, data = EXCLUDED.data, rev = EXCLUDED.rev, deleted = EXCLUDED.deleted, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [this.orgId, coll, id, opts.branchId ?? null, data === null ? null : JSON.stringify(data), rev, data === null, opts.by],
    )
    return rev
  }

  async hasMutation(mid: string): Promise<boolean> {
    const r = await this.c.query('SELECT 1 FROM mutations WHERE org_id = $1 AND mid = $2', [this.orgId, mid])
    return (r.rowCount ?? 0) > 0
  }

  async rememberMutation(mid: string, rev: number): Promise<void> {
    await this.c.query('INSERT INTO mutations (org_id, mid, rev) VALUES ($1, $2, $3) ON CONFLICT (org_id, mid) DO NOTHING', [this.orgId, mid, rev])
  }

  /** A SAVEPOINT: if `fn` throws, everything it wrote is undone and the surrounding transaction carries on. */
  async atomic<T>(fn: () => Promise<T>): Promise<T> {
    const name = `kosh_sp_${++this.savepoints}`
    await this.c.query(`SAVEPOINT ${name}`)
    try {
      const r = await fn()
      await this.c.query(`RELEASE SAVEPOINT ${name}`)
      return r
    } catch (e) {
      await this.c.query(`ROLLBACK TO SAVEPOINT ${name}`)
      await this.c.query(`RELEASE SAVEPOINT ${name}`)
      throw e
    }
  }

  /**
   * Everything after `since` that the filter allows. Run it on a connection in a REPEATABLE READ transaction so the documents and
   * the organisation's current revision come from one snapshot: when the page is the last one, the cursor can safely jump to that
   * revision (documents the person may not see do not make them re-ask for the same range forever) without ever skipping a
   * document that commits a moment later.
   */
  async changesSince(since: number, limit: number, filter: ReadFilter) {
    const all = filter.branches === 'all'
    const r = await this.c.query<DocRow>(
      `SELECT coll, id, data, rev, branch_id FROM docs
        WHERE org_id = $1 AND rev > $2 AND coll = ANY($3::text[]) AND ($4::boolean OR branch_id IS NULL OR branch_id = ANY($5::text[]))
        ORDER BY rev LIMIT $6`,
      [this.orgId, since, filter.colls, all, all ? [] : filter.branches, limit + 1],
    )
    const hasMore = r.rows.length > limit
    const rows = hasMore ? r.rows.slice(0, limit) : r.rows
    const docs: StoredDoc[] = rows.map((d) => ({ coll: d.coll, id: d.id, data: d.data, rev: d.rev, branchId: d.branch_id }))
    let cursor = docs.length ? docs[docs.length - 1].rev : since
    if (!hasMore) {
      const o = await this.c.query<{ rev: number }>('SELECT rev FROM orgs WHERE id = $1', [this.orgId])
      cursor = Math.max(cursor, o.rows[0]?.rev ?? 0)
    }
    return { docs, cursor, hasMore }
  }
}
