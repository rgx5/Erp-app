import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

interface Counter extends Shop { terminal: string; shift: string; device: string }
const put = (s: Shop, path: string, body: object) => call(server, 'PUT', `/v1/pos/${path}?companyId=${s.companyId}`, { tenant: s.tenant, body });
/** A shop with the till configured, an open shift, and a registered device. */
async function counter(name: string): Promise<Counter> {
  const s = await kit.shop(name);
  ok(await put(s, 'settings', { walkInCustomerId: s.cust.consumer, cashVarianceAccountId: s.acc['5900'] }), 200);
  for (const [method, code] of [['cash', '1110'], ['card', '1120'], ['upi', '1120']] as const) ok(await put(s, 'payment-accounts', { method, accountId: s.acc[code] }), 200);
  const loc = (await call(server, 'GET', `/v1/business-locations?companyId=${s.companyId}`, { tenant: s.tenant })).json.items[0].id as string;
  const terminal = ok(await call(server, 'POST', '/v1/pos/terminals', { tenant: s.tenant, body: { companyId: s.companyId, code: 'T1', name: 'Till 1', gstRegistrationId: s.regId, businessLocationId: loc, warehouseId: s.wh } })).id as string;
  const shift = ok(await call(server, 'POST', '/v1/pos/shifts', { tenant: s.tenant, body: { terminalId: terminal, openingCash: '500', date: '2025-04-10' } })).id as string;
  const device = ok(await call(server, 'POST', '/v1/pos/devices', { tenant: s.tenant, body: { terminalId: terminal, name: 'Android till' } })).id as string;
  return { ...s, terminal, shift, device };
}
const saleItem = (c: Counter, o: { clientId?: string; at?: string; itemId?: string; quantity?: string; unitPrice?: string; payments?: object[] } = {}) => {
  const q = o.quantity ?? '1';
  const price = o.unitPrice ?? '118';
  return {
    clientId: o.clientId ?? randomUUID(), kind: 'sale', occurredAt: o.at ?? '2025-04-10T10:00:00+05:30',
    payload: { lines: [{ itemId: o.itemId ?? c.item.widget, quantity: q, unitPrice: price }], payments: o.payments ?? [{ method: 'cash', amount: (Number(q) * Number(price)).toFixed(2), tendered: (Number(q) * Number(price)).toFixed(2) }] },
  };
};
const upload = (c: Counter, items: object[], o: { shiftId?: string; deviceId?: string; token?: string } = {}) =>
  call(server, 'POST', '/v1/pos/sync/batches', { ...(o.token ? { token: o.token } : { tenant: c.tenant }), body: { deviceId: o.deviceId ?? c.device, shiftId: o.shiftId ?? c.shift, items } });
const salesOf = async (c: Counter) => (await call(server, 'GET', `/v1/pos/sales?companyId=${c.companyId}&shiftId=${c.shift}&limit=100`, { tenant: c.tenant })).json.items as { documentNo: string; kind: string }[];
const recon = async (c: Counter, path: string) => (await call(server, 'GET', `/v1/${path}?companyId=${c.companyId}&asOf=2026-03-31`, { tenant: c.tenant })).json;
const items = async (c: Counter, status?: string) => (await call(server, 'GET', `/v1/pos/sync/items?deviceId=${c.device}${status ? `&status=${status}` : ''}`, { tenant: c.tenant })).json.items as { clientId: string; status: string; errorCode: string | null; attempts: number }[];

