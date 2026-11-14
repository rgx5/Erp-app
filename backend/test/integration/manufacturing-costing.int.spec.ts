import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { plantKit, type Plant } from '../support/plant.js';
import { ok } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let k: ReturnType<typeof plantKit>;
beforeAll(async () => { server = await startServer(); k = plantKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const wo = async (p: Plant, o: object = {}) => ok(await call(server, 'POST', '/v1/manufacturing/work-orders', { tenant: p.tenant, body: { companyId: p.companyId, itemId: p.table, orderDate: '2025-04-10', plannedQuantity: '10', outputWarehouseId: p.wh, materialsWarehouseId: p.wh, ...o } }));
const act = (p: Plant, id: string, what: string, body: object = {}) => call(server, 'POST', `/v1/manufacturing/work-orders/${id}/${what}`, { tenant: p.tenant, body });
const variance = async (p: Plant, id: string) => (await call(server, 'GET', `/v1/manufacturing/work-orders/${id}/variance`, { tenant: p.tenant })).json;
const rollup = async (p: Plant, itemId: string, quantity: string, date = '2025-06-01') => (await call(server, 'GET', `/v1/manufacturing/costing/rollup?companyId=${p.companyId}&itemId=${itemId}&quantity=${quantity}&date=${date}`, { tenant: p.tenant })).json;

describe('cost roll-up', () => {
  it('prices an item from current stock costs and work-centre rates, level by level', async () => {
    const p = await k.plant('Roll Co');
    // top: 3 wood per 2 tops; table: 1 top + 8 screws (5% scrap) and the standard routing
    ok(await call(server, 'POST', '/v1/manufacturing/boms', { tenant: p.tenant, body: { companyId: p.companyId, itemId: p.top, baseQuantity: '2', effectiveFrom: '2025-04-01', lines: [{ itemId: p.wood, quantity: '3' }], operations: [{ opNo: 10, name: 'Plane', workCentreId: p.wc.cut, runHours: '1' }] } }));
    ok(await call(server, 'POST', '/v1/manufacturing/boms', { tenant: p.tenant, body: { companyId: p.companyId, itemId: p.table, effectiveFrom: '2025-04-01', lines: [{ itemId: p.top, quantity: '1' }, { itemId: p.screw, quantity: '8', scrapPercent: '5' }], operations: [{ opNo: 10, name: 'Assemble', workCentreId: p.wc.assemble, setupHours: '0.5', runHours: '1' }] } }));
    const r = await rollup(p, p.table, '10');
    // 10 tables: 10 tops (15 wood at 50 = 750) + 84.210526 screws at 2 = 168.4211 ; plane 5 h (labour 600 + 375) ; assemble 10.5 h (945 + 787.50)
    expect(r).toMatchObject({ material: '918.4211', labour: '1545.0000', overhead: '1162.5000', total: '3625.9211', unitCost: '362.592110', complete: true, itemsWithoutCost: [] });
    expect(r.tree.map((n: { itemCode: string; source: string; value: string }) => [n.itemCode.split('-')[0], n.source, n.value])).toEqual([['TOP', 'bom', '1725.0000'], ['SCREW', 'stock', '168.4211']]); // the top includes its own planing: 750 + 975
    expect(r.tree[0].children[0]).toMatchObject({ source: 'stock', quantity: '15.000000', unitCost: '50.000000' });
    // changing a rate changes tomorrow's roll-up, not the structure
    ok(await call(server, 'PATCH', `/v1/manufacturing/work-centres/${p.wc.assemble}`, { tenant: p.tenant, body: { labourRatePerHour: '190' } }), 200);
    expect((await rollup(p, p.table, '10')).labour).toBe('2595.0000');
    expect((await call(server, 'GET', `/v1/manufacturing/costing/rollup?companyId=${p.companyId}&itemId=${p.table}&quantity=1&date=2024-01-01`, { tenant: p.tenant })).json.code).toBe('no_active_bom');
  });

  it('says so when a component has no known cost', async () => {
    const p = await k.plant('Roll Unknown Co', { stock: false });
    await k.tableBom(p);
    const r = await rollup(p, p.table, '1');
    expect(r.complete).toBe(false);
    expect(r.itemsWithoutCost.map((c: string) => c.split('-')[0]).sort()).toEqual(['SCREW', 'WOOD']);
    expect(r.material).toBe('0.0000');
    expect(r.tree.every((n: { source: string }) => n.source === 'unknown')).toBe(true);
  });
});

describe('work order variances', () => {
  async function finished(name: string, o: { wood: string; hoursCut: string; hoursAsm: string; made: string }) {
    const p = await k.plant(name);
    await k.tableBom(p);
    const w = await wo(p);
    ok(await act(p, w.id, 'release'), 200);
    ok(await act(p, w.id, 'issue-materials', { date: '2025-04-11', lines: [{ itemId: p.wood, quantity: o.wood }, { itemId: p.screw, quantity: '80' }] }), 200);
    ok(await act(p, w.id, 'report-time', { date: '2025-04-12', lines: [{ opNo: 10, hours: o.hoursCut }, { opNo: 20, hours: o.hoursAsm }] }), 200);
    ok(await act(p, w.id, 'report-output', { date: '2025-04-15', quantity: o.made, scrapQuantity: '1' }), 200);
    ok(await act(p, w.id, 'complete', { date: '2025-04-16' }), 200);
    return { p, w };
  }

  it('splits the variance into usage and efficiency, and is zero for an order that went to plan', async () => {
    const onPlan = await finished('Var Plan Co', { wood: '40', hoursCut: '5', hoursAsm: '10.5', made: '10' });
    const v0 = await variance(onPlan.p, onPlan.w.id);
    expect(v0.totals).toMatchObject({ planned: '4867.5000', actual: '4867.5000', variance: '0.0000', usage: '0.0000', efficiency: '0.0000' });
    expect(v0.yield).toMatchObject({ percent: '100.0000', shortfallQuantity: '0.000000' });
    expect(v0.unitCost).toEqual({ actual: '486.750000', planned: '486.750000' });

    // 48 wood instead of 40 (+8 x 50 = 400 usage); cutting took 7 h instead of 5 (+2 x 75 + 2 x 120 = 390); assembly as planned; 9 made
    const over = await finished('Var Over Co', { wood: '48', hoursCut: '7', hoursAsm: '10.5', made: '9' });
    const v = await variance(over.p, over.w.id);
    expect(v.materials[0]).toMatchObject({ requiredQuantity: '40.000000', netIssuedQuantity: '48.000000', plannedValue: '2000.0000', actualValue: '2400.0000', usageVariance: '400.0000', usageVariancePercent: '20.0000' });
    expect(v.materials[1]).toMatchObject({ usageVariance: '0.0000' });
    expect(v.operations[0]).toMatchObject({ opNo: 10, plannedHours: '5.0000', actualHours: '7.0000', hoursVariance: '2.0000', hoursOver: true, plannedValue: '975.0000', actualValue: '1365.0000', efficiencyVariance: '390.0000', efficiencyVariancePercent: '40.0000' });
    expect(v.operations[1]).toMatchObject({ efficiencyVariance: '0.0000', hoursOver: false });
    expect(v.totals).toMatchObject({ planned: '4867.5000', actual: '5657.5000', variance: '790.0000', usage: '400.0000', efficiency: '390.0000' });
    expect(v.yield).toMatchObject({ percent: '90.0000', shortfallQuantity: '1.000000', scrapRatePercent: '10.0000' }); // 1 spoiled of 10 units attempted
    // 9 made out of 10 planned: the unfinished unit's cost went to production variance on completion
    expect(v.finishedGoodsValue).toBe('5091.7500'); // 9 of 10 units take 90% of the pool
    expect(v.residualClearedToVariance).toBe('565.7500');
    expect(v.unitCost.planned).toBe('486.750000');
  });

  it('shows less than planned as a negative variance and aggregates completed orders by period', async () => {
    const a = await finished('Var Agg Co', { wood: '36', hoursCut: '4', hoursAsm: '10.5', made: '10' }); // 4 wood and 1 h under: -200 usage, -195 efficiency
    const va = await variance(a.p, a.w.id);
    expect(va.totals).toMatchObject({ variance: '-395.0000', usage: '-200.0000', efficiency: '-195.0000' });
    // a second order in the same plant, later
    const w2 = await wo(a.p, { orderDate: '2025-05-02' });
    ok(await act(a.p, w2.id, 'release'), 200);
    ok(await act(a.p, w2.id, 'issue-materials', { date: '2025-05-03', lines: [{ itemId: a.p.wood, quantity: '44' }, { itemId: a.p.screw, quantity: '80' }] }), 200); // +4 wood = +200
    ok(await act(a.p, w2.id, 'report-time', { date: '2025-05-04', lines: [{ opNo: 10, hours: '5' }, { opNo: 20, hours: '10.5' }] }), 200);
    ok(await act(a.p, w2.id, 'report-output', { date: '2025-05-06', quantity: '10' }), 200);
    ok(await act(a.p, w2.id, 'complete', { date: '2025-05-07' }), 200);
    const report = (await call(server, 'GET', `/v1/manufacturing/costing/variances?companyId=${a.p.companyId}&from=2025-04-01&to=2025-04-30`, { tenant: a.p.tenant })).json;
    expect(report.workOrders).toHaveLength(1);
    expect(report.totals).toMatchObject({ variance: '-395.0000' });
    const both = (await call(server, 'GET', `/v1/manufacturing/costing/variances?companyId=${a.p.companyId}&from=2025-04-01&to=2025-05-31`, { tenant: a.p.tenant })).json;
    expect(both.workOrders.map((x: { woNo: string }) => x.woNo)).toEqual(['WO/2526/000001', 'WO/2526/000002']);
    expect(both.totals).toMatchObject({ usage: '0.0000', efficiency: '-195.0000', variance: '-195.0000' }); // -200 + 200 usage, -195 efficiency
    expect((await call(server, 'GET', `/v1/manufacturing/costing/variances?companyId=${a.p.companyId}&from=2025-05-31&to=2025-04-01`, { tenant: a.p.tenant })).status).toBe(422);
    expect((await call(server, 'GET', `/v1/manufacturing/costing/variances?companyId=${a.p.companyId}&from=2025-04-01&to=2025-05-31&itemId=${a.p.wood}`, { tenant: a.p.tenant })).json.workOrders).toHaveLength(0);
  });

  it('reads a running order too (what has happened so far) and keeps tenants and rights apart', async () => {
    const p = await k.plant('Var Run Co');
    await k.tableBom(p);
    const w = await wo(p);
    ok(await act(p, w.id, 'release'), 200);
    ok(await act(p, w.id, 'issue-materials', { date: '2025-04-11', lines: [{ itemId: p.wood, quantity: '10' }] }), 200);
    const v = await variance(p, w.id);
    expect(v).toMatchObject({ status: 'in_progress', unitCost: { actual: null } });
    expect(v.materials[0]).toMatchObject({ netIssuedQuantity: '10.000000', actualValue: '500.0000', plannedValue: '2000.0000' }); // so far
    const key = await (async () => (await call(server, 'POST', '/v1/api-keys', { tenant: p.tenant, body: { name: 'k', permissions: ['manufacturing:produce'] } })).json.key as string)();
    expect((await call(server, 'GET', `/v1/manufacturing/work-orders/${w.id}/variance`, { token: key })).status).toBe(403);
    const other = await k.plant('Var Run Other');
    expect((await call(server, 'GET', `/v1/manufacturing/work-orders/${w.id}/variance`, { tenant: other.tenant })).status).toBe(404);
  });
});
