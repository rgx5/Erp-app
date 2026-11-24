import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const notices = async (s: { tenant: string; companyId: string }) => (await call(server, 'GET', `/v1/notifications?companyId=${s.companyId}`, { tenant: s.tenant })).json.items as { id: string; title: string; count: number; to: string }[];

describe('notifications', () => {
  it('says nothing when nothing needs attention, then reports low stock, overdue customers and a failing recurring invoice', async () => {
    const s = await kit.shop('Notice Co'); const quiet = await kit.shop('Notice Quiet Co');
    expect(await notices(quiet)).toEqual([]); // a fresh business has nothing to report

    ok(await call(server, 'PATCH', `/v1/items/${s.item.widget}`, { tenant: s.tenant, headers: { 'if-match': '1' }, body: { reorderLevel: '100000' } }), 200);
    ok(await call(server, 'POST', '/v1/sales/invoices', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: s.companyId, gstRegistrationId: s.regId, invoiceDate: '2025-06-01', customerId: s.cust.local, lines: [{ itemId: s.item.service, quantity: '1', unitPrice: '1000' }] } }));
    ok(await call(server, 'POST', '/v1/sales/recurring-invoices', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: s.companyId, gstRegistrationId: s.regId, customerId: s.cust.local, name: 'Big order', frequency: 'monthly', startDate: '2025-05-31', lines: [{ itemId: s.item.widget, quantity: '100000', unitPrice: '10', warehouseId: s.wh }] } }));
    await call(server, 'POST', '/v1/sales/recurring-invoices/run-due', { tenant: s.tenant, body: { companyId: s.companyId, asOf: '2025-05-31' } }); // fails: not enough stock
    const found = await notices(s);
    const ids = found.map((n) => n.id).sort();
    expect(ids).toEqual(['low_stock', 'overdue', 'recurring_failed']);
    expect(found.find((n) => n.id === 'overdue')).toMatchObject({ count: 1, to: '/sales/reminders' });
    expect(found.find((n) => n.id === 'low_stock')).toMatchObject({ count: 1, to: '/inventory/reorder' });

    // a shift left open overnight
    const loc = (await call(server, 'GET', `/v1/business-locations?companyId=${s.companyId}`, { tenant: s.tenant })).json.items[0].id as string;
    const put = (path: string, body: object) => call(server, 'PUT', `/v1/pos/${path}?companyId=${s.companyId}`, { tenant: s.tenant, body });
    ok(await put('settings', { walkInCustomerId: s.cust.consumer, cashVarianceAccountId: s.acc['5900'] }), 200);
    const term = ok(await call(server, 'POST', '/v1/pos/terminals', { tenant: s.tenant, body: { companyId: s.companyId, code: 'T1', name: 'Till 1', gstRegistrationId: s.regId, businessLocationId: loc, warehouseId: s.wh } }));
    const shift = ok(await call(server, 'POST', '/v1/pos/shifts', { tenant: s.tenant, body: { terminalId: term.id, openingCash: '100', date: '2025-04-10' } }));
    expect((await notices(s)).map((n) => n.id)).not.toContain('shift_open'); // just opened
    // shifts are protected from edits; the test backdates one the way time would have
    await supers.query(`BEGIN; ALTER TABLE erp.pos_shifts DISABLE TRIGGER USER; UPDATE erp.pos_shifts SET opened_at = now() - interval '20 hours' WHERE id = '${shift.id as string}'; ALTER TABLE erp.pos_shifts ENABLE TRIGGER USER; COMMIT;`);
    expect((await notices(s)).map((n) => n.id)).toContain('shift_open');

    expect(await notices(quiet)).toEqual([]); // another business sees none of this
    expect((await call(server, 'GET', `/v1/notifications?companyId=${s.companyId}`)).status).toBe(401);
  });
});
