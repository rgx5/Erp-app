import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { plantKit, type Plant } from '../support/plant.js';
import { ok } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let k: ReturnType<typeof plantKit>;
beforeAll(async () => { server = await startServer(); k = plantKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

const wo = (p: Plant, o: object = {}) => call(server, 'POST', '/v1/manufacturing/work-orders', { tenant: p.tenant, body: { companyId: p.companyId, itemId: p.table, orderDate: '2025-04-10', plannedQuantity: '10', outputWarehouseId: p.wh, materialsWarehouseId: p.wh, ...o } });
const act = (p: Plant, id: string, what: string, body: object = {}) => call(server, 'POST', `/v1/manufacturing/work-orders/${id}/${what}`, { tenant: p.tenant, body });
const get = async (p: Plant, id: string) => (await call(server, 'GET', `/v1/manufacturing/work-orders/${id}`, { tenant: p.tenant })).json;
const net = async (p: Plant, code: string) => {
  const t = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${p.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: p.tenant })).json;
  expect(t.balanced).toBe(true);
  const r = t.rows.find((x: { code: string }) => x.code === code) as { closingDebit: string; closingCredit: string } | undefined;
  return r ? Math.round((Number(r.closingDebit) - Number(r.closingCredit)) * 10000) / 10000 : 0;
};
const recon = async (p: Plant, path: string, asOf = '2026-03-31') => (await call(server, 'GET', `/v1/${path}?companyId=${p.companyId}&asOf=${asOf}`, { tenant: p.tenant })).json;
const issue = (p: Plant, id: string, lines: { itemId: string; quantity: string }[], date = '2025-04-11') => act(p, id, 'issue-materials', { date, lines });
const hours = (p: Plant, id: string, lines: { opNo: number; hours: string }[], date = '2025-04-12') => act(p, id, 'report-time', { date, lines });
const output = (p: Plant, id: string, quantity: string, o: object = {}) => act(p, id, 'report-output', { date: '2025-04-15', quantity, ...o });
/** A released order for 10 tables, with all its materials issued and all its time reported: 2,160 + 2,707.50 = 4,867.50 in WIP. */
async function running(name: string) {
  const p = await k.plant(name);
  await k.tableBom(p);
  const w = ok(await wo(p));
  ok(await act(p, w.id, 'release'), 200);
  ok(await issue(p, w.id, [{ itemId: p.wood, quantity: '40' }, { itemId: p.screw, quantity: '80' }]), 200);
  ok(await hours(p, w.id, [{ opNo: 10, hours: '5' }, { opNo: 20, hours: '10.5' }]), 200);
  return { p, w };
}

