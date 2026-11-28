import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let kit: ReturnType<typeof shopKit>;
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

describe('sales in a foreign currency', () => {
  it('books at the invoice rate, shows unrealised exposure, and posts the realised exchange gain or loss when the customer pays', async () => {
    const s = await kit.shop('Fx Co');
    const tb = async (to: string) => (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=${to}`, { tenant: s.tenant })).json;
    const bal = (t: { rows: Array<{ code: string; closingDebit: string; closingCredit: string }> }, code: string) => { const r = t.rows.find((x) => x.code === code); return r ? Number(r.closingDebit) - Number(r.closingCredit) : 0; };
    const invoice = (extra: object, qty = '10') => call(server, 'POST', '/v1/sales/invoices', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: s.companyId, gstRegistrationId: s.regId, invoiceDate: '2025-06-10', customerId: s.cust.local, lines: [{ itemId: s.item.widget, quantity: qty, unitPrice: '100', warehouseId: s.wh }], ...extra } });

    ok(await call(server, 'POST', '/v1/currencies', { tenant: s.tenant, body: { code: 'USD', name: 'US dollar', decimalPlaces: 2 } }));
    ok(await call(server, 'POST', '/v1/exchange-rates', { tenant: s.tenant, body: { fromCurrency: 'USD', toCurrency: 'INR', rate: '80', effectiveDate: '2025-06-01' } }));

    // a preview and the posted invoice agree; the rate is taken from the table when none is given
    const calc = ok(await call(server, 'POST', '/v1/sales/invoices/calculate', { tenant: s.tenant, body: { companyId: s.companyId, gstRegistrationId: s.regId, invoiceDate: '2025-06-10', customerId: s.cust.local, currency: 'USD', lines: [{ itemId: s.item.widget, quantity: '10', unitPrice: '100', warehouseId: s.wh }] } }), 200);
    expect(calc).toMatchObject({ currency: 'USD', exchangeRate: '80' });
    expect(calc.totals.taxable).toBe('80000.0000');
    const inv = ok(await invoice({ currency: 'USD' }));
    expect(inv).toMatchObject({ currency: 'USD', exchangeRate: '80.00000000', taxableTotal: '80000.0000' });
    const grand = Number(inv.grandTotal); const foreign = Number(inv.foreignTotal);
    expect(foreign).toBeCloseTo(grand / 80, 2);
    expect((await invoice({ currency: 'EUR' })).status).toBe(404);          // no rate in force
    expect((await invoice({ exchangeRate: '80' })).status).toBe(422);       // a rate needs a currency

    // exposure: the dollar rises to 83 before the customer pays
    ok(await call(server, 'POST', '/v1/exchange-rates', { tenant: s.tenant, body: { fromCurrency: 'USD', toCurrency: 'INR', rate: '83', effectiveDate: '2025-06-20' } }));
    const exp = ok(await call(server, 'GET', `/v1/fx/exposure?companyId=${s.companyId}&asOf=2025-06-30`, { tenant: s.tenant }), 200);
    expect(exp.items).toHaveLength(1);
    expect(Number(exp.totals[0].unrealised)).toBeCloseTo(foreign * 83 - grand, 1);

    // the customer pays the whole amount in dollars at 82: the books clear at 80, the 2 extra rupees a dollar are gain
    const paidInr = (foreign * 82).toFixed(2);
    const rcpt = ok(await call(server, 'POST', '/v1/receivables/receipts', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: s.companyId, customerId: s.cust.local, receiptDate: '2025-06-25', amount: paidInr, method: 'bank_transfer', depositAccountId: s.acc['1120'], foreign: { currency: 'USD', amount: String(foreign), rate: '82' }, allocations: [{ invoiceId: inv.id, amount: String(foreign) }] } }));
    expect(rcpt).toMatchObject({ currency: 'USD' });
    const t = await tb('2025-06-30');
    expect(t.balanced).toBe(true);
    expect(bal(t, '1120')).toBeCloseTo(Number(paidInr), 1);
    expect(bal(t, '1130')).toBeCloseTo(0, 2);                                 // the customer owes nothing
    expect(bal(t, '4920')).toBeCloseTo(-(Number(paidInr) - grand), 1);       // exchange gain
    const after = ok(await call(server, 'GET', `/v1/fx/exposure?companyId=${s.companyId}&asOf=2025-06-30`, { tenant: s.tenant }), 200);
    expect(after.items).toHaveLength(0);

    // a second invoice paid at a lower rate is a loss
    const inv2 = ok(await invoice({ currency: 'USD', exchangeRate: '80' }, '5'));
    const f2 = Number(inv2.foreignTotal); const paid2 = (f2 * 78).toFixed(2);
    ok(await call(server, 'POST', '/v1/receivables/receipts', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: s.companyId, customerId: s.cust.local, receiptDate: '2025-07-02', amount: paid2, method: 'bank_transfer', depositAccountId: s.acc['1120'], foreign: { currency: 'USD', amount: String(f2), rate: '78' }, allocations: [{ invoiceId: inv2.id, amount: String(f2) }] } }));
    const t2 = await tb('2025-07-31');
    expect(bal(t2, '5810')).toBeCloseTo(Number(inv2.grandTotal) - Number(paid2), 1);
    expect(bal(t2, '1130')).toBeCloseTo(0, 2);

    // the rupee amount has to match what was paid in dollars
    expect((await call(server, 'POST', '/v1/receivables/receipts', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: s.companyId, customerId: s.cust.local, receiptDate: '2025-07-03', amount: '100', method: 'bank_transfer', depositAccountId: s.acc['1120'], foreign: { currency: 'USD', amount: '10', rate: '82' } } })).status).toBe(422);
  });
});
