import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createRegistration, createTenant, makeGstin, startServer, superPool, type TestServer } from '../support/harness.js';

let server: TestServer;
const supers = superPool();
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server.close(); await supers.end(); });

const ok = (res: { status: number; json: unknown }, status = 201) => { expect(res.status, JSON.stringify(res.json)).toBe(status); return res.json as any; }; // eslint-disable-line

interface Shop {
  tenant: string; companyId: string; regId: string; acc: Record<string, string>; wh: string; periods: { id: string; name: string }[];
  tax: { gst18: string; gst5: string; exempt: string };
  item: { widget: string; cheap: string; service: string; exemptItem: string };
  cust: { local: string; other: string; consumer: string; sez: string; overseas: string };
  addr: { localShip: string; otherBill: string };
}
let seq = 0;
const unitId = async (tenant: string, code: string) => ((await call(server, 'GET', '/v1/units?limit=200', { tenant })).json.items as { id: string; code: string }[]).find((u) => u.code === code)?.id as string;

/** A seller registered in Maharashtra (27) with chart, books, stock, tax codes, items, customers and number series ready. */
async function shop(name: string, o: { registrationType?: string } = {}): Promise<Shop> {
  const tenant = await createTenant(server, name);
  const pan = 'ABCDE1234F';
  const { companyId, registrationId: regId } = await createRegistration(server, tenant, '27', pan);
  if (o.registrationType) await supers.query('UPDATE erp.gst_registrations SET registration_type = $1 WHERE id = $2', [o.registrationType, regId]);
  ok(await call(server, 'POST', `/v1/companies/${companyId}/chart-of-accounts/template`, { tenant, body: { template: 'manufacturing_india' } }));
  const acc: Record<string, string> = {};
  for (const a of (await call(server, 'GET', `/v1/accounts?companyId=${companyId}&limit=200`, { tenant })).json.items) acc[a.code] = a.id;
  const fy = ok(await call(server, 'POST', '/v1/fiscal-years', { tenant, body: { companyId, startDate: '2025-04-01' } }));
  const loc = ok(await call(server, 'POST', '/v1/business-locations', { tenant, body: { companyId, gstRegistrationId: regId, code: 'MUM', name: 'Mumbai', addressLine1: '1 Main Rd', city: 'Mumbai', stateCode: '27', pincode: '400001' } }));
  const wh = ok(await call(server, 'POST', '/v1/warehouses', { tenant, body: { businessLocationId: loc.id, code: 'MAIN', name: 'Main', kind: 'finished_goods' } })).id as string;
  for (const [type, code] of [['finished_good', '1240'], ['trading_good', '1240'], ['raw_material', '1210']] as const) ok(await call(server, 'PUT', `/v1/companies/${companyId}/inventory-accounts`, { tenant, body: { itemType: type, accountId: acc[code] } }), 200);
  ok(await call(server, 'PUT', `/v1/companies/${companyId}/stock-settings`, { tenant, body: { adjustmentAccountId: acc['5300'], openingBalanceAccountId: acc['3100'] } }), 200);
  ok(await call(server, 'PUT', `/v1/companies/${companyId}/sales-settings`, {
    tenant, body: { receivableAccountId: acc['1130'], salesAccountId: acc['4100'], serviceSalesAccountId: acc['4130'], cogsAccountId: acc['5100'], roundOffAccountId: acc['5900'], outputCgstAccountId: acc['2210'], outputSgstAccountId: acc['2220'], outputIgstAccountId: acc['2230'] },
  }), 200);
  for (const documentType of ['tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note']) {
    ok(await call(server, 'POST', '/v1/number-series', { tenant, body: { gstRegistrationId: regId, documentType, financialYear: '2025-26', prefix: documentType === 'tax_invoice' ? 'INV' : documentType === 'bill_of_supply' ? 'BOS' : documentType === 'credit_note' ? 'CN' : 'DN' } }));
  }
  const taxCode = async (code: string, kind: string, rate?: number) => {
    const id = ok(await call(server, 'POST', '/v1/tax-codes', { tenant, body: { code, name: code, kind } })).id as string;
    if (rate !== undefined) ok(await call(server, 'POST', `/v1/tax-codes/${id}/rates`, { tenant, body: { effectiveFrom: '2025-04-01', igstRate: rate } }));
    return id;
  };
  const tax = { gst18: await taxCode('GST18', 'gst', 18), gst5: await taxCode('GST5', 'gst', 5), exempt: await taxCode('EXEMPT', 'exempt') };
  const nos = await unitId(tenant, 'NOS');
  const mk = async (code: string, o2: object) => ok(await call(server, 'POST', '/v1/items', { tenant, body: { code: `${code}-${++seq}`, name: code, baseUomId: nos, itemType: 'finished_good', ...o2 } })).id as string;
  const item = {
    widget: await mk('WIDGET', { taxCodeId: tax.gst18, hsnSacCode: '8479' }),
    cheap: await mk('CHEAP', { taxCodeId: tax.gst5, hsnSacCode: '9503' }),
    service: await mk('JOBWORK', { itemType: 'service', isStocked: false, taxCodeId: tax.gst18, hsnSacCode: '998821' }),
    exemptItem: await mk('LOOSE', { taxCodeId: tax.exempt, hsnSacCode: '1001' }),
  };
  for (const id of [item.widget, item.cheap, item.exemptItem]) ok(await call(server, 'POST', '/v1/stock/movements', { tenant, body: { companyId, movementType: 'opening', postingDate: '2025-04-01', description: 'Opening', lines: [{ warehouseId: wh, itemId: id, quantity: '100', unitCost: '400' }] } }));
  const party = async (code: string, treatment: string, extra: object = {}, roles: object = { isCustomer: true }) =>
    ok(await call(server, 'POST', '/v1/parties', { tenant, body: { code: `${code}-${++seq}`, legalName: `${code} Customer`, gstTreatment: treatment, ...roles, ...extra } })).id as string;
  const cust = {
    local: await party('LOCAL', 'registered_regular', { gstin: makeGstin('27', 'FGHIJ5678K') }),
    other: await party('OTHER', 'registered_regular', { gstin: makeGstin('29', 'KLMNO9012P') }),
    consumer: await party('WALKIN', 'consumer'),
    sez: await party('SEZ', 'sez', { gstin: makeGstin('24', 'PQRST3456U') }),
    overseas: await party('EXPORT', 'overseas', { currency: 'INR' }),
  };
  const address = async (partyId: string, kind: string, state: string, pincode = '400001') =>
    ok(await call(server, 'POST', `/v1/parties/${partyId}/addresses`, { tenant, body: { kind, line1: '9 Road', city: 'City', stateCode: state, pincode, isDefault: true } })).id as string;
  await address(cust.local, 'billing', '27');
  const localShip = await address(cust.local, 'shipping', '24', '380001'); // delivered to Gujarat
  const otherBill = await address(cust.other, 'billing', '29', '560001');
  await address(cust.sez, 'billing', '24', '380001');
  return { tenant, companyId, regId, acc, wh, periods: fy.periods, tax, item, cust, addr: { localShip, otherBill } };
}

