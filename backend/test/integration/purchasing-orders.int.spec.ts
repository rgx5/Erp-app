import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, makeGstin, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let kit: ReturnType<typeof shopKit>;
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

interface Buyer extends Shop { supplier: string; supplier2: string }
let seq = 0;

/** A buyer with the usual shop world, purchasing accounts set, and two suppliers. */
async function buyer(name: string): Promise<Buyer> {
  const s = await kit.shop(name);
  ok(await call(server, 'PUT', `/v1/companies/${s.companyId}/purchasing-settings`, { tenant: s.tenant, body: { payableAccountId: s.acc['2110'], grniAccountId: s.acc['2120'], purchasePriceVarianceAccountId: s.acc['5400'] } }), 200);
  const sup = async (code: string, extra: object = {}) => ok(await call(server, 'POST', '/v1/parties', { tenant: s.tenant, body: { code: `${code}-${++seq}`, legalName: `${code} Supplies`, gstTreatment: 'registered_regular', gstin: makeGstin('29', 'KLMNO9012P', (++seq % 35 + 1).toString(36).toUpperCase()), isSupplier: true, ...extra } })).id as string;
  return { ...s, supplier: await sup('SUP'), supplier2: await sup('SUP') };
}
const line = (b: Buyer, itemId: string, o: object = {}) => ({ itemId, quantity: '10', unitPrice: '500', warehouseId: b.wh, ...o });
const po = (b: Buyer, lines: object[], o: object = {}) => call(server, 'POST', '/v1/purchasing/orders', { tenant: b.tenant, body: { companyId: b.companyId, gstRegistrationId: b.regId, supplierId: b.supplier, orderDate: '2025-04-10', lines, ...o } });
const receive = (b: Buyer, body: object) => call(server, 'POST', '/v1/purchasing/receipts', { tenant: b.tenant, body: { companyId: b.companyId, receiptDate: '2025-04-12', ...body } });
const getPo = async (b: Buyer, id: string) => (await call(server, 'GET', `/v1/purchasing/orders/${id}`, { tenant: b.tenant })).json;
const onHand = async (b: Buyer, itemId: string) => (await call(server, 'GET', `/v1/stock/availability?companyId=${b.companyId}&itemId=${itemId}&warehouseId=${b.wh}`, { tenant: b.tenant })).json.warehouses[0] as { onHand: string };
const grniBalance = async (b: Buyer) => {
  const t = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${b.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: b.tenant })).json;
  const r = t.rows.find((x: { code: string }) => x.code === '2120') as { closingCredit: string; closingDebit: string } | undefined;
  return r ? `${r.closingCredit}/${r.closingDebit}` : '0/0';
};
const grni = async (b: Buyer) => (await call(server, 'GET', `/v1/purchasing/grni?companyId=${b.companyId}&asOf=2026-03-31`, { tenant: b.tenant })).json;

describe('settings', () => {
  it('only accepts accounts of the right kind and reports what is missing', async () => {
    const s = await kit.shop('Pur Cfg Co');
    const put = (body: object) => call(server, 'PUT', `/v1/companies/${s.companyId}/purchasing-settings`, { tenant: s.tenant, body });
    expect((await put({ payableAccountId: s.acc['1130'] })).status).toBe(422); // receivables, not payables
    expect((await put({ grniAccountId: s.acc['2110'] })).status).toBe(422); // payables control, not the inventory-control GRNI account
    expect((await put({ purchasePriceVarianceAccountId: s.acc['1210'] })).status).toBe(422); // a control account
    expect((await put({ inputCgstAccountId: s.acc['2210'] })).status).toBe(422); // output liability, not an input asset
    expect((await put({ priceTolerancePercent: '101' })).status).toBe(422);
    ok(await put({ payableAccountId: s.acc['2110'], grniAccountId: s.acc['2120'], inputCgstAccountId: s.acc['1310'], priceTolerancePercent: '2.5' }), 200);
    expect((await call(server, 'GET', `/v1/companies/${s.companyId}/purchasing-settings`, { tenant: s.tenant })).json).toMatchObject({ payableAccountId: s.acc['2110'], priceTolerancePercent: '2.5000', quantityTolerancePercent: '0.0000' });
    // a receipt without the GRNI account says exactly what is missing
    const sup = ok(await call(server, 'POST', '/v1/parties', { tenant: s.tenant, body: { code: 'S1', legalName: 'S1', gstTreatment: 'registered_regular', gstin: makeGstin('29', 'KLMNO9012P', 'Z'), isSupplier: true } })).id as string;
    ok(await put({ grniAccountId: null }), 200);
    const r = await call(server, 'POST', '/v1/purchasing/receipts', { tenant: s.tenant, body: { companyId: s.companyId, supplierId: sup, receiptDate: '2025-04-12', lines: [{ itemId: s.item.widget, warehouseId: s.wh, quantity: '1', unitPrice: '10' }] } });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'purchasing_accounts_not_configured', missing: ['grniAccountId'] });
  });
});

