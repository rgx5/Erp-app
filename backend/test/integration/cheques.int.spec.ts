import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerKit } from '../support/buyer.js';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let buyers: ReturnType<typeof buyerKit>;
beforeAll(async () => { server = await startServer(); buyers = buyerKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

describe('cheques', () => {
  it('holds a received cheque, deposits it, and makes the receipt only when it clears; a bounce afterwards cancels it', async () => {
    const s = await buyers.buyer('Cheque Recv Co');
    // something owed to settle
    const opening = ok(await call(server, 'POST', '/v1/receivables/opening-balances', { tenant: s.tenant, body: { companyId: s.companyId, asOf: '2025-04-01', items: [{ partyId: s.cust.local, amount: '5000' }] } }), 200);
    const inv = opening.items[0].documentId as string;
    const cheque = ok(await call(server, 'POST', '/v1/cheques/received', { tenant: s.tenant, body: { companyId: s.companyId, partyId: s.cust.local, chequeNo: '000123', chequeDate: '2025-05-10', bankName: 'Sample Bank', amount: '3000', allocations: [{ invoiceId: inv, amount: '3000' }] } }));
    expect(cheque).toMatchObject({ status: 'pending', direction: 'received', chequeNo: '000123' });
    const pos = async () => Number((await call(server, 'GET', `/v1/receivables/customers/${s.cust.local}/position?companyId=${s.companyId}&asOf=2025-06-30`, { tenant: s.tenant })).json.totalOutstanding);
    expect(await pos()).toBe(5000); // nothing is posted while it is only held

    expect((await call(server, 'POST', '/v1/cheques/received', { tenant: s.tenant, body: { companyId: s.companyId, partyId: s.cust.local, chequeNo: '000123', chequeDate: '2025-05-10', amount: '10' } })).status).toBe(409); // same number twice
    expect((await call(server, 'POST', '/v1/cheques/received', { tenant: s.tenant, body: { companyId: s.companyId, partyId: s.sup.inter, chequeNo: '9', chequeDate: '2025-05-10', amount: '10' } })).status).toBe(422); // a supplier is not a payer

    const dep = ok(await call(server, 'POST', `/v1/cheques/received/${cheque.id}/deposit`, { tenant: s.tenant, body: { date: '2025-05-11', accountId: s.acc['1120'] } }), 200);
    expect(dep.status).toBe('deposited');
    expect(await pos()).toBe(5000);

    const cleared = ok(await call(server, 'POST', `/v1/cheques/received/${cheque.id}/clear`, { tenant: s.tenant, body: { date: '2025-05-13' } }), 200);
    expect(cleared).toMatchObject({ status: 'cleared', clearedOn: '2025-05-13' });
    expect(cleared.receiptId).toBeTruthy();
    expect(await pos()).toBe(2000);
    expect((await call(server, 'POST', `/v1/cheques/received/${cheque.id}/clear`, { tenant: s.tenant, body: { date: '2025-05-14' } })).status).toBe(409); // not twice

    const bounced = ok(await call(server, 'POST', `/v1/cheques/received/${cheque.id}/bounce`, { tenant: s.tenant, body: { date: '2025-05-16', reason: 'Insufficient funds' } }), 200);
    expect(bounced).toMatchObject({ status: 'bounced', bounceReason: 'Insufficient funds' });
    expect(await pos()).toBe(5000); // the receipt was cancelled and the invoice is open again
    const open = (await call(server, 'GET', `/v1/cheques/received?companyId=${s.companyId}&status=open`, { tenant: s.tenant })).json.items;
    expect(open).toHaveLength(0);
  });

  it('a held cheque can be cancelled; an issued cheque makes a supplier payment when it clears', async () => {
    const s = await buyers.buyer('Cheque Issue Co');
    const a = ok(await call(server, 'POST', '/v1/cheques/received', { tenant: s.tenant, body: { companyId: s.companyId, partyId: s.cust.local, chequeNo: 'C1', chequeDate: '2025-05-10', amount: '100' } }));
    ok(await call(server, 'POST', `/v1/cheques/received/${a.id}/cancel`, { tenant: s.tenant, body: { reason: 'Customer asked for it back' } }), 200);
    expect((await call(server, 'POST', `/v1/cheques/received/${a.id}/clear`, { tenant: s.tenant, body: { date: '2025-05-12', accountId: s.acc['1120'] } })).status).toBe(409);

    const bill = ok(await call(server, 'POST', '/v1/payables/opening-balances', { tenant: s.tenant, body: { companyId: s.companyId, asOf: '2025-04-01', items: [{ partyId: s.sup.inter, amount: '8000' }] } }), 200);
    const chq = ok(await call(server, 'POST', '/v1/cheques/issued', { tenant: s.tenant, body: { companyId: s.companyId, partyId: s.sup.inter, chequeNo: '777001', chequeDate: '2025-06-01', amount: '8000', allocations: [{ billId: bill.items[0].documentId, amount: '8000' }] } }));
    const out = async () => Number((await call(server, 'GET', `/v1/payables/suppliers/${s.sup.inter}/position?companyId=${s.companyId}&asOf=2025-06-30`, { tenant: s.tenant })).json.totalOutstanding);
    expect(await out()).toBe(8000);
    const done = ok(await call(server, 'POST', `/v1/cheques/issued/${chq.id}/clear`, { tenant: s.tenant, body: { date: '2025-06-05', accountId: s.acc['1120'] } }), 200);
    expect(done).toMatchObject({ status: 'cleared' }); expect(done.paymentId).toBeTruthy();
    expect(await out()).toBe(0);
    // clearing needs an account the first time
    const next = ok(await call(server, 'POST', '/v1/cheques/issued', { tenant: s.tenant, body: { companyId: s.companyId, partyId: s.sup.inter, chequeNo: '777002', chequeDate: '2025-06-01', amount: '10' } }));
    expect((await call(server, 'POST', `/v1/cheques/issued/${next.id}/clear`, { tenant: s.tenant, body: { date: '2025-06-05' } })).status).toBe(422);
    expect((await call(server, 'GET', `/v1/cheques/issued?companyId=${s.companyId}&dueBy=2025-07-01&status=open`, { tenant: s.tenant })).json.items).toHaveLength(1);
  });
});
