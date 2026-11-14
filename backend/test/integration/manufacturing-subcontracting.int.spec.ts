import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { plantKit, type Plant } from '../support/plant.js';
import { ok } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let k: ReturnType<typeof plantKit>;
beforeAll(async () => { server = await startServer(); k = plantKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

interface Jobwork extends Plant { jw: string; jwWh: string }
let seq = 0;

/** A plant with a job worker and a warehouse of kind subcontractor for their premises. */
async function jobwork(name: string): Promise<Jobwork> {
  const p = await k.plant(name);
  const jw = ok(await call(server, 'POST', '/v1/parties', { tenant: p.tenant, body: { code: `JW-${++seq}`, legalName: 'Cutters & Co', gstTreatment: 'unregistered', isSubcontractor: true } })).id as string;
  const loc = (await call(server, 'GET', `/v1/business-locations?companyId=${p.companyId}`, { tenant: p.tenant })).json.items[0].id as string;
  const jwWh = ok(await call(server, 'POST', '/v1/warehouses', { tenant: p.tenant, body: { businessLocationId: loc, code: `JW${seq}`, name: 'At Cutters', kind: 'subcontractor' } })).id as string;
  return { ...p, jw, jwWh };
}
const order = (p: Jobwork, o: object = {}) => call(server, 'POST', '/v1/manufacturing/subcontracting/orders', { tenant: p.tenant, body: { companyId: p.companyId, itemId: p.table, orderDate: '2025-04-10', plannedQuantity: '10', outputWarehouseId: p.wh, sourceWarehouseId: p.wh, subcontractorId: p.jw, jobWorkerWarehouseId: p.jwWh, ratePerUnit: '120', ...o } });
const act = (p: Plant, id: string, what: string, body: object = {}) => call(server, 'POST', `/v1/manufacturing/subcontracting/orders/${id}/${what}`, { tenant: p.tenant, body });
const net = async (p: Plant, code: string) => {
  const t = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${p.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: p.tenant })).json;
  expect(t.balanced).toBe(true);
  const r = t.rows.find((x: { code: string }) => x.code === code) as { closingDebit: string; closingCredit: string } | undefined;
  return r ? Math.round((Number(r.closingDebit) - Number(r.closingCredit)) * 10000) / 10000 : 0;
};
const onHand = async (p: Plant, itemId: string, warehouseId: string) => ((await call(server, 'GET', `/v1/stock/availability?companyId=${p.companyId}&itemId=${itemId}&warehouseId=${warehouseId}`, { tenant: p.tenant })).json.warehouses[0]?.onHand ?? '0') as string;
const recon = async (p: Plant, path: string) => (await call(server, 'GET', `/v1/${path}?companyId=${p.companyId}&asOf=2026-03-31`, { tenant: p.tenant })).json;
/** Cutting only: 4 wood and 8 screws per table, no routing of our own (the job worker does the work). */
const simpleBom = async (p: Plant) => ok(await call(server, 'POST', '/v1/manufacturing/boms', { tenant: p.tenant, body: { companyId: p.companyId, itemId: p.table, effectiveFrom: '2025-04-01', lines: [{ itemId: p.wood, quantity: '4' }, { itemId: p.screw, quantity: '8' }] } }));
const send = (p: Plant, id: string, lines: object[], o: object = {}) => act(p, id, 'send', { date: '2025-04-12', vehicleNo: 'MH12AB1234', lines, ...o });

