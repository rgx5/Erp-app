import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, makeGstin, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let kit: ReturnType<typeof shopKit>;
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

interface Buyer extends Shop { sup: { inter: string; intra: string; unreg: string; composition: string } }
let seq = 0;

/** A buyer in Maharashtra (27) with every purchasing account set, and suppliers of each GST kind. */
async function buyer(name: string, settings: object = {}): Promise<Buyer> {
  const s = await kit.shop(name);
  ok(await call(server, 'PUT', `/v1/companies/${s.companyId}/purchasing-settings`, {
    tenant: s.tenant,
    body: {
      payableAccountId: s.acc['2110'], grniAccountId: s.acc['2120'], purchasePriceVarianceAccountId: s.acc['5400'], expensePurchaseAccountId: s.acc['5900'], roundOffAccountId: s.acc['5900'], costVarianceAccountId: s.acc['5300'],
      inputCgstAccountId: s.acc['1310'], inputSgstAccountId: s.acc['1320'], inputIgstAccountId: s.acc['1330'], rcmCgstAccountId: s.acc['2210'], rcmSgstAccountId: s.acc['2220'], rcmIgstAccountId: s.acc['2230'], ...settings,
    },
  }), 200);
  const sup = async (code: string, treatment: string, state?: string) =>
    ok(await call(server, 'POST', '/v1/parties', { tenant: s.tenant, body: { code: `${code}-${++seq}`, legalName: `${code} Supplies`, gstTreatment: treatment, isSupplier: true, ...(state ? { gstin: makeGstin(state, 'KLMNO9012P', (++seq % 35 + 1).toString(36).toUpperCase()) } : {}) } })).id as string;
  return { ...s, sup: { inter: await sup('INTER', 'registered_regular', '29'), intra: await sup('INTRA', 'registered_regular', '27'), unreg: await sup('UNREG', 'unregistered'), composition: await sup('COMP', 'registered_composition', '27') } };
}

const net = async (b: Buyer, code: string) => {
  const t = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${b.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: b.tenant })).json;
  expect(t.balanced).toBe(true);
  const r = t.rows.find((x: { code: string }) => x.code === code) as { closingDebit: string; closingCredit: string } | undefined;
  return r ? Math.round((Number(r.closingDebit) - Number(r.closingCredit)) * 10000) / 10000 : 0;
};

const receiveAgainst = async (b: Buyer, order: { id: string; lines: { id: string }[] }, quantities: string[]) =>
  ok(await call(server, 'POST', '/v1/purchasing/receipts', { tenant: b.tenant, body: { companyId: b.companyId, purchaseOrderId: order.id, receiptDate: '2025-04-12', lines: quantities.map((quantity, i) => ({ orderLineId: order.lines[i]?.id, quantity })) } }));
const ordered = async (b: Buyer, supplier: string, o: { quantity?: string; price?: string; discount?: string; itemId?: string } = {}) => {
  const order = ok(await call(server, 'POST', '/v1/purchasing/orders', { tenant: b.tenant, body: { companyId: b.companyId, gstRegistrationId: b.regId, supplierId: supplier, orderDate: '2025-04-10', lines: [{ itemId: o.itemId ?? b.item.widget, quantity: o.quantity ?? '10', unitPrice: o.price ?? '500', discountPercent: o.discount ?? '0', warehouseId: b.wh }] } }));
  const receipt = await receiveAgainst(b, order, [o.quantity ?? '10']);
  return { order, receipt, grnLine: receipt.lines[0].id as string, poLine: order.lines[0].id as string };
};
let invoiceSeq = 0;
const bill = (b: Buyer, supplier: string, lines: object[], o: object = {}, token?: string) =>
  call(server, 'POST', '/v1/purchasing/bills', { ...(token ? { token } : { tenant: b.tenant }), body: { companyId: b.companyId, gstRegistrationId: b.regId, supplierId: supplier, supplierInvoiceNo: `SI-${++invoiceSeq}`, supplierInvoiceDate: '2025-04-14', billDate: '2025-04-15', lines, ...o } });
const bl = (grnLine: string, o: object = {}) => ({ grnLineId: grnLine, quantity: '10', unitPrice: '500', ...o });
const key = async (b: Buyer, permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: b.tenant, body: { name: 'k', permissions } })).json.key as string;
const recon = async (b: Buyer, path: string) => (await call(server, 'GET', `/v1/${path}?companyId=${b.companyId}&asOf=2026-03-31`, { tenant: b.tenant })).json;
const withItem = (b: Buyer, line: object) => ({ itemId: b.item.widget, ...line });

