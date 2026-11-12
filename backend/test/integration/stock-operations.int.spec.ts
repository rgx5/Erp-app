import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, startServer, superPool, type TestServer } from '../support/harness.js';

let server: TestServer;
const supers = superPool();
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server.close(); await supers.end(); });

const ok = (res: { status: number; json: unknown }, status = 201) => { expect(res.status, JSON.stringify(res.json)).toBe(status); return res.json as any; }; // eslint-disable-line

interface World { tenant: string; companyId: string; acc: Record<string, string>; wh: string; wh2: string; transit: string; periods: { id: string; name: string }[] }
async function world(name: string): Promise<World> {
  const tenant = await createTenant(server, name);
  const companyId = ok(await call(server, 'POST', '/v1/companies', { tenant, body: { legalName: `${name} Ltd` } })).id as string;
  ok(await call(server, 'POST', `/v1/companies/${companyId}/chart-of-accounts/template`, { tenant, body: { template: 'manufacturing_india' } }));
  const acc: Record<string, string> = {};
  for (const a of (await call(server, 'GET', `/v1/accounts?companyId=${companyId}&limit=200`, { tenant })).json.items) acc[a.code] = a.id;
  const fy = ok(await call(server, 'POST', '/v1/fiscal-years', { tenant, body: { companyId, startDate: '2025-04-01' } }));
  const loc = ok(await call(server, 'POST', '/v1/business-locations', { tenant, body: { companyId, code: 'HO', name: 'HO', addressLine1: '1 Main Rd', city: 'Pune', stateCode: '27', pincode: '411001' } }));
  const mk = async (code: string, kind = 'general') => ok(await call(server, 'POST', '/v1/warehouses', { tenant, body: { businessLocationId: loc.id, code, name: code, kind } })).id as string;
  for (const [type, code] of [['raw_material', '1210'], ['finished_good', '1240']] as const) ok(await call(server, 'PUT', `/v1/companies/${companyId}/inventory-accounts`, { tenant, body: { itemType: type, accountId: acc[code] } }), 200);
  ok(await call(server, 'PUT', `/v1/companies/${companyId}/stock-settings`, { tenant, body: { adjustmentAccountId: acc['5300'], openingBalanceAccountId: acc['3100'] } }), 200);
  return { tenant, companyId, acc, wh: await mk('MAIN'), wh2: await mk('SECOND'), transit: await mk('TRANSIT', 'in_transit'), periods: fy.periods };
}
let n = 0;
const item = async (w: World, o: object = {}) => {
  const nos = ((await call(server, 'GET', '/v1/units?limit=200', { tenant: w.tenant })).json.items as { id: string; code: string }[]).find((u) => u.code === 'NOS')?.id;
  return ok(await call(server, 'POST', '/v1/items', { tenant: w.tenant, body: { code: `OP-${++n}`, name: 'Thing', itemType: 'raw_material', baseUomId: nos, ...o } })).id as string;
};
const post = (w: World, path: string, body: object) => call(server, 'POST', path, { tenant: w.tenant, body });
const receipt = (w: World, itemId: string, q: string, cost: string, o: { date?: string; wh?: string; line?: object } = {}) =>
  post(w, '/v1/stock/movements', { companyId: w.companyId, movementType: 'receipt', postingDate: o.date ?? '2025-04-10', description: 'Receipt', offsetAccountId: w.acc['2140'], lines: [{ warehouseId: o.wh ?? w.wh, itemId, quantity: q, unitCost: cost, ...o.line }] });
const issue = (w: World, itemId: string, q: string, o: { wh?: string; line?: object; date?: string } = {}) =>
  post(w, '/v1/stock/movements', { companyId: w.companyId, movementType: 'issue', postingDate: o.date ?? '2025-04-10', description: 'Issue', offsetAccountId: w.acc['5100'], lines: [{ warehouseId: o.wh ?? w.wh, itemId, quantity: q, ...o.line }] });
