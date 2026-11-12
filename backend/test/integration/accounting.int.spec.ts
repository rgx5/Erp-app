import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnitOfWork } from '../../src/platform/database/unit-of-work.js';
import { PostingService, type PostingRequest } from '../../src/modules/accounting/posting.service.js';
import { MANUFACTURING_INDIA_TEMPLATE } from '../../src/modules/accounting/template.js';
import { appPool, call, createTenant, startServer, superPool, type TestServer } from '../support/harness.js';

let server: TestServer;
let uow: UnitOfWork;
let posting: PostingService;
const supers = superPool();

beforeAll(async () => {
  server = await startServer();
  uow = server.app.get(UnitOfWork);
  posting = server.app.get(PostingService);
});
afterAll(async () => { await server.close(); await supers.end(); });

const ok = (res: { status: number; json: unknown }, status = 201) => { expect(res.status, JSON.stringify(res.json)).toBe(status); return res.json as any; }; // eslint-disable-line

interface Books { tenant: string; companyId: string; acc: Record<string, string>; periods: { id: string; name: string; startDate: string }[] }
/** A tenant with one company, the starter chart and fiscal year 2025-26 (Apr 2025 - Mar 2026). */
async function books(name: string, fy = true): Promise<Books> {
  const tenant = await createTenant(server, name);
  const company = ok(await call(server, 'POST', '/v1/companies', { tenant, body: { legalName: `${name} Ltd` } }));
  const companyId = company.id as string;
  ok(await call(server, 'POST', `/v1/companies/${companyId}/chart-of-accounts/template`, { tenant, body: { template: 'manufacturing_india' } }));
  const acc: Record<string, string> = {};
  for (const a of (await call(server, 'GET', `/v1/accounts?companyId=${companyId}&limit=200`, { tenant })).json.items) acc[a.code] = a.id;
  let periods: Books['periods'] = [];
  if (fy) periods = ok(await call(server, 'POST', '/v1/fiscal-years', { tenant, body: { companyId, startDate: '2025-04-01' } })).periods;
  return { tenant, companyId, acc, periods };
}
const journal = (b: Books, lines: object[], o: object = {}) =>
  call(server, 'POST', '/v1/journal-entries', { tenant: b.tenant, body: { companyId: b.companyId, postingDate: '2025-04-10', description: 'Test entry', lines, ...o } });
const simple = (b: Books, amount: string, o: object = {}) => journal(b, [{ accountId: b.acc['5900'], debit: amount }, { accountId: b.acc['1110'], credit: amount }], o);
const periodOf = (b: Books, name: string) => b.periods.find((p) => p.name === name)?.id as string;
const tb = (b: Books, from: string, to: string) => call(server, 'GET', `/v1/accounting/trial-balance?companyId=${b.companyId}&from=${from}&to=${to}`, { tenant: b.tenant });