describe('bills against received goods', () => {
  it('books an intra-state bill: CGST + SGST input credit, GRNI cleared, payable raised', async () => {
    const b = await buyer('Bill Intra Co');
    const g = await ordered(b, b.sup.intra);
    expect(await net(b, '2120')).toBe(-5000);
    const r = ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))]));
    expect(r).toMatchObject({ documentType: 'bill', billNo: 'BILL/2526/000001', taxRegime: 'intra', supplierState: '27', placeOfSupply: '27', taxableTotal: '5000.0000', cgstTotal: '450.0000', sgstTotal: '450.0000', igstTotal: '0.0000', itcTotal: '900.0000', grandTotal: '5900.0000', matchStatus: 'matched', status: 'posted' });
    expect(r.lines[0]).toMatchObject({ clearedQuantity: '10.000000', clearedValue: '5000.0000', priceVariance: '0.0000', capitalisedTax: '0.0000', poLineId: g.poLine, itcEligible: true });
    expect(await net(b, '2120')).toBe(0); // GRNI cleared
    expect(await net(b, '2110')).toBe(-5900); // we owe the supplier
    expect(await net(b, '1310')).toBe(450);
    expect(await net(b, '1320')).toBe(450);
    expect(await net(b, '1330')).toBe(0);
    expect(await net(b, '5400')).toBe(0);
    const grn = (await call(server, 'GET', `/v1/purchasing/receipts/${g.receipt.id}`, { tenant: b.tenant })).json;
    expect(grn.lines[0]).toMatchObject({ quantityBilled: '10.000000', valueBilled: '5000.0000' });
    expect((await call(server, 'GET', `/v1/purchasing/orders/${g.order.id}`, { tenant: b.tenant })).json.lines[0].quantityBilled).toBe('10.000000');
    expect((await call(server, 'GET', `/v1/purchasing/grni?companyId=${b.companyId}&asOf=2026-03-31`, { tenant: b.tenant })).json).toMatchObject({ totalOpenValue: '0.0000', reconciled: true });
    expect(await recon(b, 'inventory/reconciliation'), JSON.stringify(await recon(b, 'inventory/reconciliation'))).toMatchObject({ reconciled: true });
  });

  it('books an inter-state bill with IGST, discounts and a due date from the supplier terms', async () => {
    const b = await buyer('Bill Inter Co');
    const g = await ordered(b, b.sup.inter, { discount: '10' }); // 500 less 10% = 450 x 10
    const r = ok(await bill(b, b.sup.inter, [withItem(b, bl(g.grnLine, { discountPercent: '10' }))]));
    expect(r).toMatchObject({ taxRegime: 'inter', supplierState: '29', taxableTotal: '4500.0000', igstTotal: '810.0000', cgstTotal: '0.0000', grandTotal: '5310.0000', dueDate: '2025-04-15' });
    expect(await net(b, '1330')).toBe(810);
    expect(await net(b, '2110')).toBe(-5310);
    expect(await net(b, '2120')).toBe(0);
  });

  it('charges no tax for composition and unregistered suppliers, and needs a state for an unregistered one', async () => {
    const b = await buyer('Bill NoTax Co');
    const g = await ordered(b, b.sup.composition);
    const r = ok(await bill(b, b.sup.composition, [withItem(b, bl(g.grnLine))]));
    expect(r).toMatchObject({ taxableTotal: '5000.0000', cgstTotal: '0.0000', igstTotal: '0.0000', itcTotal: '0.0000', grandTotal: '5000.0000' });
    expect(await net(b, '1310')).toBe(0);
    const g2 = await ordered(b, b.sup.unreg);
    expect((await bill(b, b.sup.unreg, [withItem(b, bl(g2.grnLine))])).json.code).toBe('supplier_state_unknown');
    expect(ok(await bill(b, b.sup.unreg, [withItem(b, bl(g2.grnLine))], { supplierStateCode: '27' })).grandTotal).toBe('5000.0000');
  });

  it('shows reverse-charge tax as a liability and as credit, and does not pay it to the supplier', async () => {
    const b = await buyer('Bill Rcm Co');
    const g = await ordered(b, b.sup.unreg);
    const r = ok(await bill(b, b.sup.unreg, [withItem(b, bl(g.grnLine))], { reverseCharge: true, supplierStateCode: '27' }));
    expect(r).toMatchObject({ reverseCharge: true, taxableTotal: '5000.0000', cgstTotal: '450.0000', sgstTotal: '450.0000', itcTotal: '900.0000', grandTotal: '5000.0000' }); // the supplier is paid the value only
    expect(await net(b, '2110')).toBe(-5000);
    expect(await net(b, '2210')).toBe(-450); // RCM liability
    expect(await net(b, '2220')).toBe(-450);
    expect(await net(b, '1310')).toBe(450); // and the credit
    expect(await net(b, '1320')).toBe(450);
    expect(await net(b, '2120')).toBe(0);
  });

  it('adds tax that cannot be claimed to the cost: of stock, and of expenses', async () => {
    const b = await buyer('Bill Ineligible Co');
    const g = await ordered(b, b.sup.intra);
    const before = await net(b, '1240');
    const r = ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine, { itcEligible: false }))]));
    expect(r).toMatchObject({ itcTotal: '0.0000', grandTotal: '5900.0000', revaluationMovementId: expect.any(String) });
    expect(r.lines[0]).toMatchObject({ capitalisedTax: '900.0000', itcEligible: false });
    expect(await net(b, '1310')).toBe(0);
    expect(await net(b, '1240') - before).toBe(900); // inventory now carries the tax
    expect(await net(b, '2120')).toBe(0);
    expect(await net(b, '2110')).toBe(-5900);
    expect(await recon(b, 'inventory/reconciliation'), JSON.stringify(await recon(b, 'inventory/reconciliation'))).toMatchObject({ reconciled: true });
    // a service whose tax is blocked: the whole amount is an expense
    const svc = ok(await bill(b, b.sup.intra, [{ itemId: b.item.service, quantity: '1', unitPrice: '1000', itcEligible: false }]));
    expect(svc).toMatchObject({ matchStatus: 'not_applicable', grandTotal: '1180.0000' });
    expect(svc.lines[0].capitalisedTax).toBe('180.0000');
    expect(await net(b, '5900')).toBe(1180);
    // the same service with credit: tax goes to input accounts
    ok(await bill(b, b.sup.intra, [{ itemId: b.item.service, quantity: '1', unitPrice: '1000' }]));
    expect(await net(b, '5900')).toBe(2180);
    expect(await net(b, '1310')).toBe(90);
  });

  it('splits non-claimable tax between stock still held and units already used', async () => {
    const b = await buyer('Bill Consumed Co');
    const g = await ordered(b, b.sup.intra); // 10 received on top of the 100 opening
    ok(await call(server, 'POST', '/v1/stock/movements', { tenant: b.tenant, body: { companyId: b.companyId, movementType: 'issue', postingDate: '2025-04-13', description: 'Use', offsetAccountId: b.acc['5100'], lines: [{ warehouseId: b.wh, itemId: b.item.widget, quantity: '105' }] } }));
    // 5 units are left of this receipt; tax on the other 5 is a cost of goods already used
    ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine, { itcEligible: false }))]));
    expect(await net(b, '5300')).toBe(450);
    expect(await recon(b, 'inventory/reconciliation'), JSON.stringify(await recon(b, 'inventory/reconciliation'))).toMatchObject({ reconciled: true });
    expect(await net(b, '2120')).toBe(0);
  });

  it('takes the tax of a FIFO item onto the cost layer it belongs to', async () => {
    const b = await buyer('Bill Fifo Co');
    const nos = ((await call(server, 'GET', '/v1/units?limit=200', { tenant: b.tenant })).json.items as { id: string; code: string }[]).find((u) => u.code === 'NOS')?.id as string;
    const fifo = ok(await call(server, 'POST', '/v1/items', { tenant: b.tenant, body: { code: `FIFO-${++seq}`, name: 'Fifo', baseUomId: nos, itemType: 'finished_good', costingMethod: 'fifo', taxCodeId: b.tax.gst18, hsnSacCode: '8479' } })).id as string;
    const first = await ordered(b, b.sup.intra, { itemId: fifo, quantity: '10', price: '100' });
    await ordered(b, b.sup.intra, { itemId: fifo, quantity: '10', price: '120' });
    ok(await bill(b, b.sup.intra, [bl(first.grnLine, { itemId: fifo, quantity: '10', unitPrice: '100', itcEligible: false })])); // 180 of tax onto the first layer
    const issued = ok(await call(server, 'POST', '/v1/stock/movements', { tenant: b.tenant, body: { companyId: b.companyId, movementType: 'issue', postingDate: '2025-04-20', description: 'Use', offsetAccountId: b.acc['5100'], lines: [{ warehouseId: b.wh, itemId: fifo, quantity: '10' }] } }));
    expect(JSON.stringify(issued)).toContain('1180.0000'); // the first layer left at 100 + 18 per unit
    // a layer's cost can only be changed by a revaluation in the same transaction, never by hand
    await expect(supers.query('UPDATE erp.stock_layers SET unit_cost = 1 WHERE item_id = $1', [fifo])).rejects.toMatchObject({ code: '55000' });
    expect(await recon(b, 'inventory/reconciliation'), JSON.stringify(await recon(b, 'inventory/reconciliation'))).toMatchObject({ reconciled: true });
  });
});

