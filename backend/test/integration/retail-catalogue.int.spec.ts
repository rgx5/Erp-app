import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, startServer, type TestServer } from '../support/harness.js';

let server: TestServer;
let tenant: string;
let other: string;

beforeAll(async () => { server = await startServer(); tenant = await createTenant(server, 'Retail Co'); other = await createTenant(server, 'Other Retail Co'); });
afterAll(async () => { await server.close(); });

const post = (path: string, body: object, who = tenant) => call(server, 'POST', path, { tenant: who, body });
const get = (path: string, who = tenant) => call(server, 'GET', path, { tenant: who });
const ok = (res: { status: number; json: unknown }, status = 201) => { expect(res.status, JSON.stringify(res.json)).toBe(status); return res.json as any; }; // eslint-disable-line

async function item(code: string, extra: object = {}, who = tenant) {
  const units = (await get('/v1/units?limit=200', who)).json.items as { id: string; code: string }[];
  const nos = units.find((u) => u.code === 'NOS') as { id: string };
  return ok(await post('/v1/items', { code, name: `Item ${code}`, itemType: 'trading_good', baseUomId: nos.id, ...extra }, who));
}

describe('categories, brand and MRP', () => {
  it('keeps a category tree with a no-discount rule, and puts category, brand and MRP on items', async () => {
    const food = ok(await post('/v1/item-categories', { code: 'FOOD', name: 'Food', noDiscount: false }));
    const staples = ok(await post('/v1/item-categories', { code: 'staples', name: 'Staples', parentId: food.id }));
    expect((await post('/v1/item-categories', { code: 'FOOD', name: 'again' })).status).toBe(409);
    const it = await item('RICE1', { categoryId: staples.id, brand: 'Golden', mrp: '120' });
    expect(it).toMatchObject({ categoryId: staples.id, brand: 'Golden', mrp: '120.0000' });
    const patched = ok(await call(server, 'PATCH', `/v1/items/${it.id}`, { tenant, headers: { 'if-match': String(it.version) }, body: { mrp: '125.5' } }), 200);
    expect(patched.mrp).toBe('125.5000');
    // a category cannot become its own ancestor
    const cyc = await call(server, 'PATCH', `/v1/item-categories/${food.id}`, { tenant, headers: { 'if-match': String(food.version) }, body: { parentId: staples.id } });
    expect(cyc.status).toBe(422);
    expect(cyc.json.code).toBe('category_cycle');
    // another business cannot attach its items to this category
    const stolen = await post('/v1/items', { code: 'X1', name: 'x', itemType: 'trading_good', baseUomId: (await get('/v1/units?limit=200', other)).json.items[0].id, categoryId: staples.id }, other);
    expect(stolen.status).toBeGreaterThanOrEqual(400);
  });
});

describe('barcodes and the counter lookup', () => {
  it('finds an item by barcode first, then by code; a barcode is unique and only switched on or off', async () => {
    const a = await item('SOAP1');
    const b = await item('SOAP2');
    const bc = ok(await post(`/v1/items/${a.id}/barcodes`, { barcode: '8901234567890' }));
    ok(await post(`/v1/items/${a.id}/barcodes`, { barcode: 'ALT-0001' }));
    const dup = await post(`/v1/items/${b.id}/barcodes`, { barcode: '8901234567890' });
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe('barcode_in_use');
    expect((await post(`/v1/items/${b.id}/barcodes`, { barcode: '8901234567890'.toLowerCase() })).status).toBe(409);
    expect((await post(`/v1/items/${b.id}/barcodes`, { barcode: 'ab' })).status).toBe(422);
    expect(ok(await get(`/v1/items/${a.id}/barcodes`), 200).items).toHaveLength(2);

    const byBarcode = ok(await get('/v1/items/lookup?code=8901234567890'), 200);
    expect(byBarcode).toMatchObject({ matchedBy: 'barcode', noDiscount: false });
    expect(byBarcode.item.id).toBe(a.id);
    expect(ok(await get('/v1/items/lookup?code=soap2'), 200)).toMatchObject({ matchedBy: 'code' });
    expect((await get('/v1/items/lookup?code=NOPE')).status).toBe(404);

    // switched off, the barcode stops resolving; the item is still found by its code
    ok(await post(`/v1/item-barcodes/${bc.id}/status`, { status: 'inactive' }), 200);
    expect((await get('/v1/items/lookup?code=8901234567890')).status).toBe(404);
    expect(ok(await get('/v1/items/lookup?code=SOAP1'), 200).matchedBy).toBe('code');
    // and cannot be re-used by another item while it exists (switching on again is allowed)
    expect((await post(`/v1/items/${b.id}/barcodes`, { barcode: '8901234567890' })).status).toBe(409);
  });

  it('reports the no-discount rule of an item\'s category or any ancestor', async () => {
    const root = ok(await post('/v1/item-categories', { code: 'LIQ', name: 'Liquor', noDiscount: true }));
    const child = ok(await post('/v1/item-categories', { code: 'WHISKY', name: 'Whisky', parentId: root.id }));
    const it = await item('JW1', { categoryId: child.id });
    expect(ok(await get('/v1/items/lookup?code=JW1'), 200).noDiscount).toBe(true);
    await item('PLAIN1');
    expect(ok(await get('/v1/items/lookup?code=PLAIN1'), 200).noDiscount).toBe(false);
    expect(it.categoryId).toBe(child.id);
  });

  it('does not leak barcodes across businesses', async () => {
    const mine = await item('PRIV1');
    ok(await post(`/v1/items/${mine.id}/barcodes`, { barcode: 'PRIVATE-9999' }));
    expect((await get('/v1/items/lookup?code=PRIVATE-9999', other)).status).toBe(404);
    const theirs = await item('PRIV1', {}, other);
    ok(await post(`/v1/items/${theirs.id}/barcodes`, { barcode: 'PRIVATE-9999' }, other)); // the same code is fine in another business
  });
});
