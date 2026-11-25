/**
 * Moves one client between cells as an exact copy (see src/maintenance/tenant-move.ts). Needs the database ADMINISTRATOR connection of each cell (the table owner is held back by row-level security, and only an administrator may switch triggers off for the load).
 *   SOURCE_ADMIN_DATABASE_URL=...  npm run maintenance:tenant-move -- export --tenant <id> --dir ./move-1234
 *   npm run maintenance:tenant-move -- verify --dir ./move-1234                       (checks the folder only)
 *   TARGET_ADMIN_DATABASE_URL=...  npm run maintenance:tenant-move -- import --dir ./move-1234 [--dry-run]
 */
import pg from 'pg';
import { exportTenant, importTenant, verifyTenantExport } from '../src/maintenance/tenant-move.js';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (flag: string): string | undefined => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : undefined; };
const dir = arg('--dir');
if (!cmd || !dir) { console.error('usage: tenant-move export|verify|import --dir <folder> [--tenant <id>] [--dry-run]'); process.exit(2); }
const pool = (name: string): pg.Pool => { const url = process.env[name]; if (!url) { console.error(`${name} is required`); process.exit(2); } return new pg.Pool({ connectionString: url, max: 1 }); };
if (cmd === 'verify') { const m = await verifyTenantExport(dir); console.log(`OK: ${m.slug} (${m.tenantId}), ${Object.keys(m.tables).length} tables, ${Object.values(m.tables).reduce((n, t) => n + t.rows, 0)} rows, migration ${m.migrationHead}, exported ${m.exportedAt}`); process.exit(0); }
if (cmd === 'export') {
  const tenant = arg('--tenant'); if (!tenant) { console.error('--tenant is required'); process.exit(2); }
  const p = pool('SOURCE_ADMIN_DATABASE_URL');
  try { const m = await exportTenant(p, tenant, dir); console.log(`exported ${Object.keys(m.tables).length} tables, ${Object.values(m.tables).reduce((n, t) => n + t.rows, 0)} rows to ${dir}`); } finally { await p.end(); }
} else if (cmd === 'import') {
  const p = pool('TARGET_ADMIN_DATABASE_URL');
  try { console.log(JSON.stringify(await importTenant(p, dir, { dryRun: process.argv.includes('--dry-run') }))); } finally { await p.end(); }
} else { console.error(`unknown command ${cmd}`); process.exit(2); }
