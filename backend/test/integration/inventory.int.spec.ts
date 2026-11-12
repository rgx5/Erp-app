import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnitOfWork } from '../../src/platform/database/unit-of-work.js';
import { StockService } from '../../src/modules/inventory/stock.service.js';
import { appPool, call, createTenant, startServer, superPool, type TestServer } from '../support/harness.js';

let server: TestServer;
let uow: UnitOfWork;
let stock: StockService;
const supers = superPool();

beforeAll(async () => {
  server = await startServer();
  uow = server.app.get(UnitOfWork);
  stock = server.app.get(StockService);
});
afterAll(async () => { await server.close(); await supers.end(); });

const ok = (res: { status: number; json: unknown }, status = 201) => { expect(res.status, JSON.stringify(res.json)).toBe(status); return res.json as any; }; // eslint-disable-line

interface World { tenant: string; companyId: string; acc: Record<string, string>; wh: string; wh2: string; periods: { id: string; name: string }[]; slug: string }
let counter = 0;
/** A tenant with a company, chart, fiscal year 2025-26, two warehouses, and the stock accounts configured. */
async function world(name: string, configure = true): Promise<World> {
  const tenant = await createTenant(server, name);
  const company = ok(await call(server, 'POST', '/v1/companies', { tenant, body: { legalName: `${name} Ltd` } }));
  const companyId = company.id as string;
  ok(await call(server, 'POST', `/v1/companies/${companyId}/chart-of-accounts/template`, { tenant, body: { template: 'manufacturing_india' } }));
  const acc: Record<string, string> = {};
  for (const a of (await call(server, 'GET', `/v1/accounts?companyId=${companyId}&limit=200`, { tenant })).json.items) acc[a.code] = a.id;
  const fy = ok(await call(server, 'POST', '/v1/fiscal-years', { tenant, body: { companyId, startDate: '2025-04-01' } }));
  const loc = ok(await call(server, 'POST', '/v1/business-locations', { tenant, body: { companyId, code: 'HO', name: 'Head office', addressLine1: '1 Main Rd', city: 'Pune', stateCode: '27', pincode: '411001' } }));
  const mkWh = async (code: string, kind = 'general') => ok(await call(server, 'POST', '/v1/warehouses', { tenant, body: { businessLocationId: loc.id, code, name: code, kind } })).id as string;
  const w: World = { tenant, companyId, acc, wh: await mkWh('MAIN'), wh2: await mkWh('SECOND'), periods: fy.periods, slug: `${++counter}` };
  if (configure) {
    for (const [type, code] of [['raw_material', '1210'], ['finished_good', '1240'], ['consumable', '1250']] as const) ok(await call(server, 'PUT', `/v1/companies/${companyId}/inventory-accounts`, { tenant, body: { itemType: type, accountId: acc[code] } }), 200);
    ok(await call(server, 'PUT', `/v1/companies/${companyId}/stock-settings`, { tenant, body: { adjustmentAccountId: acc['5300'], openingBalanceAccountId: acc['3100'] } }), 200);
  }
  return w;
}
let itemSeq = 0;
const item = async (w: World, o: object = {}) => {
  const units = (await call(server, 'GET', '/v1/units?limit=200', { tenant: w.tenant })).json.items as { id: string; code: string }[];
  const nos = units.find((u) => u.code === 'NOS')?.id;
  return ok(await call(server, 'POST', '/v1/items', { tenant: w.tenant, body: { code: `IT-${++itemSeq}`, name: 'Thing', itemType: 'raw_material', baseUomId: nos, ...o } })).id as string;
};
const mv = (w: World, body: object) => call(server, 'POST', '/v1/stock/movements', { tenant: w.tenant, body: { companyId: w.companyId, postingDate: '2025-04-10', description: 'Test movement', ...body } });
const receipt = (w: World, itemId: string, q: string, cost: string, o: { date?: string; wh?: string; line?: object } = {}) =>
  mv(w, { movementType: 'receipt', postingDate: o.date ?? '2025-04-10', offsetAccountId: w.acc['2140'], lines: [{ warehouseId: o.wh ?? w.wh, itemId, quantity: q, unitCost: cost, ...o.line }] });
const issue = (w: World, itemId: string, q: string, o: { date?: string; wh?: string; line?: object } = {}) =>
  mv(w, { movementType: 'issue', postingDate: o.date ?? '2025-04-10', offsetAccountId: w.acc['5100'], lines: [{ warehouseId: o.wh ?? w.wh, itemId, quantity: q, ...o.line }] });
