import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit, type Shop } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
let kit: ReturnType<typeof shopKit>;
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });

interface Plant extends Shop { table: string; top: string; wood: string; screw: string; wc: { cut: string; assemble: string } }
let seq = 0;

/** A shop that also makes tables: a finished table, a semi-finished top, raw wood and screws, and two work centres. */
async function plant(name: string): Promise<Plant> {
  const s = await kit.shop(name);
  const nos = ((await call(server, 'GET', '/v1/units?limit=200', { tenant: s.tenant })).json.items as { id: string; code: string }[]).find((u) => u.code === 'NOS')?.id as string;
  const item = async (code: string, itemType: string, o: object = {}) => ok(await call(server, 'POST', '/v1/items', { tenant: s.tenant, body: { code: `${code}-${++seq}`, name: code, baseUomId: nos, itemType, ...o } })).id as string;
  const wc = async (code: string, labour: string) => ok(await call(server, 'POST', '/v1/manufacturing/work-centres', { tenant: s.tenant, body: { companyId: s.companyId, code, name: code, labourRatePerHour: labour, machineRatePerHour: '50', overheadRatePerHour: '25' } })).id as string;
  return {
    ...s, table: await item('TABLE', 'finished_good'), top: await item('TOP', 'semi_finished'), wood: await item('WOOD', 'raw_material'), screw: await item('SCREW', 'raw_material'),
    wc: { cut: await wc('CUT', '120'), assemble: await wc('ASM', '90') },
  };
}
const bom = (p: Plant, itemId: string, lines: object[], o: object = {}) =>
  call(server, 'POST', '/v1/manufacturing/boms', { tenant: p.tenant, body: { companyId: p.companyId, itemId, effectiveFrom: '2025-04-01', lines, ...o } });
const explode = async (p: Plant, itemId: string, quantity: string, date: string) => (await call(server, 'GET', `/v1/manufacturing/boms/explode?companyId=${p.companyId}&itemId=${itemId}&quantity=${quantity}&date=${date}`, { tenant: p.tenant })).json;

describe('work centres', () => {
  it('holds hourly rates, can be re-rated and deactivated, and keeps codes unique', async () => {
    const p = await plant('Wc Co');
    const w = ok(await call(server, 'GET', `/v1/manufacturing/work-centres/${p.wc.cut}`, { tenant: p.tenant }), 200);
    expect(w).toMatchObject({ code: 'CUT', labourRatePerHour: '120.0000', machineRatePerHour: '50.0000', overheadRatePerHour: '25.0000', status: 'active', version: 1 });
    const u = ok(await call(server, 'PATCH', `/v1/manufacturing/work-centres/${p.wc.cut}`, { tenant: p.tenant, body: { labourRatePerHour: '130', name: 'Cutting' } }), 200);
    expect(u).toMatchObject({ labourRatePerHour: '130.0000', name: 'Cutting', version: 2 });
    expect((await call(server, 'POST', '/v1/manufacturing/work-centres', { tenant: p.tenant, body: { companyId: p.companyId, code: 'cut', name: 'Again' } })).status).toBe(409);
    expect((await call(server, 'POST', '/v1/manufacturing/work-centres', { tenant: p.tenant, body: { companyId: p.companyId, code: 'bad code!', name: 'x' } })).status).toBe(422);
    expect((await call(server, 'PATCH', `/v1/manufacturing/work-centres/${p.wc.cut}`, { tenant: p.tenant, body: {} })).status).toBe(422);
    expect((await call(server, 'PATCH', `/v1/manufacturing/work-centres/${p.wc.cut}`, { tenant: p.tenant, body: { labourRatePerHour: '-1' } })).status).toBe(422);
    ok(await call(server, 'PATCH', `/v1/manufacturing/work-centres/${p.wc.assemble}`, { tenant: p.tenant, body: { status: 'inactive' } }), 200);
    expect((await call(server, 'GET', `/v1/manufacturing/work-centres?companyId=${p.companyId}&status=active`, { tenant: p.tenant })).json.items).toHaveLength(1);
  });
});

