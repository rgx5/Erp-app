import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

// a real 1x1 PNG and a minimal PDF
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
type S = Awaited<ReturnType<typeof kit.shop>>;
const add = (s: S, body: object) => call(server, 'POST', '/v1/attachments', { tenant: s.tenant, body });
const photo = (s: S, o: object = {}) => ({ entityType: 'item', entityId: s.item.widget, kind: 'photo', filename: 'widget.png', contentType: 'image/png', dataBase64: PNG.toString('base64'), ...o });

describe('attachments', () => {
  it('stores a photo and a file on records, returns them byte for byte, and keeps one photo per item', async () => {
    const s = await kit.shop('Attach Co');
    const a = ok(await add(s, photo(s)));
    expect(a).toMatchObject({ kind: 'photo', filename: 'widget.png', contentType: 'image/png', sizeBytes: PNG.length });
    const second = ok(await add(s, photo(s, { filename: 'new.png' })));
    const list = (await call(server, 'GET', `/v1/attachments?entityType=item&entityId=${s.item.widget}`, { tenant: s.tenant })).json.items as { id: string; filename: string }[];
    expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ id: second.id, filename: 'new.png' }); // the new photo replaced the old
    const bill = ok(await add(s, { entityType: 'party', entityId: s.cust.local, kind: 'file', filename: 'agreement.pdf', contentType: 'application/pdf', dataBase64: PDF.toString('base64') }));
    const raw = await call(server, 'GET', `/v1/attachments/${bill.id}/content`, { tenant: s.tenant });
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-type')).toContain('application/pdf');
    const stored = await supers.query("SELECT encode(sha256(data), 'hex') AS h, sha256 FROM erp.attachments WHERE id = $1", [bill.id]);
    expect(stored.rows[0].h).toBe(stored.rows[0].sha256); // what is stored is what was recorded
    expect(stored.rows[0].h).toBe((await import('node:crypto')).createHash('sha256').update(PDF).digest('hex')); // and it is the file that was sent
    ok(await call(server, 'DELETE', `/v1/attachments/${bill.id}`, { tenant: s.tenant }), 200);
    expect((await call(server, 'GET', `/v1/attachments/${bill.id}/content`, { tenant: s.tenant })).status).toBe(404);
  });

  it('refuses what is not what it claims, too large, unknown records and other businesses', async () => {
    const s = await kit.shop('Attach Refuse Co'); const other = await kit.shop('Attach Other Co');
    expect((await add(s, photo(s, { contentType: 'application/pdf' }))).status).toBe(422); // PNG bytes, claimed PDF
    expect((await add(s, photo(s, { dataBase64: Buffer.from('not an image at all').toString('base64') }))).status).toBe(422);
    expect((await add(s, photo(s, { kind: 'photo', contentType: 'application/pdf', dataBase64: PDF.toString('base64') }))).status).toBe(422); // a photo must be an image
    expect((await add(s, photo(s, { entityId: '01a1f6f5-0000-7000-8000-000000000001' }))).status).toBe(404);
    expect((await add(s, photo(s, { entityType: 'journal_entry' }))).status).toBe(422);
    const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
    expect((await add(s, photo(s, { dataBase64: big.toString('base64') }))).status).toBe(413);
    // another business cannot read, list, or attach to this business's records
    const mine = ok(await add(s, photo(s)));
    expect((await call(server, 'GET', `/v1/attachments/${mine.id}/content`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/attachments?entityType=item&entityId=${s.item.widget}`, { tenant: other.tenant })).json.items).toHaveLength(0);
    expect((await add(other, photo(other, { entityId: s.item.widget }))).status).toBe(404);
    expect((await call(server, 'DELETE', `/v1/attachments/${mine.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/attachments?entityType=item&entityId=${s.item.widget}`)).status).toBe(401);
  });
});