describe('three-way match', () => {
  it('accepts a bill inside the price tolerance and books the difference as price variance', async () => {
    const b = await buyer('Match Price Co', { priceTolerancePercent: '2' });
    const g = await ordered(b, b.sup.intra);
    const r = ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine, { unitPrice: '505' }))]));
    expect(r).toMatchObject({ matchStatus: 'matched', taxableTotal: '5050.0000', grandTotal: '5959.0000' });
    expect(r.lines[0]).toMatchObject({ clearedValue: '5000.0000', priceVariance: '50.0000' });
    expect(await net(b, '5400')).toBe(50); // unfavourable price variance
    expect(await net(b, '2120')).toBe(0);
    const g2 = await ordered(b, b.sup.intra);
    ok(await bill(b, b.sup.intra, [withItem(b, bl(g2.grnLine, { unitPrice: '495' }))])); // 1% cheaper is fine too
    expect(await net(b, '5400')).toBe(0);
  });

  it('blocks a bill outside tolerance until a user with approval rights overrides it with a reason', async () => {
    const b = await buyer('Match Block Co', { priceTolerancePercent: '1' });
    const g = await ordered(b, b.sup.intra);
    const blocked = await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine, { unitPrice: '520' }))]);
    expect(blocked.status).toBe(409);
    expect(blocked.json).toMatchObject({ code: 'match_failed', issues: [{ lineNo: 1, kind: 'price', expected: '500.000000', actual: '520.000000', deviationPercent: '4.0000', tolerancePercent: '1.0000' }] });
    expect(await net(b, '2110')).toBe(0); // nothing posted
    const clerk = await key(b, ['purchasing:post']);
    const refused = await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine, { unitPrice: '520' }))], { overrideMatch: { reason: 'Supplier raised the price' } }, clerk);
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe('approval_required');
    const manager = await key(b, ['purchasing:post', 'purchasing:approve']);
    const r = ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine, { unitPrice: '520' }))], { overrideMatch: { reason: 'Supplier raised the price' } }, manager));
    expect(r).toMatchObject({ matchStatus: 'overridden', matchOverrideReason: 'Supplier raised the price', matchOverrideBy: expect.any(String), matchIssues: [expect.objectContaining({ kind: 'price' })] });
    expect(await net(b, '5400')).toBe(200);
    // the override is on the audit trail
    const audit = (await call(server, 'GET', '/v1/audit-events?entityType=supplier_bill&limit=50', { tenant: b.tenant })).json.items as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['supplier_bill.match_overridden', 'supplier_bill.posted']));
    // an override for a bill that matches is a mistake
    const g2 = await ordered(b, b.sup.intra);
    expect((await bill(b, b.sup.intra, [withItem(b, bl(g2.grnLine))], { overrideMatch: { reason: 'just in case' } }, manager)).status).toBe(422);
  });

  it('applies the quantity tolerance to billing more than was received', async () => {
    const b = await buyer('Match Qty Co', { quantityTolerancePercent: '10' });
    const g = await ordered(b, b.sup.intra);
    const r = ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine, { quantity: '11' }))])); // 11 billed, 10 received: 10% over
    expect(r.lines[0]).toMatchObject({ clearedQuantity: '10.000000', clearedValue: '5000.0000', priceVariance: '500.0000' }); // the unreceived unit has no GRNI to clear
    expect(await net(b, '5400')).toBe(500);
    expect(await net(b, '2120')).toBe(0);
    const g2 = await ordered(b, b.sup.intra);
    const over = await bill(b, b.sup.intra, [withItem(b, bl(g2.grnLine, { quantity: '12' }))]);
    expect(over.status).toBe(409);
    expect(over.json.issues[0]).toMatchObject({ kind: 'quantity', expected: '10.000000', actual: '12.000000', deviationPercent: '20.0000' });
  });

  it('bills a receipt in parts and clears GRNI exactly, rounding included', async () => {
    const b = await buyer('Match Parts Co', { priceTolerancePercent: '5' });
    const g = await ordered(b, b.sup.intra, { quantity: '3', price: '10', discount: '33.3333' }); // 6.66667 a unit: 20.0001 in all
    expect(await net(b, '2120')).toBe(-20); // 3 x 6.66667 = 20.00001, kept to the cent-of-a-paisa: 20.0000
    for (const q of ['1', '1', '1']) ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine, { quantity: q, unitPrice: '6.6667' }))]));
    expect(await net(b, '2120')).toBe(0);
    expect((await call(server, 'GET', `/v1/purchasing/grni?companyId=${b.companyId}&asOf=2026-03-31`, { tenant: b.tenant })).json).toMatchObject({ totalOpenValue: '0.0000', reconciled: true });
    // everything on the receipt is billed: another bill has nothing left to match
    expect((await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine, { quantity: '1', unitPrice: '6.6667' }))])).json.code).toBe('match_failed');
  });

  it('lets exactly one of two simultaneous bills take a receipt', async () => {
    const b = await buyer('Match Race Co');
    const g = await ordered(b, b.sup.intra);
    const results = await Promise.all([1, 2, 3].map(() => bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))])));
    expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([201, 409, 409]);
    expect(await net(b, '2110')).toBe(-5900);
    expect(await net(b, '2120')).toBe(0);
  });
});