describe('chart of accounts', () => {
  it('seeds the opt-in template once, with control accounts marked', async () => {
    const b = await books('Chart Co', false);
    const accounts = (await call(server, 'GET', `/v1/accounts?companyId=${b.companyId}&limit=200`, { tenant: b.tenant })).json.items;
    expect(accounts).toHaveLength(MANUFACTURING_INDIA_TEMPLATE.length);
    expect(accounts.find((a: { code: string }) => a.code === '1230')).toMatchObject({ name: 'Work in progress', controlKind: 'work_in_progress', isGroup: false });
    expect(accounts.find((a: { code: string }) => a.code === '1200')).toMatchObject({ isGroup: true, controlKind: null });
    const again = await call(server, 'POST', `/v1/companies/${b.companyId}/chart-of-accounts/template`, { tenant: b.tenant, body: { template: 'manufacturing_india' } });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('chart_not_empty');
    expect(JSON.stringify(accounts)).not.toContain('tenantId');
  });
  it('enforces the hierarchy, unique codes and fixed structure', async () => {
    const b = await books('Struct Co', false);
    const make = (o: object) => call(server, 'POST', '/v1/accounts', { tenant: b.tenant, body: { companyId: b.companyId, name: 'X', type: 'asset', ...o } });
    expect((await make({ code: '1110' })).status).toBe(409);
    expect((await make({ code: '9001', parentId: b.acc['1110'] })).status).toBe(422); // parent is a leaf
    expect((await make({ code: '9002', parentId: b.acc['2100'] })).status).toBe(422); // parent of another type
    const leaf = ok(await make({ code: '1115', name: 'Petty cash', parentId: b.acc['1100'] }));
    expect((await make({ code: '9003', isGroup: true, controlKind: 'tax' })).status).toBe(422);
    expect((await call(server, 'PATCH', `/v1/accounts/${leaf.id}`, { tenant: b.tenant, headers: { 'if-match': '1' }, body: { type: 'income' } })).status).toBe(422);
    await expect(supers.query("UPDATE erp.accounts SET type = 'income' WHERE id = $1", [leaf.id])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query('UPDATE erp.accounts SET parent_id = NULL WHERE id = $1', [leaf.id])).rejects.toMatchObject({ code: '55000' });
    const renamed = await call(server, 'PATCH', `/v1/accounts/${leaf.id}`, { tenant: b.tenant, headers: { 'if-match': '1' }, body: { name: 'Petty cash box' } });
    expect(renamed.json).toMatchObject({ name: 'Petty cash box', version: 2 });
    expect((await call(server, 'GET', `/v1/accounts?companyId=${b.companyId}&type=income&q=sales`, { tenant: b.tenant })).json.items.length).toBeGreaterThan(0);
  });
});

describe('fiscal years and periods', () => {
  it('creates twelve exact monthly periods, and refuses overlap and odd start dates', async () => {
    const b = await books('FY Co', false);
    const fy = ok(await call(server, 'POST', '/v1/fiscal-years', { tenant: b.tenant, body: { companyId: b.companyId, startDate: '2024-04-01' } }));
    expect(fy).toMatchObject({ label: '2024-25', startDate: '2024-04-01', endDate: '2025-03-31' });
    expect(fy.periods.map((p: { name: string }) => p.name)).toEqual(['Apr 2024', 'May 2024', 'Jun 2024', 'Jul 2024', 'Aug 2024', 'Sep 2024', 'Oct 2024', 'Nov 2024', 'Dec 2024', 'Jan 2025', 'Feb 2025', 'Mar 2025']);
    expect(fy.periods[10]).toMatchObject({ startDate: '2025-02-01', endDate: '2025-02-28', status: 'open' });
    const cal = ok(await call(server, 'POST', '/v1/fiscal-years', { tenant: b.tenant, body: { companyId: b.companyId, startDate: '2026-01-01' } }));
    expect(cal).toMatchObject({ label: '2026', endDate: '2026-12-31' });
    expect((await call(server, 'POST', '/v1/fiscal-years', { tenant: b.tenant, body: { companyId: b.companyId, startDate: '2024-10-01' } })).status).toBe(409);
    expect((await call(server, 'POST', '/v1/fiscal-years', { tenant: b.tenant, body: { companyId: b.companyId, startDate: '2027-04-15' } })).status).toBe(422);
    const leap = ok(await call(server, 'POST', '/v1/fiscal-years', { tenant: b.tenant, body: { companyId: b.companyId, startDate: '2027-03-01' } }));
    expect(leap.periods[11].endDate).toBe('2028-02-29');
    expect((await call(server, 'GET', `/v1/fiscal-years?companyId=${b.companyId}`, { tenant: b.tenant })).json.items).toHaveLength(3);
  });
});

