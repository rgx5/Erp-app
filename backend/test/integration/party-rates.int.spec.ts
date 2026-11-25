import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let kit: ReturnType<typeof shopKit>;
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

describe('rates agreed with one party', () => {
  it('suggests the party rate first, then the last price charged, then a price list; and a removed rate stops applying', async () => {
    const s = await kit.shop('Party Rates Co');
    const suggest = async (party: string) => (await call(server, 'GET', `/v1/parties/${party}/suggested-price?itemId=${s.item.widget}&kind=sales`, { tenant: s.tenant })).json;
    expect((await suggest(s.cust.local)).source).toBe('none');

    // a price list entry is the fallback
    const list = ok(await call(server, 'POST', '/v1/price-lists', { tenant: s.tenant, body: { code: 'STD', name: 'Standard', kind: 'sales' } }));
    const uom = (await call(server, 'GET', `/v1/items/${s.item.widget}`, { tenant: s.tenant })).json.baseUomId as string;
    ok(await call(server, 'POST', `/v1/price-lists/${list.id}/prices`, { tenant: s.tenant, body: { itemId: s.item.widget, uomId: uom, price: '1000', effectiveFrom: '2025-04-01' } }));
    expect(await suggest(s.cust.local)).toMatchObject({ source: 'list', price: '1000.0000' });

    // the last price charged to this customer comes before the list
    ok(await call(server, 'POST', '/v1/sales/invoices', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: s.companyId, gstRegistrationId: s.regId, invoiceDate: '2025-06-01', customerId: s.cust.local, lines: [{ itemId: s.item.widget, quantity: '1', unitPrice: '900', warehouseId: s.wh }] } }));
    expect(await suggest(s.cust.local)).toMatchObject({ source: 'last', price: '900.0000' });
    expect((await suggest(s.cust.other)).source).toBe('list'); // another customer is not affected

    // an agreed rate comes first
    const rate = ok(await call(server, 'PUT', `/v1/parties/${s.cust.local}/item-rates`, { tenant: s.tenant, body: { itemId: s.item.widget, rate: '850', taxInclusive: true } }), 200);
    expect(await suggest(s.cust.local)).toMatchObject({ source: 'party', price: '850.0000', taxInclusive: true });
    ok(await call(server, 'PUT', `/v1/parties/${s.cust.local}/item-rates`, { tenant: s.tenant, body: { itemId: s.item.widget, rate: '800' } }), 200); // changing replaces
    const rows = (await call(server, 'GET', `/v1/parties/${s.cust.local}/item-rates`, { tenant: s.tenant })).json.items;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ itemCode: expect.stringMatching(/^WIDGET/), rate: '800.0000' });
    ok(await call(server, 'POST', `/v1/parties/${s.cust.local}/item-rates/${rate.id}/remove`, { tenant: s.tenant }), 200);
    expect((await suggest(s.cust.local)).source).toBe('last');
    expect((await call(server, 'PUT', `/v1/parties/${s.cust.local}/item-rates`, { tenant: s.tenant, body: { itemId: s.item.widget, rate: 'abc' } })).status).toBe(422);
  });
});
