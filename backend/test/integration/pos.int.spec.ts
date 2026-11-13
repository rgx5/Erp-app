import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

interface Counter extends Shop { terminal: string; shift: string }
const put = (s: Shop, path: string, body: object) => call(server, 'PUT', `/v1/pos/${path}?companyId=${s.companyId}`, { tenant: s.tenant, body });
/** A shop with the till configured: walk-in customer, payment accounts, over/short account, a terminal and an open shift with 500 in the drawer. */
async function counter(name: string, openShift = true): Promise<Counter> {
  const s = await kit.shop(name);
  ok(await put(s, 'settings', { walkInCustomerId: s.cust.consumer, cashVarianceAccountId: s.acc['5900'] }), 200);
  for (const [method, code] of [['cash', '1110'], ['card', '1120'], ['upi', '1120']] as const) ok(await put(s, 'payment-accounts', { method, accountId: s.acc[code] }), 200);
  const loc = (await call(server, 'GET', `/v1/business-locations?companyId=${s.companyId}`, { tenant: s.tenant })).json.items[0].id as string;
  const terminal = ok(await call(server, 'POST', '/v1/pos/terminals', { tenant: s.tenant, body: { companyId: s.companyId, code: 'T1', name: 'Till 1', gstRegistrationId: s.regId, businessLocationId: loc, warehouseId: s.wh } })).id as string;
  const shift = openShift ? ok(await call(server, 'POST', '/v1/pos/shifts', { tenant: s.tenant, body: { terminalId: terminal, openingCash: '500', date: '2025-04-10' } })).id as string : '';
  return { ...s, terminal, shift };
}
const sale = (c: Counter, lines: object[], payments: object[], o: object = {}) => call(server, 'POST', '/v1/pos/sales', { tenant: c.tenant, body: { shiftId: c.shift, date: '2025-04-10', lines, payments, ...o } });
const item = (c: Counter, itemId: string, o: object = {}) => ({ itemId, quantity: '1', unitPrice: '118', ...o });
const recon = async (c: Counter, path: string) => (await call(server, 'GET', `/v1/${path}?companyId=${c.companyId}&asOf=2026-03-31`, { tenant: c.tenant })).json;
const summary = async (c: Counter, id = c.shift) => (await call(server, 'GET', `/v1/pos/shifts/${id}`, { tenant: c.tenant })).json;

describe('configuration, terminals and shifts', () => {
  it('validates the till set-up and allows one open shift per terminal', async () => {
    const s = await kit.shop('Pos Cfg Co');
    expect((await put(s, 'settings', { walkInCustomerId: '01a1cf33-1a44-7104-863e-b26a759d6544' })).status).toBe(422);
    expect((await put(s, 'settings', { cashVarianceAccountId: s.acc['1210'] })).status).toBe(422); // a control account
    expect((await put(s, 'payment-accounts', { method: 'cash', accountId: s.acc['4100'] })).status).toBe(422); // income, not cash/bank
    expect((await put(s, 'payment-accounts', { method: 'cash', accountId: s.acc['1130'] })).status).toBe(422); // receivables control
    ok(await put(s, 'payment-accounts', { method: 'cash', accountId: s.acc['1110'] }), 200);
    ok(await put(s, 'payment-accounts', { method: 'cash', accountId: s.acc['1120'] }), 200); // remapping replaces
    expect((await call(server, 'GET', `/v1/pos/settings?companyId=${s.companyId}`, { tenant: s.tenant })).json.paymentAccounts).toEqual([expect.objectContaining({ method: 'cash', accountId: s.acc['1120'] })]);
    const loc = (await call(server, 'GET', `/v1/business-locations?companyId=${s.companyId}`, { tenant: s.tenant })).json.items[0].id as string;
    const term = (code: string, o: object = {}) => call(server, 'POST', '/v1/pos/terminals', { tenant: s.tenant, body: { companyId: s.companyId, code, name: 'T', gstRegistrationId: s.regId, businessLocationId: loc, warehouseId: s.wh, ...o } });
    const t1 = ok(await term('till-1'));
    expect(t1.code).toBe('TILL-1');
    expect((await term('TILL-1')).status).toBe(409);
    const other = await kit.shop('Pos Cfg Other');
    expect((await term('X2', { gstRegistrationId: other.regId })).status).toBe(422);
    const shift = (b: object = {}) => call(server, 'POST', '/v1/pos/shifts', { tenant: s.tenant, body: { terminalId: t1.id, date: '2025-04-10', ...b } });
    const opened = ok(await shift({ openingCash: '250.50' }));
    expect(opened).toMatchObject({ status: 'open', openingCash: '250.5000', shiftNo: 'SHF/2526/000001' });
    expect((await shift()).json.code).toBe('shift_already_open');
    expect((await call(server, 'GET', `/v1/pos/terminals?companyId=${s.companyId}`, { tenant: s.tenant })).json.items).toHaveLength(1);
  });
});

