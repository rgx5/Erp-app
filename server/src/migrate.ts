import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool } from 'pg'

/** Applies `migrations/*.sql` in filename order, each once, recorded in `schema_migrations`. Safe to run on every start. */
export async function migrate(pool: Pool, dir = join(__dirname, '..', 'migrations'), log: (m: string) => void = () => {}): Promise<string[]> {
  const c = await pool.connect()
  const applied: string[] = []
  try {
    // One migrator at a time (two instances starting together must not both create the same table).
    await c.query('SELECT pg_advisory_lock(727274)')
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())')
    const done = new Set((await c.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue
      log(`applying ${file}`)
      await c.query('BEGIN')
      try {
        await c.query(readFileSync(join(dir, file), 'utf8'))
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await c.query('COMMIT')
        applied.push(file)
      } catch (e) {
        await c.query('ROLLBACK')
        throw new Error(`migration ${file} failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  } finally {
    try { await c.query('SELECT pg_advisory_unlock(727274)') } catch { /* released with the connection */ }
    c.release()
  }
  return applied
}
