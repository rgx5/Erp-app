import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

interface Counter extends Shop { terminal: string; shift: string; owner: string }
const put = (s: Shop, path: string, body: object, base = '/v1/pos/') => call(server, 'PUT', `${base}${path}?companyId=${s.companyId}`, { tenant: s.tenant, body });
async function counter(name: string): Promise<Counter> {
  const s = await kit.shop(name);
  ok(await put(s, 'settings', { walkInCustomerId: s.cust.consumer, cashVarianceAccountId: s.acc['5900'] }), 200);
  for (const [method, code] of [['cash', '1110'], ['card', '1120']] as const) ok(await put(s, 'payment-accounts', { method, accountId: s.acc[code] }), 200);
  const loc = (await call(server, 'GET', `/v1/business-locations?companyId=${s.companyId}`, { tenant: s.tenant })).json.items[0].id as string;
  const terminal = ok(await call(server, 'POST', '/v1/pos/terminals', { tenant: s.tenant, body: { companyId: s.companyId, code: 'T1', name: 'Till 1', gstRegistrationId: s.regId, businessLocationId: loc, warehouseId: s.wh } })).id as string;
  const shift = ok(await call(server, 'POST', '/v1/pos/shifts', { tenant: s.tenant, body: { terminalId: terminal, openingCash: '500', date: '2025-04-10' } })).id as string;
  const owner = (await supers.query<{ id: string }>('SELECT id FROM erp.users WHERE tenant_id = $1 LIMIT 1', [s.tenant])).rows[0]?.id as string;
  return { ...s, terminal, shift, owner };
}
const sale = (c: Counter, lines: object[], payments: object[], o: object = {}) => call(server, 'POST', '/v1/pos/sales', { tenant: c.tenant, body: { shiftId: c.shift, date: '2025-04-10', lines, payments, ...o } });
const widget = (c: Counter, o: object = {}) => ({ itemId: c.item.widget, quantity: '1', unitPrice: '118', ...o });

describe('counter staff', () => {
  it('lets a manager approve a discount above the limit with a PIN, and credits the salesperson', async () => {
    const c = await counter('Staff Approval Co');
    expect((await call(server, 'PUT', '/v1/pos/me/pin', { tenant: c.tenant, body: { pin: '12' } })).status).toBe(422);
    ok(await call(server, 'PUT', '/v1/pos/me/pin', { tenant: c.tenant, body: { pin: '4321' } }), 200);
    const approvers = ok(await call(server, 'GET', '/v1/pos/approvers', { tenant: c.tenant }), 200).items as { id: string }[];
    expect(approvers.map((a) => a.id)).toEqual([c.owner]);
    expect((await put(c, 'settings', { maxDiscountWithoutApproval: '10' }, '/v1/retail/')).status).toBe(200);

    // 10% is allowed, 20% is not without a PIN
    ok(await sale(c, [widget(c, { discountPercent: '10', salespersonId: c.owner })], [{ method: 'cash', amount: '106' }]));
    const refused = await sale(c, [widget(c, { discountPercent: '20' })], [{ method: 'cash', amount: '94' }]);
    expect(refused.status).toBe(409); expect(refused.json.code).toBe('approval_required');
    expect((await sale(c, [widget(c, { discountPercent: '20' })], [{ method: 'cash', amount: '94' }], { approval: { userId: c.owner, pin: '0000' } })).json.code).toBe('approval_refused');
    ok(await sale(c, [widget(c, { discountPercent: '20' })], [{ method: 'cash', amount: '94' }], { approval: { userId: c.owner, pin: '4321' } }));

    const approvals = await supers.query('SELECT highest_discount FROM erp.pos_sale_approvals WHERE tenant_id = $1', [c.tenant]);
    expect(approvals.rows).toHaveLength(1); expect(Number(approvals.rows[0].highest_discount)).toBe(20);
    const credited = await supers.query('SELECT salesperson_id FROM erp.pos_sale_staff WHERE tenant_id = $1', [c.tenant]);
    expect(credited.rows).toEqual([{ salesperson_id: c.owner }]);
    // a salesperson who is not a user is refused
    expect((await sale(c, [widget(c, { salespersonId: '019a0000-0000-7000-8000-000000000000' })], [{ method: 'cash', amount: '118' }])).status).toBe(422);
  });

  it('locks an approver after five wrong PINs', async () => {
    const c = await counter('Staff Lock Co');
    ok(await call(server, 'PUT', '/v1/pos/me/pin', { tenant: c.tenant, body: { pin: '4321' } }), 200);
    for (let i = 0; i < 5; i++) expect((await call(server, 'POST', '/v1/pos/approvals/verify', { tenant: c.tenant, body: { userId: c.owner, pin: '1111' } })).status).toBe(403);
    expect((await call(server, 'POST', '/v1/pos/approvals/verify', { tenant: c.tenant, body: { userId: c.owner, pin: '4321' } })).json.code).toBe('approver_locked');
  });

  it('a user without the approve permission cannot approve even with a PIN', async () => {
    const c = await counter('Staff Perm Co');
    ok(await call(server, 'PUT', '/v1/pos/me/pin', { tenant: c.tenant, body: { pin: '4321' } }), 200);
    await supers.query("UPDATE erp.roles SET permissions = ARRAY['pos:sell'] WHERE tenant_id = $1", [c.tenant]);
    expect((await call(server, 'POST', '/v1/pos/approvals/verify', { tenant: c.tenant, body: { userId: c.owner, pin: '4321' } })).json.code).toBe('approval_refused');
  });
});