const balance = async (w: World, itemId: string, wh = w.wh) => {
  const rows = (await call(server, 'GET', `/v1/stock/balances?companyId=${w.companyId}&itemId=${itemId}&warehouseId=${wh}`, { tenant: w.tenant })).json.items;
  return rows[0] as { quantity: string; value: string; averageCost: string; batches: { batchNo: string; quantity: string }[] } | undefined;
};
const recon = async (w: World, asOf = '2026-03-31') => (await call(server, 'GET', `/v1/inventory/reconciliation?companyId=${w.companyId}&asOf=${asOf}`, { tenant: w.tenant })).json;

describe('configuration', () => {
  it('requires GL accounts to be configured, and only accepts proper ones', async () => {
    const w = await world('Config Co', false);
    const it1 = await item(w);
    const unconfigured = await receipt(w, it1, '1', '10');
    expect(unconfigured.status).toBe(409);
    expect(unconfigured.json.code).toBe('stock_accounts_not_configured');
    const map = (itemType: string, code: string) => call(server, 'PUT', `/v1/companies/${w.companyId}/inventory-accounts`, { tenant: w.tenant, body: { itemType, accountId: w.acc[code] } });
    expect((await map('raw_material', '1110')).status).toBe(422); // cash is not a stock control account
    expect((await map('raw_material', '1200')).status).toBe(422); // a group
    expect((await map('raw_material', '2120')).status).toBe(422); // not an asset
    expect((await map('raw_material', '1210')).status).toBe(200);
    expect((await map('finished_good', '1210')).status).toBe(200); // two item types may share one account
    expect((await call(server, 'PUT', `/v1/companies/${w.companyId}/stock-settings`, { tenant: w.tenant, body: { adjustmentAccountId: w.acc['1210'] } })).status).toBe(422); // control account
    expect((await call(server, 'PUT', `/v1/companies/${w.companyId}/stock-settings`, { tenant: w.tenant, body: { adjustmentAccountId: w.acc['1200'] } })).status).toBe(422); // group
    expect((await call(server, 'PUT', `/v1/companies/${w.companyId}/stock-settings`, { tenant: w.tenant, body: { adjustmentAccountId: w.acc['5300'] } })).status).toBe(200);
    expect((await call(server, 'GET', `/v1/companies/${w.companyId}/inventory-accounts`, { tenant: w.tenant })).json.items).toHaveLength(2);
    expect((await receipt(w, it1, '1', '10')).status).toBe(201);
  });
});