const balance = async (w: World, itemId: string, wh: string) => (await call(server, 'GET', `/v1/stock/balances?companyId=${w.companyId}&itemId=${itemId}&warehouseId=${wh}`, { tenant: w.tenant })).json.items[0] as { quantity: string; value: string; averageCost: string; batches: { batchNo: string; quantity: string }[] } | undefined;
const recon = async (w: World) => (await call(server, 'GET', `/v1/inventory/reconciliation?companyId=${w.companyId}&asOf=2026-03-31`, { tenant: w.tenant })).json;
const journals = async (w: World) => Number((await supers.query('SELECT count(*) AS n FROM erp.journal_entries WHERE tenant_id = $1', [w.tenant])).rows[0].n);
const availability = async (w: World, itemId: string, wh = w.wh) => (await call(server, 'GET', `/v1/stock/availability?companyId=${w.companyId}&itemId=${itemId}&warehouseId=${wh}`, { tenant: w.tenant })).json.warehouses[0];
const reserve = (w: World, itemId: string, q: string, o: object = {}) => post(w, '/v1/stock/reservations', { companyId: w.companyId, warehouseId: w.wh, itemId, quantity: q, referenceType: 'sales_order', referenceId: `SO-${++n}`, ...o });
const transfer = (w: World, lines: object[], o: object = {}) => post(w, '/v1/stock/transfers', { companyId: w.companyId, fromWarehouseId: w.wh, toWarehouseId: w.wh2, postingDate: '2025-04-12', description: 'Move', lines, ...o });

