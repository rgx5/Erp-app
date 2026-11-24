import { createHash } from 'node:crypto';
import type pg from 'pg';

export interface ExportFile { format: string; exportedAt: string; tenantId: string; counts?: Record<string, number>; checksum?: string; tables: Record<string, Record<string, unknown>[]> }
export interface RestoreResult { tables: number; rows: number; skipped: string[]; dryRun: boolean }

/** Checks an export file is whole: right format, the checksum matches the records, and the counts add up. Throws a plain message when it is not. */
export function verifyExportFile(data: unknown): ExportFile {
  const f = data as Partial<ExportFile> | null;
  if (!f || f.format !== 'onesync-export-v1' || typeof f.tables !== 'object' || f.tables === null) throw new Error('This is not a OneSyncERP export file.');
  if (!f.checksum) throw new Error('This export has no checksum, so it cannot be verified. Export again from the current version.');
  const actual = createHash('sha256').update(JSON.stringify(f.tables)).digest('hex');
  if (actual !== f.checksum) throw new Error('The file has been changed or damaged: its checksum does not match its records.');
  for (const [t, n] of Object.entries(f.counts ?? {})) if ((f.tables[t]?.length ?? 0) !== n) throw new Error(`The file is incomplete: ${t} should have ${n} records.`);
  return f as ExportFile;
}

const NEVER_RESTORED = new Set(['tenants', 'tenant_directory', 'tenant_entitlements', 'attachments']); // the business, its address and its licence already exist (the operator owns them); attachment bytes are not in an export
const LOCKED_PASSWORD = '!restored-sign-in-locked';

/**
 * Loads an export into a business that has just been created and has no companies yet. Run by an operator with the table-owner connection
 * (it switches triggers off for the load, which only that role may do). Everything happens in one transaction: it all lands or none of it does.
 * Sign-in is locked on every restored user (an export never holds passwords): reset the owner's password afterwards.
 */
export async function restoreExport(pool: pg.Pool, input: unknown, targetTenantId: string, opts: { dryRun?: boolean } = {}): Promise<RestoreResult> {
  const data = verifyExportFile(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    const tenant = await client.query('SELECT 1 FROM erp.tenants WHERE id = $1', [targetTenantId]);
    if (tenant.rows.length === 0) throw new Error('The target business does not exist. Create it first.');
    const used = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM erp.companies WHERE tenant_id = $1', [targetTenantId]);
    if (Number(used.rows[0]?.n) > 0) throw new Error('The target business already has data. Restore only into a new, empty business.');
    // only tables the database really has, with a tenant column: the file cannot name anything else
    const valid = new Set((await client.query<{ table_name: string }>(`SELECT DISTINCT c.table_name FROM information_schema.columns c JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE' WHERE c.table_schema = 'erp' AND c.column_name = 'tenant_id'`)).rows.map((r) => r.table_name));
    let rows = 0; let tables = 0; const skipped: string[] = [];
    for (const [table, list] of Object.entries(data.tables)) {
      if (NEVER_RESTORED.has(table) || !valid.has(table)) { skipped.push(table); continue; }
      const ident = `erp."${table.replaceAll('"', '')}"`;
      await client.query(`DELETE FROM ${ident} WHERE tenant_id = $1`, [targetTenantId]); // the empty business's own starter records are replaced by the file's
      for (let i = 0; i < list.length; i += 500) {
        const chunk = list.slice(i, i + 500).map((r) => ({ ...r, tenant_id: targetTenantId, ...(table === 'users' ? { password_hash: LOCKED_PASSWORD } : {}) }));
        await client.query(`INSERT INTO ${ident} SELECT * FROM jsonb_populate_recordset(null::${ident}, $1::jsonb)`, [JSON.stringify(chunk)]);
      }
      rows += list.length; tables++;
    }
    // counters that hand out the next number must carry on after the restored ones
    const serials = await client.query<{ table_name: string; column_name: string }>(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'erp' AND (column_default LIKE 'nextval(%' OR is_identity = 'YES')`);
    for (const s of serials.rows) await client.query(`SELECT setval(pg_get_serial_sequence('erp."${s.table_name}"', '${s.column_name}'), COALESCE((SELECT max("${s.column_name}") FROM erp."${s.table_name}"), 1))`);
    await client.query(opts.dryRun ? 'ROLLBACK' : 'COMMIT');
    return { tables, rows, skipped, dryRun: Boolean(opts.dryRun) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { client.release(); }
}
