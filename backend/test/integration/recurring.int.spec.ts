import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';
import { nextOccurrence } from '../../src/modules/sales/recurring.service.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

type S = Awaited<ReturnType<typeof kit.shop>>;
const make = (s: S, o: object = {}, lines?: object[]) => call(server, 'POST', '/v1/sales/recurring-invoices', { tenant: s.tenant, headers: { 'idempotency-key': crypto.randomUUID() }, body: { companyId: s.companyId, gstRegistrationId: s.regId, customerId: s.cust.local, name: 'Shop rent', frequency: 'monthly', startDate: '2025-05-31', lines: lines ?? [{ itemId: s.item.service, quantity: '1', unitPrice: '5000' }], ...o } });
const runDue = (s: S, asOf: string) => call(server, 'POST', '/v1/sales/recurring-invoices/run-due', { tenant: s.tenant, body: { companyId: s.companyId, asOf } });
const get = async (s: S, id: string) => (await call(server, 'GET', `/v1/sales/recurring-invoices/${id}`, { tenant: s.tenant })).json;

describe('schedule arithmetic', () => {
  it('keeps the start day, shortening it in short months', () => {
    expect(nextOccurrence('2025-01-31', 'monthly', 31)).toBe('2025-02-28');
    expect(nextOccurrence('2025-02-28', 'monthly', 31)).toBe('2025-03-31');
    expect(nextOccurrence('2024-02-29', 'yearly', 29)).toBe('2025-02-28');
    expect(nextOccurrence('2025-03-31', 'quarterly', 31)).toBe('2025-06-30');
    expect(nextOccurrence('2025-04-10', 'half_yearly', 10)).toBe('2025-10-10');
    expect(nextOccurrence('2025-04-10', 'weekly', 10)).toBe('2025-04-17');
  });
});

describe('recurring invoices', () => {
  it('posts each due occurrence as a real invoice, catches up on missed ones, and never posts twice', async () => {
    const s = await kit.shop('Recurring Co');
    const r = ok(await make(s));
    expect(r).toMatchObject({ status: 'active', nextRunDate: '2025-05-31', anchorDay: 31, runCount: 0 });
    expect((await runDue(s, '2025-05-30')).json.generated).toHaveLength(0); // not due yet
    const out = ok(await runDue(s, '2025-08-31'), 200);
    expect(out.generated.map((g: { date: string }) => g.date)).toEqual(['2025-05-31', '2025-06-30', '2025-07-31', '2025-08-31']);
    expect(out.failed).toHaveLength(0);
    const after = await get(s, r.id);
    expect(after).toMatchObject({ nextRunDate: '2025-09-30', lastRunDate: '2025-08-31', runCount: 4, status: 'active' });
    expect(after.runs).toHaveLength(4);
    expect((await runDue(s, '2025-08-31')).json.generated).toHaveLength(0); // running again posts nothing new
    const inv = (await call(server, 'GET', `/v1/sales/invoices?companyId=${s.companyId}`, { tenant: s.tenant })).json.items as { invoiceDate: string; grandTotal: string }[];
    expect(inv).toHaveLength(4); expect(inv.every((i) => i.grandTotal === '5900.0000')).toBe(true); // 5000 + 18% GST
    const tb = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: s.tenant })).json;
    expect(tb.balanced).toBe(true);
  });

  it('pauses, resumes and ends, and ends by itself after its end date', async () => {
    const s = await kit.shop('Recurring Pause Co');
    const r = ok(await make(s, { startDate: '2025-05-10', endDate: '2025-07-10' }));
    ok(await call(server, 'POST', `/v1/sales/recurring-invoices/${r.id}/pause`, { tenant: s.tenant }), 200);
    expect((await runDue(s, '2025-09-01')).json.generated).toHaveLength(0);
    ok(await call(server, 'POST', `/v1/sales/recurring-invoices/${r.id}/resume`, { tenant: s.tenant }), 200);
    expect((await runDue(s, '2025-09-01')).json.generated).toHaveLength(3); // 05-10, 06-10, 07-10, then past its end date
    expect((await get(s, r.id)).status).toBe('ended');
    expect((await call(server, 'POST', `/v1/sales/recurring-invoices/${r.id}/resume`, { tenant: s.tenant })).json.code).toBe('already_ended');
    const manual = ok(await make(s, { startDate: '2025-06-01' }));
    ok(await call(server, 'POST', `/v1/sales/recurring-invoices/${manual.id}/end`, { tenant: s.tenant }), 200);
    expect((await runDue(s, '2025-09-01')).json.generated).toHaveLength(0);
  });

  it('keeps a failing schedule due with the reason, without blocking the others', async () => {
    const s = await kit.shop('Recurring Fail Co');
    const goods = ok(await make(s, { name: 'Too many widgets' }, [{ itemId: s.item.widget, quantity: '100000', unitPrice: '10', warehouseId: s.wh }]));
    const fine = ok(await make(s, { name: 'Rent' }));
    const out = ok(await runDue(s, '2025-05-31'), 200);
    expect(out.generated).toHaveLength(1); expect(out.generated[0].recurringId).toBe(fine.id);
    expect(out.failed).toHaveLength(1); expect(out.failed[0]).toMatchObject({ recurringId: goods.id, date: '2025-05-31' });
    const g = await get(s, goods.id);
    expect(g).toMatchObject({ status: 'active', nextRunDate: '2025-05-31', runCount: 0 }); expect(g.lastError).toBeTruthy();
    expect(g.runs[0]).toMatchObject({ status: 'failed' });
  });

  it('validates the template up front and keeps businesses apart', async () => {
    const s = await kit.shop('Recurring Val Co'); const other = await kit.shop('Recurring Other Co');
    expect((await make(s, {}, [{ itemId: s.item.widget, quantity: '1', unitPrice: '10' }])).status).toBe(422); // stocked, no warehouse
    expect((await make(s, { endDate: '2025-01-01' })).status).toBe(422);
    const r = ok(await make(s));
    expect((await call(server, 'GET', `/v1/sales/recurring-invoices/${r.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/sales/recurring-invoices?companyId=${other.companyId}`, { tenant: other.tenant })).json.items).toHaveLength(0);
  });
});