describe('reservations', () => {
  it('holds stock back from other issues until consumed or released', async () => {
    const w = await world('Reserve Co');
    const i = await item(w);
    ok(await receipt(w, i, '10', '5'));
    const r = ok(await reserve(w, i, '6'));
    expect(r).toMatchObject({ status: 'active', quantity: '6.000000', consumedQuantity: '0.000000' });
    expect(await availability(w, i)).toMatchObject({ onHand: '10.000000', reserved: '6.000000', available: '4.000000' });
    const blocked = await issue(w, i, '5');
    expect(blocked.status).toBe(409);
    expect(blocked.json).toMatchObject({ code: 'insufficient_stock', available: '4.000000', reserved: '6.000000' });
    ok(await issue(w, i, '4'));
    // the reservation's own order can take its stock
    const part = ok(await issue(w, i, '2', { line: { reservationId: r.id } }));
    expect(part.lines[0].quantity).toBe('-2.000000');
    expect((await call(server, 'GET', `/v1/stock/reservations/${r.id}`, { tenant: w.tenant })).json).toMatchObject({ status: 'active', consumedQuantity: '2.000000' });
    expect((await issue(w, i, '5', { line: { reservationId: r.id } })).json.code).toBe('reservation_exceeded');
    ok(await issue(w, i, '4', { line: { reservationId: r.id } }));
    expect((await call(server, 'GET', `/v1/stock/reservations/${r.id}`, { tenant: w.tenant })).json.status).toBe('fulfilled');
    expect((await issue(w, i, '1', { line: { reservationId: r.id } })).json.code).toBe('reservation_invalid');
    expect(await balance(w, i, w.wh)).toMatchObject({ quantity: '0.000000' });
  });
  it('releases the unconsumed part, and expired reservations stop holding stock', async () => {
    const w = await world('Release Co');
    const i = await item(w);
    ok(await receipt(w, i, '10', '5'));
    const a = ok(await reserve(w, i, '7'));
    const released = ok(await post(w, `/v1/stock/reservations/${a.id}/release`, {}), 200);
    expect(released.status).toBe('released');
    expect((await post(w, `/v1/stock/reservations/${a.id}/release`, {})).json.code).toBe('reservation_not_active');
    expect(await availability(w, i)).toMatchObject({ reserved: '0.000000', available: '10.000000' });
    const b = ok(await reserve(w, i, '8', { expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
    expect((await issue(w, i, '5')).status).toBe(409);
    await supers.query("UPDATE erp.stock_reservations SET expires_at = now() - interval '1 minute' WHERE id = $1", [b.id]);
    expect(await availability(w, i)).toMatchObject({ reserved: '0.000000', available: '10.000000' });
    expect((await issue(w, i, '5', { line: { reservationId: b.id } })).json.code).toBe('reservation_invalid');
    ok(await issue(w, i, '5'));
  });
  it('cannot over-reserve, and never lets a reservation and an issue both claim the last unit', async () => {
    const w = await world('Race Reserve Co');
    const i = await item(w);
    ok(await receipt(w, i, '5', '5'));
    expect((await reserve(w, i, '6')).json.code).toBe('insufficient_stock');
    const many = await Promise.all(Array.from({ length: 12 }, () => reserve(w, i, '1')));
    expect(many.filter((r) => r.status === 201)).toHaveLength(5);
    expect(await availability(w, i)).toMatchObject({ reserved: '5.000000', available: '0.000000' });
    const j = await item(w);
    ok(await receipt(w, j, '1', '5'));
    const [a, b] = await Promise.all([reserve(w, j, '1'), issue(w, j, '1')]);
    expect([a.status, b.status].filter((s) => s === 201)).toHaveLength(1);
  });
  it('reserves a specific batch and protects it from other issues', async () => {
    const w = await world('Batch Reserve Co');
    const i = await item(w, { tracking: 'batch' });
    const r1 = ok(await receipt(w, i, '10', '5', { line: { batch: { batchNo: 'B1', expiryDate: '2026-01-01' } } }));
    const b1 = r1.lines[0].batchId as string;
    ok(await receipt(w, i, '10', '5', { line: { batch: { batchNo: 'B2', expiryDate: '2026-02-01' } } }));
    const res = ok(await reserve(w, i, '8', { batchId: b1 }));
    expect((await reserve(w, i, '3', { batchId: b1 })).json.code).toBe('insufficient_batch_stock');
    expect((await issue(w, i, '3', { line: { batchId: b1 } })).json.code).toBe('insufficient_batch_stock'); // only 2 of B1 are free
    ok(await issue(w, i, '2', { line: { batchId: b1 } }));
    ok(await issue(w, i, '8', { line: { batchId: b1, reservationId: res.id } }));
    expect((await reserve(w, i, '1', { batchId: b1 })).json.code).toBe('insufficient_batch_stock'); // B2 still has stock, B1 has none
  });
  it('lists by reference and rejects what cannot be reserved', async () => {
    const w = await world('Reserve Misc Co');
    const i = await item(w);
    const svc = await item(w, { itemType: 'service', isStocked: false });
    const serial = await item(w, { tracking: 'serial', itemType: 'finished_good' });
    ok(await receipt(w, i, '5', '1'));
    ok(await reserve(w, i, '1', { referenceId: 'SO-A' }));
    ok(await reserve(w, i, '1', { referenceId: 'SO-B' }));
    expect((await call(server, 'GET', `/v1/stock/reservations?companyId=${w.companyId}&referenceId=SO-A`, { tenant: w.tenant })).json.items).toHaveLength(1);
    expect((await reserve(w, svc, '1')).json.code).toBe('item_not_stocked');
    expect((await reserve(w, serial, '1')).json.code).toBe('serial_reservation');
    expect((await reserve(w, i, '1', { warehouseId: w.transit })).json.code).toBe('warehouse_not_reservable');
    const other = await world('Reserve Other');
    expect((await call(server, 'GET', `/v1/stock/reservations?companyId=${w.companyId}`, { tenant: other.tenant })).json.items).toEqual([]);
  });
});

describe('transfers', () => {
  it('moves stock directly at its cost, with no GL entry and no revaluation', async () => {
    const w = await world('Direct Co');
    const i = await item(w);
    ok(await receipt(w, i, '10', '100'));
    ok(await receipt(w, i, '10', '120'));
    const before = await journals(w);
    const t = ok(await transfer(w, [{ itemId: i, quantity: '8' }]));
    expect(t).toMatchObject({ status: 'completed', transferNo: 'TF/2526/000001' });
    expect(t.lines[0]).toMatchObject({ quantity: '8.000000', receivedQuantity: '8.000000' });
    expect(await balance(w, i, w.wh)).toMatchObject({ quantity: '12.000000', value: '1320.0000', averageCost: '110.000000' });
    expect(await balance(w, i, w.wh2)).toMatchObject({ quantity: '8.000000', value: '880.0000', averageCost: '110.000000' }); // same cost
    expect(await journals(w)).toBe(before); // inside one inventory account: nothing to post
    expect((await recon(w)).reconciled).toBe(true);
    const mv = (await supers.query("SELECT movement_type, journal_entry_id, source_event FROM erp.stock_movements WHERE tenant_id = $1 AND source_type = 'stock_transfer'", [w.tenant])).rows;
    expect(mv).toEqual([{ movement_type: 'transfer_direct', journal_entry_id: null, source_event: 'direct' }]);
  });
  it('keeps FIFO layers (cost and date) when stock moves', async () => {
    const w = await world('FIFO Move Co');
    const i = await item(w, { costingMethod: 'fifo' });
    ok(await receipt(w, i, '5', '100', { date: '2025-04-05' }));
    ok(await receipt(w, i, '5', '130', { date: '2025-04-15' }));
    ok(await transfer(w, [{ itemId: i, quantity: '7' }], { postingDate: '2025-04-20' })); // 5 @ 100 then 2 @ 130
    ok(await receipt(w, i, '4', '90', { date: '2025-04-18', wh: w.wh2 }));
    const out = ok(await issue(w, i, '9', { wh: w.wh2, date: '2025-04-25' })); // layers at dest by date: 5 @ 100 (04-05), 4 @ 90 (04-18)... then 2 @ 130 (04-15)
    // oldest first by received date: 04-05 (5 @ 100), 04-15 (2 @ 130), 04-18 (2 of 4 @ 90)
    expect(out.lines[0].value).toBe('-940.0000'); // 500 + 260 + 180
    expect((await recon(w)).reconciled).toBe(true);
  });
  it('goes through an in-transit warehouse in two steps, with partial receipts', async () => {
    const w = await world('Transit Co');
    const i = await item(w);
    ok(await receipt(w, i, '10', '50'));
    const before = await journals(w);
    const t = ok(await transfer(w, [{ itemId: i, quantity: '10' }], { transitWarehouseId: w.transit }));
    expect(t.status).toBe('in_transit');
    expect(await balance(w, i, w.wh)).toMatchObject({ quantity: '0.000000' });
    expect(await balance(w, i, w.transit)).toMatchObject({ quantity: '10.000000', value: '500.0000' }); // still on the books while it travels
    expect(await balance(w, i, w.wh2)).toBeUndefined();
    expect((await recon(w)).reconciled).toBe(true);
    const lineId = t.lines[0].id as string;
    const half = ok(await post(w, `/v1/stock/transfers/${t.id}/receive`, { postingDate: '2025-04-14', lines: [{ lineId, quantity: '4' }] }), 200);
    expect(half.status).toBe('partially_received');
    expect(await balance(w, i, w.wh2)).toMatchObject({ quantity: '4.000000', value: '200.0000' });
    expect((await post(w, `/v1/stock/transfers/${t.id}/receive`, { postingDate: '2025-04-14', lines: [{ lineId, quantity: '7' }] })).json.code).toBe('receive_exceeds_dispatch');
    expect((await post(w, `/v1/stock/transfers/${t.id}/cancel`, { postingDate: '2025-04-14', reason: 'x' })).json.code).toBe('partially_received');
    const done = ok(await post(w, `/v1/stock/transfers/${t.id}/receive`, { postingDate: '2025-04-15' }), 200);
    expect(done.status).toBe('completed');
    expect(done.lines[0].receivedQuantity).toBe('10.000000');
    expect(await balance(w, i, w.transit)).toMatchObject({ quantity: '0.000000', value: '0.0000' });
    expect(await balance(w, i, w.wh2)).toMatchObject({ quantity: '10.000000', value: '500.0000' });
    expect((await post(w, `/v1/stock/transfers/${t.id}/receive`, { postingDate: '2025-04-16' })).json.code).toBe('transfer_not_in_transit');
    expect(await journals(w)).toBe(before);
    expect((await recon(w)).reconciled).toBe(true);
  });
  it('cancels an undelivered transfer back to the source', async () => {
    const w = await world('Cancel Transfer Co');
    const i = await item(w);
    ok(await receipt(w, i, '6', '10'));
    const t = ok(await transfer(w, [{ itemId: i, quantity: '6' }], { transitWarehouseId: w.transit }));
    const c = ok(await post(w, `/v1/stock/transfers/${t.id}/cancel`, { postingDate: '2025-04-13', reason: 'Truck cancelled' }), 200);
    expect(c.status).toBe('cancelled');
    expect(await balance(w, i, w.wh)).toMatchObject({ quantity: '6.000000', value: '60.0000' });
    expect(await balance(w, i, w.transit)).toMatchObject({ quantity: '0.000000' });
    expect((await post(w, `/v1/stock/transfers/${t.id}/receive`, { postingDate: '2025-04-14' })).json.code).toBe('transfer_not_in_transit');
    expect((await recon(w)).reconciled).toBe(true);
  });
  it('carries batches and serial numbers with the stock', async () => {
    const w = await world('Trace Move Co');
    const b = await item(w, { tracking: 'batch' });
    const s = await item(w, { tracking: 'serial', itemType: 'finished_good' });
    const r = ok(await receipt(w, b, '10', '5', { line: { batch: { batchNo: 'L1', expiryDate: '2026-03-01' } } }));
    ok(await receipt(w, s, '3', '900', { line: { serialNos: ['U1', 'U2', 'U3'] } }));
    const t = ok(await transfer(w, [{ itemId: b, quantity: '6', batchId: r.lines[0].batchId }, { itemId: s, quantity: '3', serialNos: ['U1', 'U2', 'U3'] }], { transitWarehouseId: w.transit }));
    const serialLine = t.lines.find((l: { serialNos: string[] | null }) => l.serialNos) as { id: string };
    const batchLine = t.lines.find((l: { serialNos: string[] | null }) => !l.serialNos) as { id: string };
    expect((await post(w, `/v1/stock/transfers/${t.id}/receive`, { postingDate: '2025-04-13', lines: [{ lineId: serialLine.id, quantity: '2' }] })).json.code).toBe('serial_required');
    expect((await post(w, `/v1/stock/transfers/${t.id}/receive`, { postingDate: '2025-04-13', lines: [{ lineId: serialLine.id, quantity: '1', serialNos: ['ZZ'] }] })).json.code).toBe('serial_required');
    ok(await post(w, `/v1/stock/transfers/${t.id}/receive`, { postingDate: '2025-04-13', lines: [{ lineId: serialLine.id, quantity: '2', serialNos: ['U1', 'U3'] }, { lineId: batchLine.id, quantity: '6' }] }), 200);
    const where = async () => Object.fromEntries((await supers.query('SELECT serial_no, w.code AS wh, s.status FROM erp.stock_serials s JOIN erp.warehouses w ON w.id = s.warehouse_id WHERE s.tenant_id = $1 AND s.item_id = $2', [w.tenant, s])).rows.map((x) => [x.serial_no, `${x.wh}:${x.status}`]));
    expect(await where()).toEqual({ U1: 'SECOND:in_stock', U2: 'TRANSIT:in_stock', U3: 'SECOND:in_stock' });
    expect((await balance(w, b, w.wh2))?.batches).toEqual([expect.objectContaining({ batchNo: 'L1', quantity: '6.000000' })]);
    expect((await balance(w, b, w.wh))?.batches).toEqual([expect.objectContaining({ batchNo: 'L1', quantity: '4.000000' })]);
    ok(await post(w, `/v1/stock/transfers/${t.id}/receive`, { postingDate: '2025-04-14' }), 200); // the remaining serial is offered automatically
    expect(await where()).toEqual({ U1: 'SECOND:in_stock', U2: 'SECOND:in_stock', U3: 'SECOND:in_stock' });
    ok(await issue(w, s, '1', { wh: w.wh2, line: { serialNos: ['U2'] } })); // and can then be issued from the new warehouse
    expect((await recon(w)).reconciled).toBe(true);
  });
  it('validates warehouses, stock and periods', async () => {
    const w = await world('Transfer Rules Co');
    const i = await item(w);
    ok(await receipt(w, i, '3', '10'));
    expect((await transfer(w, [{ itemId: i, quantity: '4' }])).json.code).toBe('insufficient_stock');
    expect((await transfer(w, [{ itemId: i, quantity: '1' }], { toWarehouseId: w.wh })).status).toBe(422);
    expect((await transfer(w, [{ itemId: i, quantity: '1' }], { toWarehouseId: w.transit })).json.code).toBe('warehouse_kind');
    expect((await transfer(w, [{ itemId: i, quantity: '1' }], { transitWarehouseId: w.wh2 })).status).toBe(422);
    expect((await transfer(w, [{ itemId: i, quantity: '1' }], { postingDate: '2027-01-01' })).json.code).toBe('no_accounting_period');
    const n1 = (await supers.query('SELECT count(*)::int AS c FROM erp.stock_transfers WHERE tenant_id = $1', [w.tenant])).rows[0].c;
    expect(n1).toBe(0); // every refusal rolled back completely
    ok(await call(server, 'POST', `/v1/accounting-periods/${w.periods.find((p) => p.name === 'Apr 2025')?.id}/close`, { tenant: w.tenant }), 200);
    expect((await transfer(w, [{ itemId: i, quantity: '1' }])).json.code).toBe('period_closed');
    const other = await world('Transfer Other');
    expect((await post(other, '/v1/stock/transfers', { companyId: other.companyId, fromWarehouseId: w.wh, toWarehouseId: other.wh2, postingDate: '2025-04-12', description: 'x', lines: [{ itemId: i, quantity: '1' }] })).status).toBe(422);
  });
  it('never deadlocks when transfers run in opposite directions at once', async () => {
    const w = await world('Opposite Co');
    const a = await item(w);
    const b = await item(w);
    for (const wh of [w.wh, w.wh2]) for (const x of [a, b]) ok(await receipt(w, x, '50', '2', { wh }));
    const run = (n: number) => n % 2
      ? transfer(w, [{ itemId: a, quantity: '1' }, { itemId: b, quantity: '1' }])
      : transfer(w, [{ itemId: b, quantity: '1' }, { itemId: a, quantity: '1' }], { fromWarehouseId: w.wh2, toWarehouseId: w.wh });
    const results = await Promise.all(Array.from({ length: 20 }, (_, k) => run(k)));
    expect(new Set(results.map((r) => r.status))).toEqual(new Set([201]));
    expect((await balance(w, a, w.wh))?.quantity).toBe('50.000000');
    expect((await balance(w, b, w.wh2))?.quantity).toBe('50.000000');
    expect((await recon(w)).reconciled).toBe(true);
  });
});

describe('physical counts', () => {
  it('turns counted differences into one adjustment, valued and posted to the GL', async () => {
    const w = await world('Count Co');
    const a = await item(w);
    const b = await item(w);
    const c = await item(w);
    ok(await receipt(w, a, '10', '20'));
    ok(await receipt(w, b, '5', '40'));
    ok(await receipt(w, c, '8', '10'));
    const count = ok(await post(w, '/v1/stock/counts', { companyId: w.companyId, warehouseId: w.wh, countDate: '2025-04-30', description: 'April count' }));
    expect(count).toMatchObject({ status: 'open', countNo: 'CN/2526/000001' });
    expect(count.lines).toHaveLength(3);
    const line = (id: string) => count.lines.find((l: { itemId: string }) => l.itemId === id).id as string;
    expect((await post(w, `/v1/stock/counts/${count.id}/post`, { postingDate: '2025-04-30' })).json.code).toBe('count_incomplete');
    const counted = ok(await call(server, 'PUT', `/v1/stock/counts/${count.id}/counted`, { tenant: w.tenant, body: { lines: [{ lineId: line(a), countedQuantity: '9' }, { lineId: line(b), countedQuantity: '6.5', unitCost: '44' }, { lineId: line(c), countedQuantity: '8' }] } }), 200);
    expect(counted.lines.find((l: { itemId: string }) => l.itemId === a).countedQuantity).toBe('9.000000');
    // a movement between the snapshot and the posting is measured, not double counted
    ok(await issue(w, a, '1'));
    const posted = ok(await post(w, `/v1/stock/counts/${count.id}/post`, { postingDate: '2025-04-30' }), 200);
    expect(posted.status).toBe('posted');
    expect(posted.movementId).toBeTruthy();
    const v = (id: string) => posted.lines.find((l: { itemId: string }) => l.itemId === id);
    expect(v(a)).toMatchObject({ systemQuantity: '9.000000', variance: '0.000000' }); // already issued: nothing to adjust
    expect(v(b)).toMatchObject({ systemQuantity: '5.000000', variance: '1.500000' });
    expect(v(c)).toMatchObject({ variance: '0.000000' });
    expect(await balance(w, b, w.wh)).toMatchObject({ quantity: '6.500000', value: '266.0000' }); // 200 + 1.5 x 44
    const mv = (await call(server, 'GET', `/v1/stock/movements/${posted.movementId}`, { tenant: w.tenant })).json;
    expect(mv).toMatchObject({ movementType: 'count_adjustment', movementNo: 'SC/2526/000001' });
    expect(mv.lines).toHaveLength(1);
    const tb = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${w.companyId}&from=2025-04-01&to=2025-04-30`, { tenant: w.tenant })).json;
    expect(tb.rows.find((r: { code: string }) => r.code === '5300')).toMatchObject({ credit: '66.0000' });
    expect((await recon(w)).reconciled).toBe(true);
    expect((await post(w, `/v1/stock/counts/${count.id}/post`, { postingDate: '2025-04-30' })).json.code).toBe('count_not_open');
    await expect(supers.query('UPDATE erp.stock_count_lines SET counted_quantity = 99 WHERE count_id = $1', [count.id])).rejects.toMatchObject({ code: '55000' });
  });
  it('counts losses at the valuation cost, records zero-variance counts without a movement, and handles found stock', async () => {
    const w = await world('Count Loss Co');
    const a = await item(w);
    const found = await item(w);
    ok(await receipt(w, a, '10', '30'));
    const count = ok(await post(w, '/v1/stock/counts', { companyId: w.companyId, warehouseId: w.wh, countDate: '2025-04-30', description: 'Spot check' }));
    const added = ok(await post(w, `/v1/stock/counts/${count.id}/lines`, { itemId: found }));
    expect(added.snapshotQuantity).toBe('0.000000');
    ok(await call(server, 'PUT', `/v1/stock/counts/${count.id}/counted`, { tenant: w.tenant, body: { lines: [{ lineId: count.lines[0].id, countedQuantity: '7' }, { lineId: added.id, countedQuantity: '2', unitCost: '15' }] } }), 200);
    const posted = ok(await post(w, `/v1/stock/counts/${count.id}/post`, { postingDate: '2025-04-30' }), 200);
    expect(await balance(w, a, w.wh)).toMatchObject({ quantity: '7.000000', value: '210.0000' }); // 3 lost at the average of 30
    expect(await balance(w, found, w.wh)).toMatchObject({ quantity: '2.000000', value: '30.0000' });
    expect(posted.lines.map((l: { variance: string }) => l.variance).sort()).toEqual(['-3.000000', '2.000000']);
    expect((await recon(w)).reconciled).toBe(true);
    const quiet = ok(await post(w, '/v1/stock/counts', { companyId: w.companyId, warehouseId: w.wh, countDate: '2025-04-30', description: 'All fine' }));
    ok(await call(server, 'PUT', `/v1/stock/counts/${quiet.id}/counted`, { tenant: w.tenant, body: { lines: quiet.lines.map((l: { id: string; snapshotQuantity: string }) => ({ lineId: l.id, countedQuantity: l.snapshotQuantity })) } }), 200);
    const calm = ok(await post(w, `/v1/stock/counts/${quiet.id}/post`, { postingDate: '2025-04-30' }), 200);
    expect(calm).toMatchObject({ status: 'posted', movementId: null });
  });
  it('counts batches separately, leaves serial items out, and can be cancelled', async () => {
    const w = await world('Count Batch Co');
    const b = await item(w, { tracking: 'batch' });
    const s = await item(w, { tracking: 'serial', itemType: 'finished_good' });
    ok(await receipt(w, b, '10', '5', { line: { batch: { batchNo: 'X1', expiryDate: '2026-01-01' } } }));
    ok(await receipt(w, b, '4', '5', { line: { batch: { batchNo: 'X2', expiryDate: '2026-01-01' } } }));
    ok(await receipt(w, s, '2', '100', { line: { serialNos: ['A', 'B'] } }));
    const count = ok(await post(w, '/v1/stock/counts', { companyId: w.companyId, warehouseId: w.wh, countDate: '2025-04-30', description: 'By batch' }));
    expect(count.lines).toHaveLength(2); // two batches; the serial item is not counted this way
    expect((await post(w, '/v1/stock/counts', { companyId: w.companyId, warehouseId: w.wh, countDate: '2025-04-30', description: 'x', itemIds: [s] })).json.code).toBe('serial_count');
    const x1 = count.lines.find((l: { snapshotQuantity: string }) => l.snapshotQuantity === '10.000000') as { id: string; batchId: string };
    const x2 = count.lines.find((l: { snapshotQuantity: string }) => l.snapshotQuantity === '4.000000') as { id: string };
    ok(await call(server, 'PUT', `/v1/stock/counts/${count.id}/counted`, { tenant: w.tenant, body: { lines: [{ lineId: x1.id, countedQuantity: '9' }, { lineId: x2.id, countedQuantity: '4' }] } }), 200);
    ok(await post(w, `/v1/stock/counts/${count.id}/post`, { postingDate: '2025-04-30' }), 200);
    const bal = await balance(w, b, w.wh);
    expect(bal?.quantity).toBe('13.000000');
    expect(bal?.batches.map((x) => [x.batchNo, x.quantity])).toEqual([['X1', '9.000000'], ['X2', '4.000000']]);
    const c2 = ok(await post(w, '/v1/stock/counts', { companyId: w.companyId, warehouseId: w.wh, countDate: '2025-04-30', description: 'Abandoned' }));
    ok(await post(w, `/v1/stock/counts/${c2.id}/cancel`, {}), 200);
    expect((await post(w, `/v1/stock/counts/${c2.id}/cancel`, {})).json.code).toBe('count_not_open');
    expect((await call(server, 'GET', `/v1/stock/counts?companyId=${w.companyId}&status=posted`, { tenant: w.tenant })).json.items).toHaveLength(1);
    expect((await post(w, '/v1/stock/counts', { companyId: w.companyId, warehouseId: w.transit, countDate: '2025-04-30', description: 'x' })).json.code).toBe('warehouse_not_countable');
    expect((await post(w, '/v1/stock/counts', { companyId: w.companyId, warehouseId: w.wh, countDate: '2030-04-30', description: 'x' })).json.code).toBe('no_accounting_period');
    expect((await recon(w)).reconciled).toBe(true);
  });
  it('is permissioned and tenant-isolated', async () => {
    const w = await world('Count Access Co');
    const i = await item(w);
    ok(await receipt(w, i, '1', '1'));
    const count = ok(await post(w, '/v1/stock/counts', { companyId: w.companyId, warehouseId: w.wh, countDate: '2025-04-30', description: 'x' }));
    const key = (await call(server, 'POST', '/v1/api-keys', { tenant: w.tenant, body: { name: 'ro', permissions: ['stock:read'] } })).json.key as string;
    expect((await call(server, 'GET', `/v1/stock/counts/${count.id}`, { token: key })).status).toBe(200);
    expect((await call(server, 'POST', `/v1/stock/counts/${count.id}/post`, { token: key, body: { postingDate: '2025-04-30' } })).status).toBe(403);
    expect((await call(server, 'POST', '/v1/stock/reservations', { token: key, body: {} })).status).toBe(403);
    expect((await call(server, 'POST', '/v1/stock/transfers', { token: key, body: {} })).status).toBe(403);
    const other = await world('Count Access Other');
    expect((await call(server, 'GET', `/v1/stock/counts/${count.id}`, { tenant: other.tenant })).status).toBe(404);
  });
});