describe('uploading offline sales', () => {
  it('applies each sale once, in the order it happened, and books everything like an online sale', async () => {
    const c = await counter('Sync Flow Co');
    const early = saleItem(c, { at: '2025-04-10T09:00:00+05:30', quantity: '2' });
    const mid = saleItem(c, { at: '2025-04-10T11:30:00+05:30', itemId: c.item.cheap, unitPrice: '105', payments: [{ method: 'upi', amount: '105', reference: 'UPI-1' }] });
    const late = saleItem(c, { at: '2025-04-10T18:45:00+05:30', payments: [{ method: 'cash', amount: '118', tendered: '200' }] });
    const r = ok(await upload(c, [late, early, mid]), 200); // sent out of order
    expect(r).toMatchObject({ received: 3, applied: 3, duplicates: 0, rejected: 0 });
    expect(r.results.map((x: { clientId: string }) => x.clientId)).toEqual([early.clientId, mid.clientId, late.clientId]); // processed in the order they happened
    const sales = await salesOf(c);
    expect(sales.map((s) => s.documentNo).sort()).toEqual(['INV/2526/00001', 'INV/2526/00002', 'INV/2526/00003']);
    const first = (await call(server, 'GET', `/v1/pos/sales/${r.results[0].saleId}`, { tenant: c.tenant })).json;
    expect(first.document).toMatchObject({ invoiceNo: 'INV/2526/00001', invoiceDate: '2025-04-10', grandTotal: '236.0000' }); // the earliest sale got the first number
    const summary = (await call(server, 'GET', `/v1/pos/shifts/${c.shift}`, { tenant: c.tenant })).json;
    expect(summary.summary).toMatchObject({ salesTotal: '459.0000' });
    expect((await recon(c, 'receivables/reconciliation')).reconciled).toBe(true);
    expect((await recon(c, 'inventory/reconciliation')).reconciled).toBe(true);
    expect((await items(c)).map((x) => x.status)).toEqual(['applied', 'applied', 'applied']);
    expect((await call(server, 'GET', `/v1/pos/devices?companyId=${c.companyId}`, { tenant: c.tenant })).json.items[0]).toMatchObject({ applied: 3, rejected: 0, lastSyncAt: expect.any(String) });
  });

  it('is safe to retry: a repeated batch books nothing twice, and a reused id with other content is refused', async () => {
    const c = await counter('Sync Retry Co');
    const a = saleItem(c);
    const b = saleItem(c, { at: '2025-04-10T12:00:00+05:30' });
    const first = ok(await upload(c, [a, b]), 200);
    const again = ok(await upload(c, [b, a]), 200); // the connection dropped before the answer arrived: same batch again
    expect(again).toMatchObject({ applied: 0, duplicates: 2, rejected: 0 });
    expect(again.results.map((r: { saleId: string }) => r.saleId).sort()).toEqual(first.results.map((r: { saleId: string }) => r.saleId).sort());
    expect(await salesOf(c)).toHaveLength(2);
    const tampered = { ...a, payload: { ...a.payload, lines: [{ ...a.payload.lines[0], quantity: '5' }] } };
    const bad = ok(await upload(c, [tampered]), 200);
    expect(bad.results[0]).toMatchObject({ status: 'rejected', error: { code: 'client_id_reused' } });
    expect(await salesOf(c)).toHaveLength(2);
    // field order is not content: the same sale with its keys shuffled is still a duplicate
    const shuffled = { occurredAt: a.occurredAt, payload: { payments: a.payload.payments, lines: [{ unitPrice: '118', quantity: '1', itemId: c.item.widget }] }, kind: 'sale', clientId: a.clientId };
    expect(ok(await upload(c, [shuffled]), 200).results[0].status).toBe('duplicate');
  });

  it('survives the same batch arriving twice at once', async () => {
    const c = await counter('Sync Race Co');
    const batch = [1, 2, 3, 4].map((n) => saleItem(c, { at: `2025-04-10T1${n}:00:00+05:30` }));
    const [x, y] = await Promise.all([upload(c, batch), upload(c, batch)]);
    expect(x.status).toBe(200);
    expect(y.status).toBe(200);
    expect(x.json.applied + y.json.applied).toBe(4);
    expect(await salesOf(c)).toHaveLength(4);
    expect((await recon(c, 'inventory/reconciliation')).reconciled).toBe(true);
  });
});