describe('weighted-average costing', () => {
  it('averages receipts, costs issues at the average, and reconciles to the GL', async () => {
    const w = await world('WAC Co');
    const i = await item(w);
    const r1 = ok(await receipt(w, i, '10', '100'));
    expect(r1).toMatchObject({ movementType: 'receipt', movementNo: 'SR/2526/000001' });
    expect(r1.journalEntryId).toBeTruthy();
    ok(await receipt(w, i, '10', '120'));
    expect(await balance(w, i)).toMatchObject({ quantity: '20.000000', value: '2200.0000', averageCost: '110.000000' });
    const out = ok(await issue(w, i, '5'));
    expect(out.lines[0]).toMatchObject({ quantity: '-5.000000', unitCost: '110.000000', value: '-550.0000', balanceQuantity: '15.000000', balanceValue: '1650.0000' });
    expect(await balance(w, i)).toMatchObject({ quantity: '15.000000', value: '1650.0000', averageCost: '110.000000' });
    // GL: Dr stock 2200, Cr stock 550 against the offsets; the subledger agrees with the control account
    const r = await recon(w);
    expect(r).toMatchObject({ reconciled: true, stockTotal: '1650.0000', glTotal: '1650.0000' });
    expect(r.rows.find((x: { code: string }) => x.code === '1210')).toMatchObject({ stockValue: '1650.0000', glBalance: '1650.0000', reconciled: true });
  });
  it('rounds without ever losing or inventing a paisa, and empties to exactly zero', async () => {
    const w = await world('Round Co');
    const i = await item(w);
    ok(await receipt(w, i, '3', '33.333333')); // 3 x 33.333333 = 99.999999 -> 100.0000
    expect(await balance(w, i)).toMatchObject({ value: '100.0000' });
    const values: string[] = [];
    for (let n = 0; n < 3; n++) values.push(ok(await issue(w, i, '1')).lines[0].value);
    expect(values).toEqual(['-33.3333', '-33.3334', '-33.3333']);
    expect(await balance(w, i)).toMatchObject({ quantity: '0.000000', value: '0.0000' });
    expect((await recon(w)).reconciled).toBe(true);
  });
  it('handles fractional quantities and uses the valuation cost for adjustments', async () => {
    const w = await world('Adj Co');
    const i = await item(w);
    ok(await receipt(w, i, '10', '50'));
    const up = ok(await mv(w, { movementType: 'adjustment', description: 'Found stock', lines: [{ warehouseId: w.wh, itemId: i, quantity: '2.5', direction: 'in' }] }));
    expect(up.lines[0]).toMatchObject({ quantity: '2.500000', unitCost: '50.000000', value: '125.0000' }); // at the average, nobody typed a cost
    const down = ok(await mv(w, { movementType: 'adjustment', description: 'Damaged', lines: [{ warehouseId: w.wh, itemId: i, quantity: '1.25', direction: 'out' }] }));
    expect(down.lines[0]).toMatchObject({ quantity: '-1.250000', value: '-62.5000' });
    // adjustments post against the configured adjustment account (5300): net +62.5 income
    const tb = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${w.companyId}&from=2025-04-01&to=2025-04-30`, { tenant: w.tenant })).json;
    expect(tb.rows.find((r: { code: string }) => r.code === '5300')).toMatchObject({ debit: '62.5000', credit: '125.0000', closingCredit: '62.5000' });
    expect(tb.balanced).toBe(true);
    expect((await recon(w)).reconciled).toBe(true);
  });
  it('posts opening stock against the opening balance account', async () => {
    const w = await world('Opening Co');
    const i = await item(w);
    const o = ok(await mv(w, { movementType: 'opening', description: 'Opening', postingDate: '2025-04-01', lines: [{ warehouseId: w.wh, itemId: i, quantity: '100', unitCost: '12.5' }] }));
    expect(o.movementNo).toBe('SO/2526/000001');
    const tb = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${w.companyId}&from=2025-04-01&to=2025-04-30`, { tenant: w.tenant })).json;
    expect(tb.rows.find((r: { code: string }) => r.code === '3100')).toMatchObject({ credit: '1250.0000' });
    expect((await mv(w, { movementType: 'opening', description: 'x', offsetAccountId: w.acc['3100'], lines: [{ warehouseId: w.wh, itemId: i, quantity: '1', unitCost: '1' }] })).status).toBe(422);
  });
});

describe('FIFO costing', () => {
  it('consumes the oldest layer first, by receipt date, and records what it consumed', async () => {
    const w = await world('FIFO Co');
    const i = await item(w, { costingMethod: 'fifo' });
    ok(await receipt(w, i, '10', '120', { date: '2025-04-20' }));
    ok(await receipt(w, i, '10', '100', { date: '2025-04-10' })); // posted later, received earlier
    const out = ok(await issue(w, i, '15', { date: '2025-04-25' }));
    expect(out.lines[0]).toMatchObject({ quantity: '-15.000000', value: '-1600.0000', unitCost: '106.666667' }); // 10 @ 100 + 5 @ 120
    const layers = (await supers.query("SELECT quantity::text AS q, remaining::text AS r, unit_cost::text AS c FROM erp.stock_layers WHERE tenant_id = $1 AND item_id = $2 ORDER BY received_on", [w.tenant, i])).rows;
    expect(layers).toEqual([{ q: '10.000000', r: '0.000000', c: '100.000000' }, { q: '10.000000', r: '5.000000', c: '120.000000' }]);
    const used = (await supers.query('SELECT quantity::text AS q, value::text AS v FROM erp.stock_layer_consumptions WHERE tenant_id = $1 ORDER BY value', [w.tenant])).rows;
    expect(used).toEqual([{ q: '5.000000', v: '600.0000' }, { q: '10.000000', v: '1000.0000' }]);
    const rest = ok(await issue(w, i, '5', { date: '2025-04-26' }));
    expect(rest.lines[0]).toMatchObject({ value: '-600.0000', balanceQuantity: '0.000000', balanceValue: '0.0000' });
    expect((await recon(w)).reconciled).toBe(true);
  });
  it('never goes negative, not even where the warehouse allows it for other items', async () => {
    const w = await world('FIFO Neg Co');
    const i = await item(w, { costingMethod: 'fifo' });
    ok(await receipt(w, i, '2', '10'));
    ok(await call(server, 'PATCH', `/v1/warehouses/${w.wh}/stock-settings`, { tenant: w.tenant, body: { allowNegativeStock: true } }), 200);
    const res = await issue(w, i, '3');
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: 'insufficient_stock', available: '2.000000', requested: '3' });
    expect((await balance(w, i))?.quantity).toBe('2.000000');
  });
});