describe('creating and releasing', () => {
  it('snapshots the BOM into material requirements and planned hours', async () => {
    const p = await k.plant('Wo Create Co');
    const bom = await k.tableBom(p);
    const w = ok(await wo(p, { plannedStart: '2025-04-12', dueDate: '2025-04-20', notes: 'Rush' }));
    expect(w).toMatchObject({ woNo: 'WO/2526/000001', status: 'planned', bomId: bom.id, plannedQuantity: '10.000000', producedQuantity: '0.000000' });
    expect(w.materials.map((m: { itemId: string; requiredQuantity: string }) => [m.itemId, m.requiredQuantity])).toEqual([[p.wood, '40.000000'], [p.screw, '80.000000']]);
    expect(w.operations.map((o: { opNo: number; plannedHours: string }) => [o.opNo, o.plannedHours])).toEqual([[10, '5.0000'], [20, '10.5000']]); // setup 0.5 + 1 h x 10
    expect(w.cost).toMatchObject({ wip: '0.0000' });
    // an order is for the BOM in force on its date
    expect((await wo(p, { orderDate: '2024-01-01' })).json.code).toBe('no_active_bom');
    expect((await wo(p, { itemId: p.top })).json.code).toBe('no_active_bom');
    expect((await wo(p, { plannedQuantity: '0' })).status).toBe(422);
    expect((await wo(p, { dueDate: '2025-04-01', plannedStart: '2025-04-05' })).status).toBe(422);
    const other = await k.plant('Wo Create Other');
    expect((await wo(p, { outputWarehouseId: other.wh })).status).toBe(422);
    expect((await wo(p, { bomId: (await k.tableBom(other)).id })).status).toBe(404); // another tenant's BOM is invisible
    ok(await act(p, w.id, 'release'), 200);
    expect((await act(p, w.id, 'release')).json.code).toBe('not_planned');
    expect((await call(server, 'GET', `/v1/manufacturing/work-orders?companyId=${p.companyId}&status=released`, { tenant: p.tenant })).json.items).toHaveLength(1);
  });

  it('cancels an order nothing happened to, and only that', async () => {
    const p = await k.plant('Wo Cancel Co');
    await k.tableBom(p);
    const a = ok(await wo(p));
    expect(ok(await act(p, a.id, 'cancel'), 200).status).toBe('cancelled');
    expect((await act(p, a.id, 'cancel')).json.code).toBe('not_cancellable');
    expect((await act(p, a.id, 'release')).json.code).toBe('not_planned');
    const b = ok(await wo(p));
    ok(await act(p, b.id, 'release'), 200);
    ok(await issue(p, b.id, [{ itemId: p.wood, quantity: '1' }]), 200);
    expect((await act(p, b.id, 'cancel')).json.code).toBe('not_cancellable'); // in progress: it can only be completed
  });
});