describe('offline returns', () => {
  it('returns an offline sale by the till\'s own id and line number', async () => {
    const c = await counter('Sync Return Co');
    const sale = saleItem(c, { at: '2025-04-10T10:00:00+05:30', quantity: '3' });
    const ret = { clientId: randomUUID(), kind: 'return', occurredAt: '2025-04-10T15:00:00+05:30', payload: { originalClientId: sale.clientId, reason: 'Wrong size', lines: [{ lineNo: 1, quantity: '1' }], refunds: [{ method: 'cash', amount: '118' }] } };
    const r = ok(await upload(c, [ret, sale]), 200); // the return is listed first, but it happened later
    expect(r).toMatchObject({ applied: 2, rejected: 0 });
    const kinds = (await salesOf(c)).map((s) => s.kind).sort();
    expect(kinds).toEqual(['return', 'sale']);
    expect((await recon(c, 'receivables/reconciliation')).reconciled).toBe(true);
    // returning a sale the server has not seen is rejected, and succeeds when retried after it arrives
    const lateSale = saleItem(c, { at: '2025-04-10T16:00:00+05:30' });
    const early = { clientId: randomUUID(), kind: 'return', occurredAt: '2025-04-10T17:00:00+05:30', payload: { originalClientId: lateSale.clientId, reason: 'x', lines: [{ lineNo: 1, quantity: '1' }], refunds: [{ method: 'cash', amount: '118' }] } };
    expect(ok(await upload(c, [early]), 200).results[0]).toMatchObject({ status: 'rejected', error: { code: 'original_unknown' } });
    ok(await upload(c, [lateSale]), 200);
    const retry = ok(await upload(c, [early]), 200);
    expect(retry.results[0].status).toBe('applied');
    expect((await items(c)).find((x) => x.clientId === early.clientId)).toMatchObject({ status: 'applied', attempts: 2 });
    // a line the sale does not have, a mismatching refund
    const bad = { clientId: randomUUID(), kind: 'return', occurredAt: '2025-04-10T18:00:00+05:30', payload: { originalClientId: sale.clientId, reason: 'x', lines: [{ lineNo: 9, quantity: '1' }], refunds: [{ method: 'cash', amount: '118' }] } };
    expect(ok(await upload(c, [bad]), 200).results[0]).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
    const both = { clientId: randomUUID(), kind: 'return', occurredAt: '2025-04-10T18:05:00+05:30', payload: { originalClientId: sale.clientId, originalSaleId: randomUUID(), reason: 'x', lines: [{ lineNo: 1, quantity: '1' }], refunds: [{ method: 'cash', amount: '118' }] } };
    expect(ok(await upload(c, [both]), 200).results[0].error.code).toBe('validation_failed');
  });
});