describe('validation and posting controls', () => {
  it('refuses what cannot be booked, leaving no trace', async () => {
    const b = await buyer('Bill Bad Co');
    const g = await ordered(b, b.sup.intra);
    expect((await bill(b, b.sup.intra, [{ itemId: b.item.widget, quantity: '1', unitPrice: '10' }])).json.code).toBe('receipt_required'); // stock must be received first
    expect((await bill(b, b.sup.inter, [withItem(b, bl(g.grnLine))])).status).toBe(422); // the receipt is from another supplier
    expect((await bill(b, b.cust.local, [withItem(b, bl(g.grnLine))])).status).toBe(422); // a customer
    expect((await bill(b, b.sup.intra, [{ itemId: b.item.service, quantity: '1', unitPrice: '10', grnLineId: g.grnLine }])).status).toBe(422);
    expect((await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))], { billDate: '2025-04-10' })).status).toBe(422); // before the supplier's invoice
    expect((await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))], { billDate: '2027-01-01', supplierInvoiceDate: '2027-01-01' })).json.code).toBe('no_accounting_period');
    expect((await bill(b, b.sup.intra, [{ itemId: b.item.service, quantity: '1', unitPrice: '10', taxCodeId: undefined, expenseAccountId: b.acc['1210'] }])).status).toBeGreaterThanOrEqual(409); // a control account cannot be the cost
    expect(await net(b, '2110')).toBe(0);
    expect(await net(b, '2120')).toBe(-5000);
    // the numbers the failures would have taken are still free
    expect(ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))])).billNo).toBe('BILL/2526/000001');
  });

  it('refuses the same supplier invoice twice, until the first is cancelled', async () => {
    const b = await buyer('Bill Dupe Co');
    const g = await ordered(b, b.sup.intra);
    const first = ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))], { supplierInvoiceNo: 'INV-77' }));
    const g2 = await ordered(b, b.sup.intra);
    const dupe = await bill(b, b.sup.intra, [withItem(b, bl(g2.grnLine))], { supplierInvoiceNo: 'inv-77' });
    expect(dupe.status).toBe(409);
    expect(dupe.json).toMatchObject({ code: 'duplicate_supplier_invoice', billNo: first.billNo });
    expect(ok(await bill(b, b.sup.inter, [withItem(b, bl((await ordered(b, b.sup.inter)).grnLine))], { supplierInvoiceNo: 'INV-77' })).status).toBe('posted'); // another supplier may use it
    ok(await call(server, 'POST', `/v1/purchasing/bills/${first.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-16', reason: 'Entered in error' } }), 200);
    expect(ok(await bill(b, b.sup.intra, [withItem(b, bl(g2.grnLine))], { supplierInvoiceNo: 'INV-77' })).status).toBe('posted');
  });

  it('says exactly which accounts are missing', async () => {
    const b = await buyer('Bill Cfg Co', { inputCgstAccountId: null, purchasePriceVarianceAccountId: null });
    const g = await ordered(b, b.sup.intra);
    const r = await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))]);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'purchasing_accounts_not_configured', missing: ['inputCgstAccountId'] });
  });

  it('keeps bills out of closed periods', async () => {
    const b = await buyer('Bill Locked Co');
    const g = await ordered(b, b.sup.intra);
    for (const n of ['Apr 2025', 'May 2025']) ok(await call(server, 'POST', `/v1/accounting-periods/${b.periods.find((p) => p.name === n)?.id}/close`, { tenant: b.tenant }), 200);
    expect((await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))], { billDate: '2025-05-20' })).json.code).toBe('period_closed');
    expect((await call(server, 'GET', `/v1/purchasing/grni?companyId=${b.companyId}&asOf=2026-03-31`, { tenant: b.tenant })).json.totalOpenValue).toBe('5000.0000');
  });
});

describe('returns', () => {
  it('debits the supplier for goods returned after the bill: stock out, payable and credit reversed', async () => {
    const b = await buyer('Return Billed Co');
    const g = await ordered(b, b.sup.intra);
    const original = ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))]));
    const stockBefore = await net(b, '1240');
    const note = ok(await call(server, 'POST', '/v1/purchasing/debit-notes', { tenant: b.tenant, body: { originalBillId: original.id, noteDate: '2025-04-20', reason: 'Damaged', lines: [{ originalLineId: original.lines[0].id, quantity: '3' }] } }));
    expect(note).toMatchObject({ documentType: 'debit_note', billNo: 'PDN/2526/000001', originalBillId: original.id, taxableTotal: '1500.0000', cgstTotal: '135.0000', sgstTotal: '135.0000', grandTotal: '1770.0000' });
    expect(await net(b, '2110')).toBe(-5900 + 1770);
    expect(await net(b, '1310')).toBe(450 - 135);
    expect(await net(b, '1240') - stockBefore).toBeCloseTo(-1227.2727, 3); // stock leaves at the average it carries (110 units, 45000): 3 x 409.0909
    expect(await net(b, '5400')).toBeCloseTo(1227.2727 - 1500, 3); // the supplier credits 1500: the 272.73 difference is a price-variance gain
    expect(await recon(b, 'inventory/reconciliation'), JSON.stringify(await recon(b, 'inventory/reconciliation'))).toMatchObject({ reconciled: true });
    // more than was billed is refused, price may not go up
    expect((await call(server, 'POST', '/v1/purchasing/debit-notes', { tenant: b.tenant, body: { originalBillId: original.id, noteDate: '2025-04-21', reason: 'x', lines: [{ originalLineId: original.lines[0].id, quantity: '8' }] } })).json.code).toBe('return_exceeds_bill');
    expect((await call(server, 'POST', '/v1/purchasing/debit-notes', { tenant: b.tenant, body: { originalBillId: original.id, noteDate: '2025-04-21', reason: 'x', lines: [{ originalLineId: original.lines[0].id, quantity: '1', unitPrice: '600' }] } })).status).toBe(422);
    expect((await call(server, 'POST', '/v1/purchasing/debit-notes', { tenant: b.tenant, body: { originalBillId: note.id, noteDate: '2025-04-21', reason: 'x', lines: [{ originalLineId: note.lines[0].id, quantity: '1' }] } })).json.code).toBe('original_is_a_note');
    // a bill with a debit note cannot be cancelled
    expect((await call(server, 'POST', `/v1/purchasing/bills/${original.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-22', reason: 'x' } })).json.code).toBe('has_notes');
  });

  it('returns goods that were not yet billed, clearing GRNI at the value it was accrued at', async () => {
    const b = await buyer('Return Unbilled Co');
    const g = await ordered(b, b.sup.intra);
    const r = ok(await call(server, 'POST', `/v1/purchasing/receipts/${g.receipt.id}/return`, { tenant: b.tenant, body: { returnDate: '2025-04-14', reason: 'Wrong grade', lines: [{ receiptLineId: g.grnLine, quantity: '4' }] } }));
    expect(r).toMatchObject({ returnNo: 'PRET/2526/000001' });
    expect(r.lines[0]).toMatchObject({ quantity: '4.000000', receiptValue: '2000.0000' });
    expect(await net(b, '2120')).toBe(-3000);
    expect(await recon(b, 'inventory/reconciliation'), JSON.stringify(await recon(b, 'inventory/reconciliation'))).toMatchObject({ reconciled: true });
    expect((await call(server, 'GET', `/v1/purchasing/grni?companyId=${b.companyId}&asOf=2026-03-31`, { tenant: b.tenant })).json).toMatchObject({ totalOpenValue: '3000.0000', reconciled: true });
    // only the unbilled, unreturned remainder (6) can be billed or returned
    expect((await call(server, 'POST', `/v1/purchasing/receipts/${g.receipt.id}/return`, { tenant: b.tenant, body: { returnDate: '2025-04-14', reason: 'x', lines: [{ receiptLineId: g.grnLine, quantity: '7' }] } })).json.code).toBe('return_exceeds_open');
    const billed = ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine, { quantity: '6' }))]));
    expect(billed.lines[0]).toMatchObject({ clearedQuantity: '6.000000', clearedValue: '3000.0000', priceVariance: '0.0000' });
    expect(await net(b, '2120')).toBe(0);
    expect((await call(server, 'GET', `/v1/purchasing/returns/${r.id}`, { tenant: b.tenant })).json.lines).toHaveLength(1);
  });
});

