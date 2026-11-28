import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let kit: ReturnType<typeof shopKit>;
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

describe('TCS on sales', () => {
  it('adds tax collected at source to the invoice, credits TCS payable, lists it in the register and clears it on deposit', async () => {
    const s = await kit.shop('Tcs Co');
    const tb = async (to: string) => (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=${to}`, { tenant: s.tenant })).json;
    const bal = (t: { rows: Array<{ code: string; closingDebit: string; closingCredit: string }> }, code: string) => { const r = t.rows.find((x) => x.code === code); return r ? Number(r.closingDebit) - Number(r.closingCredit) : 0; };

    const sections = ok(await call(server, 'GET', '/v1/tcs/sections', { tenant: s.tenant }), 200);
    expect(sections.items.find((x: { code: string }) => x.code === '206C(1)-SCRAP')).toMatchObject({ rate: '1.0000', status: 'active' });

    const body = { companyId: s.companyId, gstRegistrationId: s.regId, invoiceDate: '2025-06-10', customerId: s.cust.local, lines: [{ itemId: s.item.widget, quantity: '10', unitPrice: '1000', warehouseId: s.wh }], tcs: { sectionCode: '206C(1)-SCRAP' } };
    const calc = ok(await call(server, 'POST', '/v1/sales/invoices/calculate', { tenant: s.tenant, body }), 200);
    expect(calc.tcs).toMatchObject({ section: '206C(1)-SCRAP', rate: '1', base: '10000.0000', amount: '100.0000' });
    const plain = ok(await call(server, 'POST', '/v1/sales/invoices/calculate', { tenant: s.tenant, body: { ...body, tcs: undefined } }), 200);
    expect(Number(calc.totals.grandTotal) - Number(plain.totals.grandTotal)).toBeCloseTo(100, 2);

    const inv = ok(await call(server, 'POST', '/v1/sales/invoices', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body }));
    expect(inv).toMatchObject({ tcsSection: '206C(1)-SCRAP', tcsAmount: '100.0000' });
    const t = await tb('2025-06-30');
    expect(bal(t, '2250')).toBe(-100);
    expect(t.balanced).toBe(true);

    expect((await call(server, 'POST', '/v1/sales/invoices/calculate', { tenant: s.tenant, body: { ...body, tcs: { sectionCode: 'NOPE' } } })).status).toBe(422);

    const reg = ok(await call(server, 'GET', `/v1/tcs/register?companyId=${s.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: s.tenant }), 200);
    expect(reg.items).toHaveLength(1);
    expect(reg.totals).toMatchObject({ collected: '100.0000', deposited: '0.0000', pending: '100.0000', invoices: 1 });

    ok(await call(server, 'POST', '/v1/tcs/deposits', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: s.companyId, periodFrom: '2025-04-01', periodTo: '2025-06-30', amount: '100', depositedOn: '2025-07-05', challanNo: 'CH-1', bankAccountId: s.acc['1120'] } }));
    expect(bal(await tb('2025-07-31'), '2250')).toBe(0);
    const after = ok(await call(server, 'GET', `/v1/tcs/register?companyId=${s.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: s.tenant }), 200);
    expect(after.totals).toMatchObject({ deposited: '100.0000', pending: '0.0000' });
  });
});