describe('negative stock policy', () => {
  it('blocks by default, allows per warehouse for weighted-average items at the last cost, and recovers', async () => {
    const w = await world('Neg Co');
    const i = await item(w);
    ok(await receipt(w, i, '4', '25'));
    const blocked = await issue(w, i, '6');
    expect(blocked.status).toBe(409);
    expect(blocked.json).toMatchObject({ code: 'insufficient_stock', available: '4.000000' });
    ok(await call(server, 'PATCH', `/v1/warehouses/${w.wh}/stock-settings`, { tenant: w.tenant, body: { allowNegativeStock: true } }), 200);
    const over = ok(await issue(w, i, '6'));
    expect(over.lines[0]).toMatchObject({ quantity: '-6.000000', value: '-150.0000', balanceQuantity: '-2.000000', balanceValue: '-50.0000' }); // 4 @ avg, 2 @ last cost
    expect((await recon(w)).reconciled).toBe(true);
    ok(await receipt(w, i, '5', '30'));
    expect(await balance(w, i)).toMatchObject({ quantity: '3.000000' });
    expect((await recon(w)).reconciled).toBe(true);
    // the other warehouse still blocks
    expect((await issue(w, i, '1', { wh: w.wh2 })).json.code).toBe('insufficient_stock');
  });
});

describe('batches', () => {
  it('traces stock by batch with expiry, and refuses expired, blocked and missing batches', async () => {
    const w = await world('Batch Co');
    const i = await item(w, { tracking: 'batch' });
    const plain = await item(w);
    expect((await receipt(w, i, '10', '5')).json.code).toBe('batch_required');
    expect((await receipt(w, plain, '10', '5', { line: { batch: { batchNo: 'B1' } } })).json.code).toBe('item_not_batch_tracked');
    const r1 = ok(await receipt(w, i, '10', '5', { line: { batch: { batchNo: 'B-001', manufactureDate: '2025-03-01', expiryDate: '2025-06-30' } } }));
    expect(r1.lines[0].batchId).toBeTruthy();
    ok(await receipt(w, i, '4', '6', { line: { batch: { batchNo: 'B-002', expiryDate: '2026-01-31' } } }));
    ok(await receipt(w, i, '5', '5', { line: { batch: { batchNo: 'B-001' } } })); // same batch again: no dates given, adds to it
    expect((await receipt(w, i, '1', '5', { line: { batch: { batchNo: 'B-001', expiryDate: '2025-12-31' } } })).json.code).toBe('batch_mismatch');
    const bal = await balance(w, i);
    expect(bal?.quantity).toBe('19.000000');
    expect(bal?.batches.map((b) => [b.batchNo, b.quantity])).toEqual([['B-001', '15.000000'], ['B-002', '4.000000']]); // by expiry
    const b1 = r1.lines[0].batchId as string;
    expect((await issue(w, i, '16', { line: { batchId: b1 } })).json.code).toBe('insufficient_batch_stock');
    ok(await issue(w, i, '6', { line: { batchId: b1 } }));
    expect((await issue(w, i, '1', { date: '2025-07-01', line: { batchId: b1 } })).json.code).toBe('batch_expired');
    ok(await call(server, 'POST', `/v1/batches/${b1}/status`, { tenant: w.tenant, body: { status: 'blocked' } }), 200);
    expect((await issue(w, i, '1', { line: { batchId: b1 } })).json.code).toBe('batch_blocked');
    expect((await issue(w, i, '1')).json.code).toBe('batch_required');
    expect((await receipt(w, i, '1', '5', { date: '2025-07-01', line: { batch: { batchNo: 'B-OLD', expiryDate: '2025-06-01' } } })).json.code).toBe('batch_expired');
    const batches = (await call(server, 'GET', `/v1/items/${i}/batches`, { tenant: w.tenant })).json.items;
    expect(batches).toHaveLength(2);
    await expect(supers.query("UPDATE erp.batches SET expiry_date = '2030-01-01' WHERE id = $1", [b1])).rejects.toMatchObject({ code: '55000' });
    const sums = (await supers.query('SELECT sum(quantity)::text AS q FROM erp.stock_ledger WHERE tenant_id = $1 AND batch_id = $2', [w.tenant, b1])).rows[0];
    const held = (await supers.query('SELECT quantity::text AS q FROM erp.batch_balances WHERE tenant_id = $1 AND batch_id = $2', [w.tenant, b1])).rows[0];
    expect(held.q).toBe(sums.q);
  });
});

