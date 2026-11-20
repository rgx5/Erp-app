import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

describe('item variants', () => {
  it('stores style, size and colour on ordinary items and finds all variants by style', async () => {
    const s = await kit.shop('Variant Co');
    const base = ok(await call(server, 'GET', `/v1/items/${s.item.widget}`, { tenant: s.tenant }), 200);
    const make = (code: string, size: string, colour: string) => call(server, 'POST', '/v1/items', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { code, name: `Polo shirt - ${size} / ${colour}`, baseUomId: base.baseUomId, itemType: 'finished_good', taxCodeId: base.taxCodeId, hsnSacCode: '6105', styleCode: 'POLO', size, colour } });
    const a = ok(await make('POLO-M-RED', 'M', 'Red')); ok(await make('POLO-L-RED', 'L', 'Red'));
    expect(a).toMatchObject({ styleCode: 'POLO', size: 'M', colour: 'Red' });
    const found = (await call(server, 'GET', '/v1/items?q=POLO', { tenant: s.tenant })).json.items as { code: string }[];
    expect(found.map((i) => i.code).sort()).toEqual(['POLO-L-RED', 'POLO-M-RED']);
    expect((await make('POLO-X', ' ', 'Red')).status).toBe(422); // blank size
    const up = await call(server, 'PATCH', `/v1/items/${a.id}`, { tenant: s.tenant, headers: { 'if-match': '1' }, body: { colour: null } });
    expect(ok(up, 200).colour).toBeNull();
    const other = await kit.shop('Variant Other');
    expect((await call(server, 'GET', '/v1/items?q=POLO', { tenant: other.tenant })).json.items).toHaveLength(0);
  });
});