describe('bills of materials', () => {
  it('creates a versioned BOM with lines and routing, and refuses an overlapping version until the first is obsolete', async () => {
    const p = await plant('Bom Co');
    const v1 = ok(await bom(p, p.table, [{ itemId: p.top, quantity: '1' }, { itemId: p.screw, quantity: '4', scrapPercent: '5' }], {
      description: 'Standard table', effectiveTo: '2025-12-31',
      operations: [{ opNo: 20, name: 'Assemble', workCentreId: p.wc.assemble, setupHours: '0.5', runHours: '1.25' }, { opNo: 10, name: 'Cut', workCentreId: p.wc.cut, runHours: '0.75' }],
    }));
    expect(v1).toMatchObject({ bomNo: 'BOM/2526/000001', version: 1, baseQuantity: '1.000000', status: 'active', effectiveTo: '2025-12-31' });
    expect(v1.lines.map((l: { itemId: string; quantity: string; scrapPercent: string }) => [l.itemId, l.quantity, l.scrapPercent])).toEqual([[p.top, '1.000000', '0.0000'], [p.screw, '4.000000', '5.0000']]);
    expect(v1.operations.map((o: { opNo: number }) => o.opNo)).toEqual([10, 20]); // kept in routing order
    // another BOM for the same item in the same period is refused by the database
    const clash = await bom(p, p.table, [{ itemId: p.wood, quantity: '2' }], { effectiveFrom: '2025-06-01' });
    expect(clash.status).toBe(409);
    expect(clash.json.code).toBe('overlaps_existing');
    const v2 = ok(await bom(p, p.table, [{ itemId: p.wood, quantity: '2' }], { effectiveFrom: '2026-01-01' })); // starts when v1 ends
    expect(v2).toMatchObject({ version: 2, bomNo: 'BOM/2526/000002' }); // the failed attempt burnt no number or version
    const o = ok(await call(server, 'POST', `/v1/manufacturing/boms/${v2.id}/obsolete`, { tenant: p.tenant, body: {} }), 200);
    expect(o.status).toBe('obsolete');
    expect((await call(server, 'POST', `/v1/manufacturing/boms/${v2.id}/obsolete`, { tenant: p.tenant, body: {} })).json.code).toBe('already_obsolete');
    ok(await bom(p, p.table, [{ itemId: p.wood, quantity: '3' }], { effectiveFrom: '2026-01-01' })); // the slot is free again
    expect((await call(server, 'GET', `/v1/manufacturing/boms?companyId=${p.companyId}&itemId=${p.table}`, { tenant: p.tenant })).json.items).toHaveLength(3);
    expect((await call(server, 'GET', `/v1/manufacturing/boms/${v1.id}`, { tenant: p.tenant })).json.operations).toHaveLength(2);
  });

  it('refuses BOMs that make no sense', async () => {
    const p = await plant('Bom Bad Co');
    const other = await plant('Bom Bad Other');
    expect((await bom(p, p.wood, [{ itemId: p.screw, quantity: '1' }])).status).toBe(422); // raw material is not made
    expect((await bom(p, p.table, [{ itemId: p.item.service, quantity: '1' }])).status).toBe(422); // a service is not a component
    expect((await bom(p, p.table, [{ itemId: p.table, quantity: '1' }])).status).toBe(422);
    expect((await bom(p, p.table, [{ itemId: p.wood, quantity: '1' }, { itemId: p.wood, quantity: '2' }])).status).toBe(422);
    expect((await bom(p, p.table, [{ itemId: p.wood, quantity: '0' }])).status).toBe(422);
    expect((await bom(p, p.table, [{ itemId: p.wood, quantity: '1', scrapPercent: '100' }])).status).toBe(422);
    expect((await bom(p, p.table, [])).status).toBe(422);
    expect((await bom(p, p.table, [{ itemId: p.wood, quantity: '1' }], { effectiveFrom: '2025-05-01', effectiveTo: '2025-04-01' })).status).toBe(422);
    const op = (workCentreId: string, opNo = 10) => ({ opNo, name: 'Op', workCentreId });
    expect((await bom(p, p.table, [{ itemId: p.wood, quantity: '1' }], { operations: [op(other.wc.cut)] })).status).toBe(422); // another tenant's work centre
    expect((await bom(p, p.table, [{ itemId: p.wood, quantity: '1' }], { operations: [op(p.wc.cut), op(p.wc.assemble)] })).status).toBe(422); // op number twice
    ok(await call(server, 'PATCH', `/v1/manufacturing/work-centres/${p.wc.assemble}`, { tenant: p.tenant, body: { status: 'inactive' } }), 200);
    expect((await bom(p, p.table, [{ itemId: p.wood, quantity: '1' }], { operations: [op(p.wc.assemble)] })).status).toBe(422); // inactive work centre
    // a loop through another BOM
    ok(await bom(p, p.table, [{ itemId: p.top, quantity: '1' }]));
    expect((await bom(p, p.top, [{ itemId: p.table, quantity: '1' }])).json.code).toBe('bom_cycle');
    expect(ok(await bom(p, p.top, [{ itemId: p.wood, quantity: '3' }])).bomNo).toBe('BOM/2526/000002');
  });

  it('explodes a multi-level BOM with scrap, for the version in force on a date', async () => {
    const p = await plant('Explode Co');
    ok(await bom(p, p.top, [{ itemId: p.wood, quantity: '3' }], { baseQuantity: '2' })); // 2 tops need 3 wood
    ok(await bom(p, p.table, [{ itemId: p.top, quantity: '1' }, { itemId: p.screw, quantity: '4', scrapPercent: '5' }], { effectiveTo: '2025-12-31' }));
    ok(await bom(p, p.table, [{ itemId: p.wood, quantity: '9' }, { itemId: p.screw, quantity: '2' }], { effectiveFrom: '2026-01-01' })); // a simpler design from 2026
    const e = await explode(p, p.table, '10', '2025-08-01');
    expect(e.tree.map((n: { itemCode: string; quantity: string; bomId: string | null }) => [n.itemCode.split('-')[0], n.quantity, n.bomId !== null])).toEqual([['TOP', '10.000000', true], ['SCREW', '42.105263', false]]); // 40 / 0.95
    expect(e.tree[0].children).toEqual([expect.objectContaining({ quantity: '15.000000', bomId: null })]); // 10 tops x 3 / 2
    expect(e.rawRequirements.map((r: { itemCode: string; quantity: string }) => [r.itemCode.split('-')[0], r.quantity])).toEqual([['SCREW', '42.105263'], ['WOOD', '15.000000']]);
    const later = await explode(p, p.table, '10', '2026-02-01');
    expect(later.rawRequirements.map((r: { itemCode: string; quantity: string }) => [r.itemCode.split('-')[0], r.quantity])).toEqual([['SCREW', '20.000000'], ['WOOD', '90.000000']]);
    expect((await call(server, 'GET', `/v1/manufacturing/boms/explode?companyId=${p.companyId}&itemId=${p.table}&quantity=1&date=2024-01-01`, { tenant: p.tenant })).json.code).toBe('no_active_bom');
  });
});