describe('counter sales', () => {
  it('sells tax-inclusive to the walk-in customer, takes cash with change and card, and posts invoice, stock, receipts and ledger together', async () => {
    const c = await counter('Sale Co');
    const r = ok(await sale(c, [item(c, c.item.widget, { quantity: '2' }), item(c, c.item.cheap, { unitPrice: '105' })], [{ method: 'cash', amount: '200', tendered: '500' }, { method: 'card', amount: '141', reference: 'AUTH-77' }]));
    // widget 2 x 118 incl 18% = taxable 200 + 36; cheap 105 incl 5% = taxable 100 + 5; total 341
    expect(r).toMatchObject({ kind: 'sale', changeDue: '300.0000' });
    expect(r.invoice).toMatchObject({ documentType: 'tax_invoice', invoiceNo: 'INV/2526/00001', taxableTotal: '300.0000', cgstTotal: '20.5000', sgstTotal: '20.5000', grandTotal: '341.0000', supplyType: 'b2c', placeOfSupply: '27' });
    expect(r.invoice.lines[0]).toMatchObject({ taxInclusive: true, taxableValue: '200.0000', lineTotal: '236.0000', unitCost: '400.000000' });
    expect(r.payments).toEqual([expect.objectContaining({ method: 'cash', amount: '200.0000', tendered: '500.0000', changeGiven: '300.0000' }), expect.objectContaining({ method: 'card', amount: '141.0000', tendered: '141.0000', changeGiven: '0.0000', reference: 'AUTH-77' })]);
    const t = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${c.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: c.tenant })).json;
    const row = (code: string) => t.rows.find((x: { code: string }) => x.code === code);
    expect(row('1110')).toMatchObject({ closingDebit: '200.0000' }); // the cash account received the net amount, not the 500 tendered
    expect(row('1120')).toMatchObject({ closingDebit: '141.0000' });
    expect(row('1130')).toBeDefined();
    expect(row('1130')).toMatchObject({ closingDebit: '0.0000', closingCredit: '0.0000' }); // fully settled
    expect(t.balanced).toBe(true);
    expect((await recon(c, 'receivables/reconciliation')).reconciled).toBe(true);
    expect((await recon(c, 'inventory/reconciliation')).reconciled).toBe(true);
    const got = (await call(server, 'GET', `/v1/pos/sales/${r.id}`, { tenant: c.tenant })).json;
    expect(got.document.invoiceNo).toBe('INV/2526/00001');
    expect(got.payments).toHaveLength(2);
    const list = (await call(server, 'GET', `/v1/pos/sales?companyId=${c.companyId}&shiftId=${c.shift}`, { tenant: c.tenant })).json;
    expect(list.items).toEqual([expect.objectContaining({ kind: 'sale', documentNo: 'INV/2526/00001', total: '341.0000' })]);
    expect((await call(server, 'GET', `/v1/receivables/customers/${c.cust.consumer}/position?companyId=${c.companyId}&asOf=2026-03-31`, { tenant: c.tenant })).json.balance).toBe('0.0000');
  });
  it('requires the payments to add up exactly, cash only above the amount, and mapped methods; a failed sale leaves nothing', async () => {
    const c = await counter('Sale Rules Co');
    const before = (await supers.query('SELECT (SELECT count(*) FROM erp.sales_invoices WHERE tenant_id = $1)::int AS i, (SELECT count(*) FROM erp.customer_receipts WHERE tenant_id = $1)::int AS r', [c.tenant])).rows[0];
    const short = await sale(c, [item(c, c.item.widget)], [{ method: 'cash', amount: '100' }]);
    expect(short.status).toBe(422);
    expect(short.json).toMatchObject({ code: 'payment_mismatch', total: '118.0000', paid: '100.0000' });
    expect((await sale(c, [item(c, c.item.widget)], [{ method: 'cash', amount: '118', tendered: '100' }])).status).toBe(422);
    expect((await sale(c, [item(c, c.item.widget)], [{ method: 'card', amount: '118', tendered: '200' }])).status).toBe(422);
    expect((await sale(c, [item(c, c.item.widget)], [{ method: 'bank_transfer', amount: '118' }])).json.code).toBe('pos_not_configured');
    expect((await sale(c, [item(c, c.item.widget, { quantity: '500' })], [{ method: 'cash', amount: '59000' }])).json.code).toBe('insufficient_stock');
    expect((await supers.query('SELECT (SELECT count(*) FROM erp.sales_invoices WHERE tenant_id = $1)::int AS i, (SELECT count(*) FROM erp.customer_receipts WHERE tenant_id = $1)::int AS r', [c.tenant])).rows[0]).toEqual(before);
    expect(ok(await sale(c, [item(c, c.item.widget)], [{ method: 'upi', amount: '118' }])).invoice.invoiceNo).toBe('INV/2526/00001'); // no numbers were burnt
    const bare = await kit.shop('Pos Bare Co');
    expect((await call(server, 'POST', '/v1/pos/sales', { tenant: bare.tenant, body: { shiftId: '01a1cf33-1a44-7104-863e-b26a759d6544', lines: [], payments: [] } })).status).toBe(422);
  });
  it('can sell to a named customer, with the rounding on a tax-inclusive total', async () => {
    const c = await counter('Named Co');
    const r = ok(await sale(c, [item(c, c.item.widget, { unitPrice: '99.99' })], [{ method: 'cash', amount: '100' }], { customerId: c.cust.local }));
    expect(r.invoice).toMatchObject({ customerId: c.cust.local, grandTotal: '100.0000' });
    expect(Number(r.invoice.roundOff)).not.toBe(NaN);
    const walkIn = await call(server, 'POST', '/v1/pos/sales', { tenant: c.tenant, body: { shiftId: c.shift, date: '2025-04-10', customerId: '01a1cf33-1a44-7104-863e-b26a759d6544', lines: [item(c, c.item.widget)], payments: [{ method: 'cash', amount: '118' }] } });
    expect(walkIn.status).toBe(404);
  });
  it('is idempotent: a retried sale does not sell twice', async () => {
    const c = await counter('Pos Idem Co');
    const body = { shiftId: c.shift, date: '2025-04-10', lines: [item(c, c.item.widget)], payments: [{ method: 'cash', amount: '118' }] };
    const one = await call(server, 'POST', '/v1/pos/sales', { tenant: c.tenant, headers: { 'idempotency-key': 'pos-1' }, body });
    const two = await call(server, 'POST', '/v1/pos/sales', { tenant: c.tenant, headers: { 'idempotency-key': 'pos-1' }, body });
    expect(two.headers.get('idempotent-replayed')).toBe('true');
    expect(two.json.id).toBe(one.json.id);
    expect((await summary(c)).summary.salesCount).toBe(1);
  });
  it('serialises the till: 15 simultaneous sales of 10 units sell exactly 10 and number consecutively', async () => {
    const c = await counter('Pos Race Co');
    const nos = (await call(server, 'GET', '/v1/units?limit=200', { tenant: c.tenant })).json.items.find((u: { code: string }) => u.code === 'NOS').id as string;
    const scarce = ok(await call(server, 'POST', '/v1/items', { tenant: c.tenant, body: { code: 'SCARCE', name: 'S', itemType: 'finished_good', baseUomId: nos, taxCodeId: c.tax.gst18 } })).id as string;
    ok(await call(server, 'POST', '/v1/stock/movements', { tenant: c.tenant, body: { companyId: c.companyId, movementType: 'opening', postingDate: '2025-04-01', description: 'o', lines: [{ warehouseId: c.wh, itemId: scarce, quantity: '10', unitCost: '5' }] } }));
    const results = await Promise.all(Array.from({ length: 15 }, () => sale(c, [item(c, scarce)], [{ method: 'cash', amount: '118' }])));
    const good = results.filter((r) => r.status === 201);
    expect(good).toHaveLength(10);
    expect(good.map((r) => Number(r.json.invoice.invoiceNo.slice(-5))).sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect((await summary(c)).summary).toMatchObject({ salesCount: 10, expectedCash: '1680.0000' }); // 500 + 10 x 118
  });
});

