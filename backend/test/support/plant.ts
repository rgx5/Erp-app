import type pg from 'pg';
import { call, type TestServer } from './harness.js';
import { ok, shopKit, type Shop } from './shop.js';

export interface Plant extends Shop { table: string; top: string; wood: string; screw: string; wc: { cut: string; assemble: string }; rawWh: string }

/** A factory that makes tables: items, work centres, manufacturing accounts, and opening stock of raw material. */
export function plantKit(server: TestServer, supers: pg.Pool) {
  const kit = shopKit(server, supers);
  let seq = 0;
  async function plant(name: string, o: { settings?: boolean; stock?: boolean } = {}): Promise<Plant> {
    const s = await kit.shop(name);
    ok(await call(server, 'PUT', `/v1/companies/${s.companyId}/inventory-accounts`, { tenant: s.tenant, body: { itemType: 'semi_finished', accountId: s.acc['1220'] } }), 200);
    if (o.settings !== false) {
      ok(await call(server, 'PUT', `/v1/manufacturing/companies/${s.companyId}/settings`, { tenant: s.tenant, body: { wipAccountId: s.acc['1230'], labourAbsorbedAccountId: s.acc['5210'], overheadAbsorbedAccountId: s.acc['5230'], productionVarianceAccountId: s.acc['5260'] } }), 200);
    }
    const nos = ((await call(server, 'GET', '/v1/units?limit=200', { tenant: s.tenant })).json.items as { id: string; code: string }[]).find((u) => u.code === 'NOS')?.id as string;
    const item = async (code: string, itemType: string, extra: object = {}) => ok(await call(server, 'POST', '/v1/items', { tenant: s.tenant, body: { code: `${code}-${++seq}`, name: code, baseUomId: nos, itemType, ...extra } })).id as string;
    const wc = async (code: string, labour: string) => ok(await call(server, 'POST', '/v1/manufacturing/work-centres', { tenant: s.tenant, body: { companyId: s.companyId, code, name: code, labourRatePerHour: labour, machineRatePerHour: '50', overheadRatePerHour: '25' } })).id as string;
    const p = { ...s, table: await item('TABLE', 'finished_good'), top: await item('TOP', 'semi_finished'), wood: await item('WOOD', 'raw_material'), screw: await item('SCREW', 'raw_material'), wc: { cut: await wc('CUT', '120'), assemble: await wc('ASM', '90') }, rawWh: s.wh };
    if (o.stock !== false) {
      for (const [itemId, quantity, unitCost] of [[p.wood, '100', '50'], [p.screw, '400', '2']] as const) {
        ok(await call(server, 'POST', '/v1/stock/movements', { tenant: s.tenant, body: { companyId: s.companyId, movementType: 'opening', postingDate: '2025-04-01', description: 'Opening', lines: [{ warehouseId: s.wh, itemId, quantity, unitCost }] } }));
      }
    }
    return p;
  }
  /** The standard table: 4 wood + 8 screws, cut (0.5 h) then assembled (0.5 h setup + 1 h), effective all year. */
  const tableBom = async (p: Plant, o: object = {}) => ok(await call(server, 'POST', '/v1/manufacturing/boms', {
    tenant: p.tenant,
    body: {
      companyId: p.companyId, itemId: p.table, effectiveFrom: '2025-04-01', lines: [{ itemId: p.wood, quantity: '4' }, { itemId: p.screw, quantity: '8' }],
      operations: [{ opNo: 10, name: 'Cut', workCentreId: p.wc.cut, runHours: '0.5' }, { opNo: 20, name: 'Assemble', workCentreId: p.wc.assemble, setupHours: '0.5', runHours: '1' }], ...o,
    },
  }));
  return { plant, tableBom };
}
