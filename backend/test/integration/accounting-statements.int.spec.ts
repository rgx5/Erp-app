import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let kit: ReturnType<typeof shopKit>;
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const journal = (s: Shop, date: string, lines: [string, string, string][]) =>
  call(server, 'POST', '/v1/journal-entries', { tenant: s.tenant, body: { companyId: s.companyId, postingDate: date, description: 'x', lines: lines.map(([code, debit, credit]) => ({ accountId: s.acc[code], ...(debit !== '0' ? { debit } : { credit }) })) } });
const get = async (s: Shop, path: string) => (await call(server, 'GET', `/v1/accounting/${path}${path.includes('?') ? '&' : '?'}companyId=${s.companyId}`, { tenant: s.tenant })).json;
const firstYear = async (s: Shop) => (await call(server, 'GET', `/v1/fiscal-years?companyId=${s.companyId}`, { tenant: s.tenant })).json.items[0] as { id: string };
const line = (st: { lines: { code: string; amount: string }[] }, code: string) => st.lines.find((l) => l.code === code)?.amount;

/** A year of trading with no GST or stock documents: only manual journals, so every figure can be checked by hand. */
async function trader(name: string) {
  const s = await kit.shop(name);
  ok(await call(server, 'PUT', `/v1/accounting/companies/${s.companyId}/settings`, { tenant: s.tenant, body: { retainedEarningsAccountId: s.acc['3200'] } }), 200);
  ok(await call(server, 'POST', `/v1/accounting/statements/mapping/apply-template?companyId=${s.companyId}`, { tenant: s.tenant }), 200);
  // Income tax is not in the template chart: add it and map it by hand.
  const tax = ok(await call(server, 'POST', '/v1/accounts', { tenant: s.tenant, body: { companyId: s.companyId, code: '5950', name: 'Income tax', type: 'expense', parentId: s.acc['5000'] } }));
  s.acc['5950'] = tax.id;
  ok(await call(server, 'PUT', `/v1/accounting/statements/mapping?companyId=${s.companyId}`, { tenant: s.tenant, body: { items: [{ accountId: tax.id, lineCode: 'PL.TAX' }] } }), 200);
  for (const [date, lines] of [
    ['2025-04-02', [['1120', '100000', '0'], ['3100', '0', '100000']]], // capital
    ['2025-05-10', [['1120', '50000', '0'], ['4100', '0', '50000']]], // sales for cash
    ['2025-06-10', [['1120', '2000', '0'], ['4900', '0', '2000']]], // other income
    ['2025-07-01', [['1510', '40000', '0'], ['1120', '0', '40000']]], // machinery
    ['2025-07-05', [['1120', '30000', '0'], ['2310', '0', '30000']]], // loan
    ['2025-08-01', [['5100', '20000', '0'], ['1120', '0', '20000']]], // cost of goods
    ['2025-08-02', [['5500', '12000', '0'], ['1120', '0', '12000']]], // salaries
    ['2025-09-30', [['5700', '3000', '0'], ['1590', '0', '3000']]], // depreciation
    ['2025-10-01', [['5800', '1000', '0'], ['1120', '0', '1000']]], // interest
    ['2025-11-01', [['5900', '4000', '0'], ['1120', '0', '4000']]], // other expenses
    ['2026-03-31', [['5950', '3000', '0'], ['1120', '0', '3000']]], // tax
  ] as [string, [string, string, string][]][]) ok(await journal(s, date, lines));
  return s;
}