describe('serial numbers', () => {
  it('tracks each unit from receipt to issue', async () => {
    const w = await world('Serial Co');
    const i = await item(w, { tracking: 'serial', itemType: 'finished_good' });
    expect((await receipt(w, i, '3', '1000', { line: { serialNos: ['S1', 'S2'] } })).json.code).toBe('serial_required');
    expect((await receipt(w, i, '2.5', '1000', { line: { serialNos: ['S1', 'S2'] } })).json.code).toBe('serial_quantity');
    expect((await receipt(w, i, '2', '1000', { line: { serialNos: ['S1', 'S1'] } })).json.code).toBe('serial_required');
    const r = ok(await receipt(w, i, '3', '1000', { line: { serialNos: ['S1', 'S2', 'S3'] } }));
    expect(r.lines[0].serialNos).toEqual(['S1', 'S2', 'S3']);
    expect((await receipt(w, i, '1', '1000', { line: { serialNos: ['S2'] } })).json.code).toBe('serial_exists');
    expect((await issue(w, i, '1', { line: { serialNos: ['S9'] } })).json.code).toBe('serial_not_available');
    expect((await issue(w, i, '1', { wh: w.wh2, line: { serialNos: ['S1'] } })).json.code).toBe('insufficient_stock');
    const out = ok(await issue(w, i, '2', { line: { serialNos: ['S1', 'S3'] } }));
    expect(out.lines[0].serialNos).toEqual(['S1', 'S3']);
    expect((await issue(w, i, '1', { line: { serialNos: ['S1'] } })).json.code).toBe('serial_not_available'); // already issued
    const list = (await call(server, 'GET', `/v1/stock/serials?itemId=${i}`, { tenant: w.tenant })).json.items;
    expect(list.map((s: { serialNo: string; status: string }) => `${s.serialNo}:${s.status}`).sort()).toEqual(['S1:issued', 'S2:in_stock', 'S3:issued']);
    expect((await call(server, 'GET', `/v1/stock/serials?itemId=${i}&status=in_stock`, { tenant: w.tenant })).json.items).toHaveLength(1);
    const plain = await item(w);
    expect((await receipt(w, plain, '1', '1', { line: { serialNos: ['X'] } })).json.code).toBe('item_not_serial_tracked');
    await expect(supers.query("UPDATE erp.stock_serials SET serial_no = 'HACK' WHERE item_id = $1", [i])).rejects.toMatchObject({ code: '55000' });
  });
});