describe('rejections', () => {
  it('rejects only what the books cannot take, keeps the rest, and lets a fixed item be retried unchanged', async () => {
    const c = await counter('Sync Reject Co');
    const good = saleItem(c, { at: '2025-04-10T09:00:00+05:30' });
    const noStock = saleItem(c, { at: '2025-04-10T09:10:00+05:30', quantity: '500' }); // only 100 in stock
    const mismatch = saleItem(c, { at: '2025-04-10T09:20:00+05:30', payments: [{ method: 'cash', amount: '100' }] });
    const future = saleItem(c, { at: '2099-01-01T09:30:00+05:30' });
    const broken = { clientId: randomUUID(), kind: 'sale', occurredAt: '2025-04-10T09:40:00+05:30', payload: { lines: [] } };
    const stockBefore = (await call(server, 'GET', `/v1/stock/availability?companyId=${c.companyId}&itemId=${c.item.widget}&warehouseId=${c.wh}`, { tenant: c.tenant })).json.warehouses[0].onHand;
    const r = ok(await upload(c, [good, noStock, mismatch, future, broken]), 200);
    expect(r).toMatchObject({ applied: 1, rejected: 4 });
    expect(r.results.map((x: { status: string; error?: { code: string } }) => x.error?.code ?? x.status)).toEqual(['applied', 'insufficient_stock', 'payment_mismatch', 'validation_failed', 'date_in_future']); // in the order they happened
    expect(await salesOf(c)).toHaveLength(1);
    expect((await call(server, 'GET', `/v1/stock/availability?companyId=${c.companyId}&itemId=${c.item.widget}&warehouseId=${c.wh}`, { tenant: c.tenant })).json.warehouses[0].onHand).toBe(String(Number(stockBefore) - 1) + '.000000'); // the rejected ones took nothing
    expect((await items(c, 'rejected')).map((x) => x.errorCode).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(['date_in_future', 'insufficient_stock', 'payment_mismatch', 'validation_failed']);
    expect((await recon(c, 'inventory/reconciliation')).reconciled).toBe(true);
    expect((await recon(c, 'receivables/reconciliation')).reconciled).toBe(true);
    // stock arrives: the same item, unchanged, now goes through
    ok(await call(server, 'POST', '/v1/stock/movements', { tenant: c.tenant, body: { companyId: c.companyId, movementType: 'opening', postingDate: '2025-04-01', description: 'More', lines: [{ warehouseId: c.wh, itemId: c.item.widget, quantity: '1000', unitCost: '400' }] } }));
    const retry = ok(await upload(c, [noStock]), 200);
    expect(retry.results[0].status).toBe('applied');
    expect((await items(c)).find((x) => x.clientId === noStock.clientId)).toMatchObject({ status: 'applied', errorCode: null, attempts: 2 });
  });

  it('refuses sales into a closed period and onto a closed shift', async () => {
    const c = await counter('Sync Closed Co');
    for (const n of ['Apr 2025', 'May 2025']) ok(await call(server, 'POST', `/v1/accounting-periods/${c.periods.find((p) => p.name === n)?.id}/close`, { tenant: c.tenant }), 200);
    const inClosed = saleItem(c, { at: '2025-05-20T10:00:00+05:30' });
    expect(ok(await upload(c, [inClosed]), 200).results[0]).toMatchObject({ status: 'rejected', error: { code: 'period_closed' } });
    const open = counter('Sync Shift Co');
    const d = await open;
    ok(await call(server, 'POST', `/v1/pos/shifts/${d.shift}/close`, { tenant: d.tenant, body: { countedCash: '500', date: '2025-04-10' } }), 200);
    const onClosed = ok(await upload(d, [saleItem(d)]), 200);
    expect(onClosed.results[0]).toMatchObject({ status: 'rejected', error: { code: 'shift_closed' } });
    expect((await salesOf(d))).toHaveLength(0);
  });
});

describe('devices and reference data', () => {
  it('registers devices per terminal, binds uploads to the device\'s own terminal, and revokes for good', async () => {
    const c = await counter('Sync Device Co');
    expect((await call(server, 'POST', '/v1/pos/devices', { tenant: c.tenant, body: { terminalId: c.terminal, name: 'Android till' } })).status).toBe(409); // name per terminal
    const second = ok(await call(server, 'POST', '/v1/pos/devices', { tenant: c.tenant, body: { terminalId: c.terminal, name: 'Spare' } })).id as string;
    const loc = (await call(server, 'GET', `/v1/business-locations?companyId=${c.companyId}`, { tenant: c.tenant })).json.items[0].id as string;
    const t2 = ok(await call(server, 'POST', '/v1/pos/terminals', { tenant: c.tenant, body: { companyId: c.companyId, code: 'T2', name: 'Till 2', gstRegistrationId: c.regId, businessLocationId: loc, warehouseId: c.wh } })).id as string;
    const shift2 = ok(await call(server, 'POST', '/v1/pos/shifts', { tenant: c.tenant, body: { terminalId: t2, openingCash: '0', date: '2025-04-10' } })).id as string;
    expect((await upload(c, [saleItem(c)], { shiftId: shift2 })).status).toBe(422); // device of till 1, shift of till 2
    expect((await upload(c, [saleItem(c)], { deviceId: randomUUID() })).status).toBe(404);
    ok(await call(server, 'POST', `/v1/pos/devices/${second}/revoke`, { tenant: c.tenant, body: {} }), 200);
    expect((await call(server, 'POST', `/v1/pos/devices/${second}/revoke`, { tenant: c.tenant, body: {} })).json.code).toBe('already_revoked');
    const denied = await upload(c, [saleItem(c)], { deviceId: second });
    expect(denied.status).toBe(403);
    expect(denied.json.code).toBe('device_revoked');
    expect((await call(server, 'GET', `/v1/pos/sync/catalogue?deviceId=${second}`, { tenant: c.tenant })).status).toBe(403);
    expect((await call(server, 'GET', `/v1/pos/sync/items?deviceId=${randomUUID()}`, { tenant: c.tenant })).status).toBe(404);
  });

  it('gives a till what it needs to sell offline, and only what changed since it last asked', async () => {
    const c = await counter('Sync Catalogue Co');
    const cat = (await call(server, 'GET', `/v1/pos/sync/catalogue?deviceId=${c.device}`, { tenant: c.tenant })).json;
    expect(cat).toMatchObject({ terminal: { id: c.terminal, code: 'T1', warehouseId: c.wh }, walkInCustomerId: c.cust.consumer, paymentMethods: ['cash', 'card', 'upi'].sort() });
    expect(cat.items.map((i: { code: string }) => i.code.split('-')[0]).sort()).toEqual(['CHEAP', 'JOBWORK', 'LOOSE', 'WIDGET']);
    expect(cat.items.find((i: { code: string }) => i.code.startsWith('WIDGET'))).toMatchObject({ hsn: '8479', stocked: true, status: 'active' });
    expect(cat.taxRates.map((t: { code: string }) => t.code).sort()).toEqual(['GST18', 'GST5']);
    expect(cat.taxRates.find((t: { code: string }) => t.code === 'GST18')).toMatchObject({ igst: '18.0000', cgst: '9.0000', sgst: '9.0000' });
    // retail catalogue: barcodes, MRP and a category's no-discount rule reach the till, so it can sell offline the same way
    const widget = cat.items.find((i: { code: string }) => i.code.startsWith('WIDGET'));
    const cate = (await call(server, 'POST', '/v1/item-categories', { tenant: c.tenant, body: { code: 'NODISC', name: 'No discount', noDiscount: true } })).json;
    const wfull = (await call(server, 'GET', `/v1/items/${widget.id}`, { tenant: c.tenant })).json;
    expect((await call(server, 'PATCH', `/v1/items/${widget.id}`, { tenant: c.tenant, headers: { 'if-match': String(wfull.version) }, body: { categoryId: cate.id, mrp: '99' } })).status).toBe(200);
    expect((await call(server, 'POST', `/v1/items/${widget.id}/barcodes`, { tenant: c.tenant, body: { barcode: 'SCAN-0001' } })).status).toBe(201);
    const cat2 = (await call(server, 'GET', `/v1/pos/sync/catalogue?deviceId=${c.device}`, { tenant: c.tenant })).json;
    expect(cat2.items.find((i: { id: string }) => i.id === widget.id)).toMatchObject({ mrp: '99.0000', noDiscount: true, categoryId: cate.id });
    expect(cat2.barcodes).toEqual([{ itemId: widget.id, barcode: 'SCAN-0001' }]);
    const none = (await call(server, 'GET', `/v1/pos/sync/catalogue?deviceId=${c.device}&updatedSince=${encodeURIComponent(cat2.serverTime)}`, { tenant: c.tenant })).json;
    expect(none.items).toEqual([]);
    expect(none.serverTime >= cat2.serverTime).toBe(true);
  });
});

describe('guards and access', () => {
  it('keeps applied items and devices immutable in the database', async () => {
    const c = await counter('Sync Guard Co');
    const a = saleItem(c);
    ok(await upload(c, [a]), 200);
    const bad = (sql: string, params: unknown[] = []) => expect(supers.query(sql, params)).rejects.toMatchObject({ code: '55000' });
    await bad("UPDATE erp.pos_sync_items SET status = 'rejected', error_code = 'x', pos_sale_id = NULL WHERE client_id = $1", [a.clientId]);
    await bad('DELETE FROM erp.pos_sync_items WHERE client_id = $1', [a.clientId]);
    await bad("UPDATE erp.pos_devices SET name = 'renamed' WHERE id = $1", [c.device]);
    await bad('DELETE FROM erp.pos_devices WHERE id = $1', [c.device]);
    await expect(supers.query("INSERT INTO erp.pos_sync_items (tenant_id, device_id, client_id, kind, payload_hash, occurred_at, status) VALUES ($1, $2, gen_random_uuid(), 'sale', 'h', 'x', 'applied')", [c.tenant, c.device])).rejects.toMatchObject({ code: '23514' }); // applied needs its sale
  });

  it('lets a till upload with only the sync right, and keeps tenants apart', async () => {
    const c = await counter('Sync Access Co');
    const key = async (permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: c.tenant, body: { name: 'k', permissions } })).json.key as string;
    const till = await key(['pos:sync']);
    expect(ok(await upload(c, [saleItem(c)], { token: till }), 200).applied).toBe(1);
    expect((await call(server, 'GET', `/v1/pos/sync/catalogue?deviceId=${c.device}`, { token: till })).status).toBe(200);
    expect((await call(server, 'GET', `/v1/pos/sales?companyId=${c.companyId}`, { token: till })).status).toBe(403); // it cannot read the books
    expect((await call(server, 'POST', '/v1/pos/devices', { token: till, body: {} })).status).toBe(403);
    const seller = await key(['pos:sell']);
    expect((await upload(c, [saleItem(c)], { token: seller })).status).toBe(403); // selling online is a different right
    const reader = await key(['pos:read']);
    expect((await call(server, 'GET', `/v1/pos/sync/items?deviceId=${c.device}`, { token: reader })).status).toBe(200);
    expect((await upload(c, [saleItem(c)], { token: reader })).status).toBe(403);
    const other = await counter('Sync Access Other');
    expect((await upload(other, [saleItem(other)], { deviceId: c.device })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/pos/sync/items?deviceId=${c.device}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'POST', `/v1/pos/devices/${c.device}/revoke`, { tenant: other.tenant, body: {} })).status).toBe(404);
  });
});
