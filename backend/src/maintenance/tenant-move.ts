import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type pg from 'pg';

/**
 * Moves one client from one cell (database) to another as an exact physical copy: every row of every table that belongs to the client, including
 * attachments, users and password hashes, the licence and the ledger, so people sign in with the same passwords and the books are byte for byte
 * the same. (The JSON "data export" cannot do this: it leaves out attachments and passwords, and refuses very large clients.)
 *
 * Export reads inside one repeatable-read snapshot, so it is consistent even while the client is working; for a move, put the client in read-only
 * first so nothing is written after the snapshot. Both ends need the database administrator connection (the table owner is held back by row-level security, and only an administrator may switch triggers off for the load) and refuses a
 * target that already has the client, or whose migrations differ from the source. Both ends verify row counts and checksums.
 * Left out on purpose: sign-in sessions (people sign in again), idempotency keys and the outbox dispatch queue (transient delivery state).
 */
export const MOVE_FORMAT = 'onesync-tenant-move-v1';
const SKIPPED = new Set(['sessions', 'idempotency_keys', 'outbox_dispatch', 'schema_migrations']);
const BATCH = 2000;

export interface MoveManifest {
  format: typeof MOVE_FORMAT; tenantId: string; slug: string; exportedAt: string; migrationHead: string;
  tables: Record<string, { rows: number; sha256: string }>;
}
export interface MoveResult { tenantId: string; tables: number; rows: number; dryRun: boolean }

const ident = (t: string): string => `erp."${t.replaceAll('"', '')}"`;

/** The tables that hold this client's rows (a tenant_id column; the client's own row in tenants is keyed by id), in a stable order. */
async function tenantTables(c: pg.PoolClient): Promise<{ table: string; key: string }[]> {
  const r = await c.query<{ table_name: string; column_name: string }>(`SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE' WHERE c.table_schema = 'erp' AND (c.column_name = 'tenant_id' OR (c.table_name = 'tenants' AND c.column_name = 'id')) ORDER BY c.table_name`);
  const seen = new Map<string, string>();
  for (const row of r.rows) { if (SKIPPED.has(row.table_name)) continue; if (row.table_name === 'tenants') { seen.set('tenants', 'id'); continue; } if (!seen.has(row.table_name)) seen.set(row.table_name, row.column_name); }
  return [...seen].map(([table, key]) => ({ table, key }));
}

export async function exportTenant(pool: pg.Pool, tenantId: string, dir: string): Promise<MoveManifest> {
  if (existsSync(join(dir, 'manifest.json'))) throw new Error('That folder already holds an export. Use an empty folder.');
  mkdirSync(dir, { recursive: true });
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const t = (await c.query<{ slug: string }>('SELECT slug FROM erp.tenants WHERE id = $1', [tenantId])).rows[0];
    if (!t) throw new Error('That client does not exist on this cell.');
    const head = (await c.query<{ head: string }>('SELECT max(id) AS head FROM erp.schema_migrations')).rows[0]?.head ?? '';
    const tables: MoveManifest['tables'] = {};
    for (const { table, key } of await tenantTables(c)) {
      const hash = createHash('sha256'); let rows = 0;
      const out = createWriteStream(join(dir, `${table}.ndjson`));
      await c.query(`DECLARE mv NO SCROLL CURSOR FOR SELECT row_to_json(x)::text AS j FROM ${ident(table)} x WHERE x."${key}" = $1`, [tenantId]);
      for (;;) {
        const batch = await c.query<{ j: string }>(`FETCH ${BATCH} FROM mv`);
        if (batch.rows.length === 0) break;
        const text = batch.rows.map((r) => `${r.j}\n`).join('');
        hash.update(text); rows += batch.rows.length;
        if (!out.write(text)) await new Promise((res) => out.once('drain', res));
      }
      await c.query('CLOSE mv');
      await new Promise<void>((res, rej) => { out.end(() => res()); out.on('error', rej); });
      tables[table] = { rows, sha256: hash.digest('hex') };
    }
    await c.query('COMMIT');
    const manifest: MoveManifest = { format: MOVE_FORMAT, tenantId, slug: t.slug, exportedAt: new Date().toISOString(), migrationHead: head, tables };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
}

