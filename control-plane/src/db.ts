import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export type Db = pg.Pool;
export const createPool = (url: string): Db => { const pool = new pg.Pool({ connectionString: url, max: 10 }); pool.on('error', () => undefined); return pool; };

/** Applies db/migrations in order, once each, each in its own transaction. */
export async function migrate(pool: Db, dir = path.resolve(import.meta.dirname, '../db/migrations')): Promise<string[]> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  return applied;
}