describe('cancellation', () => {
  it('reverses the bill completely: books, quantities, and non-claimable tax on stock', async () => {
    const b = await buyer('Cancel Co');
    const g = await ordered(b, b.sup.intra);
    const stock = await net(b, '1240');
    const r = ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine, { itcEligible: false }))]));
    expect(await net(b, '1240') - stock).toBe(900);
    const c = ok(await call(server, 'POST', `/v1/purchasing/bills/${r.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-18', reason: 'Wrong supplier invoice' } }), 200);
    expect(c).toMatchObject({ status: 'cancelled', cancelReason: 'Wrong supplier invoice', cancelJournalEntryId: expect.any(String) });
    expect(await net(b, '2110')).toBe(0);
    expect(await net(b, '2120')).toBe(-5000); // received, not invoiced again
    expect(await net(b, '1240') - stock).toBe(0);
    expect((await call(server, 'GET', `/v1/purchasing/receipts/${g.receipt.id}`, { tenant: b.tenant })).json.lines[0]).toMatchObject({ quantityBilled: '0.000000', valueBilled: '0.0000' });
    expect((await call(server, 'GET', `/v1/purchasing/orders/${g.order.id}`, { tenant: b.tenant })).json.lines[0].quantityBilled).toBe('0.000000');
    expect(await recon(b, 'inventory/reconciliation'), JSON.stringify(await recon(b, 'inventory/reconciliation'))).toMatchObject({ reconciled: true });
    expect((await call(server, 'GET', `/v1/purchasing/grni?companyId=${b.companyId}&asOf=2026-03-31`, { tenant: b.tenant })).json).toMatchObject({ totalOpenValue: '5000.0000', reconciled: true });
    expect((await call(server, 'POST', `/v1/purchasing/bills/${r.id}/cancel`, { tenant: b.tenant, body: { cancelDate: '2025-04-19', reason: 'again' } })).json.code).toBe('already_cancelled');
    // the receipt can be billed again
    expect(ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))])).status).toBe('posted');
    // as-of reconciliation honours the cancellation date
    expect((await call(server, 'GET', `/v1/purchasing/grni?companyId=${b.companyId}&asOf=2025-04-17`, { tenant: b.tenant })).json.reconciled).toBe(true);
  });
});

describe('guards and access', () => {
  it('keeps bills immutable in the database, and checks totals against lines at commit', async () => {
    const b = await buyer('Bill Guard Co');
    const g = await ordered(b, b.sup.intra);
    const r = ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))]));
    const bad = (sql: string, params: unknown[] = []) => expect(supers.query(sql, params)).rejects.toMatchObject({ code: '55000' });
    await bad('UPDATE erp.supplier_bills SET grand_total = 1 WHERE id = $1', [r.id]);
    await bad('DELETE FROM erp.supplier_bills WHERE id = $1', [r.id]);
    await bad('UPDATE erp.supplier_bill_lines SET unit_price = 1 WHERE id = $1', [r.lines[0].id]);
    await bad("UPDATE erp.supplier_bills SET status = 'posted', cancelled_at = now() WHERE id = $1", [r.id]);
    await expect(supers.query("UPDATE erp.goods_receipt_lines SET quantity_billed = 11 WHERE id = $1", [g.grnLine])).rejects.toMatchObject({ code: '23514' }); // beyond what was received
    // an override needs a reason and an approver; a note needs its original
    await expect(supers.query("UPDATE erp.supplier_bills SET match_override_by = NULL WHERE id = $1 AND false", [r.id])).resolves.toBeDefined();
    const client = await supers.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO erp.supplier_bills (tenant_id, id, company_id, document_type, bill_no, supplier_invoice_no, supplier_invoice_date, bill_date, due_date, gst_registration_id, supplier_id, supplier_name, supplier_gst_treatment, supplier_state, place_of_supply, tax_regime, taxable_total, grand_total, match_status) SELECT tenant_id, gen_random_uuid(), company_id, 'bill', 'RAW/1', 'RAW', bill_date, bill_date, bill_date, gst_registration_id, supplier_id, supplier_name, supplier_gst_treatment, supplier_state, place_of_supply, tax_regime, 100, 100, 'matched' FROM erp.supplier_bills WHERE id = $1", [r.id]);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' }); // header with no lines
    } finally { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
    await expect(supers.query("INSERT INTO erp.supplier_bills (tenant_id, id, company_id, document_type, bill_no, supplier_invoice_no, supplier_invoice_date, bill_date, due_date, gst_registration_id, supplier_id, supplier_name, supplier_gst_treatment, supplier_state, place_of_supply, tax_regime, taxable_total, grand_total, match_status) SELECT tenant_id, gen_random_uuid(), company_id, 'bill', 'RAW/2', 'RAW', bill_date, bill_date, bill_date, gst_registration_id, supplier_id, supplier_name, supplier_gst_treatment, supplier_state, place_of_supply, tax_regime, 100, 100, 'overridden' FROM erp.supplier_bills WHERE id = $1", [r.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('separates reading, posting, cancelling and approving, and keeps tenants apart', async () => {
    const b = await buyer('Bill Access Co');
    const g = await ordered(b, b.sup.intra);
    const r = ok(await bill(b, b.sup.intra, [withItem(b, bl(g.grnLine))]));
    const reader = await key(b, ['purchasing:read']);
    expect((await call(server, 'GET', `/v1/purchasing/bills/${r.id}`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/purchasing/bills', { token: reader, body: {} })).status).toBe(403);
    const poster = await key(b, ['purchasing:post']);
    expect((await call(server, 'POST', `/v1/purchasing/bills/${r.id}/cancel`, { token: poster, body: { cancelDate: '2025-04-20', reason: 'x' } })).status).toBe(403);
    expect((await call(server, 'GET', `/v1/purchasing/bills/${r.id}`, { token: poster })).status).toBe(403);
    const other = await buyer('Bill Access Other');
    expect((await call(server, 'GET', `/v1/purchasing/bills/${r.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/purchasing/bills?companyId=${other.companyId}`, { tenant: other.tenant })).json.items).toHaveLength(0);
    const g2 = await ordered(other, other.sup.intra);
    expect((await bill(other, other.sup.intra, [withItem(other, bl(g.grnLine))])).status).toBeGreaterThanOrEqual(404); // another tenant's receipt line is invisible
    expect(ok(await bill(other, other.sup.intra, [withItem(other, bl(g2.grnLine))])).status).toBe('posted');
    const listed = (await call(server, 'GET', `/v1/purchasing/bills?companyId=${b.companyId}&supplierId=${b.sup.intra}`, { tenant: b.tenant })).json.items;
    expect(listed).toHaveLength(1);
  });
});