describe('profit and loss, balance sheet and cash flow', () => {
  it('lays the year out in Schedule III lines and ties every figure to the ledger', async () => {
    const s = await trader('St Year Co');
    const pl = await get(s, 'statements/profit-loss?from=2025-04-01&to=2026-03-31');
    expect(pl).toMatchObject({ revenueFromOperations: '50000.0000', otherIncome: '2000.0000', totalRevenue: '52000.0000', totalExpenses: '40000.0000', profitBeforeTax: '12000.0000', taxExpense: '3000.0000', profitForThePeriod: '9000.0000', unmappedAccounts: [] });
    expect(['PL.MATERIALS', 'PL.EMPLOYEE', 'PL.DEPRECIATION', 'PL.FINANCE', 'PL.OTHER_EXPENSES', 'PL.TAX'].map((c) => line(pl, c))).toEqual(['20000.0000', '12000.0000', '3000.0000', '1000.0000', '4000.0000', '3000.0000']);
    // a shorter period only sees its own transactions
    expect((await get(s, 'statements/profit-loss?from=2025-04-01&to=2025-06-30')).profitForThePeriod).toBe('52000.0000');
    const bs = await get(s, 'statements/balance-sheet?asOf=2026-03-31');
    expect(bs).toMatchObject({ balanced: true, difference: '0.0000', unmappedAccounts: [] });
    expect(bs.assets.total).toBe('259000.0000');
    expect([line(bs.assets, 'BS.CASH'), line(bs.assets, 'BS.INVENTORIES'), line(bs.assets, 'BS.PPE')]).toEqual(['102000.0000', '120000.0000', '37000.0000']); // PPE net of depreciation
    expect([line(bs.equityAndLiabilities, 'BS.SHARE_CAPITAL'), line(bs.equityAndLiabilities, 'BS.LT_BORROWINGS')]).toEqual(['220000.0000', '30000.0000']); // 100,000 capital + 120,000 opening stock
    expect(bs.equityAndLiabilities).toMatchObject({ profitAndLossAccount: '9000.0000', shareholdersFunds: '229000.0000', total: '259000.0000' });
    // earlier in the year it balanced too, with the profit so far
    const mid = await get(s, 'statements/balance-sheet?asOf=2025-06-30&compareAsOf=2026-03-31');
    expect(mid.balanced).toBe(true);
    expect(mid.equityAndLiabilities.profitAndLossAccount).toBe('52000.0000');
    expect(mid.comparative.equityAndLiabilities.profitAndLossAccount).toBe('9000.0000');
    const cf = await get(s, 'statements/cash-flow?from=2025-04-01&to=2026-03-31');
    expect(cf).toMatchObject({ reconciled: true, openingCash: '0.0000', closingCash: '102000.0000', movementInCash: '102000.0000', netChangeInCash: '102000.0000' });
    expect(cf.operating).toMatchObject({ profitForThePeriod: '9000.0000', depreciation: '3000.0000', changeInWorkingCapital: '-120000.0000', net: '-108000.0000' });
    expect(cf.investing.net).toBe('-40000.0000');
    expect(cf.financing).toMatchObject({ borrowings: '30000.0000', equityOtherThanProfit: '220000.0000', net: '250000.0000' });
    const half = await get(s, 'statements/cash-flow?from=2025-07-01&to=2026-03-31');
    expect(half.reconciled).toBe(true);
    expect(half.openingCash).toBe('152000.0000'); // after capital and sales and other income
  });

  it('compares periods, and shows accounts nobody mapped rather than losing them', async () => {
    const s = await kit.shop('St Unmapped Co'); // template never applied
    ok(await journal(s, '2025-05-01', [['1120', '1000', '0'], ['4100', '0', '1000']]));
    ok(await journal(s, '2025-06-01', [['5900', '300', '0'], ['1120', '0', '300']]));
    const pl = await get(s, 'statements/profit-loss?from=2025-05-01&to=2025-05-31&compareFrom=2025-06-01&compareTo=2025-06-30');
    expect(pl.profitForThePeriod).toBe('1000.0000');
    expect(pl.comparative).toMatchObject({ from: '2025-06-01', profitForThePeriod: '-300.0000' });
    expect(pl.unmappedAccounts).toEqual(['4100']);
    const bs = await get(s, 'statements/balance-sheet?asOf=2025-12-31');
    expect(bs.balanced).toBe(true); // unmapped accounts land in "other" lines, flagged
    expect(bs.unmappedAccounts.sort()).toEqual(['1120', '1240', '3100']);
    const m = await get(s, 'statements/mapping');
    expect(m.unmapped.length).toBeGreaterThan(10);
    ok(await call(server, 'POST', `/v1/accounting/statements/mapping/apply-template?companyId=${s.companyId}`, { tenant: s.tenant }), 200);
    expect((await get(s, 'statements/profit-loss?from=2025-05-01&to=2025-05-31')).unmappedAccounts).toEqual([]);
  });

  it('only maps accounts to lines of their own kind', async () => {
    const s = await kit.shop('St Map Co');
    const map = (accountId: string | undefined, lineCode: string) => call(server, 'PUT', `/v1/accounting/statements/mapping?companyId=${s.companyId}`, { tenant: s.tenant, body: { items: [{ accountId, lineCode }] } });
    expect((await map(s.acc['4100'], 'BS.CASH')).status).toBe(422); // income on the balance sheet
    expect((await map(s.acc['1120'], 'BS.TRADE_PAYABLES')).status).toBe(422); // an asset as a liability
    expect((await map(s.acc['1120'], 'BS.NOPE')).status).toBe(422);
    expect((await map(s.acc['1000'], 'BS.CASH')).status).toBe(422); // a group account
    expect((await map(s.acc['5900'], 'PL.FINANCE')).status).toBe(200);
    expect((await get(s, 'statements/mapping')).accounts.find((a: { code: string }) => a.code === '5900').lineCode).toBe('PL.FINANCE');
  });
});