describe('purchase orders', () => {
  it('numbers orders, validates the parties and lines, and starts open', async () => {
    const b = await buyer('Po Create Co');
    const r = ok(await po(b, [line(b, b.item.widget, { discountPercent: '10' }), line(b, b.item.service, { warehouseId: undefined })], { supplierReference: 'QUOTE-9', expectedDate: '2025-04-20' }));
    expect(r).toMatchObject({ poNo: 'PO/2526/000001', status: 'open', supplierId: b.supplier, supplierReference: 'QUOTE-9' });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ lineNo: 1, quantity: '10.000000', quantityReceived: '0.000000', unitPrice: '500.0000', discountPercent: '10.0000', taxCodeId: b.tax.gst18 }); // tax code defaults from the item
    expect(ok(await po(b, [line(b, b.item.cheap)])).poNo).toBe('PO/2526/000002');
    // a customer is not a supplier; another tenant's registration is not ours
    expect((await po(b, [line(b, b.item.widget)], { supplierId: b.cust.local })).status).toBe(422);
    const other = await buyer('Po Create Other');
    expect((await po(b, [line(b, b.item.widget)], { gstRegistrationId: other.regId })).status).toBe(422);
    expect((await po(b, [line(b, b.item.widget, { warehouseId: other.wh })])).status).toBe(422);
    expect((await po(b, [line(b, b.item.widget, { quantity: '0' })])).status).toBe(422);
    expect((await po(b, [line(b, b.item.widget)], { expectedDate: '2025-04-01' })).status).toBe(422);
    expect((await po(b, [])).status).toBe(422);
    expect((await call(server, 'GET', `/v1/purchasing/orders?companyId=${b.companyId}&status=open`, { tenant: b.tenant })).json.items).toHaveLength(2);
  });

  it('can be cancelled only before anything arrives, and closed at any time', async () => {
    const b = await buyer('Po Close Co');
    const a = ok(await po(b, [line(b, b.item.widget)]));
    expect(ok(await call(server, 'POST', `/v1/purchasing/orders/${a.id}/cancel`, { tenant: b.tenant }), 200).status).toBe('cancelled');
    expect((await call(server, 'POST', `/v1/purchasing/orders/${a.id}/cancel`, { tenant: b.tenant })).json.code).toBe('order_finished');
    expect((await receive(b, { purchaseOrderId: a.id, lines: [{ orderLineId: a.lines[0].id, quantity: '1' }] })).json.code).toBe('order_finished');
    const c = ok(await po(b, [line(b, b.item.widget)]));
    ok(await receive(b, { purchaseOrderId: c.id, lines: [{ orderLineId: c.lines[0].id, quantity: '4' }] }));
    expect((await call(server, 'POST', `/v1/purchasing/orders/${c.id}/cancel`, { tenant: b.tenant })).json.code).toBe('has_receipts');
    expect(ok(await call(server, 'POST', `/v1/purchasing/orders/${c.id}/close`, { tenant: b.tenant }), 200).status).toBe('closed');
    expect((await receive(b, { purchaseOrderId: c.id, lines: [{ orderLineId: c.lines[0].id, quantity: '1' }] })).json.code).toBe('order_finished');
  });
});

