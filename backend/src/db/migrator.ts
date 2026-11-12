import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../db/migrations');
/** Serialises concurrent migrators (two deploy pods starting together). */
const ADVISORY_LOCK_KEY = 7_420_042_001;

export interface MigrationFile {
  id: string;
  checksum: string;
  sql: string;
}
export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}
export class MigrationError extends Error {}

export async function readMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n)).sort();
  return Promise.all(
    names.map(async (id) => {
      const sql = await readFile(path.join(dir, id), 'utf8');
      return { id, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

/**
 * Forward-only migrations. Each file runs in its own transaction and is recorded with a checksum.
 * Refuses to continue if an applied file was edited, is missing, or a new file sorts before an applied one.
 * Must be run as the schema owner (erp_migrator), never as the runtime role.
 */
export async function migrateUp(databaseUrl: string, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const files = await readMigrations(dir);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS erp.schema_migrations (
      id          text        PRIMARY KEY,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer     NOT NULL
    )`);
    // Non-tenant metadata: the runtime role may read it (readiness check) and never write it.
    await client.query('GRANT SELECT ON erp.schema_migrations TO erp_app');
    const { rows } = await client.query<{ id: string; checksum: string }>('SELECT id, checksum FROM erp.schema_migrations ORDER BY id');
    const byId = new Map(files.map((f) => [f.id, f]));
    for (const row of rows) {
      const file = byId.get(row.id);
      if (!file) throw new MigrationError(`Applied migration ${row.id} is missing from the migrations directory`);
      if (file.checksum !== row.checksum) throw new MigrationError(`Applied migration ${row.id} was modified after it ran`);
    }
    const appliedIds = new Set(rows.map((r) => r.id));
    const lastApplied = rows.at(-1)?.id ?? '';
    const pending = files.filter((f) => !appliedIds.has(f.id));
    const outOfOrder = pending.find((f) => f.id < lastApplied);
    if (outOfOrder) throw new MigrationError(`Migration ${outOfOrder.id} sorts before the last applied migration ${lastApplied}`);

    const applied: string[] = [];
    for (const file of pending) {
      const started = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO erp.schema_migrations (id, checksum, duration_ms) VALUES ($1, $2, $3)', [
          file.id,
          file.checksum,
          Date.now() - started,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new MigrationError(`Migration ${file.id} failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
      }
      applied.push(file.id);
    }
    return { applied, alreadyApplied: rows.map((r) => r.id) };
  } finally {
    await client.end();
  }
}

export async function migrationStatus(databaseUrl: string, dir = MIGRATIONS_DIR): Promise<{ applied: string[]; pending: string[] }> {
  const files = await readMigrations(dir);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const exists = await client.query("SELECT to_regclass('erp.schema_migrations') AS t");
    const rows = exists.rows[0]?.t
      ? (await client.query<{ id: string }>('SELECT id FROM erp.schema_migrations ORDER BY id')).rows.map((r) => r.id)
      : [];
    const done = new Set(rows);
    return { applied: rows, pending: files.filter((f) => !done.has(f.id)).map((f) => f.id) };
  } finally {
    await client.end();
  }
}

/** The newest migration this build expects. Readiness compares it with what the database has applied. */
export async function expectedMigrationHead(dir = MIGRATIONS_DIR): Promise<string> {
  return (await readMigrations(dir)).at(-1)?.id ?? '';
}