describe('posting controls and atomicity', () => {
  it('refuses control accounts as the offset, closed periods, inactive or foreign items, and unknown warehouses', async () => {
    const w = await world('Control Co');
    const i = await item(w);
    expect((await mv(w, { movementType: 'receipt', offsetAccountId: w.acc['2110'], lines: [{ warehouseId: w.wh, itemId: i, quantity: '1', unitCost: '1' }] })).json.code).toBe('control_account');
    expect((await mv(w, { movementType: 'receipt', offsetAccountId: w.acc['2100'], lines: [{ warehouseId: w.wh, itemId: i, quantity: '1', unitCost: '1' }] })).json.code).toBe('account_not_postable');
    ok(await receipt(w, i, '5', '10', { date: '2025-04-05' }));
    ok(await call(server, 'POST', `/v1/accounting-periods/${w.periods.find((p) => p.name === 'Apr 2025')?.id}/close`, { tenant: w.tenant }), 200);
    expect((await receipt(w, i, '1', '10', { date: '2025-04-20' })).json.code).toBe('period_closed'); // stock dates lock with the books
    expect((await issue(w, i, '1', { date: '2025-04-21' })).json.code).toBe('period_closed');
    expect((await receipt(w, i, '1', '10', { date: '2027-01-01' })).json.code).toBe('no_accounting_period');
    const svc = await item(w, { itemType: 'service', isStocked: false });
    expect((await receipt(w, svc, '1', '10', { date: '2025-05-02' })).json.code).toBe('item_not_stocked');
    await call(server, 'PATCH', `/v1/items/${i}`, { tenant: w.tenant, headers: { 'if-match': '1' }, body: { status: 'inactive' } });
    expect((await receipt(w, i, '1', '10', { date: '2025-05-02' })).json.code).toBe('item_inactive');
    const other = await world('Control Other');
    expect((await receipt(w, await item(w), '1', '1', { date: '2025-05-02', wh: other.wh })).status).toBe(422);
  });
  it('rolls the whole movement back when any part fails, leaving no ledger, balance, number or journal behind', async () => {
    const w = await world('Atomic Co');
    const raw = await item(w);
    const fg = await item(w, { itemType: 'finished_good' });
    const nos = (await supers.query("SELECT id FROM erp.units WHERE tenant_id = $1 AND code = 'NOS'", [w.tenant])).rows[0].id;
    const consumable = ok(await call(server, 'POST', '/v1/items', { tenant: w.tenant, body: { code: 'CONS-1', name: 'c', itemType: 'packing_material', baseUomId: nos } })).id; // packing material: not mapped
    const res = await mv(w, { movementType: 'receipt', offsetAccountId: w.acc['2140'], lines: [{ warehouseId: w.wh, itemId: raw, quantity: '1', unitCost: '10' }, { warehouseId: w.wh, itemId: consumable, quantity: '1', unitCost: '10' }] });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('stock_accounts_not_configured');
    const n = (await supers.query('SELECT (SELECT count(*) FROM erp.stock_ledger WHERE tenant_id = $1)::int AS l, (SELECT count(*) FROM erp.stock_movements WHERE tenant_id = $1)::int AS m, (SELECT count(*) FROM erp.stock_balances WHERE tenant_id = $1)::int AS b, (SELECT count(*) FROM erp.journal_entries WHERE tenant_id = $1)::int AS j', [w.tenant])).rows[0];
    expect(n).toEqual({ l: 0, m: 0, b: 0, j: 0 });
    expect(ok(await receipt(w, raw, '1', '10')).movementNo).toBe('SR/2526/000001'); // the number was not consumed
    void fg;
  });
  it('lets documents move stock once per source, with control accounts and in their own transaction', async () => {
    const w = await world('Doc Co');
    const i = await item(w);
    const req = { companyId: w.companyId, movementType: 'receipt' as const, postingDate: '2025-04-12', description: 'GRN-1', offsetAccountId: w.acc['2120'], allowControlOffset: true, source: { type: 'goods_receipt', id: 'grn-1' }, lines: [{ warehouseId: w.wh, itemId: i, direction: 'in' as const, quantity: '5', unitCost: '40' }] };
    const a = await uow.inTenant(w.tenant, (tx) => stock.move(tx, w.tenant, req));
    expect(a.replayed).toBe(false);
    expect((await uow.inTenant(w.tenant, (tx) => stock.move(tx, w.tenant, req))).replayed).toBe(true);
    expect((await balance(w, i))?.quantity).toBe('5.000000'); // not doubled
    await expect(uow.inTenant(w.tenant, async (tx) => { await stock.move(tx, w.tenant, { ...req, source: { type: 'goods_receipt', id: 'grn-2' } }); throw new Error('document failed'); })).rejects.toThrow('document failed');
    expect((await balance(w, i))?.quantity).toBe('5.000000');
  });
});