describe('counter returns', () => {
  it('credits a sale, brings the stock back at its original cost and refunds the money, in the shift', async () => {
    const c = await counter('Return Co');
    const s1 = ok(await sale(c, [item(c, c.item.widget, { quantity: '3' })], [{ method: 'cash', amount: '354' }])); // 3 x 118
    const before = (await call(server, 'GET', `/v1/stock/balances?companyId=${c.companyId}&itemId=${c.item.widget}`, { tenant: c.tenant })).json.items[0];
    const ret = ok(await call(server, 'POST', '/v1/pos/returns', { tenant: c.tenant, body: { shiftId: c.shift, date: '2025-04-11', originalSaleId: s1.id, reason: 'Wrong size', lines: [{ originalLineId: s1.invoice.lines[0].id, quantity: '1' }], refunds: [{ method: 'cash', amount: '118' }] } }));
    expect(ret).toMatchObject({ kind: 'return' });
    expect(ret.creditNote).toMatchObject({ documentType: 'credit_note', invoiceNo: 'CN/2526/00001', originalInvoiceId: s1.invoice.id, taxableTotal: '100.0000', grandTotal: '118.0000' });
    expect(ret.payments).toEqual([expect.objectContaining({ method: 'cash', amount: '118.0000' })]);
    const after = (await call(server, 'GET', `/v1/stock/balances?companyId=${c.companyId}&itemId=${c.item.widget}`, { tenant: c.tenant })).json.items[0];
    expect(Number(after.quantity) - Number(before.quantity)).toBe(1);
    expect(Number(after.value) - Number(before.value)).toBe(400); // back at the original cost
    expect((await summary(c)).summary).toMatchObject({ salesCount: 1, returnsCount: 1, returnsTotal: '118.0000', refundsPaid: { cash: '118.0000' }, expectedCash: '736.0000' }); // 500 + 354 - 118
    expect((await recon(c, 'receivables/reconciliation')).reconciled).toBe(true);
    expect((await recon(c, 'inventory/reconciliation')).reconciled).toBe(true);
    expect((await call(server, 'GET', `/v1/receivables/customers/${c.cust.consumer}/position?companyId=${c.companyId}&asOf=2026-03-31`, { tenant: c.tenant })).json).toMatchObject({ balance: '0.0000', totalUnapplied: '0.0000' });
  });
  it('limits returns to what was sold, needs refunds that match, and refunds by card when asked', async () => {
    const c = await counter('Return Rules Co');
    const s1 = ok(await sale(c, [item(c, c.item.widget, { quantity: '2' })], [{ method: 'card', amount: '236' }]));
    const line = s1.invoice.lines[0].id as string;
    const ret = (qty: string, refunds: object[]) => call(server, 'POST', '/v1/pos/returns', { tenant: c.tenant, body: { shiftId: c.shift, date: '2025-04-11', originalSaleId: s1.id, reason: 'x', lines: [{ originalLineId: line, quantity: qty }], refunds } });
    const mismatch = await ret('1', [{ method: 'card', amount: '100' }]);
    expect(mismatch.status).toBe(422);
    expect(mismatch.json).toMatchObject({ code: 'refund_mismatch', total: '118.0000', refunded: '100.0000' });
    expect((await ret('3', [{ method: 'card', amount: '354' }])).json.code).toBe('credit_exceeds_invoice');
    expect((await ret('1', [{ method: 'bank_transfer', amount: '118' }])).json.code).toBe('pos_not_configured');
    ok(await ret('1', [{ method: 'card', amount: '60' }, { method: 'cash', amount: '58' }])); // a split refund
    expect((await summary(c)).summary).toMatchObject({ refundsPaid: { card: '60.0000', cash: '58.0000' }, expectedCash: '442.0000' }); // 500 - 58
    expect((await call(server, 'POST', '/v1/pos/returns', { tenant: c.tenant, body: { shiftId: c.shift, originalSaleId: s1.invoice.id, reason: 'x', lines: [{ originalLineId: line, quantity: '1' }], refunds: [{ method: 'card', amount: '118' }] } })).status).toBe(404); // an invoice id is not a POS sale
    expect((await recon(c, 'receivables/reconciliation')).reconciled).toBe(true);
    const nothing = (await supers.query('SELECT count(*)::int AS n FROM erp.sales_invoices WHERE tenant_id = $1 AND document_type = $2', [c.tenant, 'credit_note'])).rows[0].n;
    expect(nothing).toBe(1); // every refused return rolled back its credit note
  });
});