const base = (s: Shop, customerId: string, lines: object[], o: object = {}) => ({ companyId: s.companyId, gstRegistrationId: s.regId, customerId, lines, ...o });
const order = (s: Shop, customerId: string, lines: object[], o: object = {}) => call(server, 'POST', '/v1/sales/orders', { tenant: s.tenant, body: { ...base(s, customerId, lines), orderDate: '2025-04-10', ...o } });
const quote = (s: Shop, customerId: string, lines: object[], o: object = {}) => call(server, 'POST', '/v1/sales/quotes', { tenant: s.tenant, body: { ...base(s, customerId, lines), quoteDate: '2025-04-10', validUntil: '2025-04-30', ...o } });
const ol = (s: Shop, itemId: string, o: object = {}) => ({ itemId, quantity: '10', unitPrice: '1000', warehouseId: s.wh, ...o });
const availability = async (s: Shop, itemId: string) => (await call(server, 'GET', `/v1/stock/availability?companyId=${s.companyId}&itemId=${itemId}&warehouseId=${s.wh}`, { tenant: s.tenant })).json.warehouses[0] as { onHand: string; reserved: string; available: string };
const invoiceOrder = (s: Shop, id: string, body: object = {}) => call(server, 'POST', `/v1/sales/orders/${id}/invoice`, { tenant: s.tenant, body: { invoiceDate: '2025-04-15', ...body } });
const getOrder = async (s: Shop, id: string) => (await call(server, 'GET', `/v1/sales/orders/${id}`, { tenant: s.tenant })).json;