describe('materials, labour and output', () => {
  it('carries the whole cost from stock through WIP into finished goods, to the paisa', async () => {
    const p = await k.plant('Wo Flow Co');
    await k.tableBom(p);
    const fgBefore = await net(p, '1240'); // the shop's own opening stock is in here too
    const w = ok(await wo(p));
    expect((await issue(p, w.id, [{ itemId: p.wood, quantity: '1' }])).json.code).toBe('not_live'); // release first
    ok(await act(p, w.id, 'release'), 200);
    const issued = ok(await issue(p, w.id, [{ itemId: p.wood, quantity: '40' }, { itemId: p.screw, quantity: '80' }]), 200);
    expect(issued.status).toBe('in_progress');
    expect(issued.cost).toMatchObject({ materials: '2160.0000', wip: '2160.0000' });
    expect(issued.materials.map((m: { issuedQuantity: string }) => m.issuedQuantity)).toEqual(['40.000000', '80.000000']);
    expect(await net(p, '1230')).toBe(2160);
    expect(await net(p, '1210')).toBe(5000 + 800 - 2160); // raw material stock down
    const timed = ok(await hours(p, w.id, [{ opNo: 10, hours: '5' }, { opNo: 20, hours: '10.5' }]), 200);
    // CUT 5 h: labour 600, overhead (50 + 25) x 5 = 375. ASM 10.5 h: labour 945, overhead 787.50.
    expect(timed.cost).toMatchObject({ labour: '1545.0000', overhead: '1162.5000', wip: '4867.5000' });
    expect(timed.operations.map((o: { actualHours: string }) => o.actualHours)).toEqual(['5.0000', '10.5000']);
    expect(await net(p, '5210')).toBe(-1545);
    expect(await net(p, '5230')).toBe(-1162.5);
    expect((await recon(p, 'manufacturing/wip-reconciliation')).reconciled).toBe(true);
    // 4 of 10 at 40% of the pool; then the last 6 take everything left, so nothing is stranded
    const first = ok(await output(p, w.id, '4', { scrapQuantity: '1' }), 200);
    expect(first.cost.finishedGoods).toBe('1947.0000');
    expect(first).toMatchObject({ producedQuantity: '4.000000', scrapQuantity: '1.000000' });
    const done = ok(await output(p, w.id, '6'), 200);
    expect(done.cost).toMatchObject({ finishedGoods: '4867.5000', wip: '0.0000' });
    expect(await net(p, '1230')).toBe(0);
    expect(await net(p, '1240') - fgBefore).toBe(4867.5); // finished goods at actual cost: 486.75 each
    const completed = ok(await act(p, w.id, 'complete', { date: '2025-04-16' }), 200);
    expect(completed).toMatchObject({ status: 'completed' });
    expect(completed.cost.residualCleared).toBe('0.0000');
    expect((await recon(p, 'manufacturing/wip-reconciliation')).reconciled).toBe(true);
    expect((await recon(p, 'inventory/reconciliation')).reconciled).toBe(true);
    // the finished goods are ordinary stock now: 10 at 486.75
    const out = (await call(server, 'GET', `/v1/stock/availability?companyId=${p.companyId}&itemId=${p.table}&warehouseId=${p.wh}`, { tenant: p.tenant })).json.warehouses[0];
    expect(out.onHand).toBe('10.000000');
    expect((await issue(p, w.id, [{ itemId: p.wood, quantity: '1' }])).json.code).toBe('not_live'); // completed is final
  });

  it('returns unused materials at their average cost', async () => {
    const { p, w } = await running('Wo Return Co');
    const r = ok(await act(p, w.id, 'return-materials', { date: '2025-04-13', lines: [{ itemId: p.wood, quantity: '8' }] }), 200); // 8 of 40 wood at 50 = 400
    expect(r.cost.materials).toBe('1760.0000');
    expect(r.materials[0]).toMatchObject({ issuedQuantity: '40.000000', returnedQuantity: '8.000000' });
    expect(await net(p, '1230')).toBe(4867.5 - 400);
    expect((await recon(p, 'inventory/reconciliation')).reconciled).toBe(true);
    expect((await recon(p, 'manufacturing/wip-reconciliation')).reconciled).toBe(true);
    const all = ok(await act(p, w.id, 'return-materials', { date: '2025-04-13', lines: [{ itemId: p.wood, quantity: '32' }] }), 200);
    expect(all.cost.materials).toBe('160.0000'); // only the screws are left
    expect((await act(p, w.id, 'return-materials', { date: '2025-04-13', lines: [{ itemId: p.wood, quantity: '1' }] })).json.code).toBe('return_exceeds_issued');
    expect((await act(p, w.id, 'return-materials', { date: '2025-04-13', lines: [{ itemId: p.top, quantity: '1' }] })).status).toBe(422);
  });

  it('clears what is left in WIP to production variance when an order is closed short', async () => {
    const { p, w } = await running('Wo Short Co');
    ok(await output(p, w.id, '8', { scrapQuantity: '2' }), 200); // 8 of 10 = 80% of 4,867.50
    expect((await get(p, w.id)).cost.wip).toBe('973.5000');
    const done = ok(await act(p, w.id, 'complete', { date: '2025-04-20' }), 200);
    expect(done.cost).toMatchObject({ finishedGoods: '3894.0000', residualCleared: '973.5000', wip: '0.0000' });
    expect(await net(p, '5260')).toBe(973.5);
    expect(await net(p, '1230')).toBe(0);
    expect((await recon(p, 'manufacturing/wip-reconciliation')).reconciled).toBe(true);
    // as of before the completion the residual was still in WIP
    expect((await recon(p, 'manufacturing/wip-reconciliation', '2025-04-18')).documents).toBe('973.5000');
    expect((await recon(p, 'manufacturing/wip-reconciliation', '2025-04-18')).reconciled).toBe(true);
  });

  it('uses the rates in force when time is reported, not when the order was planned', async () => {
    const p = await k.plant('Wo Rates Co');
    await k.tableBom(p);
    const w = ok(await wo(p));
    ok(await act(p, w.id, 'release'), 200);
    ok(await hours(p, w.id, [{ opNo: 10, hours: '1' }]), 200); // 120 + 75
    ok(await call(server, 'PATCH', `/v1/manufacturing/work-centres/${p.wc.cut}`, { tenant: p.tenant, body: { labourRatePerHour: '200' } }), 200);
    const r = ok(await hours(p, w.id, [{ opNo: 10, hours: '1' }]), 200); // 200 + 75
    expect(r.cost.labour).toBe('320.0000');
    expect(r.cost.overhead).toBe('150.0000');
  });

  it('handles many simultaneous issues and outputs without losing or inventing cost', async () => {
    const { p, w } = await running('Wo Race Co');
    const issues = await Promise.all([1, 2, 3, 4, 5].map(() => issue(p, w.id, [{ itemId: p.wood, quantity: '2' }])));
    expect(issues.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const wip = Number((await get(p, w.id)).cost.wip);
    expect(wip).toBe(4867.5 + 500); // 10 more wood at 50
    const outs = await Promise.all([1, 2, 3, 4, 5].map(() => output(p, w.id, '2')));
    expect(outs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const done = await get(p, w.id);
    expect(done.producedQuantity).toBe('10.000000');
    expect(done.cost).toMatchObject({ wip: '0.0000', finishedGoods: '5367.5000' });
    expect((await recon(p, 'manufacturing/wip-reconciliation')).reconciled).toBe(true);
    expect((await recon(p, 'inventory/reconciliation')).reconciled).toBe(true);
  });
});

describe('refusals', () => {
  it('rejects what makes no sense and leaves nothing behind', async () => {
    const p = await k.plant('Wo Bad Co');
    await k.tableBom(p);
    const w = ok(await wo(p));
    ok(await act(p, w.id, 'release'), 200);
    expect((await output(p, w.id, '1')).json.code).toBe('no_wip_cost'); // nothing in it yet
    expect((await act(p, w.id, 'complete', { date: '2025-04-20' })).json.code).toBe('not_in_progress');
    const woodBefore = await net(p, '1210');
    expect((await issue(p, w.id, [{ itemId: p.top, quantity: '1' }])).status).toBe(422); // not a material
    expect((await issue(p, w.id, [{ itemId: p.wood, quantity: '1000' }])).json.code).toBe('insufficient_stock');
    expect((await issue(p, w.id, [{ itemId: p.wood, quantity: '5' }, { itemId: p.screw, quantity: '9999' }])).json.code).toBe('insufficient_stock'); // the first line is undone too
    expect(await net(p, '1210')).toBe(woodBefore);
    expect(await net(p, '1230')).toBe(0);
    expect((await hours(p, w.id, [{ opNo: 99, hours: '1' }])).status).toBe(422);
    expect((await hours(p, w.id, [{ opNo: 10, hours: '0' }])).status).toBe(422);
    expect((await issue(p, w.id, [{ itemId: p.wood, quantity: '1' }], '2027-01-01')).json.code).toBe('no_accounting_period');
    expect((await get(p, w.id)).transactions).toHaveLength(0);
    expect((await get(p, w.id)).status).toBe('released');
    // work centres with no rates cost nothing: refused rather than booked as zero
    const free = await k.plant('Wo Free Co');
    ok(await call(server, 'POST', '/v1/manufacturing/boms', { tenant: free.tenant, body: { companyId: free.companyId, itemId: free.table, effectiveFrom: '2025-04-01', lines: [{ itemId: free.wood, quantity: '1' }], operations: [{ opNo: 10, name: 'x', workCentreId: ok(await call(server, 'POST', '/v1/manufacturing/work-centres', { tenant: free.tenant, body: { companyId: free.companyId, code: 'FREE', name: 'Free' } })).id, runHours: '1' }] } }));
    const fw = ok(await wo(free));
    ok(await act(free, fw.id, 'release'), 200);
    expect((await hours(free, fw.id, [{ opNo: 10, hours: '1' }])).json.code).toBe('no_cost');
  });

  it('says exactly which accounts are missing, and keeps closed periods closed', async () => {
    const bare = await k.plant('Wo Cfg Co', { settings: false });
    await k.tableBom(bare);
    const w = ok(await wo(bare));
    ok(await act(bare, w.id, 'release'), 200);
    const r = await issue(bare, w.id, [{ itemId: bare.wood, quantity: '1' }]);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'manufacturing_accounts_not_configured', missing: ['wipAccountId'] });
    expect((await call(server, 'PUT', `/v1/manufacturing/companies/${bare.companyId}/settings`, { tenant: bare.tenant, body: { wipAccountId: bare.acc['1210'] } })).status).toBe(422); // not a WIP control account
    expect((await call(server, 'PUT', `/v1/manufacturing/companies/${bare.companyId}/settings`, { tenant: bare.tenant, body: { labourAbsorbedAccountId: bare.acc['1230'] } })).status).toBe(422);
    const p = await k.plant('Wo Locked Co');
    await k.tableBom(p);
    const lw = ok(await wo(p));
    ok(await act(p, lw.id, 'release'), 200);
    for (const n of ['Apr 2025', 'May 2025']) ok(await call(server, 'POST', `/v1/accounting-periods/${p.periods.find((x) => x.name === n)?.id}/close`, { tenant: p.tenant }), 200);
    expect((await issue(p, lw.id, [{ itemId: p.wood, quantity: '1' }], '2025-05-20')).json.code).toBe('period_closed');
    expect((await get(p, lw.id)).transactions).toHaveLength(0);
  });
});