describe('sending and receiving', () => {
  it('sends materials on a challan, takes the goods back, and costs them at materials plus the job-work charge', async () => {
    const p = await jobwork('Sc Flow Co');
    await simpleBom(p);
    const created = ok(await order(p));
    expect(created).toMatchObject({ status: 'open', ratePerUnit: '120.0000', subcontractorId: p.jw, jobworkerWarehouseId: p.jwWh, firstSentOn: null });
    expect(created.workOrder).toMatchObject({ woNo: 'WO/2526/000001', materialsWarehouseId: p.jwWh });
    expect((await send(p, created.id, [{ itemId: p.wood, quantity: '40' }])).json.code).toBe('not_live'); // release first
    ok(await act(p, created.id, 'release'), 200);
    const sent = ok(await send(p, created.id, [{ itemId: p.wood, quantity: '40' }, { itemId: p.screw, quantity: '80' }], { ewayBillNo: '281000000001' }), 200);
    expect(sent.firstSentOn).toBe('2025-04-12');
    expect(sent.returnDueDate).toBe('2026-04-12');
    expect(sent.challans).toHaveLength(1);
    expect(sent.challans[0]).toMatchObject({ challanNo: 'DC/2526/000001', kind: 'send', vehicleNo: 'MH12AB1234', ewayBillNo: '281000000001' });
    expect(sent.challans[0].lines).toHaveLength(2);
    // the goods are still ours: stock moved between warehouses, no ledger entry
    expect(await onHand(p, p.wood, p.jwWh)).toBe('40.000000');
    expect(await onHand(p, p.wood, p.wh)).toBe('60.000000');
    expect(await net(p, '1210')).toBe(5800);
    expect(sent.pending.map((x: { quantity: string }) => x.quantity)).toEqual(['40.000000', '80.000000']);
    // the job worker made 6 of 10 and bills 720
    const r1 = ok(await act(p, created.id, 'receive', { date: '2025-04-20', quantity: '6', scrapQuantity: '1' }), 200);
    expect(r1.workOrder).toMatchObject({ producedQuantity: '6.000000', scrapQuantity: '1.000000' });
    expect(r1.workOrder.cost).toMatchObject({ materials: '1296.0000', subcontract: '720.0000' }); // 24 wood x 50 + 48 screws x 2 = 1,296
    expect(r1.workOrder.cost.finishedGoods).toBe('2016.0000'); // 6 of 10 take the pool so far: (1,296 + 720)
    expect(await net(p, '5240')).toBe(-720); // the clearing account (where the bill was booked) is relieved
    expect(r1.pending.map((x: { quantity: string }) => x.quantity)).toEqual(['16.000000', '32.000000']);
    expect(await onHand(p, p.wood, p.jwWh)).toBe('16.000000');
    // the rest, and the order is complete with nothing stranded
    const r2 = ok(await act(p, created.id, 'receive', { date: '2025-04-25', quantity: '4' }), 200);
    expect(r2.workOrder.cost).toMatchObject({ materials: '2160.0000', subcontract: '1200.0000', finishedGoods: '3360.0000', wip: '0.0000' });
    expect(r2.pending).toEqual([expect.objectContaining({ quantity: '0.000000' }), expect.objectContaining({ quantity: '0.000000' })]);
    const done = ok(await act(p, created.id, 'complete', { date: '2025-04-26' }), 200);
    expect(done.status).toBe('closed');
    expect(done.workOrder.cost.residualCleared).toBe('0.0000');
    expect(await net(p, '1230')).toBe(0);
    expect((await recon(p, 'manufacturing/wip-reconciliation')).reconciled).toBe(true);
    expect((await recon(p, 'inventory/reconciliation')).reconciled).toBe(true);
    expect(await onHand(p, p.table, p.wh)).toBe('10.000000');
  });

  it('uses the materials the job worker reports (waste included) and a different charge', async () => {
    const p = await jobwork('Sc Actual Co');
    await simpleBom(p);
    const o = ok(await order(p));
    ok(await act(p, o.id, 'release'), 200);
    ok(await send(p, o.id, [{ itemId: p.wood, quantity: '45' }, { itemId: p.screw, quantity: '80' }]), 200);
    // 10 made, 44 wood used (4 wasted), charge 1,100 instead of 1,200
    const r = ok(await act(p, o.id, 'receive', { date: '2025-04-25', quantity: '10', chargeAmount: '1100', consumption: [{ itemId: p.wood, quantity: '44' }, { itemId: p.screw, quantity: '80' }] }), 200);
    expect(r.workOrder.cost).toMatchObject({ materials: '2360.0000', subcontract: '1100.0000', finishedGoods: '3460.0000', wip: '0.0000' }); // 44 x 50 + 160
    expect(r.pending[0]).toMatchObject({ quantity: '1.000000' });
    // the leftover wood comes back to the source warehouse at the cost it left at
    const back = ok(await act(p, o.id, 'return', { date: '2025-04-27', lines: [{ itemId: p.wood, quantity: '1' }] }), 200);
    expect(back.challans.map((c: { kind: string }) => c.kind)).toEqual(['send', 'return']);
    expect(await onHand(p, p.wood, p.jwWh)).toBe('0.000000');
    expect((await act(p, o.id, 'return', { date: '2025-04-27', lines: [{ itemId: p.wood, quantity: '1' }] })).json.code).toBe('return_exceeds_pending');
    expect((await recon(p, 'inventory/reconciliation')).reconciled).toBe(true);
    // the variance report shows the over-use and counts the agreed charge as planned
    const v = (await call(server, 'GET', `/v1/manufacturing/work-orders/${r.workOrder.id}/variance`, { tenant: p.tenant })).json;
    expect(v).toMatchObject({ subcontractCharges: '1100.0000' });
    expect(v.materials[0]).toMatchObject({ usageVariance: '200.0000' }); // 44 used against 40 required
  });

  it('reports materials that stay out too long', async () => {
    const p = await jobwork('Sc Overdue Co');
    await simpleBom(p);
    const o = ok(await order(p));
    ok(await act(p, o.id, 'release'), 200);
    ok(await send(p, o.id, [{ itemId: p.wood, quantity: '40' }]), 200);
    const at = async (asOf: string) => (await call(server, 'GET', `/v1/manufacturing/subcontracting/pending?companyId=${p.companyId}&asOf=${asOf}`, { tenant: p.tenant })).json;
    const soon = await at('2025-06-01');
    expect(soon.overdueCount).toBe(0);
    expect(soon.orders[0]).toMatchObject({ daysOut: 50, overdue: false, returnDueDate: '2026-04-12', items: [expect.objectContaining({ quantity: '40.000000' })] });
    const late = await at('2026-04-13');
    expect(late.overdueCount).toBe(1);
    expect(late.orders[0]).toMatchObject({ overdue: true, daysOut: 366 });
    ok(await act(p, o.id, 'return', { date: '2025-07-01', lines: [{ itemId: p.wood, quantity: '40' }] }), 200);
    expect((await at('2026-04-13')).orders).toHaveLength(0);
  });
});

