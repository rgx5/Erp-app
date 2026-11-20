import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const put = (s: Shop, path: string, body: object) => call(server, 'PUT', `/v1/pos/${path}?companyId=${s.companyId}`, { tenant: s.tenant, body });
async function counter(name: string) {
  const s = await kit.shop(name);
  ok(await put(s, 'settings', { walkInCustomerId: s.cust.consumer, cashVarianceAccountId: s.acc['5900'] }), 200);
  for (const [method, code] of [['cash', '1110'], ['card', '1120'], ['upi', '1120']] as const) ok(await put(s, 'payment-accounts', { method, accountId: s.acc[code] }), 200);
  const loc = (await call(server, 'GET', `/v1/business-locations?companyId=${s.companyId}`, { tenant: s.tenant })).json.items[0].id as string;
  const terminal = ok(await call(server, 'POST', '/v1/pos/terminals', { tenant: s.tenant, body: { companyId: s.companyId, code: 'T1', name: 'Till 1', gstRegistrationId: s.regId, businessLocationId: loc, warehouseId: s.wh } })).id as string;
  const shift = ok(await call(server, 'POST', '/v1/pos/shifts', { tenant: s.tenant, body: { terminalId: terminal, openingCash: '500', date: '2025-04-10' } })).id as string;
  return { ...s, terminal, shift };
}

describe('sales analysis and day-end reports', () => {
  it('groups sales by item, nets a return, shows profit, and summarises the day by payment mode', async () => {
    const c = await counter('Report Co');
    const sale = (lines: object[], payments: object[]) => call(server, 'POST', '/v1/pos/sales', { tenant: c.tenant, body: { shiftId: c.shift, date: '2025-04-10', lines, payments } });
    ok(await sale([{ itemId: c.item.widget, quantity: '2', unitPrice: '118' }, { itemId: c.item.cheap, quantity: '1', unitPrice: '105' }], [{ method: 'cash', amount: '341', tendered: '341' }]));
    ok(await sale([{ itemId: c.item.widget, quantity: '1', unitPrice: '118' }], [{ method: 'upi', amount: '118' }]));
    const q = `companyId=${c.companyId}&from=2025-04-01&to=2025-04-30`;
    const byItem = (await call(server, 'GET', `/v1/reports/sales?${q}&groupBy=item`, { tenant: c.tenant })).json;
    const widget = byItem.rows.find((r: { label: string }) => r.label.startsWith('WIDGET-1'));
    expect(widget).toMatchObject({ quantity: '3.000000', net: '300.0000' });
    expect(widget).toMatchObject({ cost: '1200.0000', profit: '-900.00' }); // profit is sales less the cost the stock carried
    expect(Number(byItem.totals.net)).toBeCloseTo(400, 2);
    const byDay = (await call(server, 'GET', `/v1/reports/sales?${q}&groupBy=day`, { tenant: c.tenant })).json;
    expect(byDay.rows).toHaveLength(1);
    expect(byDay.rows[0].label).toBe('2025-04-10');
    const byCashier = (await call(server, 'GET', `/v1/reports/sales?${q}&groupBy=cashier`, { tenant: c.tenant })).json;
    expect(byCashier.rows[0].label).not.toBe('Back office');
    expect((await call(server, 'GET', `/v1/reports/sales?companyId=${c.companyId}&from=2025-05-01&to=2025-04-01`, { tenant: c.tenant })).status).toBe(422);

    const day = (await call(server, 'GET', `/v1/reports/day-end?companyId=${c.companyId}&date=2025-04-10`, { tenant: c.tenant })).json;
    expect(day.sales.bills).toBe(2);
    expect(Number(day.sales.total)).toBeCloseTo(459, 2);
    expect(day.byPaymentMode).toEqual(expect.arrayContaining([{ method: 'cash', amount: '341.00' }, { method: 'upi', amount: '118.00' }]));
    expect(day.shifts).toHaveLength(1);
    expect(day.topItems[0].label).toContain('WIDGET-1');
    const empty = (await call(server, 'GET', `/v1/reports/day-end?companyId=${c.companyId}&date=2025-04-11`, { tenant: c.tenant })).json;
    expect(empty.sales.bills).toBe(0);
  });

  it('keeps one business out of another business report', async () => {
    const a = await counter('Report Iso A'); const b = await kit.shop('Report Iso B');
    ok(await call(server, 'POST', '/v1/pos/sales', { tenant: a.tenant, body: { shiftId: a.shift, date: '2025-04-10', lines: [{ itemId: a.item.widget, quantity: '1', unitPrice: '118' }], payments: [{ method: 'cash', amount: '118', tendered: '118' }] } }));
    const r = (await call(server, 'GET', `/v1/reports/sales?companyId=${b.companyId}&from=2025-04-01&to=2025-04-30`, { tenant: b.tenant })).json;
    expect(r.rows).toHaveLength(0);
    expect((await call(server, 'GET', `/v1/reports/sales?companyId=${a.companyId}&from=2025-04-01&to=2025-04-30`, { tenant: b.tenant })).json.rows).toHaveLength(0);
  });
});
