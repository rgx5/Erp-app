import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPool, call, createTenant, startServer, superPool, type TestServer } from '../support/harness.js';

let server: TestServer;
let tenant: string;
const supers = superPool();

beforeAll(async () => {
  server = await startServer();
  tenant = await createTenant(server, 'Master Co');
});
afterAll(async () => { await server.close(); await supers.end(); });

const post = (path: string, body: object, who = tenant) => call(server, 'POST', path, { tenant: who, body });
const get = (path: string, who = tenant) => call(server, 'GET', path, { tenant: who });
const ok = (res: { status: number; json: unknown }, status = 201) => { expect(res.status, JSON.stringify(res.json)).toBe(status); return res.json as any; }; // eslint-disable-line
let unitIds: Record<string, string> = {};
const unit = async (code: string, who = tenant, ids = unitIds) => {
  if (ids[code]) return ids[code] as string;
  const list = (await get('/v1/units?limit=200', who)).json.items as { id: string; code: string }[];
  for (const u of list) ids[u.code] = u.id;
  return ids[code] as string;
};

describe('tenant defaults', () => {
  it('starts every tenant with INR and the statutory units, and with no tax rates', async () => {
    const currencies = (await get('/v1/currencies')).json.items;
    expect(currencies.map((c: { code: string }) => c.code)).toEqual(['INR']);
    const units = (await get('/v1/units?limit=200')).json.items;
    expect(units).toHaveLength(44);
    expect(units.find((u: { code: string }) => u.code === 'KGS')).toMatchObject({ uqc: 'KGS', decimalPlaces: 3 });
    expect((await get('/v1/tax-codes')).json.items).toEqual([]);
    expect(JSON.stringify(units)).not.toContain('tenantId');
  });
});

describe('currencies, exchange rates and units', () => {
  it('resolves the rate in force on a date, never inventing one', async () => {
    ok(await post('/v1/currencies', { code: 'usd', name: 'US Dollar', symbol: '$' }));
    expect((await post('/v1/currencies', { code: 'USD', name: 'dup' })).status).toBe(409);
    const rate = (effectiveDate: string, r: string, to = 'INR') => post('/v1/exchange-rates', { fromCurrency: 'USD', toCurrency: to, rate: r, effectiveDate });
    ok(await rate('2025-01-01', '83.10'));
    ok(await rate('2025-02-01', '84.25'));
    expect((await get('/v1/exchange-rates/resolve?from=USD&to=INR&date=2025-01-15')).json.rate).toBe('83.10000000');
    expect((await get('/v1/exchange-rates/resolve?from=USD&to=INR&date=2025-02-01')).json.rate).toBe('84.25000000');
    expect((await get('/v1/exchange-rates/resolve?from=USD&to=INR&date=2024-12-31')).status).toBe(404);
    expect((await get('/v1/exchange-rates/resolve?from=INR&to=INR&date=2024-12-31')).json.rate).toBe('1');
    expect((await get('/v1/exchange-rates/resolve?from=INR&to=USD&date=2025-02-01')).status).toBe(404); // inverse is not derived
    expect((await rate('2025-02-01', '85')).status).toBe(409);
    expect((await rate('2025-03-01', '85', 'EUR')).status).toBe(422); // unknown currency
    expect((await post('/v1/exchange-rates', { fromCurrency: 'USD', toCurrency: 'USD', rate: '1', effectiveDate: '2025-01-01' })).status).toBe(422);
    expect((await post('/v1/exchange-rates', { fromCurrency: 'USD', toCurrency: 'INR', rate: 83.1, effectiveDate: '2025-05-01' })).status).toBe(422);
    const pool = appPool(1);
    try { await expect(pool.query('UPDATE erp.exchange_rates SET rate = 1')).rejects.toMatchObject({ code: '42501' }); } finally { await pool.end(); }
  });
  it('manages custom units but only the statutory UQC codes', async () => {
    const created = ok(await post('/v1/units', { code: 'rm', name: 'Running metre', uqc: 'MTR', decimalPlaces: 2 }));
    expect(created).toMatchObject({ code: 'RM', uqc: 'MTR', version: 1 });
    expect((await post('/v1/units', { code: 'RM', name: 'again' })).status).toBe(409);
    expect((await post('/v1/units', { code: 'XX', name: 'bad', uqc: 'NOPE' })).status).toBe(422);
    const patched = await call(server, 'PATCH', `/v1/units/${created.id}`, { tenant, headers: { 'if-match': '1' }, body: { name: 'Running meter' } });
    expect(patched.json.name).toBe('Running meter');
    expect((await call(server, 'PATCH', `/v1/units/${created.id}`, { tenant, headers: { 'if-match': '1' }, body: { name: 'stale' } })).status).toBe(412);
  });
});