describe('invariants, immutability and concurrency', () => {
  it('keeps balances, ledger and GL in agreement through a mixed workload', async () => {
    const w = await world('Invariant Co');
    const wac = await item(w);
    const fifo = await item(w, { costingMethod: 'fifo', itemType: 'finished_good' });
    for (let n = 0; n < 6; n++) {
      ok(await receipt(w, wac, String(3 + n), String(10 + n * 1.5)));
      ok(await receipt(w, fifo, String(2 + n), String(100 + n * 7), { date: `2025-04-${10 + n}` }));
      if (n % 2) { ok(await issue(w, wac, '2.25')); ok(await issue(w, fifo, '3.5', { date: '2025-04-28' })); }
    }
    const diff = (await supers.query(`SELECT count(*)::int AS n FROM erp.stock_balances b
      LEFT JOIN (SELECT warehouse_id, item_id, sum(quantity) q, sum(value) v FROM erp.stock_ledger WHERE tenant_id = $1 GROUP BY 1, 2) l ON l.warehouse_id = b.warehouse_id AND l.item_id = b.item_id
      WHERE b.tenant_id = $1 AND (b.quantity <> COALESCE(l.q, 0) OR b.value <> COALESCE(l.v, 0))`, [w.tenant])).rows[0];
    expect(diff.n).toBe(0);
    const layers = (await supers.query(`SELECT count(*)::int AS n FROM erp.stock_layers y WHERE y.tenant_id = $1 AND y.item_id = $2
      AND y.remaining <> y.quantity - COALESCE((SELECT sum(c.quantity) FROM erp.stock_layer_consumptions c WHERE c.tenant_id = y.tenant_id AND c.layer_id = y.id), 0)`, [w.tenant, fifo])).rows[0];
    expect(layers.n).toBe(0);
    const r = await recon(w);
    expect(r.reconciled).toBe(true);
    const valuation = (await call(server, 'GET', `/v1/stock/valuation?companyId=${w.companyId}&asOf=2026-03-31`, { tenant: w.tenant })).json;
    expect(valuation.totalValue).toBe(r.stockTotal);
    const early = (await call(server, 'GET', `/v1/stock/valuation?companyId=${w.companyId}&asOf=2025-04-11`, { tenant: w.tenant })).json;
    expect(early.totalValue).not.toBe(valuation.totalValue); // the as-of valuation really is a point in time
    expect(early.rows.length).toBeGreaterThan(0);
    const card = (await call(server, 'GET', `/v1/stock/card?companyId=${w.companyId}&itemId=${wac}`, { tenant: w.tenant })).json;
    expect(card.items.length).toBe(9);
    expect(card.items.at(-1).balanceQuantity).toBe((await balance(w, wac))?.quantity);
  });
  it('is immutable at the database, even for a superuser', async () => {
    const w = await world('Immutable Stock Co');
    const i = await item(w);
    const m = ok(await receipt(w, i, '5', '10'));
    const pool = appPool(1);
    try {
      await expect(pool.query('UPDATE erp.stock_ledger SET quantity = 1')).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('DELETE FROM erp.stock_movements')).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('TRUNCATE erp.stock_ledger')).rejects.toMatchObject({ code: '42501' });
    } finally { await pool.end(); }
    for (const sql of ["UPDATE erp.stock_ledger SET quantity = 1 WHERE movement_id = $1", 'DELETE FROM erp.stock_ledger WHERE movement_id = $1', "UPDATE erp.stock_movements SET description = 'x' WHERE id = $1", 'DELETE FROM erp.stock_movements WHERE id = $1', "UPDATE erp.stock_movements SET journal_entry_id = NULL WHERE id = $1"]) {
      await expect(supers.query(sql, [m.id]), sql).rejects.toMatchObject({ code: '55000' });
    }
    await expect(supers.query('TRUNCATE erp.stock_ledger')).rejects.toThrow(); // referenced by foreign keys, and guarded by a trigger
    await expect(supers.query("INSERT INTO erp.stock_ledger (tenant_id, id, movement_id, company_id, line_no, warehouse_id, item_id, posting_date, quantity, unit_cost, value, balance_quantity, balance_value) VALUES ($1, gen_random_uuid(), $2, $3, 9, $4, $5, '2025-04-10', 1, 1, 1, 1, 1)", [w.tenant, m.id, w.companyId, w.wh, i])).rejects.toMatchObject({ code: '55000' }); // a late line
  });
  it('freezes an item\'s costing method once it has stock, and nothing before', async () => {
    const w = await world('Costing Freeze Co');
    const i = await item(w);
    const ch = (method: string, version: number) => call(server, 'PATCH', `/v1/items/${i}`, { tenant: w.tenant, headers: { 'if-match': String(version) }, body: { costingMethod: method } });
    const before = await ch('fifo', 1);
    expect(before.status).toBe(200);
    expect(before.json.costingMethod).toBe('fifo');
    ok(await receipt(w, i, '1', '1'));
    const after = await ch('weighted_average', 2);
    expect(after.status).toBe(409);
    expect(after.json.code).toBe('immutable');
    await expect(supers.query("UPDATE erp.items SET tracking = 'batch' WHERE id = $1", [i])).rejects.toMatchObject({ code: '55000' });
  });
  it('never oversells under 20 simultaneous issues, and avoids deadlocks across lines in opposite order', async () => {
    const w = await world('Race Stock Co');
    const a = await item(w);
    const b = await item(w);
    ok(await receipt(w, a, '10', '5'));
    const results = await Promise.all(Array.from({ length: 20 }, () => issue(w, a, '1')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 409).every((r) => r.json.code === 'insufficient_stock')).toBe(true);
    expect(await balance(w, a)).toMatchObject({ quantity: '0.000000', value: '0.0000' });
    ok(await mv(w, { movementType: 'receipt', offsetAccountId: w.acc['2140'], lines: [{ warehouseId: w.wh, itemId: a, quantity: '100', unitCost: '1' }, { warehouseId: w.wh, itemId: b, quantity: '100', unitCost: '1' }] }));
    const crossing = await Promise.all(Array.from({ length: 16 }, (_, n) => mv(w, { movementType: 'issue', offsetAccountId: w.acc['5100'], lines: n % 2 ? [{ warehouseId: w.wh, itemId: a, quantity: '1' }, { warehouseId: w.wh, itemId: b, quantity: '1' }] : [{ warehouseId: w.wh, itemId: b, quantity: '1' }, { warehouseId: w.wh, itemId: a, quantity: '1' }] })));
    expect(new Set(crossing.map((r) => r.status))).toEqual(new Set([201]));
    expect((await balance(w, a))?.quantity).toBe('84.000000');
    expect((await balance(w, b))?.quantity).toBe('84.000000');
    expect((await recon(w)).reconciled).toBe(true);
  });
  it('replays an idempotent movement and audits it', async () => {
    const w = await world('Idem Stock Co');
    const i = await item(w);
    const body = { companyId: w.companyId, movementType: 'receipt', postingDate: '2025-04-10', description: 'Idem', offsetAccountId: w.acc['2140'], lines: [{ warehouseId: w.wh, itemId: i, quantity: '3', unitCost: '9' }] };
    const one = await call(server, 'POST', '/v1/stock/movements', { tenant: w.tenant, headers: { 'idempotency-key': 'mv-1' }, body });
    const two = await call(server, 'POST', '/v1/stock/movements', { tenant: w.tenant, headers: { 'idempotency-key': 'mv-1' }, body });
    expect(two.headers.get('idempotent-replayed')).toBe('true');
    expect(two.json.id).toBe(one.json.id);
    expect((await balance(w, i))?.quantity).toBe('3.000000');
    const a = (await supers.query("SELECT count(*)::int AS n FROM erp.audit_log WHERE tenant_id = $1 AND action = 'stock_movement.posted'", [w.tenant])).rows[0];
    expect(a.n).toBe(1);
  });
});

