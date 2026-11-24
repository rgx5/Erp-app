import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

type S = Awaited<ReturnType<typeof kit.shop>>;
const sale = async (s: S, customerId: string, o: object = {}) => ok(await call(server, 'POST', '/v1/sales/invoices', { tenant: s.tenant, body: { companyId: s.companyId, gstRegistrationId: s.regId, invoiceDate: '2025-04-10', customerId, lines: [{ itemId: s.item.widget, quantity: '2', unitPrice: '1000', warehouseId: s.wh }], ...o } })) as { id: string; invoiceNo: string; lines: { id: string }[] };
const irnOf = async (s: S, inv: { invoiceNo: string }) => {
  const g = (await supers.query('SELECT gstin FROM erp.gst_registrations WHERE id = $1', [s.regId])).rows[0].gstin as string;
  return createHash('sha256').update(`${g}2025-26INV${inv.invoiceNo}`).digest('hex');
};
const get = (s: S, path: string) => call(server, 'GET', path, { tenant: s.tenant });
const post = (s: S, path: string, body: object = {}) => call(server, 'POST', path, { tenant: s.tenant, body });

describe('e-invoice (file based)', () => {
  it('prepares the portal file, takes the reply back by IRN, and keeps an invoice with an IRN from being cancelled', async () => {
    const s = await kit.shop('EInv Co');
    const inv = await sale(s, s.cust.local); const inv2 = await sale(s, s.cust.other);
    const consumer = await sale(s, s.cust.consumer);

    const st = ok(await get(s, `/v1/einvoice/invoices/${inv.id}`), 200);
    expect(st).toMatchObject({ applicable: true, canFile: true, record: null }); expect(st.irn).toBe(await irnOf(s, inv));
    expect(ok(await get(s, `/v1/einvoice/invoices/${consumer.id}`), 200)).toMatchObject({ applicable: false, canFile: false }); // a sale to a consumer needs none

    const pending = ok(await get(s, '/v1/einvoice/pending'), 200).items as { id: string }[];
    expect(pending.map((p) => p.id).sort()).toEqual([inv.id, inv2.id].sort());

    // the file: both invoices, in the portal's layout; the consumer sale is refused on its own
    const file = ok(await post(s, '/v1/einvoice/file', { invoiceIds: [inv.id, inv2.id] }), 200);
    expect(file.invoices).toHaveLength(2); expect(file.skipped).toEqual([]);
    expect(file.invoices[0]).toMatchObject({ Version: '1.1', DocDtls: { Typ: 'INV', No: inv.invoiceNo, Dt: '10/04/2025' }, BuyerDtls: { Pin: 400001 }, ValDtls: { AssVal: 2000 } });
    expect(file.invoices[1].BuyerDtls).toMatchObject({ Stcd: '29', Pos: '29' }); expect(file.invoices[1].ValDtls.IgstVal).toBe(360);
    const mixed = ok(await post(s, '/v1/einvoice/file', { invoiceIds: [inv.id, consumer.id] }), 200);
    expect(mixed.invoices).toHaveLength(1); expect(mixed.skipped[0]).toMatchObject({ invoiceNo: consumer.invoiceNo });
    expect((await post(s, '/v1/einvoice/file', { invoiceIds: [consumer.id] })).status).toBe(422);

    // the portal's reply: matched by the IRN worked out from the invoice, not by trust in the number
    const irn = await irnOf(s, inv);
    const reply = ok(await post(s, '/v1/einvoice/reply', { items: [
      { irn, ackNo: 112010012345678, ackDate: '2025-04-10 14:20:05', signedQr: 'eyJhbGciOiJSUzI1NiJ9.QR', docNo: inv.invoiceNo },
      { irn: 'f'.repeat(64), ackNo: '1', ackDate: '2025-04-10 14:20:05', signedQr: 'eyJ.x', docNo: inv2.invoiceNo }, // not this invoice's IRN
      { irn: 'nope', ackNo: '1' },
    ] }), 200);
    expect(reply.outcomes.map((o: { result: string }) => o.result)).toEqual(['recorded', 'unmatched', 'invalid']);
    const rec = ok(await get(s, `/v1/einvoice/invoices/${inv.id}`), 200);
    expect(rec.record).toMatchObject({ irn, ackNo: '112010012345678', status: 'active', signedQr: 'eyJhbGciOiJSUzI1NiJ9.QR' });
    expect(rec.record.ackDate).toBe('2025-04-10T08:50:05.000Z'); // the portal's time is Indian time
    expect(ok(await post(s, '/v1/einvoice/reply', { items: [{ irn, ackNo: '1', ackDate: '2025-04-10 14:20:05', signedQr: 'x.y', docNo: inv.invoiceNo }] }), 200).outcomes[0].result).toBe('already_recorded');
    expect((ok(await get(s, '/v1/einvoice/pending'), 200).items as { id: string }[]).map((p) => p.id)).toEqual([inv2.id]);

    // typed in by hand: only the right IRN is accepted
    expect((await post(s, `/v1/einvoice/invoices/${inv2.id}/record`, { irn, ackNo: '5', ackDate: '2025-04-10 14:20:05', signedQr: 'eyJ.manualqr' })).status).toBe(422);
    ok(await post(s, `/v1/einvoice/invoices/${inv2.id}/record`, { irn: await irnOf(s, inv2), ackNo: '5', ackDate: '2025-04-10 14:20:05', signedQr: 'eyJ.manualqr' }));
    expect((await post(s, `/v1/einvoice/invoices/${inv2.id}/record`, { irn: await irnOf(s, inv2), ackNo: '5', ackDate: '2025-04-10 14:20:05', signedQr: 'eyJ.manualqr' })).status).toBe(409);

    // the invoice cannot be cancelled while its IRN is live; once the IRN is cancelled it can, and a fresh IRN may be recorded later
    const cancelBody = { cancelDate: '2025-04-10', reason: 'Wrong buyer' };
    const refused = await post(s, `/v1/sales/invoices/${inv.id}/cancel`, cancelBody);
    expect(refused.status).toBe(409); expect(refused.json.code).toBe('einvoice_active');
    ok(await post(s, `/v1/einvoice/invoices/${inv.id}/cancel`, { reason: 'Wrong buyer' }), 200);
    ok(await post(s, `/v1/sales/invoices/${inv.id}/cancel`, cancelBody), 200);
    expect((await post(s, `/v1/einvoice/invoices/${inv.id}/cancel`, { reason: 'again' })).status).toBe(404);
    expect((await post(s, `/v1/einvoice/invoices/${inv.id}/record`, { irn, ackNo: '9', ackDate: '2025-04-10 14:20:05', signedQr: 'a.b.c.d.e.f' })).status).toBe(409); // a cancelled invoice takes no new IRN
    expect(((await supers.query("SELECT count(*)::int AS n FROM erp.audit_log WHERE tenant_id = $1 AND action LIKE 'einvoice.%'", [s.tenant])).rows[0].n)).toBeGreaterThanOrEqual(4);
  });

  it('files an export and a note, and reports what is missing instead of making a bad file', async () => {
    const s = await kit.shop('EInv Missing Co');
    // the SEZ customer has an address; the overseas one has none, and a customer without PIN cannot be filed
    const sez = await sale(s, s.cust.sez, { taxPayment: 'with_payment' });
    const f = ok(await post(s, '/v1/einvoice/file', { invoiceIds: [sez.id] }), 200);
    expect(f.invoices[0].TranDtls.SupTyp).toBe('SEZWP');
    const noAddr = ok(await post(s, '/v1/parties', { code: 'NOADDR', legalName: 'No Address Ltd', gstTreatment: 'registered_regular', gstin: (await import('../support/harness.js')).makeGstin('27', 'ZZZZZ9999Z'), isCustomer: true })).id as string;
    const bad = await sale(s, noAddr);
    const st = ok(await get(s, `/v1/einvoice/invoices/${bad.id}`), 200);
    expect(st.canFile).toBe(false); expect(st.issues.map((i: { field: string }) => i.field)).toEqual(expect.arrayContaining(['buyer.address', 'buyer.pincode']));
    const refused = await post(s, '/v1/einvoice/file', { invoiceIds: [bad.id] });
    expect(refused.status).toBe(422); expect(refused.json.skipped[0].issues.length).toBeGreaterThan(0);
    // a credit note against the SEZ invoice is a CRN carrying the original's number
    const note = ok(await post(s, '/v1/sales/credit-notes', { noteDate: '2025-04-12', originalInvoiceId: sez.id, reason: 'Returned', lines: [{ originalLineId: sez.lines[0]?.id, quantity: '1' }] })) as { id: string };
    const nf = ok(await post(s, '/v1/einvoice/file', { invoiceIds: [note.id] }), 200);
    expect(nf.invoices[0]).toMatchObject({ DocDtls: { Typ: 'CRN' }, PrecDocDtls: [{ InvNo: sez.invoiceNo }] });
  });
});