describe('guards and access', () => {
  it('keeps orders and their transactions immutable in the database', async () => {
    const { p, w } = await running('Wo Guard Co');
    const bad = (sql: string, params: unknown[] = []) => expect(supers.query(sql, params)).rejects.toMatchObject({ code: '55000' });
    await bad('UPDATE erp.work_orders SET planned_quantity = 1 WHERE id = $1', [w.id]);
    await bad('DELETE FROM erp.work_orders WHERE id = $1', [w.id]);
    await bad('UPDATE erp.work_order_materials SET required_quantity = 1 WHERE work_order_id = $1', [w.id]);
    await bad('UPDATE erp.work_order_operations SET planned_hours = 1 WHERE work_order_id = $1', [w.id]);
    await bad('UPDATE erp.work_order_transactions SET value = 1 WHERE work_order_id = $1', [w.id]);
    await bad('DELETE FROM erp.work_order_transactions WHERE work_order_id = $1', [w.id]);
    ok(await output(p, w.id, '10'), 200);
    ok(await act(p, w.id, 'complete', { date: '2025-04-16' }), 200);
    await bad("UPDATE erp.work_orders SET status = 'in_progress' WHERE id = $1", [w.id]); // completed is final
    await expect(supers.query('UPDATE erp.work_order_materials SET returned_quantity = 999 WHERE work_order_id = $1', [w.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('separates reading, producing and cancelling, and keeps tenants apart', async () => {
    const { p, w } = await running('Wo Access Co');
    const key = async (permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: p.tenant, body: { name: 'k', permissions } })).json.key as string;
    const reader = await key(['manufacturing:read']);
    expect((await call(server, 'GET', `/v1/manufacturing/work-orders/${w.id}`, { token: reader })).status).toBe(200);
    expect((await call(server, 'GET', `/v1/manufacturing/wip-reconciliation?companyId=${p.companyId}&asOf=2026-03-31`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', `/v1/manufacturing/work-orders/${w.id}/issue-materials`, { token: reader, body: {} })).status).toBe(403);
    const maker = await key(['manufacturing:produce']);
    expect((await call(server, 'POST', `/v1/manufacturing/work-orders/${w.id}/cancel`, { token: maker, body: {} })).status).toBe(403);
    expect((await call(server, 'PUT', `/v1/manufacturing/companies/${p.companyId}/settings`, { token: maker, body: { wipAccountId: null } })).status).toBe(403);
    const other = await k.plant('Wo Access Other');
    expect((await call(server, 'GET', `/v1/manufacturing/work-orders/${w.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await act(other, w.id, 'complete', { date: '2025-04-20' })).status).toBe(404);
    expect((await recon(other, 'manufacturing/wip-reconciliation')).reconciled).toBe(true);
  });
});
