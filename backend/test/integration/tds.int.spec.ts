import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerKit } from '../support/buyer.js';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok } from '../support/shop.js';

let server: TestServer; let k: ReturnType<typeof buyerKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); k = buyerKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

describe('TDS on supplier payments', () => {
  it('deducts at the section rate, posts the three-way journal, tracks the deduction to its deposit, and refuses what would be wrong', async () => {
    const b = await k.buyer('TDS Co');
    const pay = (amount: string, tds?: object, supplier = b.sup.intra) => call(server, 'POST', '/v1/payables/payments', { tenant: b.tenant, body: { companyId: b.companyId, supplierId: supplier, paymentDate: '2025-04-20', amount, method: 'bank_transfer', paidFromAccountId: b.acc['1120'], ...(tds ? { tds } : {}) } });
    const bal = async (code: string) => { const t = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${b.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: b.tenant })).json; const r = t.rows.find((x: { code: string }) => x.code === code) as { closingDebit: string; closingCredit: string } | undefined; return r ? Number(r.closingDebit) - Number(r.closingCredit) : 0; };

    const sections = ok(await call(server, 'GET', '/v1/tds/sections', { tenant: b.tenant }), 200).items as { code: string; rate: string }[];
    expect(sections.find((s) => s.code === '194J-P')?.rate).toBe('10.0000');
    // what a payment would deduct, without writing anything
    const sug = ok(await call(server, 'GET', `/v1/tds/suggest?supplierId=${b.sup.intra}&sectionCode=194J-P&amount=100000&date=2025-04-20`, { tenant: b.tenant }), 200);
    expect(sug).toMatchObject({ applies: true, amount: '10000.00', rate: 10, noPan: false });
    expect(ok(await call(server, 'GET', `/v1/tds/suggest?supplierId=${b.sup.intra}&sectionCode=194J-P&amount=20000&date=2025-04-20`, { tenant: b.tenant }), 200)).toMatchObject({ applies: false });
    expect(ok(await call(server, 'GET', `/v1/tds/suggest?supplierId=${b.sup.unreg}&sectionCode=194J-P&amount=100000&date=2025-04-20`, { tenant: b.tenant }), 200)).toMatchObject({ noPan: true, rate: 20, amount: '20000.00' }); // no PAN: 20%

    // a payment of 100,000 with 10,000 held back: the supplier is credited the whole, the bank pays 90,000
    const p = ok(await pay('100000', { sectionCode: '194J-P' }));
    expect(p.amount).toBe('100000.0000');
    expect(await bal('1120')).toBe(-90000); expect(await bal('2240')).toBe(-10000); expect(await bal('2110')).toBe(100000);
    const d = ok(await call(server, 'GET', '/v1/tds/deductions', { tenant: b.tenant }), 200).items as { id: string; tdsAmount: string; sectionCode: string; status: string; paymentNo: string; dueDate: string; pan: string }[];
    expect(d).toHaveLength(1); expect(d[0]).toMatchObject({ tdsAmount: '10000.00', sectionCode: '194J-P', status: 'deducted', dueDate: '2025-05-07' }); expect(d[0]?.pan).toHaveLength(10);

    // nothing to deduct, or too much, is refused rather than guessed
    expect((await pay('20000', { sectionCode: '194J-P' }, b.sup.inter)).status).toBe(422); // a first small payment: under the limit
    expect((await pay('5000', { sectionCode: '194J-P', base: '100000', amount: '5000' })).status).toBe(422); // tax cannot be as much as the payment
    expect((await pay('100000', { sectionCode: 'NOPE' })).status).toBe(422);

    // a cancelled payment gives the tax back; a deposited one cannot be cancelled
    const second = ok(await pay('100000', { sectionCode: '194J-P' }));
    ok(await call(server, 'POST', `/v1/payables/payments/${second.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-21', reason: 'Wrong supplier' } }), 200);
    expect(await bal('2240')).toBe(-10000);
    expect(ok(await call(server, 'GET', '/v1/tds/deductions?status=cancelled', { tenant: b.tenant }), 200).items).toHaveLength(1);

    // deposit with the government: Dr TDS payable, Cr bank
    const dep = ok(await call(server, 'POST', '/v1/tds/deposits', { tenant: b.tenant, body: { ids: [d[0]?.id], paidFromAccountId: b.acc['1120'], depositedOn: '2025-05-06', challanNo: '0510001', challanDate: '2025-05-06', bsrCode: '6390340' } }), 200);
    expect(dep).toMatchObject({ amount: '10000.00', count: 1 });
    expect(await bal('2240')).toBe(0); expect(await bal('1120')).toBe(-100000);
    expect((await call(server, 'POST', '/v1/tds/deposits', { tenant: b.tenant, body: { ids: [d[0]?.id], paidFromAccountId: b.acc['1120'], depositedOn: '2025-05-06', challanNo: 'X', challanDate: '2025-05-06' } })).status).toBe(409); // already deposited
    expect((await call(server, 'POST', `/v1/payables/payments/${p.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-05-07', reason: 'x' } })).status).toBe(409);
    expect(ok(await call(server, 'GET', '/v1/tds/deductions?status=deposited', { tenant: b.tenant }), 200).items[0]).toMatchObject({ challanNo: '0510001', depositedOn: '2025-05-06' });
  });

  it('keeps businesses apart and needs the right permission', async () => {
    const a = await k.buyer('TDS A'); const o = await k.buyer('TDS B');
    ok(await call(server, 'POST', '/v1/payables/payments', { tenant: a.tenant, body: { companyId: a.companyId, supplierId: a.sup.intra, paymentDate: '2025-04-20', amount: '100000', method: 'bank_transfer', paidFromAccountId: a.acc['1120'], tds: { sectionCode: '194J-P' } } }));
    expect(ok(await call(server, 'GET', '/v1/tds/deductions', { tenant: o.tenant }), 200).items).toHaveLength(0);
    const mine = ok(await call(server, 'GET', '/v1/tds/deductions', { tenant: a.tenant }), 200).items as { id: string }[];
    expect((await call(server, 'POST', '/v1/tds/deposits', { tenant: o.tenant, body: { ids: [mine[0]?.id], paidFromAccountId: o.acc['1120'], depositedOn: '2025-05-06', challanNo: 'X', challanDate: '2025-05-06' } })).status).toBe(404);
    expect((await call(server, 'GET', '/v1/tds/sections')).status).toBe(401);
  });
});