describe('goods receipts', () => {
  it('receives in parts at the net order price, accrues GRNI, and advances the order', async () => {
    const b = await buyer('Grn Co');
    const o = ok(await po(b, [line(b, b.item.widget, { discountPercent: '10' }), line(b, b.item.cheap, { quantity: '20', unitPrice: '100' })]));
    const before = await onHand(b, b.item.widget); // 100 opening at 400
    const r1 = ok(await receive(b, { purchaseOrderId: o.id, supplierDeliveryNote: 'DN-1', lines: [{ orderLineId: o.lines[0].id, quantity: '4' }] }));
    expect(r1).toMatchObject({ grnNo: 'GRN/2526/000001', supplierId: b.supplier, purchaseOrderId: o.id, supplierDeliveryNote: 'DN-1' });
    expect(r1.lines[0]).toMatchObject({ quantity: '4.000000', unitCost: '450.000000', value: '1800.0000', quantityBilled: '0.000000' }); // 500 less 10%
    expect(Number((await onHand(b, b.item.widget)).onHand) - Number(before.onHand)).toBe(4);
    expect((await getPo(b, o.id)).status).toBe('partially_received');
    expect((await getPo(b, o.id)).lines[0].quantityReceived).toBe('4.000000');
    expect(await grniBalance(b)).toBe('1800.0000/0.0000'); // Dr inventory / Cr GRNI
    const r2 = ok(await receive(b, { purchaseOrderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: '6' }, { orderLineId: o.lines[1].id, quantity: '20' }] }));
    expect(r2.grnNo).toBe('GRN/2526/000002');
    expect((await getPo(b, o.id)).status).toBe('received');
    expect(await grniBalance(b)).toBe('6500.0000/0.0000'); // 1800 + 2700 + 2000
    const report = await grni(b);
    expect(report.totalOpenValue).toBe('6500.0000');
    expect(report.lines).toHaveLength(3);
    expect((await getPo(b, o.id)).receipts).toHaveLength(2);
    // everything received: more is refused
    expect((await receive(b, { purchaseOrderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: '1' }] })).json.code).toBe('receipt_exceeds_order');
  });

  it('refuses over-receipt and other invalid lines, leaving no trace', async () => {
    const b = await buyer('Grn Bad Co');
    const o = ok(await po(b, [line(b, b.item.widget, { quantity: '5' }), line(b, b.item.service, { warehouseId: undefined })]));
    const stockBefore = (await onHand(b, b.item.widget)).onHand;
    const r = await receive(b, { purchaseOrderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: '3' }, { orderLineId: o.lines[0].id, quantity: '3' }] }); // 6 > 5 across two lines
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'receipt_exceeds_order', remaining: '5.000000' });
    expect((await receive(b, { purchaseOrderId: o.id, lines: [{ orderLineId: o.lines[1].id, quantity: '1' }] })).json.code).toBe('item_not_stocked');
    expect((await receive(b, { purchaseOrderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: '1', unitPrice: '1' }] })).status).toBe(422); // order lines are valued at the order price
    expect((await receive(b, { purchaseOrderId: o.id, supplierId: b.supplier2, lines: [{ orderLineId: o.lines[0].id, quantity: '1' }] })).status).toBe(422);
    expect((await receive(b, { lines: [{ itemId: b.item.widget, warehouseId: b.wh, quantity: '1', unitPrice: '10' }] })).status).toBe(422); // no supplier
    expect((await receive(b, { supplierId: b.supplier, lines: [{ itemId: b.item.widget, warehouseId: b.wh, quantity: '1' }] })).status).toBe(422); // no price
    expect((await receive(b, { supplierId: b.supplier, lines: [{ orderLineId: o.lines[0].id, quantity: '1' }] })).status).toBe(422); // order line without the order
    expect((await receive(b, { supplierId: b.supplier, receiptDate: '2027-01-01', lines: [{ itemId: b.item.widget, warehouseId: b.wh, quantity: '1', unitPrice: '10' }] })).json.code).toBe('no_accounting_period');
    expect((await onHand(b, b.item.widget)).onHand).toBe(stockBefore);
    expect(await grniBalance(b)).toBe('0/0');
    expect((await getPo(b, o.id)).status).toBe('open');
    // the number the failed attempts would have used is still free
    expect(ok(await receive(b, { purchaseOrderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: '5' }] })).grnNo).toBe('GRN/2526/000001');
  });

  it('receives goods that came with no order, at the stated price, with batches and serial numbers', async () => {
    const b = await buyer('Grn Direct Co');
    const nos = ((await call(server, 'GET', '/v1/units?limit=200', { tenant: b.tenant })).json.items as { id: string; code: string }[]).find((u) => u.code === 'NOS')?.id as string;
    const batched = ok(await call(server, 'POST', '/v1/items', { tenant: b.tenant, body: { code: `BATCHY-${++seq}`, name: 'Batchy', baseUomId: nos, itemType: 'raw_material', tracking: 'batch' } })).id as string;
    const serial = ok(await call(server, 'POST', '/v1/items', { tenant: b.tenant, body: { code: `SERIAL-${++seq}`, name: 'Serial', baseUomId: nos, itemType: 'raw_material', tracking: 'serial' } })).id as string;
    const r = ok(await receive(b, {
      supplierId: b.supplier,
      lines: [
        { itemId: batched, warehouseId: b.wh, quantity: '30', unitPrice: '12.5', batch: { batchNo: 'B-1', expiryDate: '2026-12-31' } },
        { itemId: serial, warehouseId: b.wh, quantity: '2', unitPrice: '800', serialNos: ['SN-1', 'SN-2'] },
      ],
    }));
    expect(r.purchaseOrderId).toBeNull();
    expect(r.lines[0]).toMatchObject({ unitCost: '12.500000', value: '375.0000', batchId: expect.any(String) });
    expect(r.lines[1]).toMatchObject({ value: '1600.0000', serialNos: ['SN-1', 'SN-2'] });
    expect(await grniBalance(b)).toBe('1975.0000/0.0000');
    expect((await receive(b, { supplierId: b.supplier, lines: [{ itemId: batched, warehouseId: b.wh, quantity: '1', unitPrice: '1' }] })).json.code).toBe('batch_required');
    expect((await receive(b, { supplierId: b.supplier, lines: [{ itemId: serial, warehouseId: b.wh, quantity: '2', unitPrice: '1', serialNos: ['SN-1', 'SN-9'] }] })).status).toBeGreaterThanOrEqual(409); // SN-1 already in stock
    expect((await call(server, 'GET', `/v1/purchasing/receipts/${r.id}`, { tenant: b.tenant })).json.lines).toHaveLength(2);
    expect((await call(server, 'GET', `/v1/purchasing/receipts?companyId=${b.companyId}&supplierId=${b.supplier}`, { tenant: b.tenant })).json.items).toHaveLength(1);
  });

  it('lets exactly one of two simultaneous receipts take the remaining quantity', async () => {
    const b = await buyer('Grn Race Co');
    const o = ok(await po(b, [line(b, b.item.widget, { quantity: '10' })]));
    const results = await Promise.all([1, 2, 3].map(() => receive(b, { purchaseOrderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: '6' }] })));
    expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([201, 409, 409]);
    expect((await getPo(b, o.id)).lines[0].quantityReceived).toBe('6.000000');
    expect(await grniBalance(b)).toBe('3000.0000/0.0000');
  });

  it('refuses to receive into a closed accounting period, rolling everything back', async () => {
    const b = await buyer('Grn Locked Co');
    const o = ok(await po(b, [line(b, b.item.widget)]));
    for (const n of ['Apr 2025', 'May 2025']) ok(await call(server, 'POST', `/v1/accounting-periods/${b.periods.find((p) => p.name === n)?.id}/close`, { tenant: b.tenant }), 200);
    expect((await receive(b, { purchaseOrderId: o.id, receiptDate: '2025-05-05', lines: [{ orderLineId: o.lines[0].id, quantity: '2' }] })).json.code).toBe('period_closed');
    expect((await getPo(b, o.id)).lines[0].quantityReceived).toBe('0.000000');
    expect(await grniBalance(b)).toBe('0/0');
  });
});