describe('quotes', () => {
  it('estimates the tax with the same engine as an invoice, numbers itself, and validates like an invoice', async () => {
    const s = await shop('Quote Co');
    const q = ok(await quote(s, s.cust.other, [ol(s, s.item.widget, { quantity: '3', unitPrice: '999.99' }), { itemId: s.item.service, quantity: '1', unitPrice: '500' }, { itemId: s.item.cheap, quantity: '1', unitPrice: '99.99', warehouseId: undefined }], { shipToAddressId: undefined }));
    expect(q).toMatchObject({ quoteNo: 'QT/2526/000001', status: 'open', validUntil: '2025-04-30', orderId: null });
    expect(q.lines).toHaveLength(3);
    // IGST: 18% of 2999.97 = 539.99 (539.9946), 18% of 500 = 90.00, 5% of 99.99 = 5.00 (4.9995)
    expect(q).toMatchObject({ estimatedTaxable: '3599.9600', estimatedTax: '634.9900', estimatedTotal: '4235.0000' });
    expect(q.lines[0]).toMatchObject({ estimatedTaxable: '2999.9700', estimatedTotal: '3539.9600' });
    expect(JSON.stringify(q)).not.toContain('tenantId');
    expect((await quote(s, s.cust.other, [ol(s, s.item.widget)], { validUntil: '2025-04-09' })).status).toBe(422);
    const bare = ok(await call(server, 'POST', '/v1/items', { tenant: s.tenant, body: { code: 'Q-BARE', name: 'b', itemType: 'finished_good', baseUomId: await unitId(s.tenant, 'NOS') } })).id as string;
    expect((await quote(s, s.cust.other, [ol(s, bare)])).json.code).toBe('tax_code_required');
    const comp = await shop('Quote Comp Co', { registrationType: 'composition' });
    expect((await quote(comp, comp.cust.local, [ol(comp, comp.item.widget)])).json.code).toBe('composition_cannot_issue_tax_invoice');
    expect((await call(server, 'GET', `/v1/sales/quotes?companyId=${s.companyId}&status=open`, { tenant: s.tenant })).json.items).toHaveLength(1);
    await expect(supers.query("UPDATE erp.sales_quote_lines SET quantity = 99 WHERE quote_id = $1", [q.id])).rejects.toMatchObject({ code: '55000' });
  });
  it('converts once, before it expires, into an order with the same lines; or is rejected once', async () => {
    const s = await shop('Convert Co');
    const q = ok(await quote(s, s.cust.local, [ol(s, s.item.widget, { quantity: '4' })]));
    expect((await call(server, 'POST', `/v1/sales/quotes/${q.id}/convert`, { tenant: s.tenant, body: { orderDate: '2025-05-02' } })).json.code).toBe('quote_expired');
    const o = ok(await call(server, 'POST', `/v1/sales/quotes/${q.id}/convert`, { tenant: s.tenant, body: { orderDate: '2025-04-20', customerReference: 'PO-77', reserveStock: true } }));
    expect(o).toMatchObject({ orderNo: 'ORD/2526/000001', status: 'open', quoteId: q.id, customerReference: 'PO-77', reserveStock: true });
    expect(o.lines[0]).toMatchObject({ quantity: '4.000000', unitPrice: '1000.0000' });
    expect(o.lines[0].reservationId).toBeTruthy();
    const after = (await call(server, 'GET', `/v1/sales/quotes/${q.id}`, { tenant: s.tenant })).json;
    expect(after).toMatchObject({ status: 'converted', orderId: o.id });
    expect((await call(server, 'POST', `/v1/sales/quotes/${q.id}/convert`, { tenant: s.tenant, body: { orderDate: '2025-04-20' } })).json.code).toBe('quote_not_open');
    const r = ok(await quote(s, s.cust.local, [ol(s, s.item.widget)]));
    ok(await call(server, 'POST', `/v1/sales/quotes/${r.id}/reject`, { tenant: s.tenant }), 200);
    expect((await call(server, 'POST', `/v1/sales/quotes/${r.id}/reject`, { tenant: s.tenant })).json.code).toBe('quote_not_open');
    expect((await call(server, 'POST', `/v1/sales/quotes/${r.id}/convert`, { tenant: s.tenant, body: { orderDate: '2025-04-20' } })).json.code).toBe('quote_not_open');
    await expect(supers.query("UPDATE erp.sales_quotes SET status = 'open' WHERE id = $1", [q.id])).rejects.toMatchObject({ code: '55000' });
  });
});