describe('cash-up', () => {
  it('compares counted cash with the books, posts the difference to cash over/short, and closes the shift once', async () => {
    const c = await counter('Cashup Co');
    ok(await sale(c, [item(c, c.item.widget, { quantity: '2' })], [{ method: 'cash', amount: '236', tendered: '300' }]));
    ok(await sale(c, [item(c, c.item.widget)], [{ method: 'card', amount: '118' }]));
    expect((await summary(c)).summary).toMatchObject({ salesCount: 2, salesTotal: '354.0000', paymentsReceived: { cash: '236.0000', card: '118.0000' }, expectedCash: '736.0000' });
    const closed = ok(await call(server, 'POST', `/v1/pos/shifts/${c.shift}/close`, { tenant: c.tenant, body: { countedCash: '730', date: '2025-04-10' } }), 200);
    expect(closed).toMatchObject({ status: 'closed', countedCash: '730.0000', expectedCash: '736.0000', variance: '-6.0000' });
    expect(closed.varianceEntryId).toBeTruthy();
    const j = (await supers.query('SELECT a.code, l.debit::text AS dr, l.credit::text AS cr FROM erp.journal_lines l JOIN erp.accounts a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY a.code', [closed.varianceEntryId])).rows;
    expect(j).toEqual([{ code: '1110', dr: '0.0000', cr: '6.0000' }, { code: '5900', dr: '6.0000', cr: '0.0000' }]); // short: expense up, cash down
    expect((await call(server, 'POST', `/v1/pos/shifts/${c.shift}/close`, { tenant: c.tenant, body: { countedCash: '730', date: '2025-04-10' } })).json.code).toBe('shift_closed');
    expect((await sale(c, [item(c, c.item.widget)], [{ method: 'cash', amount: '118' }])).json.code).toBe('shift_closed');
    const next = ok(await call(server, 'POST', '/v1/pos/shifts', { tenant: c.tenant, body: { terminalId: c.terminal, openingCash: '730', date: '2025-04-11' } })); // a new shift can open
    expect(next.shiftNo).toBe('SHF/2526/000002');
    await expect(supers.query("UPDATE erp.pos_shifts SET opening_cash = 0 WHERE id = $1", [c.shift])).rejects.toMatchObject({ code: '55000' });
    expect((await call(server, 'GET', `/v1/pos/shifts?companyId=${c.companyId}&status=closed`, { tenant: c.tenant })).json.items).toHaveLength(1);
  });
  it('posts an overage the other way, and needs no entry when the drawer is exact', async () => {
    const c = await counter('Overage Co');
    ok(await sale(c, [item(c, c.item.widget)], [{ method: 'cash', amount: '118' }]));
    const exact = await counter('Exact Co');
    ok(await sale(exact, [item(exact, exact.item.widget)], [{ method: 'cash', amount: '118' }]));
    const done = ok(await call(server, 'POST', `/v1/pos/shifts/${exact.shift}/close`, { tenant: exact.tenant, body: { countedCash: '618', date: '2025-04-10' } }), 200);
    expect(done).toMatchObject({ variance: '0.0000', varianceEntryId: null });
    const over = ok(await call(server, 'POST', `/v1/pos/shifts/${c.shift}/close`, { tenant: c.tenant, body: { countedCash: '620.5', date: '2025-04-10' } }), 200);
    expect(over.variance).toBe('2.5000');
    const j = (await supers.query('SELECT a.code, l.debit::text AS dr, l.credit::text AS cr FROM erp.journal_lines l JOIN erp.accounts a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY a.code', [over.varianceEntryId])).rows;
    expect(j).toEqual([{ code: '1110', dr: '2.5000', cr: '0.0000' }, { code: '5900', dr: '0.0000', cr: '2.5000' }]);
  });
  it('refuses to close with a difference when over/short is not configured, leaving the shift open', async () => {
    const s = await kit.shop('Cashup Cfg Co');
    ok(await put(s, 'settings', { walkInCustomerId: s.cust.consumer }), 200);
    ok(await put(s, 'payment-accounts', { method: 'cash', accountId: s.acc['1110'] }), 200);
    const loc = (await call(server, 'GET', `/v1/business-locations?companyId=${s.companyId}`, { tenant: s.tenant })).json.items[0].id as string;
    const terminal = ok(await call(server, 'POST', '/v1/pos/terminals', { tenant: s.tenant, body: { companyId: s.companyId, code: 'T9', name: 'T', gstRegistrationId: s.regId, businessLocationId: loc, warehouseId: s.wh } })).id as string;
    const shift = ok(await call(server, 'POST', '/v1/pos/shifts', { tenant: s.tenant, body: { terminalId: terminal, openingCash: '100', date: '2025-04-10' } })).id as string;
    const res = await call(server, 'POST', `/v1/pos/shifts/${shift}/close`, { tenant: s.tenant, body: { countedCash: '90', date: '2025-04-10' } });
    expect(res.json.code).toBe('pos_not_configured');
    expect((await call(server, 'GET', `/v1/pos/shifts/${shift}`, { tenant: s.tenant })).json.status).toBe('open');
  });
});