describe('posting manual journals', () => {
  let b: Books;
  beforeAll(async () => { b = await books('Posting Co'); });

  it('posts a balanced entry with a company-scoped number and exact totals', async () => {
    const first = ok(await journal(b, [{ accountId: b.acc['5900'], debit: '0.1' }, { accountId: b.acc['5900'], debit: '0.2' }, { accountId: b.acc['1110'], credit: '0.3' }]));
    expect(first).toMatchObject({ entryNo: 'JV/2526/000001', journalType: 'general', sourceType: 'manual', totalDebit: '0.3000', totalCredit: '0.3000', lineCount: 3, periodId: periodOf(b, 'Apr 2025') });
    expect(first.lines.map((l: { lineNo: number }) => l.lineNo)).toEqual([1, 2, 3]);
    expect(ok(await simple(b, '10.50')).entryNo).toBe('JV/2526/000002');
    expect(ok(await simple(b, '1', { journalType: 'adjustment' })).entryNo).toBe('AJ/2526/000001');
    expect(JSON.stringify(first)).not.toContain('txId');
  });
  it('refuses anything unbalanced or malformed, naming the problem', async () => {
    const lopsided = await journal(b, [{ accountId: b.acc['5900'], debit: '100' }, { accountId: b.acc['1110'], credit: '99.9999' }]);
    expect(lopsided.status).toBe(422);
    expect(lopsided.json).toMatchObject({ code: 'entry_not_balanced', debit: '100.0000', credit: '99.9999' });
    expect((await journal(b, [{ accountId: b.acc['5900'], debit: '5' }])).status).toBe(422);
    expect((await journal(b, [{ accountId: b.acc['5900'], debit: '5', credit: '5' }, { accountId: b.acc['1110'], credit: '5' }])).status).toBe(422);
    expect((await journal(b, [{ accountId: b.acc['5900'], debit: '0' }, { accountId: b.acc['1110'], credit: '0' }])).status).toBe(422);
    expect((await journal(b, [{ accountId: b.acc['5900'], debit: 5 }, { accountId: b.acc['1110'], credit: 5 }])).status).toBe(422);
    expect((await journal(b, [{ accountId: b.acc['5900'], debit: '1.23456' }, { accountId: b.acc['1110'], credit: '1.23456' }])).status).toBe(422);
  });
  it('applies posting controls: postable, active, same-company accounts only; never control accounts', async () => {
    const line = (code: string) => [{ accountId: b.acc[code], debit: '5' }, { accountId: b.acc['1110'], credit: '5' }];
    expect((await journal(b, line('1130'))).json.code).toBe('control_account'); // receivables
    expect((await journal(b, line('1230'))).json.code).toBe('control_account'); // WIP
    expect((await journal(b, line('2210'))).json.code).toBe('control_account'); // GST
    expect((await journal(b, line('1200'))).json.code).toBe('account_not_postable'); // group
    const idle = ok(await call(server, 'POST', '/v1/accounts', { tenant: b.tenant, body: { companyId: b.companyId, code: '5999', name: 'Dormant', type: 'expense' } }));
    await call(server, 'PATCH', `/v1/accounts/${idle.id}`, { tenant: b.tenant, headers: { 'if-match': '1' }, body: { status: 'inactive' } });
    expect((await journal(b, [{ accountId: idle.id, debit: '5' }, { accountId: b.acc['1110'], credit: '5' }])).json.code).toBe('account_not_postable');
    const other = await books('Other Posting Co');
    expect((await journal(b, [{ accountId: other.acc['5900'], debit: '5' }, { accountId: b.acc['1110'], credit: '5' }])).status).toBe(422);
  });
  it('needs an accounting period for the date', async () => {
    const res = await simple(b, '5', { postingDate: '2027-01-01' });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('no_accounting_period');
    expect((await simple(b, '5', { postingDate: '2025-03-31' })).json.code).toBe('no_accounting_period');
    expect((await simple(b, '5', { postingDate: '2026-03-31' })).status).toBe(201); // last day of the year
  });
  it('lets system callers post to control accounts once per source, atomically with their own work', async () => {
    const req: PostingRequest = { companyId: b.companyId, postingDate: '2025-04-12', journalType: 'system', description: 'Invoice INV-1', source: { type: 'sales_invoice', id: 'inv-1' },
      lines: [{ accountId: b.acc['1130'] as string, debit: '118' }, { accountId: b.acc['4100'] as string, credit: '100' }, { accountId: b.acc['2210'] as string, credit: '9' }, { accountId: b.acc['2220'] as string, credit: '9' }] };
    const a = await uow.inTenant(b.tenant, (tx) => posting.post(tx, b.tenant, req));
    expect(a.replayed).toBe(false);
    expect(a.entry.entryNo).toMatch(/^SY\/2526\/\d{6}$/);
    const again = await uow.inTenant(b.tenant, (tx) => posting.post(tx, b.tenant, req));
    expect(again).toMatchObject({ replayed: true });
    expect(again.entry.id).toBe(a.entry.id);
    // a failing document rolls its entry and its number back
    const before = (await supers.query("SELECT next_value FROM erp.journal_counters WHERE tenant_id = $1 AND journal_type = 'system'", [b.tenant])).rows[0].next_value;
    await expect(uow.inTenant(b.tenant, async (tx) => { await posting.post(tx, b.tenant, { ...req, source: { type: 'sales_invoice', id: 'inv-2' } }); throw new Error('document failed'); })).rejects.toThrow('document failed');
    expect((await supers.query("SELECT next_value FROM erp.journal_counters WHERE tenant_id = $1 AND journal_type = 'system'", [b.tenant])).rows[0].next_value).toBe(before);
    expect((await supers.query("SELECT count(*)::int AS n FROM erp.journal_entries WHERE tenant_id = $1 AND source_id = 'inv-2'", [b.tenant])).rows[0].n).toBe(0);
  });
  it('numbers 25 simultaneous postings without a duplicate or a gap', async () => {
    const c = await books('Race Co');
    const results = await Promise.all(Array.from({ length: 25 }, () => simple(c, '1')));
    expect(new Set(results.map((r) => r.status))).toEqual(new Set([201]));
    expect(results.map((r) => Number(r.json.entryNo.slice(-6))).sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
  it('audits and publishes each posting and replays an idempotent retry', async () => {
    const key = { 'idempotency-key': 'je-key-1' };
    const body = { companyId: b.companyId, postingDate: '2025-04-20', description: 'Idempotent', lines: [{ accountId: b.acc['5900'], debit: '7' }, { accountId: b.acc['1110'], credit: '7' }] };
    const one = await call(server, 'POST', '/v1/journal-entries', { tenant: b.tenant, headers: key, body });
    const two = await call(server, 'POST', '/v1/journal-entries', { tenant: b.tenant, headers: key, body });
    expect(two.headers.get('idempotent-replayed')).toBe('true');
    expect(two.json.id).toBe(one.json.id);
    const n = (await supers.query("SELECT (SELECT count(*) FROM erp.journal_entries WHERE tenant_id = $1 AND description = 'Idempotent')::int AS e, (SELECT count(*) FROM erp.audit_log WHERE tenant_id = $1 AND action = 'journal_entry.posted' AND entity_id = $2)::int AS a, (SELECT count(*) FROM erp.outbox_events WHERE tenant_id = $1 AND event_type = 'journal_entry.posted' AND aggregate_id = $2)::int AS o", [b.tenant, one.json.id])).rows[0];
    expect(n).toEqual({ e: 1, a: 1, o: 1 });
  });
});

describe('the ledger is immutable and the database guards it', () => {
  it('rejects change or deletion by any role, and unbalanced or orphan inserts even from raw SQL', async () => {
    const b = await books('Immutable Co');
    const e = ok(await simple(b, '50'));
    const pool = appPool(1);
    try {
      await expect(pool.query('UPDATE erp.journal_entries SET description = $1', ['x'])).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('DELETE FROM erp.journal_lines')).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('TRUNCATE erp.journal_entries')).rejects.toMatchObject({ code: '42501' });
    } finally { await pool.end(); }
    for (const sql of ["UPDATE erp.journal_entries SET description = 'x' WHERE id = $1", 'DELETE FROM erp.journal_entries WHERE id = $1', "UPDATE erp.journal_lines SET debit = 1 WHERE entry_id = $1", 'DELETE FROM erp.journal_lines WHERE entry_id = $1']) {
      await expect(supers.query(sql, [e.id]), sql).rejects.toMatchObject({ code: '55000' });
    }
    await expect(supers.query('TRUNCATE erp.journal_lines')).rejects.toMatchObject({ code: '55000' });
    // a late line added to a committed entry
    await expect(supers.query("INSERT INTO erp.journal_lines (tenant_id, id, entry_id, company_id, line_no, account_id, posting_date, debit) VALUES ($1, gen_random_uuid(), $2, $3, 9, $4, '2025-04-10', 1)", [b.tenant, e.id, b.companyId, b.acc['5900']])).rejects.toMatchObject({ code: '55000' });

    // raw inserts that would unbalance the books fail at COMMIT
    const client = await supers.connect();
    try {
      const insertEntry = (debit: string, credit: string, lines: number) =>
        client.query(`INSERT INTO erp.journal_entries (tenant_id, id, company_id, fiscal_year_id, period_id, entry_no, journal_type, posting_date, description, total_debit, total_credit, line_count)
                      SELECT $1, '00000000-0000-7000-8000-000000000001', $2, fiscal_year_id, id, 'RAW/1', 'general', '2025-04-10', 'raw', $3, $4, $5 FROM erp.accounting_periods WHERE tenant_id = $1 AND company_id = $2 AND name = 'Apr 2025'`, [b.tenant, b.companyId, debit, credit, lines]);
      const line = (no: number, d: string, c: string, account = b.acc['5900']) =>
        client.query("INSERT INTO erp.journal_lines (tenant_id, id, entry_id, company_id, line_no, account_id, posting_date, debit, credit) VALUES ($1, gen_random_uuid(), '00000000-0000-7000-8000-000000000001', $2, $3, $4, '2025-04-10', $5, $6)", [b.tenant, b.companyId, no, account, d, c]);
      await client.query('BEGIN');
      await insertEntry('10', '10', 2);
      await line(1, '10', '0');
      await line(2, '0', '9');
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' }); // lines do not match the header
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('BEGIN');
      await expect(insertEntry('10', '9', 2)).rejects.toMatchObject({ code: '23514' }); // header itself unbalanced
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await insertEntry('10', '10', 2);
      await expect(line(1, '10', '0', b.acc['1000'])).rejects.toMatchObject({ code: '23514' }); // group account
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});

describe('reversals', () => {
  it('corrects by a mirror entry, never by editing, and only once', async () => {
    const b = await books('Reverse Co');
    const original = ok(await journal(b, [{ accountId: b.acc['5900'], debit: '250.75', description: 'Stationery' }, { accountId: b.acc['1110'], credit: '250.75' }]));
    const rev = ok(await call(server, 'POST', `/v1/journal-entries/${original.id}/reverse`, { tenant: b.tenant, body: { postingDate: '2025-04-15', reason: 'Wrong account' } }));
    expect(rev).toMatchObject({ journalType: 'reversal', reversesEntryId: original.id, reversalReason: 'Wrong account', entryNo: 'RV/2526/000001' });
    expect(rev.lines.map((l: { accountId: string; debit: string; credit: string }) => [l.accountId, l.debit, l.credit])).toEqual([[b.acc['5900'], '0.0000', '250.7500'], [b.acc['1110'], '250.7500', '0.0000']]);
    const reread = await call(server, 'GET', `/v1/journal-entries/${original.id}`, { tenant: b.tenant });
    expect(reread.json.reversedBy).toMatchObject({ id: rev.id, entryNo: rev.entryNo });
    expect(reread.json.lines[0]).toMatchObject({ debit: '250.7500', credit: '0.0000' }); // untouched
    expect((await call(server, 'POST', `/v1/journal-entries/${original.id}/reverse`, { tenant: b.tenant, body: { postingDate: '2025-04-16', reason: 'again' } })).json.code).toBe('already_reversed');
    expect((await call(server, 'POST', `/v1/journal-entries/${rev.id}/reverse`, { tenant: b.tenant, body: { postingDate: '2025-04-16', reason: 'undo' } })).json.code).toBe('cannot_reverse_reversal');
    const early = ok(await simple(b, '5', { postingDate: '2025-05-10' }));
    expect((await call(server, 'POST', `/v1/journal-entries/${early.id}/reverse`, { tenant: b.tenant, body: { postingDate: '2025-05-01', reason: 'x' } })).status).toBe(422);
    const t = (await tb(b, '2025-04-01', '2025-04-30')).json;
    expect(t.rows.find((r: { code: string }) => r.code === '5900')).toMatchObject({ debit: '250.7500', credit: '250.7500', closingDebit: '0.0000', closingCredit: '0.0000' });
  });
  it('leaves document-created entries to their own documents, and honours closed periods', async () => {
    const b = await books('Reverse Guard Co');
    const sys = await uow.inTenant(b.tenant, (tx) => posting.post(tx, b.tenant, { companyId: b.companyId, postingDate: '2025-04-12', journalType: 'system', description: 'Doc', source: { type: 'sales_invoice', id: 'i1' }, lines: [{ accountId: b.acc['1130'] as string, debit: '10' }, { accountId: b.acc['4100'] as string, credit: '10' }] }));
    expect((await call(server, 'POST', `/v1/journal-entries/${sys.entry.id}/reverse`, { tenant: b.tenant, body: { postingDate: '2025-04-13', reason: 'x' } })).json.code).toBe('system_entry');
    const manual = ok(await simple(b, '5'));
    ok(await call(server, 'POST', `/v1/accounting-periods/${periodOf(b, 'Apr 2025')}/close`, { tenant: b.tenant }), 200);
    const blocked = await call(server, 'POST', `/v1/journal-entries/${manual.id}/reverse`, { tenant: b.tenant, body: { postingDate: '2025-04-20', reason: 'late' } });
    expect(blocked.json.code).toBe('period_closed');
    ok(await call(server, 'POST', `/v1/journal-entries/${manual.id}/reverse`, { tenant: b.tenant, body: { postingDate: '2025-05-02', reason: 'next period' } }));
  });
});

describe('period locking', () => {
  it('closes in order, blocks posting at the database, reopens newest first, and locks permanently', async () => {
    const b = await books('Lock Co');
    const p = (n: string) => periodOf(b, n);
    const act = (verb: string, id: string, token?: string) => call(server, 'POST', `/v1/accounting-periods/${id}/${verb}`, token ? { token } : { tenant: b.tenant });
    expect((await act('close', p('May 2025'))).json.code).toBe('earlier_period_open');
    ok(await act('close', p('Apr 2025')), 200);
    const closed = await simple(b, '5', { postingDate: '2025-04-30' });
    expect(closed.status).toBe(409);
    expect(closed.json.code).toBe('period_closed');
    // the database refuses it too, whatever the application does
    await expect(supers.query(`INSERT INTO erp.journal_entries (tenant_id, id, company_id, fiscal_year_id, period_id, entry_no, journal_type, posting_date, description, total_debit, total_credit, line_count)
      SELECT $1, gen_random_uuid(), $2, fiscal_year_id, id, 'RAW/2', 'general', '2025-04-10', 'raw', 1, 1, 2 FROM erp.accounting_periods WHERE id = $3`, [b.tenant, b.companyId, p('Apr 2025')])).rejects.toMatchObject({ code: '23514' });
    expect((await simple(b, '5', { postingDate: '2025-05-01' })).status).toBe(201); // next period still open
    ok(await act('close', p('May 2025')), 200);
    expect((await act('reopen', p('Apr 2025'))).json.code).toBe('later_period_closed');
    ok(await act('reopen', p('May 2025')), 200);
    ok(await act('reopen', p('Apr 2025')), 200);
    expect((await simple(b, '5', { postingDate: '2025-04-30' })).status).toBe(201);
    ok(await act('close', p('Apr 2025')), 200);
    ok(await act('lock', p('Apr 2025')), 200);
    expect((await act('reopen', p('Apr 2025'))).json.code).toBe('period_locked');
    expect((await act('close', p('Apr 2025'))).status).toBe(409);
    await expect(supers.query("UPDATE erp.accounting_periods SET status = 'open' WHERE id = $1", [p('Apr 2025')])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query('DELETE FROM erp.accounting_periods WHERE id = $1', [p('Apr 2025')])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query("UPDATE erp.accounting_periods SET end_date = '2030-01-01' WHERE id = $1", [p('May 2025')])).rejects.toMatchObject({ code: '55000' });
  });
  it('separates the right to close from the right to reopen', async () => {
    const b = await books('Lock Perm Co');
    const key = ok(await call(server, 'POST', '/v1/api-keys', { tenant: b.tenant, body: { name: 'acct', permissions: ['accounting:manage', 'accounting:post', 'accounting:read'] } })).key;
    const id = periodOf(b, 'Apr 2025');
    ok(await call(server, 'POST', `/v1/accounting-periods/${id}/close`, { token: key }), 200);
    expect((await call(server, 'POST', `/v1/accounting-periods/${id}/reopen`, { token: key })).status).toBe(403);
    ok(await call(server, 'POST', `/v1/accounting-periods/${id}/reopen`, { tenant: b.tenant }), 200);
  });
  it('never lets an entry slip into a period while it is being closed', async () => {
    const b = await books('Close Race Co');
    const id = periodOf(b, 'Apr 2025');
    const posts = Array.from({ length: 20 }, () => simple(b, '1', { postingDate: '2025-04-15' }));
    const close = call(server, 'POST', `/v1/accounting-periods/${id}/close`, { tenant: b.tenant });
    const results = await Promise.all([...posts, close]);
    const statuses = results.slice(0, 20).map((r) => r.status);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    expect(results[20]?.status).toBe(200);
    const row = (await supers.query("SELECT (SELECT count(*)::int FROM erp.journal_entries WHERE period_id = $1) AS n, (SELECT count(*)::int FROM erp.journal_entries e JOIN erp.accounting_periods p ON p.id = e.period_id WHERE p.id = $1 AND e.posted_at > p.closed_at) AS late", [id])).rows[0];
    expect(row.n).toBe(statuses.filter((s) => s === 201).length);
    expect(row.late).toBe(0);
  });
});

describe('trial balance and account ledger', () => {
  let b: Books;
  beforeAll(async () => {
    b = await books('TB Co');
    ok(await journal(b, [{ accountId: b.acc['1120'], debit: '1000' }, { accountId: b.acc['3100'], credit: '1000' }], { postingDate: '2025-04-01', journalType: 'opening', description: 'Opening' }));
    ok(await journal(b, [{ accountId: b.acc['5900'], debit: '200' }, { accountId: b.acc['1120'], credit: '200' }], { postingDate: '2025-04-20' }));
    ok(await journal(b, [{ accountId: b.acc['5900'], debit: '50.5' }, { accountId: b.acc['1110'], credit: '50.5' }], { postingDate: '2025-05-05' }));
    ok(await journal(b, [{ accountId: b.acc['1120'], debit: '300' }, { accountId: b.acc['4900'], credit: '300' }], { postingDate: '2025-05-20' }));
  });
  it('shows opening, movement and closing per account on their natural side, and always balances', async () => {
    const may = (await tb(b, '2025-05-01', '2025-05-31')).json;
    expect(may.balanced).toBe(true);
    expect(may.totals.closingDebit).toBe(may.totals.closingCredit);
    const row = (code: string) => may.rows.find((r: { code: string }) => r.code === code);
    expect(row('1120')).toMatchObject({ openingDebit: '800.0000', openingCredit: '0.0000', debit: '300.0000', credit: '0.0000', closingDebit: '1100.0000' });
    expect(row('5900')).toMatchObject({ openingDebit: '200.0000', debit: '50.5000', closingDebit: '250.5000' });
    expect(row('3100')).toMatchObject({ openingCredit: '1000.0000', closingCredit: '1000.0000', closingDebit: '0.0000' });
    expect(row('1110')).toMatchObject({ openingDebit: '0.0000', credit: '50.5000', closingCredit: '50.5000' });
    expect(may.rows.find((r: { code: string }) => r.code === '2110')).toBeUndefined(); // no activity: not listed
  });
  it('honours the range: entries after `to` are excluded and everything before `from` is opening', async () => {
    const apr = (await tb(b, '2025-04-01', '2025-04-30')).json;
    expect(apr.rows.find((r: { code: string }) => r.code === '4900')).toBeUndefined();
    expect(apr.rows.find((r: { code: string }) => r.code === '1120')).toMatchObject({ openingDebit: '0.0000', debit: '1000.0000', credit: '200.0000', closingDebit: '800.0000' });
    const future = (await tb(b, '2026-01-01', '2026-01-31')).json;
    expect(future.rows.find((r: { code: string }) => r.code === '1120')).toMatchObject({ openingDebit: '1100.0000', debit: '0.0000', closingDebit: '1100.0000' });
    expect((await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${b.companyId}&from=2025-05-01&to=2025-04-01`, { tenant: b.tenant })).status).toBe(422);
  });
  it('lists an account\'s lines with a running balance', async () => {
    const ledger = (await call(server, 'GET', `/v1/accounting/account-ledger?companyId=${b.companyId}&accountId=${b.acc['1120']}&from=2025-04-15&to=2025-12-31`, { tenant: b.tenant })).json;
    expect(ledger.account.code).toBe('1120');
    expect(ledger.openingBalance).toBe('1000.0000');
    expect(ledger.lines.map((l: { debit: string; credit: string; balance: string }) => [l.debit, l.credit, l.balance])).toEqual([['0.0000', '200.0000', '800.0000'], ['300.0000', '0.0000', '1100.0000']]);
    expect(ledger.hasMore).toBe(false);
    const limited = (await call(server, 'GET', `/v1/accounting/account-ledger?companyId=${b.companyId}&accountId=${b.acc['1120']}&from=2025-04-01&to=2025-12-31&limit=1`, { tenant: b.tenant })).json;
    expect(limited).toMatchObject({ hasMore: true });
    expect(limited.lines).toHaveLength(1);
  });
  it('lists and filters entries newest first', async () => {
    const all = (await call(server, 'GET', `/v1/journal-entries?companyId=${b.companyId}`, { tenant: b.tenant })).json;
    expect(all.items.map((e: { postingDate: string }) => e.postingDate)).toEqual(['2025-05-20', '2025-05-05', '2025-04-20', '2025-04-01']);
    expect((await call(server, 'GET', `/v1/journal-entries?companyId=${b.companyId}&journalType=opening`, { tenant: b.tenant })).json.items).toHaveLength(1);
    expect((await call(server, 'GET', `/v1/journal-entries?companyId=${b.companyId}&accountId=${b.acc['4900']}`, { tenant: b.tenant })).json.items).toHaveLength(1);
    const page = (await call(server, 'GET', `/v1/journal-entries?companyId=${b.companyId}&limit=3`, { tenant: b.tenant })).json;
    expect(page.items).toHaveLength(3);
    expect((await call(server, 'GET', `/v1/journal-entries?companyId=${b.companyId}&limit=3&cursor=${page.nextCursor}`, { tenant: b.tenant })).json.items).toHaveLength(1);
  });
});

describe('access and isolation', () => {
  it('separates reading, posting and reversing, and keeps tenants apart', async () => {
    const b = await books('Access Co');
    const entry = ok(await simple(b, '9'));
    const key = (permissions: string[]) => call(server, 'POST', '/v1/api-keys', { tenant: b.tenant, body: { name: 'k', permissions } }).then((r) => r.json.key as string);
    const reader = await key(['accounting:read']);
    expect((await call(server, 'GET', `/v1/journal-entries/${entry.id}`, { token: reader })).status).toBe(200);
    expect((await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${b.companyId}&from=2025-04-01&to=2025-04-30`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/journal-entries', { token: reader, body: { companyId: b.companyId, postingDate: '2025-04-10', description: 'x', lines: [] } })).status).toBe(403);
    const poster = await key(['accounting:post']);
    expect((await call(server, 'POST', `/v1/journal-entries/${entry.id}/reverse`, { token: poster, body: { postingDate: '2025-04-11', reason: 'x' } })).status).toBe(403);
    const other = await books('Access Other Co');
    expect((await call(server, 'GET', `/v1/journal-entries/${entry.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/journal-entries?companyId=${b.companyId}`, { tenant: other.tenant })).json.items).toEqual([]);
    expect((await call(server, 'POST', `/v1/journal-entries/${entry.id}/reverse`, { tenant: other.tenant, body: { postingDate: '2025-04-11', reason: 'x' } })).status).toBe(404);
    const trial = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${b.companyId}&from=2025-04-01&to=2025-04-30`, { tenant: other.tenant })).json;
    expect(trial.rows).toEqual([]);
  });
});