describe('tax codes with effective-dated rates', () => {
  let gst: string;
  const rate = (from: string, igst: number, cess = 0, id = gst) => post(`/v1/tax-codes/${id}/rates`, { effectiveFrom: from, igstRate: igst, cessRate: cess });
  const on = (date: string, id = gst) => get(`/v1/tax-codes/${id}/rate?date=${date}`);

  it('versions a rate: a change closes the previous version and old dates keep the old rate', async () => {
    gst = ok(await post('/v1/tax-codes', { code: 'gst-18', name: 'GST 18%' })).id;
    const first = ok(await rate('2024-04-01', 18));
    expect(first).toMatchObject({ igstRate: '18.0000', cgstRate: '9.0000', sgstRate: '9.0000', cessRate: '0.0000', effectiveTo: null });
    ok(await rate('2025-10-01', 12));
    const history = (await get(`/v1/tax-codes/${gst}/rates`)).json.items;
    expect(history.map((r: { effectiveFrom: string; effectiveTo: string | null }) => [r.effectiveFrom, r.effectiveTo])).toEqual([['2025-10-01', null], ['2024-04-01', '2025-09-30']]);
    expect((await on('2025-09-30')).json.igstRate).toBe('18.0000'); // a back-dated document still gets the rate of its own date
    expect((await on('2025-10-01')).json.igstRate).toBe('12.0000');
    expect((await on('2030-01-01')).json.igstRate).toBe('12.0000');
    expect((await on('2024-03-31')).status).toBe(404);
  });
  it('refuses overlapping history', async () => {
    const overlap = await rate('2024-06-01', 5); // inside an existing period, before the open version's start
    expect(overlap.status).toBe(409);
    expect(overlap.json.code).toBe('overlaps_existing');
    await expect(supers.query(
      "INSERT INTO erp.tax_code_rates (tenant_id, id, tax_code_id, effective_from, effective_to, igst_rate, cgst_rate, sgst_rate) VALUES ($1, gen_random_uuid(), $2, '2024-05-01', '2024-05-31', 10, 5, 5)", [tenant, gst],
    )).rejects.toMatchObject({ code: '23P01' });
  });
  it('rejects rates on exempt codes, and bad splits at the database', async () => {
    const exempt = ok(await post('/v1/tax-codes', { code: 'EXEMPT', name: 'Exempt', kind: 'exempt' })).id;
    expect((await rate('2024-04-01', 5, 0, exempt)).json.code).toBe('rate_not_allowed');
    ok(await rate('2024-04-01', 0, 0, exempt));
    await expect(supers.query(
      "INSERT INTO erp.tax_code_rates (tenant_id, id, tax_code_id, effective_from, igst_rate, cgst_rate, sgst_rate) VALUES ($1, gen_random_uuid(), $2, '2020-01-01', 18, 10, 8)", [tenant, gst],
    )).rejects.toMatchObject({ code: '23514' });
  });
  it('never lets a rate be rewritten or deleted, even by the owner role or a superuser', async () => {
    const [row] = (await supers.query("SELECT id FROM erp.tax_code_rates WHERE tax_code_id = $1 AND effective_to IS NULL", [gst])).rows;
    await expect(supers.query('UPDATE erp.tax_code_rates SET igst_rate = 99 WHERE id = $1', [row.id])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query('DELETE FROM erp.tax_code_rates WHERE id = $1', [row.id])).rejects.toMatchObject({ code: '55000' });
    const pool = appPool(1);
    try { await expect(pool.query('UPDATE erp.tax_code_rates SET igst_rate = 99')).rejects.toMatchObject({ code: '42501' }); } finally { await pool.end(); }
  });
  it('needs tax:manage to change tax, but only masterdata:read to read it', async () => {
    const key = ok(await post('/v1/api-keys', { name: 'reader', permissions: ['masterdata:read', 'masterdata:write'] })).key;
    expect((await call(server, 'GET', '/v1/tax-codes', { token: key })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/tax-codes', { token: key, body: { code: 'NOPE', name: 'x' } })).status).toBe(403);
    expect((await call(server, 'POST', `/v1/tax-codes/${gst}/rates`, { token: key, body: { effectiveFrom: '2030-01-01', igstRate: 1 } })).status).toBe(403);
  });
});

describe('items', () => {
  let rm: string;
  it('creates items of each kind with the right defaults and statutory code checks', async () => {
    const kg = await unit('KGS');
    const gst = ok(await post('/v1/tax-codes', { code: 'GST5', name: 'GST 5%' })).id;
    const created = ok(await post('/v1/items', { code: 'RM-001', name: 'Steel rod', itemType: 'raw_material', baseUomId: kg, hsnSacCode: '7214', taxCodeId: gst, tracking: 'batch' }));
    rm = created.id;
    expect(created).toMatchObject({ itemType: 'raw_material', isStocked: true, tracking: 'batch', isManufactured: false, status: 'active' });
    const service = ok(await post('/v1/items', { code: 'SVC-1', name: 'Job work', itemType: 'service', baseUomId: await unit('NOS'), hsnSacCode: '998821' }));
    expect(service).toMatchObject({ isStocked: false, tracking: 'none' });
    const fg = ok(await post('/v1/items', { code: 'FG-1', name: 'Gearbox', itemType: 'finished_good', baseUomId: await unit('NOS'), isManufactured: true, tracking: 'serial' }));
    expect(fg.isManufactured).toBe(true);
  });
  it('rejects impossible combinations', async () => {
    const nos = await unit('NOS');
    const item = (o: object) => post('/v1/items', { code: `X-${Math.random().toString(36).slice(2, 8)}`, name: 'X', itemType: 'raw_material', baseUomId: nos, ...o });
    expect((await item({ itemType: 'service', isStocked: true })).status).toBe(422);
    expect((await item({ itemType: 'service', hsnSacCode: '7214' })).status).toBe(422);
    expect((await item({ hsnSacCode: '99' })).status).toBe(422);
    expect((await item({ isManufactured: true })).status).toBe(422);
    expect((await item({ tracking: 'batch', isStocked: false })).status).toBe(422);
    expect((await item({ baseUomId: '01a1cf33-1a44-7104-863e-b26a759d6544' })).status).toBe(422); // no such unit
    expect((await item({ taxCodeId: '01a1cf33-1a44-7104-863e-b26a759d6544' })).json.code).toBe('reference_invalid');
  });
  it('keeps codes unique ignoring case, and fixes code, type and base unit once created', async () => {
    expect((await post('/v1/items', { code: 'rm-001', name: 'Dup', itemType: 'raw_material', baseUomId: await unit('KGS') })).status).toBe(409);
    expect((await call(server, 'PATCH', `/v1/items/${rm}`, { tenant, headers: { 'if-match': '1' }, body: { itemType: 'finished_good' } })).status).toBe(422);
    await expect(supers.query("UPDATE erp.items SET base_uom_id = (SELECT id FROM erp.units WHERE tenant_id = $1 AND code = 'NOS') WHERE id = $2", [tenant, rm])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query("UPDATE erp.items SET item_type = 'finished_good' WHERE id = $1", [rm])).rejects.toMatchObject({ code: '55000' });
    const patched = await call(server, 'PATCH', `/v1/items/${rm}`, { tenant, headers: { 'if-match': '1' }, body: { name: 'Steel rod 12mm', status: 'inactive' } });
    expect(patched.json).toMatchObject({ name: 'Steel rod 12mm', status: 'inactive', version: 2 });
  });
  it('lists with filters, search and pagination', async () => {
    for (let i = 0; i < 4; i++) ok(await post('/v1/items', { code: `PG-${i}`, name: `Paged thing ${i}`, itemType: 'consumable', baseUomId: await unit('NOS') }));
    const all: string[] = [];
    let cursor = '';
    do {
      const res = await get(`/v1/items?itemType=consumable&limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      all.push(...res.json.items.map((i: { code: string }) => i.code));
      cursor = res.json.nextCursor ?? '';
    } while (cursor);
    expect(all).toEqual(['PG-0', 'PG-1', 'PG-2', 'PG-3']);
    expect((await get('/v1/items?q=paged')).json.items).toHaveLength(4);
    expect((await get('/v1/items?q=%25')).json.items).toHaveLength(0); // wildcards are matched literally
    expect((await get('/v1/items?status=inactive')).json.items.map((i: { code: string }) => i.code)).toEqual(['RM-001']);
  });
  it('holds alternative units as base-unit factors', async () => {
    const box = await unit('BOX');
    const ok1 = ok(await post(`/v1/items/${rm}/uom-conversions`, { uomId: box, factor: '12' }));
    expect(ok1.factor).toBe('12.00000000');
    expect((await post(`/v1/items/${rm}/uom-conversions`, { uomId: box, factor: '6' })).status).toBe(409);
    expect((await post(`/v1/items/${rm}/uom-conversions`, { uomId: await unit('PRS'), factor: '0' })).status).toBe(422);
    expect((await get(`/v1/items/${rm}/uom-conversions`)).json.items).toHaveLength(1);
  });
  it('is isolated per tenant', async () => {
    const other = await createTenant(server, 'Other Master');
    expect((await get(`/v1/items/${rm}`, other)).status).toBe(404);
    expect((await get('/v1/items', other)).json.items).toEqual([]);
    const otherUnits: Record<string, string> = {};
    const res = await post('/v1/items', { code: 'STOLEN', name: 'x', itemType: 'raw_material', baseUomId: await unit('KGS') }, other); // tenant A's unit id
    expect(res.status).toBe(422);
    expect(await unit('KGS', other, otherUnits)).not.toBe(await unit('KGS'));
  });
});

describe('parties', () => {
  const gstin = '27ABCDE1234F1ZW';
  it('models customers, suppliers and subcontractors with GST treatment rules', async () => {
    const { makeGstin } = await import('../support/harness.js');
    const g = makeGstin('27', 'ABCDE1234F');
    const customer = ok(await post('/v1/parties', { code: 'C-001', legalName: 'Acme Traders', isCustomer: true, gstTreatment: 'registered_regular', gstin: g, creditLimit: '500000.50' }));
    expect(customer).toMatchObject({ pan: 'ABCDE1234F', currency: 'INR', creditLimit: '500000.5000', status: 'active' });
    expect((await post('/v1/parties', { code: 'C-002', legalName: 'Dup GSTIN', isSupplier: true, gstTreatment: 'registered_regular', gstin: g })).status).toBe(409);
    const supplier = ok(await post('/v1/parties', { code: 'S-001', legalName: 'Steel Mills', isSupplier: true, isSubcontractor: true, gstTreatment: 'unregistered' }));
    expect(supplier).toMatchObject({ isSupplier: true, isSubcontractor: true, gstin: null });
    expect((await post('/v1/parties', { code: 'S-002', legalName: 'x', isSupplier: true, gstTreatment: 'registered_composition' })).status).toBe(422);
    expect((await post('/v1/parties', { code: 'S-003', legalName: 'x', isSupplier: true, gstTreatment: 'unregistered', creditLimit: '10' })).status).toBe(422);
    expect((await post('/v1/parties', { code: 'c-001', legalName: 'case dup', isCustomer: true, gstTreatment: 'consumer' })).status).toBe(409);
    expect((await post('/v1/parties', { code: 'Z', legalName: 'x', isCustomer: true, gstTreatment: 'overseas', currency: 'EUR' })).json.code).toBe('reference_invalid'); // EUR not enabled in this tenant
    expect((await get('/v1/parties?role=supplier')).json.items.map((p: { code: string }) => p.code)).toEqual(['S-001']);
    expect((await get('/v1/parties?role=customer&q=acme')).json.items).toHaveLength(1);
    void gstin;
    const blocked = await call(server, 'PATCH', `/v1/parties/${customer.id}`, { tenant, headers: { 'if-match': '1' }, body: { status: 'blocked' } });
    expect(blocked.json.status).toBe('blocked');
    expect((await call(server, 'PATCH', `/v1/parties/${supplier.id}`, { tenant, headers: { 'if-match': '1' }, body: { creditLimit: '5' } })).status).toBe(422);
  });
  it('links payment terms and rejects another tenant\'s', async () => {
    const term = ok(await post('/v1/payment-terms', { code: 'net30', name: 'Net 30', netDays: 30 }));
    expect(term).toMatchObject({ code: 'NET30', netDays: 30 });
    expect((await post('/v1/payment-terms', { code: 'NET30', name: 'dup', netDays: 30 })).status).toBe(409);
    expect((await post('/v1/payment-terms', { code: 'BAD', name: 'x', netDays: 4000 })).status).toBe(422);
    ok(await post('/v1/parties', { code: 'C-TERMS', legalName: 'With terms', isCustomer: true, gstTreatment: 'consumer', paymentTermsId: term.id }));
    const other = await createTenant(server, 'Terms Other');
    expect((await post('/v1/parties', { code: 'X', legalName: 'x', isCustomer: true, gstTreatment: 'consumer', paymentTermsId: term.id }, other)).status).toBe(422);
  });
  it('keeps addresses with one default per kind, and PIN rules by country', async () => {
    const party = ok(await post('/v1/parties', { code: 'C-ADDR', legalName: 'Addr Co', isCustomer: true, gstTreatment: 'consumer' }));
    const addr = (o: object) => post(`/v1/parties/${party.id}/addresses`, { kind: 'shipping', line1: '1 Main Rd', city: 'Pune', stateCode: '27', pincode: '411001', isDefault: true, ...o });
    const a = ok(await addr({}));
    const b = ok(await addr({ line1: '2 Side Rd' }));
    const list = (await get(`/v1/parties/${party.id}/addresses`)).json.items;
    expect(list.find((x: { id: string }) => x.id === a.id).isDefault).toBe(false);
    expect(list.find((x: { id: string }) => x.id === b.id).isDefault).toBe(true);
    expect((await addr({ pincode: undefined })).status).toBe(422);
    ok(await addr({ country: 'US', stateCode: '96', pincode: undefined, kind: 'billing' }));
    expect((await post('/v1/parties/01a1cf33-1a44-7104-863e-b26a759d6544/addresses', { kind: 'billing', line1: 'x', city: 'x', stateCode: '27', pincode: '411001' })).status).toBe(404);
  });
});

describe('price lists', () => {
  let list: string;
  let item: string;
  let kg: string;
  const price = (o: object) => post(`/v1/price-lists/${list}/prices`, { itemId: item, uomId: kg, effectiveFrom: '2025-04-01', price: '100', ...o });
  const resolve = (qty: string, date: string) => get(`/v1/price-lists/${list}/price?itemId=${item}&uomId=${kg}&qty=${qty}&date=${date}`);

  it('resolves quantity breaks and effective dates', async () => {
    kg = await unit('KGS');
    item = ok(await post('/v1/items', { code: 'PL-1', name: 'Priced', itemType: 'finished_good', baseUomId: kg })).id;
    list = ok(await post('/v1/price-lists', { code: 'retail', name: 'Retail', kind: 'sales' })).id;
    ok(await price({ minQty: '0', price: '100.00' }));
    ok(await price({ minQty: '50', price: '90.00' }));
    ok(await price({ minQty: '500', price: '80.5000' }));
    expect((await resolve('1', '2025-06-01')).json.price).toBe('100.0000');
    expect((await resolve('49.999', '2025-06-01')).json.price).toBe('100.0000');
    expect((await resolve('50', '2025-06-01')).json.price).toBe('90.0000');
    expect((await resolve('10000', '2025-06-01')).json.price).toBe('80.5000');
    expect((await resolve('1', '2025-03-31')).status).toBe(404);
  });
  it('refuses overlapping periods, closes instead of editing, and then accepts the new price', async () => {
    const overlap = await price({ minQty: '0', price: '110', effectiveFrom: '2025-09-01' });
    expect(overlap.status).toBe(409);
    expect(overlap.json.code).toBe('overlaps_existing');
    const rows = (await get(`/v1/price-lists/${list}/prices?itemId=${item}`)).json.items;
    const base = rows.find((r: { minQty: string }) => r.minQty === '0.000000');
    const closed = await post(`/v1/price-lists/${list}/prices/${base.id}/close`, { effectiveTo: '2025-09-30' });
    expect(closed.json.effectiveTo).toBe('2025-09-30');
    expect((await post(`/v1/price-lists/${list}/prices/${base.id}/close`, { effectiveTo: '2025-10-31' })).status).toBe(409);
    ok(await price({ minQty: '0', price: '110', effectiveFrom: '2025-10-01' }));
    expect((await resolve('1', '2025-09-30')).json.price).toBe('100.0000');
    expect((await resolve('1', '2025-10-01')).json.price).toBe('110.0000');
    await expect(supers.query('UPDATE erp.price_list_items SET price = 1 WHERE id = $1', [base.id])).rejects.toMatchObject({ code: '55000' });
  });
  it('validates references, currencies and permissions', async () => {
    expect((await price({ itemId: '01a1cf33-1a44-7104-863e-b26a759d6544', effectiveFrom: '2026-01-01' })).status).toBe(422);
    expect((await post('/v1/price-lists', { code: 'USD1', name: 'x', kind: 'sales', currency: 'EUR' })).status).toBe(422);
    expect((await post('/v1/price-lists', { code: 'RETAIL', name: 'dup', kind: 'sales' })).status).toBe(409);
    const key = ok(await post('/v1/api-keys', { name: 'md', permissions: ['masterdata:read', 'masterdata:write'] })).key;
    expect((await call(server, 'GET', `/v1/price-lists/${list}`, { token: key })).status).toBe(200);
    expect((await call(server, 'POST', `/v1/price-lists/${list}/prices`, { token: key, body: { itemId: item, uomId: kg, price: '1', effectiveFrom: '2030-01-01' } })).status).toBe(403);
  });
});

describe('cross-cutting behaviour', () => {
  it('audits and publishes events for master-data changes, and replays idempotent creates', async () => {
    const body = { code: 'IDEM-1', name: 'Idempotent item', itemType: 'consumable', baseUomId: await unit('NOS') };
    const first = await call(server, 'POST', '/v1/items', { tenant, headers: { 'idempotency-key': 'item-key-1' }, body });
    const again = await call(server, 'POST', '/v1/items', { tenant, headers: { 'idempotency-key': 'item-key-1' }, body });
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(again.json.id).toBe(first.json.id);
    const audit = (await supers.query("SELECT details FROM erp.audit_log WHERE tenant_id = $1 AND action = 'item.created' AND entity_id = $2", [tenant, first.json.id])).rows;
    expect(audit).toHaveLength(1);
    const events = (await supers.query("SELECT count(*)::int AS n FROM erp.outbox_events WHERE tenant_id = $1 AND event_type = 'item.created' AND aggregate_id = $2", [tenant, first.json.id])).rows[0];
    expect(events.n).toBe(1);
  });
  it('rejects unknown fields and unauthenticated calls', async () => {
    expect((await post('/v1/items', { code: 'X1', name: 'x', itemType: 'consumable', baseUomId: await unit('NOS'), tenantId: tenant })).status).toBe(422);
    expect((await call(server, 'GET', '/v1/items')).status).toBe(401);
  });
});