describe('refunds of credit balances (receivables)', () => {
  it('pays back an advance or an unapplied credit note, never more than is held, and reconciles', async () => {
    const c = await counter('Refund Co');
    const adv = ok(await call(server, 'POST', '/v1/receivables/receipts', { tenant: c.tenant, body: { companyId: c.companyId, customerId: c.cust.local, receiptDate: '2025-04-10', amount: '1000', method: 'bank_transfer', depositAccountId: c.acc['1120'] } }));
    const refund = (amount: string, o: object = {}) => call(server, 'POST', '/v1/receivables/refunds', { tenant: c.tenant, body: { companyId: c.companyId, source: { type: 'receipt', id: adv.id }, refundDate: '2025-04-12', amount, method: 'bank_transfer', paidFromAccountId: c.acc['1120'], ...o } });
    expect((await refund('1000.01')).json.code).toBe('exceeds_available');
    expect((await refund('100', { refundDate: '2025-04-05' })).status).toBe(422);
    expect((await refund('100', { paidFromAccountId: c.acc['1130'] })).status).toBe(422);
    const r = ok(await refund('400'));
    expect(r).toMatchObject({ refundNo: 'RFD/2526/000001', amount: '400.0000', customerId: c.cust.local });
    expect((await call(server, 'GET', `/v1/receivables/receipts/${adv.id}`, { tenant: c.tenant })).json.unallocated).toBe('600.0000');
    expect((await call(server, 'GET', `/v1/receivables/customers/${c.cust.local}/position?companyId=${c.companyId}&asOf=2026-03-31`, { tenant: c.tenant })).json).toMatchObject({ totalUnapplied: '600.0000', balance: '-600.0000' });
    expect((await call(server, 'POST', `/v1/receivables/receipts/${adv.id}/cancel`, { tenant: c.tenant, body: { cancelDate: '2025-04-20', reason: 'x' } })).json.code).toBe('has_refunds');
    const st = (await call(server, 'GET', `/v1/receivables/customers/${c.cust.local}/statement?companyId=${c.companyId}&from=2025-04-01&to=2025-04-30`, { tenant: c.tenant })).json;
    expect(st.lines.map((l: { kind: string; balance: string }) => [l.kind, l.balance])).toEqual([['receipt', '-1000.0000'], ['refund', '-600.0000']]);
    for (const asOf of ['2025-04-10', '2025-04-12', '2026-03-31']) expect((await recon(c, 'receivables/reconciliation')).reconciled, asOf).toBe(true);
    await expect(supers.query('DELETE FROM erp.customer_refunds WHERE id = $1', [r.id])).rejects.toMatchObject({ code: '55000' });
    const client = await supers.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO erp.customer_refunds (tenant_id, id, company_id, refund_no, customer_id, refund_date, amount, method, paid_from_account_id, receipt_id, journal_entry_id) VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, 700, $6, $7, $8, $9)', [c.tenant, c.companyId, 'RAW/1', c.cust.local, '2025-04-13', 'cash', c.acc['1110'], adv.id, r.journalEntryId ?? (await supers.query('SELECT journal_entry_id FROM erp.customer_refunds WHERE id = $1', [r.id])).rows[0].journal_entry_id]);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' }); // 400 + 700 > 1000
    } finally { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
  });
});