/** Reads a folder written by exportTenant and checks every file against the manifest, without touching any database. */
export async function verifyTenantExport(dir: string): Promise<MoveManifest> {
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as MoveManifest;
  if (m.format !== MOVE_FORMAT) throw new Error('This is not a OneSyncERP client move folder.');
  for (const [table, info] of Object.entries(m.tables)) {
    const hash = createHash('sha256'); let rows = 0;
    for await (const line of createInterface({ input: createReadStream(join(dir, `${table}.ndjson`)), crlfDelay: Infinity })) { if (line === '') continue; hash.update(`${line}\n`); rows++; }
    if (rows !== info.rows) throw new Error(`${table}: the folder has ${rows} rows but should have ${info.rows}.`);
    if (hash.digest('hex') !== info.sha256) throw new Error(`${table}: the file has been changed or damaged (checksum differs).`);
  }
  return m;
}

export async function importTenant(pool: pg.Pool, dir: string, opts: { dryRun?: boolean } = {}): Promise<MoveResult> {
  const m = await verifyTenantExport(dir);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL session_replication_role = replica');
    const head = (await c.query<{ head: string }>('SELECT max(id) AS head FROM erp.schema_migrations')).rows[0]?.head ?? '';
    if (head !== m.migrationHead) throw new Error(`The target database is at migration ${head || 'none'} but the export is from ${m.migrationHead}. Bring both to the same release first.`);
    if ((await c.query('SELECT 1 FROM erp.tenants WHERE id = $1 OR slug = $2', [m.tenantId, m.slug])).rows.length > 0) throw new Error('That client (or its slug) already exists on the target cell. A move goes into a cell that does not have it.');
    const present = new Set((await tenantTables(c)).map((t) => t.table));
    const extra = Object.keys(m.tables).filter((t) => !present.has(t));
    if (extra.length) throw new Error(`The export has tables the target does not: ${extra.join(', ')}.`);
    let rows = 0;
    // tenants first so everything else has its owner, then the rest
    for (const table of ['tenants', ...Object.keys(m.tables).filter((t) => t !== 'tenants')]) {
      let batch: string[] = []; let n = 0;
      const flush = async (): Promise<void> => { if (batch.length === 0) return; await c.query(`INSERT INTO ${ident(table)} SELECT * FROM jsonb_populate_recordset(null::${ident(table)}, $1::jsonb)`, [`[${batch.join(',')}]`]); batch = []; };
      for await (const line of createInterface({ input: createReadStream(join(dir, `${table}.ndjson`)), crlfDelay: Infinity })) { if (line === '') continue; batch.push(line); n++; if (batch.length >= BATCH) await flush(); }
      await flush();
      const key = table === 'tenants' ? 'id' : 'tenant_id';
      const got = Number((await c.query<{ n: string }>(`SELECT count(*) AS n FROM ${ident(table)} WHERE "${key}" = $1`, [m.tenantId])).rows[0]?.n);
      if (got !== (m.tables[table]?.rows ?? 0)) throw new Error(`${table}: ${got} rows landed but ${m.tables[table]?.rows} were expected. Nothing was changed.`);
      rows += n;
    }
    // the sign-in directory is kept by a trigger that is off during the load
    await c.query('INSERT INTO erp.tenant_directory (slug, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [m.slug, m.tenantId]);
    // counters that hand out the next number must carry on after the copied ones
    const serials = await c.query<{ table_name: string; column_name: string }>(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'erp' AND (column_default LIKE 'nextval(%' OR is_identity = 'YES')`);
    for (const s of serials.rows) await c.query(`SELECT setval(pg_get_serial_sequence('erp."${s.table_name}"', '${s.column_name}'), COALESCE((SELECT max("${s.column_name}") FROM erp."${s.table_name}"), 1))`);
    const books = (await c.query<{ ok: boolean }>(`SELECT coalesce(sum(debit), 0) = coalesce(sum(credit), 0) AS ok FROM erp.journal_lines WHERE tenant_id = $1`, [m.tenantId])).rows[0]?.ok;
    if (books === false) throw new Error('After the copy the ledger does not balance. Nothing was changed.');
    await c.query(opts.dryRun ? 'ROLLBACK' : 'COMMIT');
    return { tenantId: m.tenantId, tables: Object.keys(m.tables).length, rows, dryRun: Boolean(opts.dryRun) };
  } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
}
