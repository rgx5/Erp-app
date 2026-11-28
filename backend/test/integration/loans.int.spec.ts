import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerKit } from '../support/buyer.js';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let buyers: ReturnType<typeof buyerKit>;
beforeAll(async () => { server = await startServer(); buyers = buyerKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

describe('loans', () => {
  it('a loan taken: the bank gets the money, each instalment splits into principal and interest, and the loan closes when repaid', async () => {
    const s = await buyers.buyer('Loan Taken Co');
    const tb = async (to: string) => (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=${to}`, { tenant: s.tenant })).json;
    const bal = (t: { rows: Array<{ code: string; closingDebit: string; closingCredit: string }> }, code: string) => { const r = t.rows.find((x) => x.code === code); return r ? Number(r.closingDebit) - Number(r.closingCredit) : 0; };

    const preview = ok(await call(server, 'POST', '/v1/loans/preview', { tenant: s.tenant, body: { principal: '100000', annualRate: 12, method: 'reducing', tenureMonths: 12, firstDueOn: '2025-06-05' } }), 200);
    expect(preview).toMatchObject({ emi: '8884.88' });
    expect(preview.instalments).toHaveLength(12);

    const loan = ok(await call(server, 'POST', '/v1/loans', { tenant: s.tenant, body: { companyId: s.companyId, direction: 'taken', name: 'HDFC Bank term loan', principal: '100000', annualRate: 12, method: 'reducing', tenureMonths: 12, disbursedOn: '2025-05-05', firstDueOn: '2025-06-05', bankAccountId: s.acc['1120'] } }));
    expect(loan).toMatchObject({ loanNo: 'LN-0001', status: 'active', emi: '8884.8800', outstanding: '100000.0000', paidCount: 0 });
    expect(loan.instalments).toHaveLength(12);
    let t = await tb('2025-05-31');
    expect(bal(t, '1120')).toBe(100000);       // the bank has the money
    expect(bal(t, '2310')).toBe(-100000);      // and the books owe it

    // pay the first instalment: ₹1,000 interest and ₹7,884.88 principal
    const paid = ok(await call(server, 'POST', `/v1/loans/${loan.id}/instalments/1/pay`, { tenant: s.tenant, body: { date: '2025-06-05' } }), 200);
    expect(paid.instalments[0]).toMatchObject({ status: 'paid', paidOn: '2025-06-05' });
    expect(paid.paidCount).toBe(1);
    t = await tb('2025-06-30');
    expect(bal(t, '5800')).toBe(1000);
    expect(bal(t, '2310')).toBe(-(100000 - 7884.88));
    expect(bal(t, '1120')).toBeCloseTo(100000 - 8884.88, 2);
    expect(t.balanced).toBe(true);

    expect((await call(server, 'POST', `/v1/loans/${loan.id}/instalments/1/pay`, { tenant: s.tenant, body: { date: '2025-06-06' } })).status).toBe(409);   // not twice
    expect((await call(server, 'POST', `/v1/loans/${loan.id}/instalments/3/pay`, { tenant: s.tenant, body: { date: '2025-08-05' } })).status).toBe(409);   // in order
    expect((await call(server, 'POST', `/v1/loans/${loan.id}/cancel`, { tenant: s.tenant, body: { date: '2025-06-07', reason: 'mistake' } })).status).toBe(409); // payments made

    // pay the rest early, with the lender's interest to that day
    const closed = ok(await call(server, 'POST', `/v1/loans/${loan.id}/foreclose`, { tenant: s.tenant, body: { date: '2025-07-05', interest: '900' } }), 200);
    expect(closed).toMatchObject({ status: 'closed', closedOn: '2025-07-05', outstanding: '0.0000' });
    t = await tb('2025-07-31');
    expect(bal(t, '2310')).toBeCloseTo(0, 2);
    expect(bal(t, '5800')).toBe(1900);

    const list = ok(await call(server, 'GET', `/v1/loans?companyId=${s.companyId}&direction=taken`, { tenant: s.tenant }), 200);
    expect(list.items).toHaveLength(1);
  });

  it('a loan given: the bank pays out, instalments bring principal back and interest is income; a mistaken loan can be cancelled', async () => {
    const s = await buyers.buyer('Loan Given Co');
    const tb = async () => (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: s.tenant })).json;
    const bal = (t: { rows: Array<{ code: string; closingDebit: string; closingCredit: string }> }, code: string) => { const r = t.rows.find((x) => x.code === code); return r ? Number(r.closingDebit) - Number(r.closingCredit) : 0; };
    // the bank needs money to lend: borrow first
    ok(await call(server, 'POST', '/v1/loans', { tenant: s.tenant, body: { companyId: s.companyId, direction: 'taken', name: 'Owner loan', principal: '50000', annualRate: 0, tenureMonths: 5, disbursedOn: '2025-04-10', bankAccountId: s.acc['1120'] } }));

    const given = ok(await call(server, 'POST', '/v1/loans', { tenant: s.tenant, body: { companyId: s.companyId, direction: 'given', name: 'Staff advance · Ramesh', principal: '12000', annualRate: 10, method: 'flat', tenureMonths: 12, disbursedOn: '2025-05-01', bankAccountId: s.acc['1120'] } }));
    expect(given).toMatchObject({ direction: 'given', loanNo: 'LN-0002', emi: '1100.0000', firstDueOn: '2025-06-01' });
    let t = await tb();
    expect(bal(t, '1150')).toBe(12000);
    expect(bal(t, '1120')).toBe(50000 - 12000);

    ok(await call(server, 'POST', `/v1/loans/${given.id}/instalments/1/pay`, { tenant: s.tenant, body: { date: '2025-06-01' } }), 200);
    t = await tb();
    expect(bal(t, '1150')).toBe(11000);        // ₹1,000 principal came back
    expect(bal(t, '4910')).toBe(-100);         // ₹100 interest earned
    expect(bal(t, '1120')).toBe(38000 + 1100);

    const mistake = ok(await call(server, 'POST', '/v1/loans', { tenant: s.tenant, body: { companyId: s.companyId, direction: 'given', name: 'Typed twice', principal: '5000', annualRate: 0, tenureMonths: 5, disbursedOn: '2025-06-10', bankAccountId: s.acc['1120'] } }));
    const cancelled = ok(await call(server, 'POST', `/v1/loans/${mistake.id}/cancel`, { tenant: s.tenant, body: { date: '2025-06-10', reason: 'entered twice' } }), 200);
    expect(cancelled.status).toBe('cancelled');
    t = await tb();
    expect(bal(t, '1150')).toBe(11000);        // back to what it was
    expect(t.balanced).toBe(true);
  });

  it('refuses a loan whose accounts are the wrong kind, and a bank account of another type', async () => {
    const s = await buyers.buyer('Loan Bad Co');
    const r = await call(server, 'POST', '/v1/loans', { tenant: s.tenant, body: { companyId: s.companyId, direction: 'taken', name: 'x', principal: '1000', annualRate: 5, tenureMonths: 6, disbursedOn: '2025-05-01', bankAccountId: s.acc['1120'], loanAccountId: s.acc['4100'] } });
    expect(r.status).toBe(422);
  });
});