describe('e-way bill (file based)', () => {
  it('checks the transport, makes the bulk file, records the number the portal gave and replaces it on re-issue', async () => {
    const s = await kit.shop('Eway Co');
    const inv = await sale(s, s.cust.other, { lines: [{ itemId: s.item.widget, quantity: '60', unitPrice: '1000', warehouseId: s.wh }] });
    const t = { mode: 'road', distanceKm: 850, vehicleNo: 'MH12AB1234' };
    expect((await post(s, `/v1/eway/invoices/${inv.id}/file`, { ...t, distanceKm: 5000 })).status).toBe(422); // schema: distance over 4000
    const noVehicle = await post(s, `/v1/eway/invoices/${inv.id}/file`, { mode: 'road', distanceKm: 100 });
    expect(noVehicle.status).toBe(422); expect(noVehicle.json.issues.map((i: { field: string }) => i.field)).toContain('vehicle');
    const file = ok(await post(s, `/v1/eway/invoices/${inv.id}/file`, t), 200);
    expect(file.json.billLists[0]).toMatchObject({ docNo: inv.invoiceNo, fromPincode: 400001, toPincode: 560001, vehicleNo: 'MH12AB1234', transDistance: '850', totalValue: 60000 });

    const rec = { billNo: '271012345678', billDate: '2025-04-10 16:00:00', validUntil: '2025-04-14 23:59:00', transportMode: 'road', distanceKm: 850, vehicleNo: 'MH 12 AB 1234' };
    expect((await post(s, `/v1/eway/invoices/${inv.id}/record`, { ...rec, billNo: '123' })).status).toBe(422);
    ok(await post(s, `/v1/eway/invoices/${inv.id}/record`, rec));
    expect((await post(s, `/v1/eway/invoices/${inv.id}/record`, rec)).status).toBe(409); // that number is already recorded
    let st = ok(await get(s, `/v1/einvoice/invoices/${inv.id}`), 200);
    expect(st.eway).toHaveLength(1); expect(st.eway[0]).toMatchObject({ billNo: '271012345678', status: 'active', vehicleNo: 'MH12AB1234' });
    ok(await post(s, `/v1/eway/invoices/${inv.id}/record`, { ...rec, billNo: '271099999999', vehicleNo: 'MH14CD5678' })); // new vehicle: the old bill is superseded
    st = ok(await get(s, `/v1/einvoice/invoices/${inv.id}`), 200);
    expect(st.eway.map((e: { billNo: string; status: string }) => `${e.billNo}:${e.status}`).sort()).toEqual(['271012345678:cancelled', '271099999999:active']);
    ok(await post(s, `/v1/eway/invoices/${inv.id}/cancel`), 200);
    expect((await post(s, `/v1/eway/invoices/${inv.id}/cancel`)).status).toBe(404);
  });
});

describe('e-invoice security', () => {
  it('keeps one business out of another, and needs a sign-in', async () => {
    const s = await kit.shop('EInv A Co'); const o = await kit.shop('EInv B Co');
    const inv = await sale(s, s.cust.local);
    expect((await get(o, `/v1/einvoice/invoices/${inv.id}`)).status).toBe(404);
    expect((await post(o, '/v1/einvoice/file', { invoiceIds: [inv.id] })).status).toBe(404);
    expect((await post(o, `/v1/einvoice/invoices/${inv.id}/cancel`, { reason: 'try it' })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/einvoice/invoices/${inv.id}`)).status).toBe(401);
    expect((await call(server, 'POST', '/v1/einvoice/file', { body: { invoiceIds: [inv.id] } })).status).toBe(401);
    expect((ok(await get(o, '/v1/einvoice/pending'), 200).items as unknown[])).toHaveLength(0);
  });
});