describe('refusals', () => {
  it('rejects what makes no sense, leaving nothing behind', async () => {
    const p = await jobwork('Sc Bad Co');
    await simpleBom(p);
    const other = await jobwork('Sc Bad Other');
    expect((await order(p, { subcontractorId: p.cust.local })).status).toBe(422); // a customer, not a job worker
    expect((await order(p, { jobWorkerWarehouseId: p.wh })).status).toBe(422); // not a subcontractor warehouse
    expect((await order(p, { sourceWarehouseId: p.jwWh })).status).toBe(422);
    expect((await order(p, { jobWorkerWarehouseId: other.jwWh })).status).toBe(422); // another tenant's
    expect((await order(p, { ratePerUnit: '-1' })).status).toBe(422);
    const o = ok(await order(p));
    ok(await act(p, o.id, 'release'), 200);
    expect((await send(p, o.id, [{ itemId: p.top, quantity: '1' }])).status).toBe(422); // not a material
    expect((await send(p, o.id, [{ itemId: p.wood, quantity: '5000' }])).json.code).toBe('insufficient_stock');
    expect((await act(p, o.id, 'receive', { date: '2025-04-20', quantity: '1' })).json.code).toBe('consumption_exceeds_pending'); // nothing was sent
    ok(await send(p, o.id, [{ itemId: p.wood, quantity: '4' }, { itemId: p.screw, quantity: '8' }]), 200);
    expect((await act(p, o.id, 'receive', { date: '2025-04-20', quantity: '2' })).json.code).toBe('consumption_exceeds_pending'); // one table's worth was sent, two made
    expect((await act(p, o.id, 'cancel')).json.code).toBe('has_challans');
    expect(await net(p, '1230')).toBe(0);
    expect((await call(server, 'GET', `/v1/manufacturing/subcontracting/orders/${o.id}`, { tenant: p.tenant })).json.challans).toHaveLength(1); // the refused sends left no challan
    const cancelled = ok(await order(p));
    expect(ok(await act(p, cancelled.id, 'cancel'), 200).status).toBe('cancelled');
    expect((await act(p, cancelled.id, 'release')).json.code).toBe('order_closed');
  });

  it('says exactly which accounts are missing', async () => {
    const p = await jobwork('Sc Cfg Co');
    await simpleBom(p);
    ok(await call(server, 'PUT', `/v1/manufacturing/companies/${p.companyId}/settings`, { tenant: p.tenant, body: { subcontractClearingAccountId: null } }), 200);
    const o = ok(await order(p));
    ok(await act(p, o.id, 'release'), 200);
    ok(await send(p, o.id, [{ itemId: p.wood, quantity: '4' }, { itemId: p.screw, quantity: '8' }]), 200);
    const r = await act(p, o.id, 'receive', { date: '2025-04-20', quantity: '1' });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'manufacturing_accounts_not_configured', missing: ['subcontractClearingAccountId'] });
    expect((await onHand(p, p.wood, p.jwWh))).toBe('4.000000'); // nothing was consumed
    expect((await call(server, 'GET', `/v1/manufacturing/work-orders/${o.workOrder.id}`, { tenant: p.tenant })).json.transactions).toHaveLength(0);
  });
});

