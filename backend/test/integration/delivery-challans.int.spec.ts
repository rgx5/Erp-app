import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

type S = Awaited<ReturnType<typeof kit.shop>>;
const challan = (s: S, lines: object[], o: object = {}) => call(server, 'POST', '/v1/sales/delivery-challans', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: s.companyId, gstRegistrationId: s.regId, customerId: s.cust.local, challanDate: '2025-04-10', lines, ...o } });
const line = (s: S, o: object = {}) => ({ itemId: s.item.widget, quantity: '10', unitPrice: '1000', warehouseId: s.wh, ...o });
const onHand = async (s: S) => (await call(server, 'GET', `/v1/stock/availability?companyId=${s.companyId}&itemId=${s.item.widget}&warehouseId=${s.wh}`, { tenant: s.tenant })).json.warehouses[0].onHand as string;

describe('delivery challans', () => {
  it('records goods sent out with its own number, vehicle and transporter, and posts nothing', async () => {
    const s = await kit.shop('Challan Co');
    const before = await onHand(s);
    const c = ok(await challan(s, [line(s)], { vehicleNo: 'MH12AB1234', transporter: 'Swift Logistics', customerReference: 'PO-77' }));
    expect(c).toMatchObject({ kind: 'challan', status: 'open', vehicleNo: 'MH12AB1234', transporter: 'Swift Logistics', reserveStock: false });
    expect(c.orderNo).toMatch(/^DLV\/2526\/000001$/);
    expect(await onHand(s)).toBe(before); // stock has not moved: it moves when the challan is invoiced
    const tb = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: s.tenant })).json;
    expect(tb.rows.find((r: { code: string }) => r.code === '4100')?.closingCredit ?? '0.0000').toBe('0.0000'); // no sales yet
    const second = ok(await challan(s, [line(s)]));
    expect(second.orderNo).toBe('DLV/2526/000002');
    expect((await challan(s, [line(s)], { vehicleNo: ' ' })).status).toBe(422);
  });

  it('lists challans apart from orders, and invoices them in parts through the normal invoice posting', async () => {
    const s = await kit.shop('Challan Invoice Co');
    const c = ok(await challan(s, [line(s, { quantity: '10' })]));
    const orders = (await call(server, 'GET', `/v1/sales/orders?companyId=${s.companyId}`, { tenant: s.tenant })).json.items as { id: string }[];
    expect(orders.map((o) => o.id)).not.toContain(c.id);
    const list = (await call(server, 'GET', `/v1/sales/delivery-challans?companyId=${s.companyId}`, { tenant: s.tenant })).json.items as { id: string; kind: string }[];
    expect(list.map((o) => o.id)).toEqual([c.id]);
    const before = Number(await onHand(s));
    const first = ok(await call(server, 'POST', `/v1/sales/orders/${c.id}/invoice`, { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { invoiceDate: '2025-04-15', lines: [{ orderLineId: c.lines[0].id, quantity: '4' }] } }));
    expect(first).toMatchObject({ documentType: 'tax_invoice', taxableTotal: '4000.0000', status: 'posted' });
    expect(Number(await onHand(s))).toBe(before - 4); // stock leaves now
    expect((await call(server, 'GET', `/v1/sales/orders/${c.id}`, { tenant: s.tenant })).json.status).toBe('partially_invoiced');
    ok(await call(server, 'POST', `/v1/sales/orders/${c.id}/invoice`, { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { invoiceDate: '2025-04-16' } }));
    const done = (await call(server, 'GET', `/v1/sales/orders/${c.id}`, { tenant: s.tenant })).json;
    expect(done.status).toBe('invoiced'); expect(done.invoices).toHaveLength(2);
    expect(Number(await onHand(s))).toBe(before - 10);
  });

  it('cancels an uninvoiced challan, and keeps one business out of another’s', async () => {
    const s = await kit.shop('Challan Cancel Co'); const other = await kit.shop('Challan Other Co');
    const c = ok(await challan(s, [line(s)]));
    ok(await call(server, 'POST', `/v1/sales/orders/${c.id}/cancel`, { tenant: s.tenant }), 200);
    expect((await call(server, 'GET', `/v1/sales/orders/${c.id}`, { tenant: s.tenant })).json.status).toBe('cancelled');
    expect((await call(server, 'GET', `/v1/sales/orders/${c.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/sales/delivery-challans?companyId=${other.companyId}`, { tenant: other.tenant })).json.items).toHaveLength(0);
  });
});
