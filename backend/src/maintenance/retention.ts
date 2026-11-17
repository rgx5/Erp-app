import type pg from 'pg';

export interface RetentionPolicy {
  /** Idempotency keys are deleted this long after they expired. */
  idempotencyGraceHours: number;
  /** Delivered outbox events (and their consumption marks) are deleted this many days after delivery. Dead letters are kept. */
  outboxDeliveredDays: number;
  /** Sessions are deleted this many days after they expired or were revoked. */
  sessionDays: number;
  /** Rows per delete statement, so a purge never holds long locks. */
  batchSize: number;
  dryRun: boolean;
}
export const DEFAULT_POLICY: RetentionPolicy = { idempotencyGraceHours: 24, outboxDeliveredDays: 30, sessionDays: 180, batchSize: 5_000, dryRun: false };
export interface RetentionResult { idempotencyKeys: number; outboxEvents: number; outboxConsumed: number; sessions: number; dryRun: boolean }

/**
 * Purges operational tables that only grow. Run as the migrator (table owner) role; the runtime role cannot delete. Never touches the
 * audit log, ledgers, documents or master data, and keeps dead-lettered outbox events for investigation. Deletes in batches, so it is
 * safe to run while the application serves traffic, and idempotent.
 */
export async function runRetention(pool: pg.Pool, overrides: Partial<RetentionPolicy> = {}): Promise<RetentionResult> {
  const p = { ...DEFAULT_POLICY, ...overrides };
  const result: RetentionResult = { idempotencyKeys: 0, outboxEvents: 0, outboxConsumed: 0, sessions: 0, dryRun: p.dryRun };
  const count = async (sql: string, params: unknown[]): Promise<number> => Number((await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM (${sql}) q`, params)).rows[0]?.n ?? 0);
  const drain = async (deleteSql: string, params: unknown[]): Promise<number> => {
    let total = 0;
    for (;;) {
      const r = await pool.query(deleteSql, [...params, p.batchSize]);
      total += r.rowCount ?? 0;
      if ((r.rowCount ?? 0) < p.batchSize) return total;
    }
  };

  const idemWhere = `expires_at < now() - make_interval(hours => $1)`;
  const sessWhere = `GREATEST(expires_at, COALESCE(revoked_at, expires_at)) < now() - make_interval(days => $1)`;
  const doneWhere = `d.done_at IS NOT NULL AND d.dead_at IS NULL AND d.done_at < now() - make_interval(days => $1)`;
  if (p.dryRun) {
    result.idempotencyKeys = await count(`SELECT 1 FROM erp.idempotency_keys WHERE ${idemWhere}`, [p.idempotencyGraceHours]);
    result.sessions = await count(`SELECT 1 FROM erp.sessions WHERE ${sessWhere}`, [p.sessionDays]);
    result.outboxEvents = await count(`SELECT 1 FROM erp.outbox_dispatch d WHERE ${doneWhere}`, [p.outboxDeliveredDays]);
    result.outboxConsumed = await count(`SELECT 1 FROM erp.outbox_consumed c JOIN erp.outbox_dispatch d ON d.event_id = c.event_id WHERE ${doneWhere}`, [p.outboxDeliveredDays]);
    return result;
  }
  result.idempotencyKeys = await drain(`DELETE FROM erp.idempotency_keys WHERE ctid IN (SELECT ctid FROM erp.idempotency_keys WHERE ${idemWhere} LIMIT $2)`, [p.idempotencyGraceHours]);
  result.sessions = await drain(`DELETE FROM erp.sessions WHERE ctid IN (SELECT ctid FROM erp.sessions WHERE ${sessWhere} LIMIT $2)`, [p.sessionDays]);
  // Outbox: consumption marks first, then the dispatch pointer, then the event, for events delivered long enough ago.
  for (;;) {
    const ids = (await pool.query<{ event_id: string }>(`SELECT d.event_id FROM erp.outbox_dispatch d WHERE ${doneWhere} LIMIT $2`, [p.outboxDeliveredDays, p.batchSize])).rows.map((r) => r.event_id);
    if (ids.length === 0) break;
    result.outboxConsumed += (await pool.query(`DELETE FROM erp.outbox_consumed WHERE event_id = ANY($1::uuid[])`, [ids])).rowCount ?? 0;
    await pool.query(`DELETE FROM erp.outbox_dispatch WHERE event_id = ANY($1::uuid[])`, [ids]);
    result.outboxEvents += (await pool.query(`DELETE FROM erp.outbox_events WHERE id = ANY($1::uuid[])`, [ids])).rowCount ?? 0;
    if (ids.length < p.batchSize) break;
  }
  return result;
}
