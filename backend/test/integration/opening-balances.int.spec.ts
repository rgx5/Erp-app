import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { buyerKit } from '../support/buyer.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let kit: ReturnType<typeof shopKit>;
let buyers: ReturnType<typeof buyerKit>;
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); buyers = buyerKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

describe('opening balances of customers and suppliers', () => {
  it('brings forward what a customer owes: it shows in the position, ageing and statement, a receipt settles it, and it is not a sale', async () => {
    const s = await kit.shop('Opening Recv Co');
    const body = { companyId: s.companyId, asOf: '2025-04-01', items: [{ partyId: s.cust.local, amount: '3380.50' }] };
    const first = ok(await call(server, 'POST', '/v1/receivables/opening-balances', { tenant: s.tenant, body }), 200);
    expect(first.items[0]).toMatchObject({ status: 'created', number: expect.stringMatching(/^OPEN-/) });
    // doing it again changes nothing
    const again = ok(await call(server, 'POST', '/v1/receivables/opening-balances', { tenant: s.tenant, body, headers: { 'idempotency-key': 'second-try' } }), 200);
    expect(again.items[0].status).toBe('exists');

    // the ledger: receivable up, opening equity up, nothing in sales
    const pos = ok(await call(server, 'GET', `/v1/receivables/customers/${s.cust.local}/position?companyId=${s.companyId}&asOf=2025-06-30`, { tenant: s.tenant }), 200);
    expect(Number(pos.totalOutstanding)).toBe(3380.5);
    const tb = ok(await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: s.tenant }), 200);
    const line = (code: string) => (tb.lines ?? tb.rows ?? []).find((l: { code?: string; accountCode?: string }) => (l.code ?? l.accountCode) === code);
    expect(line('4100')).toBeUndefined(); // no sales
    // ageing lists it
    const ageing = ok(await call(server, 'GET', `/v1/receivables/ageing?companyId=${s.companyId}&asOf=2025-06-30`, { tenant: s.tenant }), 200);
    expect(Number(ageing.totals?.total ?? ageing.total)).toBe(3380.5);
    // statement shows it as the first movement
    const st = ok(await call(server, 'GET', `/v1/receivables/customers/${s.cust.local}/statement?companyId=${s.companyId}&from=2025-04-01&to=2025-06-30`, { tenant: s.tenant }), 200);
    expect(st.lines[0]).toMatchObject({ kind: 'opening_balance', debit: '3380.5000' });
    // a receipt can be applied to it
    const receipt = ok(await call(server, 'POST', '/v1/receivables/receipts', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: s.companyId, customerId: s.cust.local, receiptDate: '2025-05-01', amount: '1000', method: 'cash', depositAccountId: s.acc['1110'], allocations: [{ invoiceId: first.items[0].documentId, amount: '1000' }] } }));
    expect(receipt.id).toBeTruthy();
    const pos2 = ok(await call(server, 'GET', `/v1/receivables/customers/${s.cust.local}/position?companyId=${s.companyId}&asOf=2025-06-30`, { tenant: s.tenant }), 200);
    expect(Number(pos2.totalOutstanding)).toBe(2380.5);
    // not counted as a sale or a GST document
    const gst = await call(server, 'GET', `/v1/gst/returns/gstr1?registrationId=${s.regId}&period=2025-04`, { tenant: s.tenant });
    expect(JSON.stringify(gst.json)).not.toContain('OPEN-');
    const balanced = (await supers.query('SELECT coalesce(sum(debit),0) = coalesce(sum(credit),0) AS ok FROM erp.journal_lines WHERE tenant_id = $1', [s.tenant])).rows[0].ok;
    expect(balanced).toBe(true);
  });

  it('brings forward what is owed to a supplier, and refuses a party that is not one, a missing amount, and a wrong date', async () => {
    const s = await buyers.buyer('Opening Pay Co');
    const ok1 = ok(await call(server, 'POST', '/v1/payables/opening-balances', { tenant: s.tenant, body: { companyId: s.companyId, asOf: '2025-04-01', items: [{ partyId: s.sup.inter, amount: '12000' }] } }), 200);
    expect(ok1.items[0].status).toBe('created');
    const pos = ok(await call(server, 'GET', `/v1/payables/suppliers/${s.sup.inter}/position?companyId=${s.companyId}&asOf=2025-06-30`, { tenant: s.tenant }), 200);
    expect(Number(pos.totalOutstanding)).toBe(12000);
    expect((await call(server, 'POST', '/v1/payables/opening-balances', { tenant: s.tenant, body: { companyId: s.companyId, asOf: '2025-04-01', items: [{ partyId: s.cust.local, amount: '10' }] } })).status).toBe(422); // a customer, not a supplier
    expect((await call(server, 'POST', '/v1/receivables/opening-balances', { tenant: s.tenant, body: { companyId: s.companyId, asOf: '2025-04-01', items: [{ partyId: s.cust.local, amount: '0' }] } })).status).toBe(422);
    expect((await call(server, 'POST', '/v1/receivables/opening-balances', { tenant: s.tenant, body: { companyId: s.companyId, asOf: '2019-01-01', items: [{ partyId: s.cust.local, amount: '10' }] } })).status).toBeGreaterThanOrEqual(400); // no open period
  });

  it('can be cancelled when it was entered wrongly, and entered again', async () => {
    const s = await kit.shop('Opening Cancel Co');
    const body = { companyId: s.companyId, asOf: '2025-04-01', items: [{ partyId: s.cust.local, amount: '500' }] };
    const made = ok(await call(server, 'POST', '/v1/receivables/opening-balances', { tenant: s.tenant, body }), 200);
    ok(await call(server, 'POST', `/v1/sales/invoices/${made.items[0].documentId}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-04-02', reason: 'Wrong amount' } }), 200);
    const pos = ok(await call(server, 'GET', `/v1/receivables/customers/${s.cust.local}/position?companyId=${s.companyId}&asOf=2025-06-30`, { tenant: s.tenant }), 200);
    expect(Number(pos.totalOutstanding)).toBe(0);
    const again = ok(await call(server, 'POST', '/v1/receivables/opening-balances', { tenant: s.tenant, headers: { 'idempotency-key': 'redo' }, body: { ...body, items: [{ partyId: s.cust.local, amount: '700' }] } }), 200);
    expect(again.items[0].status).toBe('created');
  });
});
