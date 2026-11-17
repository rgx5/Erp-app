import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { buyerKit, type Buyer } from '../support/buyer.js';
import { ok } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let k: ReturnType<typeof buyerKit>;
beforeAll(async () => { server = await startServer(); k = buyerKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const journal = async (b: Buyer, date: string, debit: string, credit: string, amount: string) =>
  ok(await call(server, 'POST', '/v1/journal-entries', { tenant: b.tenant, body: { companyId: b.companyId, postingDate: date, description: 'Entry', lines: [{ accountId: b.acc[debit], debit: amount }, { accountId: b.acc[credit], credit: amount }] } }));
const dash = (b: Buyer, asOf: string, token?: string) => call(server, 'GET', `/v1/dashboard?companyId=${b.companyId}&asOf=${asOf}`, token ? { token } : { tenant: b.tenant });

describe('dashboard', () => {
  it('summarises cash, profit, trend, what is owed and what needs attention, straight from the ledger', async () => {
    const b = await k.buyer('Dash Co');
    ok(await call(server, 'POST', `/v1/accounting/statements/mapping/apply-template?companyId=${b.companyId}`, { tenant: b.tenant }), 200);
    await journal(b, '2025-04-05', '1120', '4100', '100000'); // April sales into the bank
    await journal(b, '2025-04-10', '5900', '1110', '30000'); // an April expense paid in cash
    await journal(b, '2025-05-08', '1120', '4100', '50000'); // May sales
    const stockBefore = Number((await dash(b, '2025-05-20')).json.inventoryValue);
    await k.billed(b, b.sup.intra); // stock received and billed: payables 5,900, inventory 5,000

    const d = (await dash(b, '2025-05-20')).json;
    expect(d).toMatchObject({
      companyId: b.companyId, asOf: '2025-05-20', fiscalYear: { startDate: '2025-04-01', endDate: '2026-03-31' },
      month: { from: '2025-05-01', revenue: '50000.0000', expenses: '0.0000', profit: '50000.0000', previousMonth: { revenue: '100000.0000', expenses: '30000.0000', profit: '70000.0000' } },
      yearToDate: { from: '2025-04-01', revenue: '150000.0000', expenses: '30000.0000', profit: '120000.0000', netMarginPercent: '80.00' },
      trend: [{ month: '2025-04', revenue: '100000.0000', expenses: '30000.0000', profit: '70000.0000' }, { month: '2025-05', revenue: '50000.0000', expenses: '0.0000', profit: '50000.0000' }],
      payables: { total: '5900.0000' },
      receivables: { total: '0.0000', overdue: '0.0000' },
      attention: { pendingApprovals: 0, unmatchedBankLines: 0, openPurchaseOrders: 0, openWorkOrders: 0 },
    });
    expect(Number(d.inventoryValue) - stockBefore).toBe(5000);
    expect(d.cash.total).toBe('120000.0000');
    const cash = (d.cash.accounts as { code: string; balance: string }[]).map((a) => `${a.code}:${a.balance}`);
    expect(cash).toHaveLength(2);
    expect(cash).toContain('1110:-30000.0000');
    expect(cash).toContain('1120:150000.0000');
    expect(Number(d.payables.current) + Number(d.payables.overdue)).toBeCloseTo(5900, 4);

    // the same numbers an accountant gets from the statements
    const pl = (await call(server, 'GET', `/v1/accounting/statements/profit-loss?companyId=${b.companyId}&from=2025-04-01&to=2025-05-20`, { tenant: b.tenant })).json;
    expect(pl.profitForThePeriod).toBe(d.yearToDate.profit);

    // things that need attention show up as counts
    const bank = ok(await call(server, 'POST', '/v1/bank-accounts', { tenant: b.tenant, body: { companyId: b.companyId, accountId: b.acc['1120'], name: 'Current' } }));
    ok(await call(server, 'POST', `/v1/bank-accounts/${bank.id}/statements`, { tenant: b.tenant, body: { periodFrom: '2025-05-01', periodTo: '2025-05-31', openingBalance: '0', closingBalance: '10', lines: [{ date: '2025-05-02', description: 'a', amount: '4' }, { date: '2025-05-03', description: 'b', amount: '6' }] } }));
    ok(await call(server, 'POST', '/v1/approval-policies', { tenant: b.tenant, body: { companyId: b.companyId, documentType: 'journal', thresholdAmount: '1', requiredApprovals: 1 } }));
    ok(await call(server, 'POST', '/v1/approvals/requests', { tenant: b.tenant, body: { companyId: b.companyId, documentType: 'journal', payload: { companyId: b.companyId, postingDate: '2025-05-09', description: 'Big one', lines: [{ accountId: b.acc['5900'], debit: '10' }, { accountId: b.acc['1110'], credit: '10' }] } } }));
    ok(await call(server, 'POST', '/v1/purchasing/orders', { tenant: b.tenant, body: { companyId: b.companyId, gstRegistrationId: b.regId, supplierId: b.sup.intra, orderDate: '2025-05-10', lines: [{ itemId: b.item.widget, quantity: '1', unitPrice: '10', warehouseId: b.wh }] } }));
    expect((await dash(b, '2025-05-20')).json.attention).toEqual({ pendingApprovals: 1, unmatchedBankLines: 2, openPurchaseOrders: 1, openWorkOrders: 0 });

    // as of the first month the previous month does not exist, and the trend has one point
    const early = (await dash(b, '2025-04-30')).json;
    expect(early.month).toMatchObject({ from: '2025-04-01', revenue: '100000.0000' });
    expect(early.month.previousMonth).toBeUndefined();
    expect(early.trend).toHaveLength(1);
  });

  it('needs a fiscal year, a permission, and never shows another tenant', async () => {
    const b = await k.buyer('Dash Guard Co');
    const other = await k.buyer('Dash Other Co');
    expect((await dash(b, '2030-01-01')).status).toBe(409);
    expect((await call(server, 'GET', `/v1/dashboard?companyId=${b.companyId}`, { tenant: other.tenant })).status).toBe(409); // other tenant has no such company: no fiscal year for it
    const slug = (await supers.query('SELECT slug FROM erp.tenants WHERE id = $1', [b.tenant])).rows[0].slug as string;
    const role = ok(await call(server, 'POST', '/v1/roles', { tenant: b.tenant, body: { name: 'nobody', permissions: ['masterdata:read'] } }));
    const email = `n@${slug}.example.com`;
    ok(await call(server, 'POST', '/v1/users', { tenant: b.tenant, body: { email, displayName: 'n', password: 'another long passphrase 42', roleIds: [role.id] } }));
    const token = ((await call(server, 'POST', '/v1/auth/login', { body: { tenant: slug, email, password: 'another long passphrase 42' } })).json as { accessToken: string }).accessToken;
    expect((await dash(b, '2025-05-20', token)).status).toBe(403);
  });
});