describe('sales orders and stock reservation', () => {
  it('holds stock for the order, and an invoice from the order consumes the hold', async () => {
    const s = await shop('Order Co');
    const o = ok(await order(s, s.cust.local, [ol(s, s.item.widget, { quantity: '30' })], { reserveStock: true }));
    expect(o.lines[0].reservationId).toBeTruthy();
    expect(await availability(s, s.item.widget)).toMatchObject({ onHand: '100.000000', reserved: '30.000000', available: '70.000000' });
    const blocked = await call(server, 'POST', '/v1/stock/movements', { tenant: s.tenant, body: { companyId: s.companyId, movementType: 'issue', postingDate: '2025-04-12', description: 'x', offsetAccountId: s.acc['5100'], lines: [{ warehouseId: s.wh, itemId: s.item.widget, quantity: '80' }] } });
    expect(blocked.json.code).toBe('insufficient_stock'); // 30 are promised to the order
    const inv = ok(await invoiceOrder(s, o.id));
    expect(inv).toMatchObject({ documentType: 'tax_invoice', orderId: o.id, status: 'posted' });
    expect(inv.lines[0]).toMatchObject({ quantity: '30.000000', orderLineId: o.lines[0].id });
    expect(await availability(s, s.item.widget)).toMatchObject({ onHand: '70.000000', reserved: '0.000000', available: '70.000000' });
    const after = await getOrder(s, o.id);
    expect(after.status).toBe('invoiced');
    expect(after.lines[0].quantityInvoiced).toBe('30.000000');
    expect(after.invoices).toEqual([expect.objectContaining({ id: inv.id, invoiceNo: inv.invoiceNo })]);
    const res = (await call(server, 'GET', `/v1/stock/reservations/${o.lines[0].reservationId}`, { tenant: s.tenant })).json;
    expect(res).toMatchObject({ status: 'fulfilled', consumedQuantity: '30.000000' });
    expect((await invoiceOrder(s, o.id)).json.code).toBe('order_not_invoiceable');
  });
  it('invoices in parts, never beyond the order, pricing each invoice on its own date', async () => {
    const s = await shop('Partial Co');
    const o = ok(await order(s, s.cust.other, [ol(s, s.item.widget, { quantity: '10' }), { itemId: s.item.service, quantity: '2', unitPrice: '500' }], { reserveStock: true }));
    ok(await call(server, 'POST', `/v1/tax-codes/${s.tax.gst18}/rates`, { tenant: s.tenant, body: { effectiveFrom: '2025-10-01', igstRate: 12 } }));
    const [wl, sl] = o.lines;
    const first = ok(await invoiceOrder(s, o.id, { invoiceDate: '2025-09-15', lines: [{ orderLineId: wl.id, quantity: '4' }] }));
    expect(first.igstTotal).toBe('720.0000'); // 18% on 4000
    expect((await getOrder(s, o.id)).status).toBe('partially_invoiced');
    expect(await availability(s, s.item.widget)).toMatchObject({ onHand: '96.000000', reserved: '6.000000' });
    const over = await invoiceOrder(s, o.id, { invoiceDate: '2025-10-15', lines: [{ orderLineId: wl.id, quantity: '7' }] });
    expect(over.status).toBe(409);
    expect(over.json).toMatchObject({ code: 'invoice_exceeds_order', remaining: '6.000000' });
    const second = ok(await invoiceOrder(s, o.id, { invoiceDate: '2025-10-15' })); // the rest, at the rate then in force
    expect(second.lines.map((l: { quantity: string }) => l.quantity)).toEqual(['6.000000', '2.000000']);
    expect(second.lines[0]).toMatchObject({ igstRate: '12.0000', igstAmount: '720.0000' });
    expect(second.lines[1]).toMatchObject({ igstRate: '12.0000', igstAmount: '120.0000' });
    const done = await getOrder(s, o.id);
    expect(done.status).toBe('invoiced');
    expect(done.invoices).toHaveLength(2);
    void sl;
  });
  it('restores the order when an invoice is cancelled, so it can be invoiced again', async () => {
    const s = await shop('Reopen Co');
    const o = ok(await order(s, s.cust.local, [ol(s, s.item.widget, { quantity: '5' })]));
    const inv = ok(await invoiceOrder(s, o.id));
    expect((await getOrder(s, o.id)).status).toBe('invoiced');
    ok(await call(server, 'POST', `/v1/sales/invoices/${inv.id}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-04-16', reason: 'Wrong qty' } }), 200);
    const back = await getOrder(s, o.id);
    expect(back.status).toBe('open');
    expect(back.lines[0].quantityInvoiced).toBe('0.000000');
    const again = ok(await invoiceOrder(s, o.id, { invoiceDate: '2025-04-17' }));
    expect(again.invoiceNo).not.toBe(inv.invoiceNo);
    expect((await getOrder(s, o.id)).status).toBe('invoiced');
  });
  it('closes a part-invoiced order and releases what it still held; cancels an untouched one', async () => {
    const s = await shop('Close Co');
    const o = ok(await order(s, s.cust.local, [ol(s, s.item.widget, { quantity: '20' })], { reserveStock: true }));
    ok(await invoiceOrder(s, o.id, { lines: [{ orderLineId: o.lines[0].id, quantity: '5' }] }));
    expect(await availability(s, s.item.widget)).toMatchObject({ reserved: '15.000000' });
    expect((await call(server, 'POST', `/v1/sales/orders/${o.id}/cancel`, { tenant: s.tenant })).json.code).toBe('has_invoices');
    const closed = ok(await call(server, 'POST', `/v1/sales/orders/${o.id}/close`, { tenant: s.tenant }), 200);
    expect(closed.status).toBe('closed');
    expect(await availability(s, s.item.widget)).toMatchObject({ reserved: '0.000000', available: '95.000000' });
    expect((await invoiceOrder(s, o.id)).json.code).toBe('order_not_invoiceable');
    expect((await call(server, 'POST', `/v1/sales/orders/${o.id}/close`, { tenant: s.tenant })).json.code).toBe('order_finished');
    await expect(supers.query("UPDATE erp.sales_orders SET status = 'open' WHERE id = $1", [o.id])).rejects.toMatchObject({ code: '55000' });
    const fresh = ok(await order(s, s.cust.local, [ol(s, s.item.widget, { quantity: '10' })], { reserveStock: true }));
    expect(await availability(s, s.item.widget)).toMatchObject({ reserved: '10.000000' });
    expect(ok(await call(server, 'POST', `/v1/sales/orders/${fresh.id}/cancel`, { tenant: s.tenant }), 200).status).toBe('cancelled');
    expect(await availability(s, s.item.widget)).toMatchObject({ reserved: '0.000000' });
  });
  it('refuses what cannot be reserved, rolling the whole order back, and cannot over-promise the last stock', async () => {
    const s = await shop('Reserve Rules Co');
    const tooMuch = await order(s, s.cust.local, [ol(s, s.item.widget, { quantity: '101' })], { reserveStock: true });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.json.code).toBe('insufficient_stock');
    const nothing = (await supers.query('SELECT (SELECT count(*) FROM erp.sales_orders WHERE tenant_id = $1)::int AS o, (SELECT count(*) FROM erp.stock_reservations WHERE tenant_id = $1)::int AS r', [s.tenant])).rows[0];
    expect(nothing).toEqual({ o: 0, r: 0 });
    expect(ok(await order(s, s.cust.local, [ol(s, s.item.widget, { quantity: '1' })])).orderNo).toBe('ORD/2526/000001'); // the number was not burnt
    expect((await order(s, s.cust.local, [{ itemId: s.item.widget, quantity: '1', unitPrice: '1' }], { reserveStock: true })).json.errors[0].message).toMatch(/warehouse/);
    const nos = await unitId(s.tenant, 'NOS');
    const serial = ok(await call(server, 'POST', '/v1/items', { tenant: s.tenant, body: { code: 'OSER', name: 'S', itemType: 'finished_good', tracking: 'serial', baseUomId: nos, taxCodeId: s.tax.gst18 } })).id as string;
    expect((await order(s, s.cust.local, [ol(s, serial, { quantity: '1' })], { reserveStock: true })).json.code).toBe('serial_reservation');
    const results = await Promise.all(Array.from({ length: 6 }, () => order(s, s.cust.local, [ol(s, s.item.cheap, { quantity: '30' })], { reserveStock: true })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3); // 100 on hand, 30 each
    expect(await availability(s, s.item.cheap)).toMatchObject({ reserved: '90.000000', available: '10.000000' });
  });
  it('invoices serial-tracked order lines by choosing the serial numbers at invoicing', async () => {
    const s = await shop('Order Serial Co');
    const nos = await unitId(s.tenant, 'NOS');
    const serial = ok(await call(server, 'POST', '/v1/items', { tenant: s.tenant, body: { code: 'OS2', name: 'S', itemType: 'finished_good', tracking: 'serial', baseUomId: nos, taxCodeId: s.tax.gst18 } })).id as string;
    ok(await call(server, 'POST', '/v1/stock/movements', { tenant: s.tenant, body: { companyId: s.companyId, movementType: 'receipt', postingDate: '2025-04-01', description: 'r', offsetAccountId: s.acc['2140'], lines: [{ warehouseId: s.wh, itemId: serial, quantity: '3', unitCost: '100', serialNos: ['P1', 'P2', 'P3'] }] } }));
    const o = ok(await order(s, s.cust.local, [ol(s, serial, { quantity: '2' })]));
    expect((await invoiceOrder(s, o.id)).json.code).toBe('serial_required');
    const inv = ok(await invoiceOrder(s, o.id, { lines: [{ orderLineId: o.lines[0].id, quantity: '2', serialNos: ['P1', 'P3'] }] }));
    expect(inv.lines[0].serialNos).toEqual(['P1', 'P3']);
  });
  it('fixes the order lines in the database and is permissioned and tenant-isolated', async () => {
    const s = await shop('Order Guard Co');
    const o = ok(await order(s, s.cust.local, [ol(s, s.item.widget, { quantity: '2' })]));
    await expect(supers.query('UPDATE erp.sales_order_lines SET unit_price = 1 WHERE order_id = $1', [o.id])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query('DELETE FROM erp.sales_order_lines WHERE order_id = $1', [o.id])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query('UPDATE erp.sales_order_lines SET quantity_invoiced = 3 WHERE order_id = $1', [o.id])).rejects.toMatchObject({ code: '23514' }); // more than ordered
    const key = (await call(server, 'POST', '/v1/api-keys', { tenant: s.tenant, body: { name: 'ro', permissions: ['sales:read'] } })).json.key as string;
    expect((await call(server, 'GET', `/v1/sales/orders/${o.id}`, { token: key })).status).toBe(200);
    expect((await call(server, 'POST', `/v1/sales/orders/${o.id}/invoice`, { token: key, body: { invoiceDate: '2025-04-15' } })).status).toBe(403);
    const other = await shop('Order Other Co');
    expect((await call(server, 'GET', `/v1/sales/orders/${o.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/sales/orders?companyId=${s.companyId}`, { tenant: other.tenant })).json.items).toEqual([]);
    expect((await call(server, 'GET', `/v1/sales/orders?companyId=${s.companyId}&status=open`, { tenant: s.tenant })).json.items).toHaveLength(1);
  });
});
