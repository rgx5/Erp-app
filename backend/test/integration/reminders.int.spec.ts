import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

describe('payment reminders and customer contact details', () => {
  it('keeps a phone and email on a customer, and refuses malformed ones', async () => {
    const s = await kit.shop('Contact Co');
    const cur = ok(await call(server, 'GET', `/v1/parties/${s.cust.local}`, { tenant: s.tenant }), 200);
    const patch = (body: object, v = cur.version) => call(server, 'PATCH', `/v1/parties/${s.cust.local}`, { tenant: s.tenant, headers: { 'if-match': String(v) }, body });
    expect((await patch({ phone: 'call me' })).status).toBe(422);
    expect((await patch({ email: 'not-an-email' })).status).toBe(422);
    const up = ok(await patch({ phone: '+91 98765 43210', email: 'accounts@asha.example.com' }), 200);
    expect(up).toMatchObject({ phone: '+91 98765 43210', email: 'accounts@asha.example.com' });
    expect(ok(await patch({ phone: null }, up.version), 200).phone).toBeNull();
  });

  it('logs reminders and shows the latest for each customer, apart for each business', async () => {
    const s = await kit.shop('Reminder Co'); const other = await kit.shop('Reminder Other Co');
    const send = (b: object, who = s) => call(server, 'POST', '/v1/sales/reminders', { tenant: who.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: who.companyId, customerId: who.cust.local, channel: 'whatsapp', amountDue: '5900', message: 'Dear customer, ₹5,900 is overdue.', ...b } });
    ok(await send({}));
    const second = ok(await send({ channel: 'call', amountDue: '3000', message: 'Called, promised Friday.' }));
    expect(second).toMatchObject({ channel: 'call', amountDue: '3000' });
    const latest = (await call(server, 'GET', `/v1/sales/reminders?companyId=${s.companyId}`, { tenant: s.tenant })).json.items as { customerId: string; channel: string; amountDue: string }[];
    expect(latest).toHaveLength(1); expect(latest[0]).toMatchObject({ customerId: s.cust.local, channel: 'call', amountDue: '3000.0000' });
    expect((await send({ channel: 'pigeon' })).status).toBe(422);
    expect((await send({ amountDue: '0' })).status).toBe(422);
    expect((await send({ customerId: s.item.widget })).status).toBe(404); // not a customer
    expect((await call(server, 'GET', `/v1/sales/reminders?companyId=${other.companyId}`, { tenant: other.tenant })).json.items).toHaveLength(0);
    expect((await send({}, { ...other, cust: { ...other.cust, local: s.cust.local } } as never)).status).toBe(404); // another business's customer
  });
});