describe('guards and access', () => {
  it('keeps BOMs immutable and non-overlapping in the database itself', async () => {
    const p = await plant('Bom Guard Co');
    const b = ok(await bom(p, p.table, [{ itemId: p.wood, quantity: '2' }], { effectiveTo: '2025-12-31' }));
    const bad = (sql: string, params: unknown[] = []) => expect(supers.query(sql, params)).rejects.toMatchObject({ code: '55000' });
    await bad("UPDATE erp.boms SET description = 'x' WHERE id = $1", [b.id]);
    await bad('DELETE FROM erp.boms WHERE id = $1', [b.id]);
    await bad('UPDATE erp.bom_lines SET quantity = 9 WHERE bom_id = $1', [b.id]);
    await bad('DELETE FROM erp.bom_lines WHERE bom_id = $1', [b.id]);
    await expect(supers.query("INSERT INTO erp.boms (tenant_id, id, company_id, item_id, bom_no, version, effective_from) VALUES ($1, gen_random_uuid(), $2, $3, 'RAW/1', 99, '2025-06-01')", [p.tenant, p.companyId, p.table])).rejects.toMatchObject({ code: '23P01' });
    ok(await call(server, 'POST', `/v1/manufacturing/boms/${b.id}/obsolete`, { tenant: p.tenant, body: {} }), 200);
    await bad("UPDATE erp.boms SET status = 'active' WHERE id = $1", [b.id]); // obsolete is final
  });

  it('separates reading from managing, and keeps tenants apart', async () => {
    const p = await plant('Bom Access Co');
    const b = ok(await bom(p, p.table, [{ itemId: p.wood, quantity: '2' }]));
    const key = async (permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: p.tenant, body: { name: 'k', permissions } })).json.key as string;
    const reader = await key(['manufacturing:read']);
    expect((await call(server, 'GET', `/v1/manufacturing/boms/${b.id}`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/manufacturing/boms', { token: reader, body: {} })).status).toBe(403);
    expect((await call(server, 'POST', '/v1/manufacturing/work-centres', { token: reader, body: {} })).status).toBe(403);
    expect((await call(server, 'POST', `/v1/manufacturing/boms/${b.id}/obsolete`, { token: reader, body: {} })).status).toBe(403);
    const other = await plant('Bom Access Other');
    expect((await call(server, 'GET', `/v1/manufacturing/boms/${b.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/manufacturing/boms?companyId=${other.companyId}`, { tenant: other.tenant })).json.items).toHaveLength(0);
    expect((await call(server, 'PATCH', `/v1/manufacturing/work-centres/${p.wc.cut}`, { tenant: other.tenant, body: { status: 'inactive' } })).status).toBe(404);
  });
});
