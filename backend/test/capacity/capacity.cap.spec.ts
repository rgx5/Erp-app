import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

/**
 * How the platform behaves with many clients on one cell, each holding a large ledger. Sizes come from the environment so the same test runs small
 * on a laptop and large on a cell-sized machine:
 *   CAPACITY_TENANTS (default 10)  CAPACITY_ENTRIES per client (default 20000 journal entries = 40000 lines)  CAPACITY_BIG_ENTRIES the one big client (default 5x)
 *   CAPACITY_OUT  where the JSON results go (default ../docs/platform/capacity-results.json)
 * The ledger is the biggest and slowest-growing table, so it stands in for volume. Rows are bulk-copied from real posted entries with triggers skipped
 * (the copies are balanced by construction); everything measured goes through the real HTTP API as the real application role, with RLS on.
 */
const TENANTS = Number(process.env['CAPACITY_TENANTS'] ?? 10);
const ENTRIES = Number(process.env['CAPACITY_ENTRIES'] ?? 20_000);
const BIG = Number(process.env['CAPACITY_BIG_ENTRIES'] ?? ENTRIES * 5);
const OUT = process.env['CAPACITY_OUT'] ?? new URL('../../../docs/platform/capacity-results.json', import.meta.url).pathname;

let server: TestServer;
const supers = superPool();
let kit: ReturnType<typeof shopKit>;
beforeAll(async () => { server = await startServer({ TENANT_MAX_CONCURRENT_HEAVY: '0' }); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number); };
const time = async (fn: () => Promise<{ status: number }>): Promise<number> => { const t = performance.now(); const r = await fn(); expect(r.status).toBe(200); return performance.now() - t; };
async function measure(fn: () => Promise<{ status: number }>, runs = 15): Promise<{ p50: number; p95: number; max: number }> {
  await fn(); // warm the plan
  const xs: number[] = []; for (let i = 0; i < runs; i++) xs.push(await time(fn));
  return { p50: pct(xs, 50), p95: pct(xs, 95), max: Math.round(Math.max(...xs)) };
}

