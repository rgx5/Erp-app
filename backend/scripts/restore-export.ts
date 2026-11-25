/**
 * Restores a OneSyncERP export file into a new, empty business. Needs MIGRATOR_DATABASE_URL pointing at the database ADMINISTRATOR (superuser) connection: the table owner is held back by row-level security and may not switch triggers off.
 *   npm run maintenance:restore -- --file export.json --tenant <id of the new business> [--dry-run]
 *   npm run maintenance:restore -- --file export.json --verify          (only checks the file)
 * Sign-in is locked on every restored user; reset the owner's password afterwards.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { restoreExport, verifyExportFile } from '../src/maintenance/restore-export.js';

const args = process.argv.slice(2);
const arg = (flag: string): string | undefined => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const file = arg('--file');
if (!file) { console.error('--file is required'); process.exit(2); }
const data = JSON.parse(readFileSync(file, 'utf8')) as unknown;
if (args.includes('--verify')) {
  const f = verifyExportFile(data);
  console.log(`OK: exported ${f.exportedAt}, ${Object.keys(f.tables).length} tables, ${Object.values(f.tables).reduce((n, t) => n + t.length, 0)} records.`);
  process.exit(0);
}
const url = process.env['MIGRATOR_DATABASE_URL']; const tenant = arg('--tenant');
if (!url || !tenant) { console.error('MIGRATOR_DATABASE_URL and --tenant are required'); process.exit(2); }
const pool = new pg.Pool({ connectionString: url, max: 1 });
try { console.log(JSON.stringify(await restoreExport(pool, data, tenant, { dryRun: args.includes('--dry-run') }))); } finally { await pool.end(); }