describe('year-end close', () => {
  it('moves the year\'s result into retained earnings, keeps the statements stable, and can be reopened', async () => {
    const s = await trader('Ye Co');
    const fy = await firstYear(s);
    const closed = ok(await call(server, 'POST', `/v1/accounting/fiscal-years/${fy.id}/close-year`, { tenant: s.tenant, body: {} }), 200);
    expect(closed).toMatchObject({ status: 'closed', netProfit: '9000.0000', closingEntryId: expect.any(String) });
    const tb = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: s.tenant })).json;
    expect(tb.balanced).toBe(true);
    const row = (code: string) => tb.rows.find((r: { code: string }) => r.code === code);
    expect(row('4100')).toMatchObject({ closingDebit: '0.0000', closingCredit: '0.0000' });
    expect(row('5900')).toMatchObject({ closingDebit: '0.0000', closingCredit: '0.0000' });
    expect(row('3200')).toMatchObject({ closingCredit: '9000.0000' });
    // the result is still reported for the year it was earned in; the balance sheet now has it in reserves
    expect((await get(s, 'statements/profit-loss?from=2025-04-01&to=2026-03-31')).profitForThePeriod).toBe('9000.0000');
    const bs = await get(s, 'statements/balance-sheet?asOf=2026-03-31');
    expect(bs).toMatchObject({ balanced: true });
    expect(line(bs.equityAndLiabilities, 'BS.RESERVES')).toBe('9000.0000');
    expect(bs.equityAndLiabilities.profitAndLossAccount).toBe('0.0000');
    expect((await get(s, 'statements/cash-flow?from=2025-04-01&to=2026-03-31')).reconciled).toBe(true);
    expect((await call(server, 'POST', `/v1/accounting/fiscal-years/${fy.id}/close-year`, { tenant: s.tenant, body: {} })).json.code).toBe('year_already_closed');
    expect((await get(s, 'year-end-closings')).items).toHaveLength(1);
    // reopening reverses the entry
    expect((await call(server, 'POST', `/v1/accounting/fiscal-years/${fy.id}/reopen-year`, { tenant: s.tenant, body: {} })).status).toBe(422);
    ok(await call(server, 'POST', `/v1/accounting/fiscal-years/${fy.id}/reopen-year`, { tenant: s.tenant, body: { reason: 'Audit adjustment' } }), 200);
    const after = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: s.tenant })).json;
    expect(after.rows.find((r: { code: string }) => r.code === '4100')).toMatchObject({ closingCredit: '50000.0000' });
    expect((await get(s, 'statements/profit-loss?from=2025-04-01&to=2026-03-31')).profitForThePeriod).toBe('9000.0000'); // the reversal is not counted either
    expect((await get(s, 'statements/balance-sheet?asOf=2026-03-31')).equityAndLiabilities.profitAndLossAccount).toBe('9000.0000');
    expect((await call(server, 'POST', `/v1/accounting/fiscal-years/${fy.id}/reopen-year`, { tenant: s.tenant, body: { reason: 'again' } })).json.code).toBe('year_not_closed');
    ok(await call(server, 'POST', `/v1/accounting/fiscal-years/${fy.id}/close-year`, { tenant: s.tenant, body: {} }), 200); // and it can be closed again
  });

  it('closes years in order and a loss goes to retained earnings as a debit', async () => {
    const s = await trader('Ye Order Co');
    const y1 = await firstYear(s);
    const y2 = ok(await call(server, 'POST', '/v1/fiscal-years', { tenant: s.tenant, body: { companyId: s.companyId, startDate: '2026-04-01' } }));
    ok(await journal(s, '2026-05-01', [['5900', '700', '0'], ['1120', '0', '700']]));
    expect((await call(server, 'POST', `/v1/accounting/fiscal-years/${y2.id}/close-year`, { tenant: s.tenant, body: {} })).json.code).toBe('earlier_year_open');
    ok(await call(server, 'POST', `/v1/accounting/fiscal-years/${y1.id}/close-year`, { tenant: s.tenant, body: {} }), 200);
    const c2 = ok(await call(server, 'POST', `/v1/accounting/fiscal-years/${y2.id}/close-year`, { tenant: s.tenant, body: {} }), 200);
    expect(c2.netProfit).toBe('-700.0000');
    const tb = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2026-04-01&to=2027-03-31`, { tenant: s.tenant })).json;
    expect(tb.rows.find((r: { code: string }) => r.code === '3200')).toMatchObject({ openingCredit: '9000.0000', closingCredit: '8300.0000' });
    expect((await get(s, 'statements/balance-sheet?asOf=2027-03-31')).balanced).toBe(true);
    expect((await call(server, 'POST', `/v1/accounting/fiscal-years/${y1.id}/reopen-year`, { tenant: s.tenant, body: { reason: 'x' } })).json.code).toBe('later_year_closed');
  });

  it('refuses without the account, with the books locked, and leaves nothing behind', async () => {
    const bare = await kit.shop('Ye Bare Co');
    ok(await journal(bare, '2025-05-01', [['1120', '10', '0'], ['4100', '0', '10']]));
    const fy = await firstYear(bare);
    const r = await call(server, 'POST', `/v1/accounting/fiscal-years/${fy.id}/close-year`, { tenant: bare.tenant, body: {} });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'accounting_accounts_not_configured', missing: ['retainedEarningsAccountId'] });
    const put = (accountId: string | undefined) => call(server, 'PUT', `/v1/accounting/companies/${bare.companyId}/settings`, { tenant: bare.tenant, body: { retainedEarningsAccountId: accountId } });
    expect((await put(bare.acc['4100'])).status).toBe(422); // not equity
    expect((await put(bare.acc['3000'])).status).toBe(422); // a group
    ok(await put(bare.acc['3200']), 200);
    for (const p of bare.periods) ok(await call(server, 'POST', `/v1/accounting-periods/${p.id}/close`, { tenant: bare.tenant }), 200);
    expect((await call(server, 'POST', `/v1/accounting/fiscal-years/${fy.id}/close-year`, { tenant: bare.tenant, body: {} })).json.code).toBe('period_closed'); // the entry needs an open last period
    expect((await get(bare, 'year-end-closings')).items).toHaveLength(0);
  });
});

describe('guards and access', () => {
  it('keeps closings immutable and allows one live closing per year', async () => {
    const s = await trader('St Guard Co');
    const fy = await firstYear(s);
    const c = ok(await call(server, 'POST', `/v1/accounting/fiscal-years/${fy.id}/close-year`, { tenant: s.tenant, body: {} }), 200);
    const bad = (sql: string, params: unknown[] = []) => expect(supers.query(sql, params)).rejects.toMatchObject({ code: '55000' });
    await bad('UPDATE erp.fiscal_year_closings SET net_profit = 1 WHERE id = $1', [c.id]);
    await bad('DELETE FROM erp.fiscal_year_closings WHERE id = $1', [c.id]);
    await expect(supers.query("INSERT INTO erp.fiscal_year_closings (tenant_id, id, company_id, fiscal_year_id, net_profit) VALUES ($1, gen_random_uuid(), $2, $3, 0)", [s.tenant, s.companyId, fy.id])).rejects.toMatchObject({ code: '23505' });
    await expect(supers.query("INSERT INTO erp.statement_mappings (tenant_id, company_id, account_id, line_code) VALUES ($1, $2, $3, 'bad line')", [s.tenant, s.companyId, s.acc['5900']])).rejects.toMatchObject({ code: '23514' });
  });

  it('separates reading, mapping and closing the year, and keeps tenants apart', async () => {
    const s = await trader('St Access Co');
    const fy = await firstYear(s);
    const key = async (permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: s.tenant, body: { name: 'k', permissions } })).json.key as string;
    const reader = await key(['accounting:read']);
    expect((await call(server, 'GET', `/v1/accounting/statements/balance-sheet?companyId=${s.companyId}&asOf=2026-03-31`, { token: reader })).status).toBe(200);
    expect((await call(server, 'PUT', `/v1/accounting/statements/mapping?companyId=${s.companyId}`, { token: reader, body: { items: [{ accountId: s.acc['5900'], lineCode: 'PL.FINANCE' }] } })).status).toBe(403);
    const manager = await key(['accounting:read', 'accounting:manage']);
    expect((await call(server, 'POST', `/v1/accounting/fiscal-years/${fy.id}/close-year`, { token: manager, body: {} })).status).toBe(403); // its own right
    const other = await kit.shop('St Access Other');
    expect((await call(server, 'POST', `/v1/accounting/fiscal-years/${fy.id}/close-year`, { tenant: other.tenant, body: {} })).status).toBe(404);
    expect((await get(other, 'statements/profit-loss?from=2025-04-01&to=2026-03-31')).profitForThePeriod).toBe('0.0000');
  });
});