describe('guards and access', () => {
  it('keeps challans immutable in the database', async () => {
    const p = await jobwork('Sc Guard Co');
    await simpleBom(p);
    const o = ok(await order(p));
    ok(await act(p, o.id, 'release'), 200);
    const s = ok(await send(p, o.id, [{ itemId: p.wood, quantity: '4' }]), 200);
    const bad = (sql: string, params: unknown[] = []) => expect(supers.query(sql, params)).rejects.toMatchObject({ code: '55000' });
    await bad("UPDATE erp.subcontract_challans SET challan_no = 'X' WHERE id = $1", [s.challans[0].id]);
    await bad('DELETE FROM erp.subcontract_challan_lines WHERE challan_id = $1', [s.challans[0].id]);
    await bad('UPDATE erp.subcontract_orders SET rate_per_unit = 1 WHERE id = $1', [o.id]);
    await bad("UPDATE erp.subcontract_orders SET first_sent_on = '2025-01-01' WHERE id = $1", [o.id]); // set once
    await bad('DELETE FROM erp.subcontract_orders WHERE id = $1', [o.id]);
  });

  it('separates reading, producing and cancelling, and keeps tenants apart', async () => {
    const p = await jobwork('Sc Access Co');
    await simpleBom(p);
    const o = ok(await order(p));
    const key = async (permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: p.tenant, body: { name: 'k', permissions } })).json.key as string;
    const reader = await key(['manufacturing:read']);
    expect((await call(server, 'GET', `/v1/manufacturing/subcontracting/orders/${o.id}`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', `/v1/manufacturing/subcontracting/orders/${o.id}/send`, { token: reader, body: {} })).status).toBe(403);
    const maker = await key(['manufacturing:produce']);
    expect((await call(server, 'POST', `/v1/manufacturing/subcontracting/orders/${o.id}/cancel`, { token: maker, body: {} })).status).toBe(403);
    const other = await jobwork('Sc Access Other');
    expect((await call(server, 'GET', `/v1/manufacturing/subcontracting/orders/${o.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await act(other, o.id, 'release')).status).toBe(404);
    expect((await call(server, 'GET', `/v1/manufacturing/subcontracting/orders?companyId=${other.companyId}`, { tenant: other.tenant })).json.items).toHaveLength(0);
  });
});