describe('access and isolation', () => {
  it('separates selling, returning and configuring, and keeps tenants apart', async () => {
    const c = await counter('Pos Access Co');
    const s1 = ok(await sale(c, [item(c, c.item.widget)], [{ method: 'cash', amount: '118' }]));
    const key = async (permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: c.tenant, body: { name: 'k', permissions } })).json.key as string;
    const reader = await key(['pos:read']);
    expect((await call(server, 'GET', `/v1/pos/sales/${s1.id}`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/pos/sales', { token: reader, body: {} })).status).toBe(403);
    const cashier = await key(['pos:sell']);
    expect((await call(server, 'POST', '/v1/pos/returns', { token: cashier, body: {} })).status).toBe(403); // returns need their own right
    expect((await call(server, 'PUT', `/v1/pos/settings?companyId=${c.companyId}`, { token: cashier, body: { walkInCustomerId: null } })).status).toBe(403);
    const other = await counter('Pos Access Other', false);
    expect((await call(server, 'GET', `/v1/pos/sales/${s1.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/pos/shifts/${c.shift}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'POST', '/v1/pos/sales', { tenant: other.tenant, body: { shiftId: c.shift, lines: [item(other, other.item.widget)], payments: [{ method: 'cash', amount: '118' }] } })).status).toBe(404);
    await expect(supers.query('DELETE FROM erp.pos_payments WHERE pos_sale_id = $1', [s1.id])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query("UPDATE erp.pos_sales SET kind = 'return' WHERE id = $1", [s1.id])).rejects.toMatchObject({ code: '55000' });
  });
});