describe('guards', () => {
  it('keeps orders and receipts immutable in the database itself', async () => {
    const b = await buyer('Pur Guard Co');
    const o = ok(await po(b, [line(b, b.item.widget)]));
    const r = ok(await receive(b, { purchaseOrderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: '3' }] }));
    const bad = (sql: string, params: unknown[] = []) => expect(supers.query(sql, params)).rejects.toMatchObject({ code: '55000' });
    await bad('UPDATE erp.purchase_orders SET supplier_id = $2 WHERE id = $1', [o.id, b.supplier2]);
    await bad('UPDATE erp.purchase_order_lines SET unit_price = 1 WHERE id = $1', [o.lines[0].id]);
    await bad('DELETE FROM erp.purchase_order_lines WHERE id = $1', [o.lines[0].id]);
    await bad('UPDATE erp.goods_receipts SET grn_no = $2 WHERE id = $1', [r.id, 'X']);
    await bad('UPDATE erp.goods_receipt_lines SET unit_cost = 1 WHERE id = $1', [r.lines[0].id]);
    await bad('DELETE FROM erp.goods_receipts WHERE id = $1', [r.id]);
    await expect(supers.query('UPDATE erp.purchase_order_lines SET quantity_received = 99 WHERE id = $1', [o.lines[0].id])).rejects.toMatchObject({ code: '23514' }); // beyond the ordered quantity
  });

  it('separates reading, posting and configuring, and keeps tenants apart', async () => {
    const b = await buyer('Pur Access Co');
    const o = ok(await po(b, [line(b, b.item.widget)]));
    const key = async (permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: b.tenant, body: { name: 'k', permissions } })).json.key as string;
    const reader = await key(['purchasing:read']);
    expect((await call(server, 'GET', `/v1/purchasing/orders/${o.id}`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/purchasing/orders', { token: reader, body: {} })).status).toBe(403);
    expect((await call(server, 'POST', '/v1/purchasing/receipts', { token: reader, body: {} })).status).toBe(403);
    const buyerKey = await key(['purchasing:post']);
    expect((await call(server, 'POST', `/v1/purchasing/orders/${o.id}/cancel`, { token: buyerKey })).status).toBe(403); // cancelling is its own right
    expect((await call(server, 'PUT', `/v1/companies/${b.companyId}/purchasing-settings`, { token: buyerKey, body: { priceTolerancePercent: '5' } })).status).toBe(403);
    expect((await call(server, 'GET', `/v1/purchasing/orders/${o.id}`, { token: buyerKey })).status).toBe(403);
    const other = await buyer('Pur Access Other');
    expect((await call(server, 'GET', `/v1/purchasing/orders/${o.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await receive(other, { purchaseOrderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: '1' }] })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/purchasing/orders?companyId=${other.companyId}`, { tenant: other.tenant })).json.items).toHaveLength(0);
  });
});