/** Gives a client `n` more balanced journal entries (two lines each) spread over the year, copied from one real posted entry. */
async function grow(s: Shop, n: number, tag: string): Promise<void> {
  const c = await supers.connect();
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL session_replication_role = 'replica'");
    const base = (await c.query('SELECT e.* FROM erp.journal_entries e WHERE e.tenant_id = $1 ORDER BY e.posting_date LIMIT 1', [s.tenant])).rows[0];
    const lines = (await c.query('SELECT account_id, debit, credit FROM erp.journal_lines WHERE tenant_id = $1 AND entry_id = $2 ORDER BY line_no', [s.tenant, base.id])).rows;
    const [a, b] = [lines[0].account_id, lines[1].account_id];
    await c.query(`INSERT INTO erp.journal_entries (tenant_id, id, company_id, fiscal_year_id, period_id, entry_no, journal_type, source_type, source_id, source_event, posting_date, description, total_debit, total_credit, line_count)
      SELECT $1::uuid, md5($1::text || $4::text || g::text)::uuid, $2::uuid, $3::uuid, $5::uuid, $4::text || '-' || g, 'general', 'manual', NULL, 'post', DATE '2025-04-01' + (g % 360), 'capacity ' || g, 100 + (g % 900), 100 + (g % 900), 2
      FROM generate_series(1, $6::int) g`, [s.tenant, base.company_id, base.fiscal_year_id, tag, base.period_id, n]);
    await c.query(`INSERT INTO erp.journal_lines (tenant_id, id, entry_id, company_id, line_no, account_id, posting_date, debit, credit)
      SELECT $1::uuid, md5($1::text || $3::text || g::text || l::text)::uuid, md5($1::text || $3::text || g::text)::uuid, $2::uuid, l, CASE l WHEN 1 THEN $4::uuid ELSE $5::uuid END, DATE '2025-04-01' + (g % 360),
             CASE l WHEN 1 THEN 100 + (g % 900) ELSE 0 END, CASE l WHEN 2 THEN 100 + (g % 900) ELSE 0 END
      FROM generate_series(1, $6::int) g, generate_series(1, 2) l`, [s.tenant, base.company_id, tag, a, b, n]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  await supers.query('ANALYZE erp.journal_lines'); await supers.query('ANALYZE erp.journal_entries');
}

const results: Record<string, unknown> = {};
describe('capacity', () => {
  let shops: Shop[] = [];
  let big!: Shop;

  it(`provisions ${TENANTS} clients and grows each to ${ENTRIES} entries, one to ${BIG}`, async () => {
    const t0 = performance.now();
    for (let i = 0; i < TENANTS; i++) {
      const s = await kit.shop(`Capacity ${i}`);
      ok(await call(server, 'POST', '/v1/journal-entries', { tenant: s.tenant, body: { companyId: s.companyId, postingDate: '2025-04-10', description: 'seed', lines: [{ accountId: s.acc['1120'], debit: '100.00' }, { accountId: s.acc['4100'], credit: '100.00' }] } }));
      await grow(s, i === 0 ? BIG : ENTRIES, `CAP${i}`);
      shops.push(s);
    }
    big = shops[0] as Shop;
    const size = (await supers.query("SELECT pg_total_relation_size('erp.journal_lines') AS lines, pg_total_relation_size('erp.journal_entries') AS entries, pg_database_size(current_database()) AS db")).rows[0];
    const rows = (await supers.query('SELECT count(*)::int AS n FROM erp.journal_lines')).rows[0].n;
    results['setup'] = { clients: TENANTS, entriesPerClient: ENTRIES, bigClientEntries: BIG, journalLinesTotal: rows, journalLinesBytes: Number(size.lines), journalEntriesBytes: Number(size.entries), databaseBytes: Number(size.db), seconds: Math.round((performance.now() - t0) / 1000) };
    expect(rows).toBeGreaterThan(TENANTS * ENTRIES);
  });

  it('answers the heavy reports for the biggest client within the time a person will wait', async () => {
    const q = (path: string) => () => call(server, 'GET', `/v1/${path}${path.includes('?') ? '&' : '?'}companyId=${big.companyId}`, { tenant: big.tenant });
    const report = {
      trialBalance: await measure(q('accounting/trial-balance?from=2025-04-01&to=2026-03-31')),
      profitLoss: await measure(q('accounting/statements/profit-loss?from=2025-04-01&to=2026-03-31')),
      balanceSheet: await measure(q('accounting/statements/balance-sheet?asOf=2026-03-31')),
      accountLedger: await measure(q(`accounting/account-ledger?accountId=${big.acc['1120']}&from=2025-04-01&to=2026-03-31&limit=200`)),
      journalList: await measure(q('journal-entries?limit=50')),
    };
    results['biggestClient'] = report;
    for (const [name, r] of Object.entries(report)) expect(r.p95, `${name} p95 ${r.p95}ms`).toBeLessThan(15_000); // the statement timeout
  });

  it('keeps a small client fast while the biggest client runs reports (noisy neighbour)', async () => {
    const small = shops[shops.length - 1] as Shop;
    const light = () => call(server, 'GET', `/v1/journal-entries?companyId=${small.companyId}&limit=20`, { tenant: small.tenant });
    const alone = await measure(light, 20);
    const stop = { v: false };
    const loops = 3;
    const hammers = Array.from({ length: loops }, async () => { while (!stop.v) await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${big.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: big.tenant }); });
    const during = await measure(light, 20);
    stop.v = true; await Promise.all(hammers);
    results['noisyNeighbour'] = { smallClientAlone: alone, smallClientWhileBigRunsReports: during, concurrentReportLoops: loops };
    expect(during.p95).toBeLessThan(Math.max(2_000, alone.p95 * 20));
  });

  it('shows what an isolated client export costs (the per-client restore path)', async () => {
    const t = performance.now();
    const r = await call(server, 'GET', '/v1/reports/export', { tenant: big.tenant });
    results['exportBiggestClient'] = { status: r.status, seconds: Math.round((performance.now() - t) / 100) / 10 };
  });

  it('records the results', () => {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), node: process.version, ...results }, null, 2));
  });
});
