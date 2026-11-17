/**
 * Purges idempotency keys, delivered outbox events and old sessions. Needs MIGRATOR_DATABASE_URL (the table-owner role).
 *   npm run maintenance:retention -- --dry-run
 *   npm run maintenance:retention -- --outbox-days 14 --session-days 90 --idempotency-hours 48
 */
import pg from 'pg';
import { runRetention } from '../src/maintenance/retention.js';

const url = process.env['MIGRATOR_DATABASE_URL'];
if (!url) { console.error('MIGRATOR_DATABASE_URL is required'); process.exit(2); }
const args = process.argv.slice(2);
const num = (flag: string): number | undefined => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : undefined; };
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const policy = { dryRun: args.includes('--dry-run'), ...(num('--outbox-days') !== undefined ? { outboxDeliveredDays: num('--outbox-days') as number } : {}), ...(num('--session-days') !== undefined ? { sessionDays: num('--session-days') as number } : {}), ...(num('--idempotency-hours') !== undefined ? { idempotencyGraceHours: num('--idempotency-hours') as number } : {}) };
  console.log(JSON.stringify(await runRetention(pool, policy)));
} finally { await pool.end(); }
