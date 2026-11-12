import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../db/schema.js';

export const DB = Symbol('DB');
export const POOL = Symbol('POOL');

export type AppDb = NodePgDatabase<typeof schema>;
/** The transaction handle passed to every unit of work. */
export type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];

export interface PoolSettings {
  url: string;
  max: number;
  statementTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
  applicationName?: string;
}

export function createAppPool(settings: PoolSettings): pg.Pool {
  const pool = new pg.Pool({
    connectionString: settings.url,
    max: settings.max,
    statement_timeout: settings.statementTimeoutMs,
    idle_in_transaction_session_timeout: settings.idleInTransactionTimeoutMs,
    application_name: settings.applicationName ?? 'erp-backend',
    connectionTimeoutMillis: 5_000,
  });
  // A connection the server drops while idle must not crash the process; the pool replaces it.
  pool.on('error', () => undefined);
  return pool;
}

export function createDb(pool: pg.Pool): AppDb {
  return drizzle(pool, { schema });
}
