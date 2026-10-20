import { Pool, types, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg'

// BIGINT (revisions, epoch millis — far below 2^53) and NUMERIC arrive as strings by default.
types.setTypeParser(20, (v) => Number(v))
types.setTypeParser(1700, (v) => Number(v))

/** Anything that can run a query: the pool, or one client inside a transaction. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>
}

export function sslFor(url: string): PoolConfig['ssl'] {
  if (/sslmode=(require|verify-full|verify-ca)/.test(url) || process.env.PGSSLMODE === 'require') {
    return process.env.DATABASE_SSL_INSECURE === '1' ? { rejectUnauthorized: false } : true
  }
  return undefined
}

export function createPool(url: string, max = 10): Pool {
  return new Pool({ connectionString: url, max, ssl: sslFor(url) })
}

/** Runs `fn` in a transaction on one connection; commits if it returns, rolls back if it throws. */
export async function withTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const r = await fn(c)
    await c.query('COMMIT')
    return r
  } catch (e) {
    try { await c.query('ROLLBACK') } catch { /* the connection is gone; nothing to undo */ }
    throw e
  } finally {
    c.release()
  }
}

export const one = async <R extends QueryResultRow = QueryResultRow>(q: Queryable, text: string, values?: unknown[]): Promise<R | undefined> =>
  (await q.query<R>(text, values)).rows[0]