describe('access, listing and isolation', () => {
  it('separates reading from posting, lists movements, and keeps tenants apart', async () => {
    const w = await world('Access Stock Co');
    const i = await item(w);
    const m = ok(await receipt(w, i, '2', '10'));
    ok(await issue(w, i, '1'));
    const key = (permissions: string[]) => call(server, 'POST', '/v1/api-keys', { tenant: w.tenant, body: { name: 'k', permissions } }).then((r) => r.json.key as string);
    const reader = await key(['stock:read']);
    expect((await call(server, 'GET', `/v1/stock/movements/${m.id}`, { token: reader })).json.lines).toHaveLength(1);
    expect((await call(server, 'GET', `/v1/stock/balances?companyId=${w.companyId}`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/stock/movements', { token: reader, body: {} })).status).toBe(403);
    expect((await call(server, 'PUT', `/v1/companies/${w.companyId}/stock-settings`, { token: reader, body: { adjustmentAccountId: null } })).status).toBe(403);
    const all = (await call(server, 'GET', `/v1/stock/movements?companyId=${w.companyId}`, { tenant: w.tenant })).json;
    expect(all.items.map((x: { movementType: string }) => x.movementType)).toEqual(['issue', 'receipt']);
    expect((await call(server, 'GET', `/v1/stock/movements?companyId=${w.companyId}&movementType=receipt&itemId=${i}`, { tenant: w.tenant })).json.items).toHaveLength(1);
    expect(JSON.stringify(all)).not.toContain('txId');
    const other = await world('Access Stock Other');
    expect((await call(server, 'GET', `/v1/stock/movements/${m.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/stock/balances?companyId=${w.companyId}`, { tenant: other.tenant })).json.items).toEqual([]);
    expect((await mv(other, { movementType: 'receipt', offsetAccountId: other.acc['2140'], lines: [{ warehouseId: w.wh, itemId: i, quantity: '1', unitCost: '1' }] })).status).toBe(422); // another tenant's warehouse and item
  });
});
