import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { buyerKit, type Buyer } from '../support/buyer.js';
import { ok } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let k: ReturnType<typeof buyerKit>;
beforeAll(async () => { server = await startServer(); k = buyerKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const pay = (b: Buyer, supplier: string, amount: string, o: object = {}) =>
  call(server, 'POST', '/v1/payables/payments', { tenant: b.tenant, body: { companyId: b.companyId, supplierId: supplier, paymentDate: '2025-04-20', amount, method: 'bank_transfer', paidFromAccountId: b.acc['1120'], ...o } });
const allocate = (b: Buyer, source: { type: string; id: string }, allocations: object[], o: object = {}) => call(server, 'POST', '/v1/payables/allocations', { tenant: b.tenant, body: { source, allocatedOn: '2025-04-21', allocations, ...o } });
const position = async (b: Buyer, supplier: string, asOf = '2026-03-31') => (await call(server, 'GET', `/v1/payables/suppliers/${supplier}/position?companyId=${b.companyId}&asOf=${asOf}`, { tenant: b.tenant })).json;
const recon = async (b: Buyer, asOf = '2026-03-31') => (await call(server, 'GET', `/v1/payables/reconciliation?companyId=${b.companyId}&asOf=${asOf}`, { tenant: b.tenant })).json;
const debitNote = (b: Buyer, original: { id: string; lines: { id: string }[] }, quantity: string, o: object = {}) =>
  call(server, 'POST', '/v1/purchasing/debit-notes', { tenant: b.tenant, body: { originalBillId: original.id, noteDate: '2025-04-20', reason: 'Damaged', lines: [{ originalLineId: original.lines[0]?.id, quantity }], ...o } });

describe('payments and allocation', () => {
  it('pays a bill in parts: bank and payables move, the bill settles, the position follows', async () => {
    const b = await k.buyer('Pay Parts Co');
    const bill = await k.billed(b, b.sup.intra); // 5,900
    const p1 = ok(await pay(b, b.sup.intra, '2000', { allocations: [{ billId: bill.id, amount: '2000' }], reference: 'NEFT-1' }));
    expect(p1).toMatchObject({ paymentNo: 'PAY/2526/000001', status: 'posted', amount: '2000.0000', unallocated: '0.0000', allocations: [expect.objectContaining({ billId: bill.id, amount: '2000.0000' })] });
    expect(await k.net(b, '2110')).toBe(-3900);
    expect(await k.net(b, '1120')).toBe(-2000);
    expect(await position(b, b.sup.intra)).toMatchObject({ totalOutstanding: '3900.0000', totalUnapplied: '0.0000', balance: '3900.0000', openBills: [expect.objectContaining({ id: bill.id, total: '5900.0000', outstanding: '3900.0000' })] });
    ok(await pay(b, b.sup.intra, '3900', { allocations: [{ billId: bill.id, amount: '3900' }] }));
    expect(await position(b, b.sup.intra)).toMatchObject({ totalOutstanding: '0.0000', openBills: [], balance: '0.0000' });
    expect(await k.net(b, '2110')).toBe(0);
    expect((await recon(b)).reconciled).toBe(true);
    // nothing is left to settle
    expect((await pay(b, b.sup.intra, '1', { allocations: [{ billId: bill.id, amount: '1' }] })).json.code).toBe('exceeds_outstanding');
  });

  it('keeps an unallocated payment as an advance and applies it later', async () => {
    const b = await k.buyer('Pay Advance Co');
    const adv = ok(await pay(b, b.sup.intra, '10000'));
    expect(adv.unallocated).toBe('10000.0000');
    expect(await position(b, b.sup.intra)).toMatchObject({ totalOutstanding: '0.0000', totalUnapplied: '10000.0000', balance: '-10000.0000', unapplied: [expect.objectContaining({ kind: 'payment', amount: '10000.0000' })] });
    const bill = await k.billed(b, b.sup.intra);
    const a = ok(await allocate(b, { type: 'payment', id: adv.id }, [{ billId: bill.id, amount: '5900' }]));
    expect(a.items).toHaveLength(1);
    expect(await position(b, b.sup.intra)).toMatchObject({ totalOutstanding: '0.0000', totalUnapplied: '4100.0000', balance: '-4100.0000' });
    expect((await call(server, 'GET', `/v1/payables/payments/${adv.id}`, { tenant: b.tenant })).json.unallocated).toBe('4100.0000');
    expect((await recon(b)).reconciled).toBe(true);
    // un-allocating gives the money back
    ok(await call(server, 'POST', `/v1/payables/allocations/${a.items[0].id}/reverse`, { tenant: b.tenant, body: { on: '2025-04-22', reason: 'Wrong bill' } }), 200);
    expect(await position(b, b.sup.intra)).toMatchObject({ totalOutstanding: '5900.0000', totalUnapplied: '10000.0000' });
    expect((await call(server, 'POST', `/v1/payables/allocations/${a.items[0].id}/reverse`, { tenant: b.tenant, body: { on: '2025-04-23', reason: 'again' } })).json.code).toBe('already_reversed');
    // as of before the reversal the bill was still settled
    expect(await position(b, b.sup.intra, '2025-04-21')).toMatchObject({ totalOutstanding: '0.0000', totalUnapplied: '4100.0000' });
  });

  it('refuses allocations that do not add up, leaving nothing behind', async () => {
    const b = await k.buyer('Pay Bad Co');
    const bill = await k.billed(b, b.sup.intra);
    const other = await k.billed(b, b.sup.inter);
    expect((await pay(b, b.sup.intra, '1000', { allocations: [{ billId: bill.id, amount: '2000' }] })).json.code).toBe('exceeds_available');
    expect((await pay(b, b.sup.intra, '9000', { allocations: [{ billId: bill.id, amount: '6000' }] })).json.code).toBe('exceeds_outstanding');
    expect((await pay(b, b.sup.intra, '1000', { allocations: [{ billId: other.id, amount: '1000' }] })).status).toBe(422); // another supplier's bill
    expect((await pay(b, b.sup.intra, '1000', { allocations: [{ billId: bill.id, amount: '1000' }], paymentDate: '2025-04-10' })).status).toBe(422); // before the bill
    expect((await pay(b, b.cust.local, '10')).json.code).toBe('not_a_supplier');
    expect((await pay(b, b.sup.intra, '10', { paidFromAccountId: b.acc['2110'] })).status).toBe(422); // payables control is not a bank
    expect((await pay(b, b.sup.intra, '10', { paidFromAccountId: b.acc['4100'] })).status).toBe(422);
    expect((await pay(b, b.sup.intra, '0')).status).toBe(422);
    expect((await pay(b, b.sup.intra, '10', { paymentDate: '2027-01-01' })).json.code).toBe('no_accounting_period');
    expect(await k.net(b, '1120')).toBe(0);
    expect((await call(server, 'GET', `/v1/payables/payments?companyId=${b.companyId}`, { tenant: b.tenant })).json.items).toHaveLength(0);
    expect(ok(await pay(b, b.sup.intra, '100')).paymentNo).toBe('PAY/2526/000001'); // failures burnt no numbers
    // a bill cannot be allocated to as if it were a payment, nor a bill used as a debit note
    expect((await allocate(b, { type: 'debit_note', id: bill.id }, [{ billId: bill.id, amount: '1' }])).json.code).toBe('not_a_debit_note');
  });

  it('lets only as many simultaneous allocations through as the payment can cover', async () => {
    const b = await k.buyer('Pay Race Co');
    const bills = [await k.billed(b, b.sup.intra), await k.billed(b, b.sup.intra), await k.billed(b, b.sup.intra), await k.billed(b, b.sup.intra), await k.billed(b, b.sup.intra)];
    const adv = ok(await pay(b, b.sup.intra, '5000'));
    const results = await Promise.all(bills.map((bl) => allocate(b, { type: 'payment', id: adv.id }, [{ billId: bl.id, amount: '2000' }])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409).map((r) => r.json.code)).toEqual(['exceeds_available', 'exceeds_available', 'exceeds_available']);
    expect((await call(server, 'GET', `/v1/payables/payments/${adv.id}`, { tenant: b.tenant })).json.unallocated).toBe('1000.0000');
  });
});

describe('cancelling', () => {
  it('cancels a bounced payment: journal reversed, settled bills reopened', async () => {
    const b = await k.buyer('Pay Cancel Co');
    const bill = await k.billed(b, b.sup.intra);
    const p = ok(await pay(b, b.sup.intra, '5900', { allocations: [{ billId: bill.id, amount: '5900' }] }));
    expect(await position(b, b.sup.intra)).toMatchObject({ totalOutstanding: '0.0000' });
    const c = ok(await call(server, 'POST', `/v1/payables/payments/${p.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-25', reason: 'Cheque bounced' } }), 200);
    expect(c.payment).toBeUndefined();
    expect(c).toMatchObject({ status: 'cancelled', cancelReason: 'Cheque bounced', unallocated: '0.0000' });
    expect(await k.net(b, '1120')).toBe(0);
    expect(await k.net(b, '2110')).toBe(-5900);
    expect(await position(b, b.sup.intra)).toMatchObject({ totalOutstanding: '5900.0000', balance: '5900.0000' });
    expect(await position(b, b.sup.intra, '2025-04-24')).toMatchObject({ totalOutstanding: '0.0000' }); // as it stood before the cancellation
    expect((await recon(b)).reconciled).toBe(true);
    expect((await recon(b, '2025-04-24')).reconciled).toBe(true);
    expect((await call(server, 'POST', `/v1/payables/payments/${p.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-26', reason: 'again' } })).json.code).toBe('already_cancelled');
    expect((await allocate(b, { type: 'payment', id: p.id }, [{ billId: bill.id, amount: '1' }])).json.code).toBe('payment_cancelled');
  });

  it('will not cancel a bill that has money allocated, until it is released', async () => {
    const b = await k.buyer('Bill Settled Co');
    const bill = await k.billed(b, b.sup.intra);
    const p = ok(await pay(b, b.sup.intra, '1000', { allocations: [{ billId: bill.id, amount: '1000' }] }));
    const cancel = () => call(server, 'POST', `/v1/purchasing/bills/${bill.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-25', reason: 'Wrong invoice' } });
    expect((await cancel()).json.code).toBe('has_settlements');
    ok(await call(server, 'POST', `/v1/payables/allocations/${p.allocations[0].id}/reverse`, { tenant: b.tenant, body: { on: '2025-04-24', reason: 'Releasing' } }), 200);
    ok(await cancel(), 200);
    expect(await position(b, b.sup.intra)).toMatchObject({ totalOutstanding: '0.0000', totalUnapplied: '1000.0000' });
    expect((await recon(b)).reconciled).toBe(true);
  });
});

describe('debit notes and refunds from suppliers', () => {
  it('settles bills with a debit note, and takes back money for what is left', async () => {
    const b = await k.buyer('Debit Co');
    const bill = await k.billed(b, b.sup.intra);
    const bill2 = await k.billed(b, b.sup.intra);
    const note = ok(await debitNote(b, bill, '3')); // 1,770 credit
    expect(await position(b, b.sup.intra)).toMatchObject({ totalOutstanding: '11800.0000', totalUnapplied: '1770.0000', balance: '10030.0000', unapplied: [expect.objectContaining({ kind: 'debit_note', amount: '1770.0000' })] });
    ok(await allocate(b, { type: 'debit_note', id: note.id }, [{ billId: bill2.id, amount: '1000' }]));
    expect(await position(b, b.sup.intra)).toMatchObject({ totalOutstanding: '10800.0000', totalUnapplied: '770.0000' });
    // the supplier refunds the rest of the credit in cash
    const refund = (amount: string, source: { type: string; id: string }, o: object = {}) => call(server, 'POST', '/v1/payables/refunds', { tenant: b.tenant, body: { companyId: b.companyId, source, refundDate: '2025-04-25', amount, method: 'bank_transfer', depositAccountId: b.acc['1120'], ...o } });
    expect((await refund('800', { type: 'debit_note', id: note.id })).json.code).toBe('exceeds_available');
    const r = ok(await refund('770', { type: 'debit_note', id: note.id }));
    expect(r).toMatchObject({ refundNo: 'SRF/2526/000001', amount: '770.0000', debitNoteId: note.id });
    expect(await k.net(b, '1120')).toBe(770);
    expect(await position(b, b.sup.intra)).toMatchObject({ totalOutstanding: '10800.0000', totalUnapplied: '0.0000' });
    expect((await recon(b)).reconciled).toBe(true);
    // an advance can be taken back too, but not a cancelled payment
    const adv = ok(await pay(b, b.sup.intra, '500'));
    ok(await refund('500', { type: 'payment', id: adv.id }));
    expect((await refund('1', { type: 'payment', id: adv.id })).json.code).toBe('exceeds_available');
    expect((await call(server, 'POST', `/v1/payables/payments/${adv.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-26', reason: 'x' } })).json.code).toBe('has_refunds');
    expect((await refund('1', { type: 'payment', id: bill.id })).status).toBe(404); // not a payment
    expect((await recon(b)).reconciled).toBe(true);
  });
});

describe('ageing, statement and reconciliation', () => {
  it('ages open bills by days past due and shows advances separately', async () => {
    const b = await k.buyer('Ageing Co');
    await k.billed(b, b.sup.intra, { billDate: '2025-04-15' });
    await k.billed(b, b.sup.intra, { billDate: '2025-05-20' });
    await k.billed(b, b.sup.inter, { billDate: '2025-06-25' });
    ok(await pay(b, b.sup.inter, '1000', { paymentDate: '2025-06-26' }));
    const a = (await call(server, 'GET', `/v1/payables/ageing?companyId=${b.companyId}&asOf=2025-06-30`, { tenant: b.tenant })).json;
    const intra = a.suppliers.find((s: { supplierId: string }) => s.supplierId === b.sup.intra);
    expect(intra).toMatchObject({ days61to90: '5900.0000', days31to60: '5900.0000', current: '0.0000', total: '11800.0000' }); // 76 and 41 days past due
    const inter = a.suppliers.find((s: { supplierId: string }) => s.supplierId === b.sup.inter);
    expect(inter).toMatchObject({ days1to30: '5900.0000', unapplied: '1000.0000' }); // due the day it was billed: 5 days late
    expect(a.totals).toMatchObject({ total: '17700.0000', unapplied: '1000.0000' });
    expect((await call(server, 'GET', `/v1/payables/ageing?companyId=${b.companyId}&asOf=2025-04-15`, { tenant: b.tenant })).json.totals).toMatchObject({ current: '5900.0000', total: '5900.0000' });
  });

  it('prints a statement with opening balance, running balance, payments and cancellations', async () => {
    const b = await k.buyer('Statement Co');
    const bill1 = await k.billed(b, b.sup.intra, { billDate: '2025-04-15' }); // 5,900
    const p = ok(await pay(b, b.sup.intra, '2000', { paymentDate: '2025-05-02', allocations: [{ billId: bill1.id, amount: '2000' }] }));
    const bill2 = await k.billed(b, b.sup.intra, { billDate: '2025-05-10' }); // 5,900
    ok(await call(server, 'POST', `/v1/purchasing/bills/${bill2.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-05-12', reason: 'Duplicate' } }), 200);
    void p;
    const st = (await call(server, 'GET', `/v1/payables/suppliers/${b.sup.intra}/statement?companyId=${b.companyId}&from=2025-05-01&to=2025-05-31`, { tenant: b.tenant })).json;
    expect(st.openingBalance).toBe('5900.0000');
    expect(st.lines.map((l: { kind: string; balance: string }) => [l.kind, l.balance])).toEqual([['payment', '3900.0000'], ['bill', '9800.0000'], ['cancellation', '3900.0000']]);
    expect(st.closingBalance).toBe('3900.0000');
    expect((await call(server, 'GET', `/v1/payables/suppliers/${b.sup.intra}/statement?companyId=${b.companyId}&from=2025-05-31&to=2025-05-01`, { tenant: b.tenant })).status).toBe(422);
  });

  it('reconciles with the ledger supplier by supplier at any date', async () => {
    const b = await k.buyer('Recon Co');
    const bill = await k.billed(b, b.sup.intra, { billDate: '2025-04-15' });
    await k.billed(b, b.sup.inter, { billDate: '2025-05-15' });
    ok(await pay(b, b.sup.intra, '3000', { paymentDate: '2025-05-20', allocations: [{ billId: bill.id, amount: '3000' }] }));
    ok(await debitNote(b, bill, '2', { noteDate: '2025-06-01' }));
    for (const d of ['2025-04-30', '2025-05-31', '2025-06-30', '2026-03-31']) expect((await recon(b, d)).reconciled, d).toBe(true);
    const r = await recon(b, '2025-05-31');
    expect(r.documentsTotal).toBe('8800.0000'); // 5,900 + 5,900 - 3,000
    expect(r.rows).toHaveLength(2);
  });
});

describe('guards and access', () => {
  it('enforces the limits and immutability in the database itself', async () => {
    const b = await k.buyer('Pay Guard Co');
    const bill = await k.billed(b, b.sup.intra);
    const p = ok(await pay(b, b.sup.intra, '1000', { allocations: [{ billId: bill.id, amount: '400' }] }));
    const bad = (sql: string, params: unknown[] = []) => expect(supers.query(sql, params)).rejects.toMatchObject({ code: '55000' });
    await bad('UPDATE erp.supplier_payments SET amount = 5 WHERE id = $1', [p.id]);
    await bad('DELETE FROM erp.supplier_payments WHERE id = $1', [p.id]);
    await bad('UPDATE erp.payable_allocations SET amount = 1 WHERE id = $1', [p.allocations[0].id]);
    await bad('DELETE FROM erp.payable_allocations WHERE id = $1', [p.allocations[0].id]);
    const client = await supers.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO erp.payable_allocations (tenant_id, id, company_id, supplier_id, bill_id, payment_id, amount, allocated_on) VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, 700, $6)', [b.tenant, b.companyId, b.sup.intra, bill.id, p.id, '2025-04-22']);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' }); // 400 + 700 > 1000 held by the payment
    } finally { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
    const c2 = await supers.connect();
    try {
      await c2.query('BEGIN');
      await c2.query('INSERT INTO erp.payable_allocations (tenant_id, id, company_id, supplier_id, bill_id, payment_id, amount, allocated_on) VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, 600, $6)', [b.tenant, b.companyId, b.sup.intra, bill.id, p.id, '2025-04-22']);
      await c2.query('COMMIT'); // 400 + 600 = 1000: exactly what it holds
    } finally { await c2.query('ROLLBACK').catch(() => undefined); c2.release(); }
    // a source of both kinds, or of neither, is not an allocation
    await expect(supers.query('INSERT INTO erp.payable_allocations (tenant_id, id, company_id, supplier_id, bill_id, amount, allocated_on) VALUES ($1, gen_random_uuid(), $2, $3, $4, 1, $5)', [b.tenant, b.companyId, b.sup.intra, bill.id, '2025-04-22'])).rejects.toMatchObject({ code: '23514' });
  });

  it('separates reading, paying and cancelling, and keeps tenants apart', async () => {
    const b = await k.buyer('Pay Access Co');
    const bill = await k.billed(b, b.sup.intra);
    const p = ok(await pay(b, b.sup.intra, '500', { allocations: [{ billId: bill.id, amount: '500' }] }));
    const reader = await k.key(b, ['payables:read']);
    expect((await call(server, 'GET', `/v1/payables/payments/${p.id}`, { token: reader })).status).toBe(200);
    expect((await call(server, 'GET', `/v1/payables/ageing?companyId=${b.companyId}&asOf=2025-06-30`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/payables/payments', { token: reader, body: {} })).status).toBe(403);
    const payer = await k.key(b, ['payables:post']);
    expect((await call(server, 'POST', `/v1/payables/payments/${p.id}/cancel`, { token: payer, body: { cancelDate: '2025-04-25', reason: 'x' } })).status).toBe(403); // cancelling is its own right
    expect((await call(server, 'GET', `/v1/payables/payments/${p.id}`, { token: payer })).status).toBe(403);
    const other = await k.buyer('Pay Access Other');
    expect((await call(server, 'GET', `/v1/payables/payments/${p.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await allocate(other, { type: 'payment', id: p.id }, [{ billId: bill.id, amount: '1' }])).status).toBe(404);
    expect((await recon(other)).reconciled).toBe(true);
  });
});
