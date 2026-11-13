import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createRegistration, createTenant, makeGstin, startServer, superPool, type TestServer } from '../support/harness.js';

let server: TestServer;
const supers = superPool();
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server.close(); await supers.end(); });

const ok = (res: { status: number; json: unknown }, status = 201) => { expect(res.status, JSON.stringify(res.json)).toBe(status); return res.json as any; }; // eslint-disable-line

interface Shop {
  tenant: string; companyId: string; regId: string; acc: Record<string, string>; wh: string; periods: { id: string; name: string }[];
  tax: { gst18: string; gst5: string; exempt: string };
  item: { widget: string; cheap: string; service: string; exemptItem: string };
  cust: { local: string; other: string; consumer: string; sez: string; overseas: string };
  addr: { localShip: string; otherBill: string };
}
let seq = 0;
const unitId = async (tenant: string, code: string) => ((await call(server, 'GET', '/v1/units?limit=200', { tenant })).json.items as { id: string; code: string }[]).find((u) => u.code === code)?.id as string;

/** A seller registered in Maharashtra (27) with chart, books, stock, tax codes, items, customers and number series ready. */
async function shop(name: string, o: { registrationType?: string } = {}): Promise<Shop> {
  const tenant = await createTenant(server, name);
  const pan = 'ABCDE1234F';
  const { companyId, registrationId: regId } = await createRegistration(server, tenant, '27', pan);
  if (o.registrationType) await supers.query('UPDATE erp.gst_registrations SET registration_type = $1 WHERE id = $2', [o.registrationType, regId]);
  ok(await call(server, 'POST', `/v1/companies/${companyId}/chart-of-accounts/template`, { tenant, body: { template: 'manufacturing_india' } }));
  const acc: Record<string, string> = {};
  for (const a of (await call(server, 'GET', `/v1/accounts?companyId=${companyId}&limit=200`, { tenant })).json.items) acc[a.code] = a.id;
  const fy = ok(await call(server, 'POST', '/v1/fiscal-years', { tenant, body: { companyId, startDate: '2025-04-01' } }));
  const loc = ok(await call(server, 'POST', '/v1/business-locations', { tenant, body: { companyId, gstRegistrationId: regId, code: 'MUM', name: 'Mumbai', addressLine1: '1 Main Rd', city: 'Mumbai', stateCode: '27', pincode: '400001' } }));
  const wh = ok(await call(server, 'POST', '/v1/warehouses', { tenant, body: { businessLocationId: loc.id, code: 'MAIN', name: 'Main', kind: 'finished_goods' } })).id as string;
  for (const [type, code] of [['finished_good', '1240'], ['trading_good', '1240'], ['raw_material', '1210']] as const) ok(await call(server, 'PUT', `/v1/companies/${companyId}/inventory-accounts`, { tenant, body: { itemType: type, accountId: acc[code] } }), 200);
  ok(await call(server, 'PUT', `/v1/companies/${companyId}/stock-settings`, { tenant, body: { adjustmentAccountId: acc['5300'], openingBalanceAccountId: acc['3100'] } }), 200);
  ok(await call(server, 'PUT', `/v1/companies/${companyId}/sales-settings`, {
    tenant, body: { receivableAccountId: acc['1130'], salesAccountId: acc['4100'], serviceSalesAccountId: acc['4130'], cogsAccountId: acc['5100'], roundOffAccountId: acc['5900'], outputCgstAccountId: acc['2210'], outputSgstAccountId: acc['2220'], outputIgstAccountId: acc['2230'] },
  }), 200);
  for (const documentType of ['tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note']) {
    ok(await call(server, 'POST', '/v1/number-series', { tenant, body: { gstRegistrationId: regId, documentType, financialYear: '2025-26', prefix: documentType === 'tax_invoice' ? 'INV' : documentType === 'bill_of_supply' ? 'BOS' : documentType === 'credit_note' ? 'CN' : 'DN' } }));
  }
  const taxCode = async (code: string, kind: string, rate?: number) => {
    const id = ok(await call(server, 'POST', '/v1/tax-codes', { tenant, body: { code, name: code, kind } })).id as string;
    if (rate !== undefined) ok(await call(server, 'POST', `/v1/tax-codes/${id}/rates`, { tenant, body: { effectiveFrom: '2025-04-01', igstRate: rate } }));
    return id;
  };
  const tax = { gst18: await taxCode('GST18', 'gst', 18), gst5: await taxCode('GST5', 'gst', 5), exempt: await taxCode('EXEMPT', 'exempt') };
  const nos = await unitId(tenant, 'NOS');
  const mk = async (code: string, o2: object) => ok(await call(server, 'POST', '/v1/items', { tenant, body: { code: `${code}-${++seq}`, name: code, baseUomId: nos, itemType: 'finished_good', ...o2 } })).id as string;
  const item = {
    widget: await mk('WIDGET', { taxCodeId: tax.gst18, hsnSacCode: '8479' }),
    cheap: await mk('CHEAP', { taxCodeId: tax.gst5, hsnSacCode: '9503' }),
    service: await mk('JOBWORK', { itemType: 'service', isStocked: false, taxCodeId: tax.gst18, hsnSacCode: '998821' }),
    exemptItem: await mk('LOOSE', { taxCodeId: tax.exempt, hsnSacCode: '1001' }),
  };
  for (const id of [item.widget, item.cheap, item.exemptItem]) ok(await call(server, 'POST', '/v1/stock/movements', { tenant, body: { companyId, movementType: 'opening', postingDate: '2025-04-01', description: 'Opening', lines: [{ warehouseId: wh, itemId: id, quantity: '100', unitCost: '400' }] } }));
  const party = async (code: string, treatment: string, extra: object = {}, roles: object = { isCustomer: true }) =>
    ok(await call(server, 'POST', '/v1/parties', { tenant, body: { code: `${code}-${++seq}`, legalName: `${code} Customer`, gstTreatment: treatment, ...roles, ...extra } })).id as string;
  const cust = {
    local: await party('LOCAL', 'registered_regular', { gstin: makeGstin('27', 'FGHIJ5678K') }),
    other: await party('OTHER', 'registered_regular', { gstin: makeGstin('29', 'KLMNO9012P') }),
    consumer: await party('WALKIN', 'consumer'),
    sez: await party('SEZ', 'sez', { gstin: makeGstin('24', 'PQRST3456U') }),
    overseas: await party('EXPORT', 'overseas', { currency: 'INR' }),
  };
  const address = async (partyId: string, kind: string, state: string, pincode = '400001') =>
    ok(await call(server, 'POST', `/v1/parties/${partyId}/addresses`, { tenant, body: { kind, line1: '9 Road', city: 'City', stateCode: state, pincode, isDefault: true } })).id as string;
  await address(cust.local, 'billing', '27');
  const localShip = await address(cust.local, 'shipping', '24', '380001'); // delivered to Gujarat
  const otherBill = await address(cust.other, 'billing', '29', '560001');
  await address(cust.sez, 'billing', '24', '380001');
  return { tenant, companyId, regId, acc, wh, periods: fy.periods, tax, item, cust, addr: { localShip, otherBill } };
}
const invoice = (s: Shop, customerId: string, lines: object[], o: object = {}) =>
  call(server, 'POST', '/v1/sales/invoices', { tenant: s.tenant, body: { companyId: s.companyId, gstRegistrationId: s.regId, invoiceDate: '2025-04-10', customerId, lines, ...o } });
const stocked = (s: Shop, itemId: string, o: object = {}) => ({ itemId, quantity: '1', unitPrice: '1000', warehouseId: s.wh, ...o });
const journalOf = async (s: Shop, id: string) => (await supers.query(`SELECT a.code, l.debit::text AS dr, l.credit::text AS cr, l.party_id FROM erp.journal_lines l JOIN erp.accounts a ON a.id = l.account_id
  WHERE l.entry_id = (SELECT journal_entry_id FROM erp.sales_invoices WHERE id = $1) ORDER BY a.code`, [id])).rows as { code: string; dr: string; cr: string; party_id: string | null }[];
const tb = async (s: Shop, to = '2026-03-31') => (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${s.companyId}&from=2025-04-01&to=${to}`, { tenant: s.tenant })).json;
const row = (t: { rows: { code: string }[] }, code: string) => t.rows.find((r) => r.code === code) as Record<string, string> | undefined;
const recon = async (s: Shop) => (await call(server, 'GET', `/v1/inventory/reconciliation?companyId=${s.companyId}&asOf=2026-03-31`, { tenant: s.tenant })).json;
const balance = async (s: Shop, itemId: string) => (await call(server, 'GET', `/v1/stock/balances?companyId=${s.companyId}&itemId=${itemId}`, { tenant: s.tenant })).json.items[0];

describe('sales settings', () => {
  it('needs the right kind of account for each setting, and refuses to post without them', async () => {
    const tenant = await createTenant(server, 'Sales Cfg Co');
    const { companyId, registrationId } = await createRegistration(server, tenant, '27', 'ABCDE1234F');
    ok(await call(server, 'POST', `/v1/companies/${companyId}/chart-of-accounts/template`, { tenant, body: { template: 'manufacturing_india' } }));
    const acc: Record<string, string> = {};
    for (const a of (await call(server, 'GET', `/v1/accounts?companyId=${companyId}&limit=200`, { tenant })).json.items) acc[a.code] = a.id;
    const put = (b: object) => call(server, 'PUT', `/v1/companies/${companyId}/sales-settings`, { tenant, body: b });
    expect((await put({ receivableAccountId: acc['1110'] })).status).toBe(422); // cash is not the receivables control account
    expect((await put({ salesAccountId: acc['5900'] })).status).toBe(422); // an expense
    expect((await put({ outputCgstAccountId: acc['1310'] })).status).toBe(422); // an input tax asset
    expect((await put({ cogsAccountId: acc['1210'] })).status).toBe(422); // a control account
    expect((await put({ roundOffAccountId: acc['2210'] })).status).toBe(422); // a tax control account
    expect((await put({})).status).toBe(422);
    expect((await put({ receivableAccountId: acc['1130'], salesAccountId: acc['4100'] })).status).toBe(200);
    expect((await call(server, 'GET', `/v1/companies/${companyId}/sales-settings`, { tenant })).json).toMatchObject({ receivableAccountId: acc['1130'], salesAccountId: acc['4100'] });
    const party = ok(await call(server, 'POST', '/v1/parties', { tenant, body: { code: 'C1', legalName: 'C', isCustomer: true, gstTreatment: 'consumer' } })).id;
    const nos = await unitId(tenant, 'NOS');
    const svc = ok(await call(server, 'POST', '/v1/items', { tenant, body: { code: 'S1', name: 'S', itemType: 'service', isStocked: false, baseUomId: nos } })).id;
    const res = await call(server, 'POST', '/v1/sales/invoices', { tenant, body: { companyId, gstRegistrationId: registrationId, invoiceDate: '2025-04-10', customerId: party, lines: [{ itemId: svc, quantity: '1', unitPrice: '100' }] } });
    expect(res.status).toBe(422); // no fiscal year/tax code etc. are checked before accounts; the item has no tax code
    expect(res.json.code).toBe('tax_code_required');
  });
});

describe('tax invoices: GST by place of supply', () => {
  it('charges CGST+SGST within the state, rounds each line and the total, and posts stock, revenue, tax and receivable', async () => {
    const s = await shop('Intra Co');
    const inv = ok(await invoice(s, s.cust.consumer, [stocked(s, s.item.widget, { quantity: '3', unitPrice: '1000' }), stocked(s, s.item.cheap, { quantity: '3', unitPrice: '99.99' })]));
    expect(inv).toMatchObject({ documentType: 'tax_invoice', invoiceNo: 'INV/2526/00001', placeOfSupply: '27', supplyType: 'b2c', taxRegime: 'intra', taxableTotal: '3299.9700', cgstTotal: '277.5000', sgstTotal: '277.5000', igstTotal: '0.0000', roundOff: '0.0300', grandTotal: '3855.0000', status: 'posted' });
    expect(inv.lines[0]).toMatchObject({ lineNo: 1, taxableValue: '3000.0000', cgstRate: '9.0000', sgstRate: '9.0000', igstRate: '0.0000', cgstAmount: '270.0000', lineTotal: '3540.0000', hsnSacCode: '8479', unitCost: '400.000000', costValue: '1200.0000' });
    expect(inv.lines[1]).toMatchObject({ taxableValue: '299.9700', cgstRate: '2.5000', cgstAmount: '7.5000', lineTotal: '314.9700' });
    const jl = await journalOf(s, inv.id);
    expect(jl).toEqual([
      { code: '1130', dr: '3855.0000', cr: '0.0000', party_id: s.cust.consumer },
      { code: '2210', dr: '0.0000', cr: '277.5000', party_id: null },
      { code: '2220', dr: '0.0000', cr: '277.5000', party_id: null },
      { code: '4100', dr: '0.0000', cr: '3299.9700', party_id: null },
      { code: '5900', dr: '0.0000', cr: '0.0300', party_id: null },
    ]);
    const t = await tb(s);
    expect(t.balanced).toBe(true);
    expect(row(t, '5100')).toMatchObject({ closingDebit: '2400.0000' }); // COGS: 6 units at 400
    expect(await balance(s, s.item.widget)).toMatchObject({ quantity: '97.000000', value: '38800.0000' });
    expect((await recon(s)).reconciled).toBe(true);
    expect(JSON.stringify(inv)).not.toContain('tenantId');
  });
  it('charges IGST between states, and decides the place of supply from the delivery address for goods and the billing address for services', async () => {
    const s = await shop('Inter Co');
    const other = ok(await invoice(s, s.cust.other, [stocked(s, s.item.widget)]));
    expect(other).toMatchObject({ placeOfSupply: '29', taxRegime: 'inter', cgstTotal: '0.0000', igstTotal: '180.0000', grandTotal: '1180.0000', roundOff: '0.0000' });
    const shipped = ok(await invoice(s, s.cust.local, [stocked(s, s.item.widget)])); // default shipping address is in Gujarat
    expect(shipped).toMatchObject({ placeOfSupply: '24', taxRegime: 'inter', igstTotal: '180.0000' });
    const serviceOnly = ok(await invoice(s, s.cust.local, [{ itemId: s.item.service, quantity: '1', unitPrice: '1000' }])); // services follow the recipient's billing state
    expect(serviceOnly).toMatchObject({ placeOfSupply: '27', taxRegime: 'intra', cgstTotal: '90.0000' });
    expect(serviceOnly.lines[0]).toMatchObject({ warehouseId: null, unitCost: null });
    const mixed = await invoice(s, s.cust.local, [stocked(s, s.item.widget), { itemId: s.item.service, quantity: '1', unitPrice: '100' }]);
    expect(mixed.status).toBe(422);
    expect(mixed.json.code).toBe('mixed_place_of_supply');
    const explicit = ok(await invoice(s, s.cust.local, [stocked(s, s.item.widget)], { shipToAddressId: s.addr.localShip, placeOfSupplyState: '27' }));
    expect(explicit.placeOfSupply).toBe('27');
    const journal = await journalOf(s, serviceOnly.id);
    expect(journal.find((l) => l.code === '4130')).toMatchObject({ cr: '1000.0000' }); // services have their own sales account
    expect(journal.find((l) => l.code === '2230')).toBeUndefined();
  });
  it('handles SEZ and export supplies, with or without payment of tax, and reverse charge', async () => {
    const s = await shop('Special Co');
    expect((await invoice(s, s.cust.sez, [stocked(s, s.item.widget)])).json.errors[0].path).toBe('taxPayment');
    expect((await invoice(s, s.cust.local, [stocked(s, s.item.widget)], { taxPayment: 'with_payment' })).status).toBe(422);
    const sezPaid = ok(await invoice(s, s.cust.sez, [stocked(s, s.item.widget)], { taxPayment: 'with_payment' }));
    expect(sezPaid).toMatchObject({ supplyType: 'sez', taxPayment: 'with_payment', taxRegime: 'inter', igstTotal: '180.0000', placeOfSupply: '24' });
    const sezLut = ok(await invoice(s, s.cust.sez, [stocked(s, s.item.widget)], { taxPayment: 'without_payment' }));
    expect(sezLut).toMatchObject({ igstTotal: '0.0000', grandTotal: '1000.0000' });
    const exp = ok(await invoice(s, s.cust.overseas, [stocked(s, s.item.widget)], { taxPayment: 'with_payment' }));
    expect(exp).toMatchObject({ supplyType: 'export', placeOfSupply: '96', igstTotal: '180.0000' });
    const rcm = ok(await invoice(s, s.cust.other, [stocked(s, s.item.widget)], { reverseCharge: true }));
    expect(rcm).toMatchObject({ reverseCharge: true, igstTotal: '180.0000', grandTotal: '1000.0000' }); // tax is shown, not collected
    const j = await journalOf(s, rcm.id);
    expect(j.map((l) => l.code)).toEqual(['1130', '4100']); // nothing booked to output tax
    expect((await tb(s)).balanced).toBe(true);
  });
  it('backs tax out of tax-inclusive prices and applies line discounts first', async () => {
    const s = await shop('Inclusive Co');
    const inv = ok(await invoice(s, s.cust.consumer, [stocked(s, s.item.widget, { unitPrice: '118', taxInclusive: true }), stocked(s, s.item.widget, { quantity: '4', unitPrice: '250', discountPercent: '10' })]));
    expect(inv.lines[0]).toMatchObject({ taxableValue: '100.0000', cgstAmount: '9.0000', lineTotal: '118.0000', taxInclusive: true });
    expect(inv.lines[1]).toMatchObject({ taxableValue: '900.0000', discountPercent: '10.0000', cgstAmount: '81.0000', lineTotal: '1062.0000' });
    expect(inv.grandTotal).toBe('1180.0000');
  });
  it('uses the tax rate in force on the invoice date', async () => {
    const s = await shop('Dated Co');
    ok(await call(server, 'POST', `/v1/tax-codes/${s.tax.gst18}/rates`, { tenant: s.tenant, body: { effectiveFrom: '2025-10-01', igstRate: 12 } }));
    expect(ok(await invoice(s, s.cust.other, [stocked(s, s.item.widget)], { invoiceDate: '2025-09-30' })).igstTotal).toBe('180.0000');
    expect(ok(await invoice(s, s.cust.other, [stocked(s, s.item.widget)], { invoiceDate: '2025-10-01' })).igstTotal).toBe('120.0000');
    const noRate = await shop('No Rate Co');
    const early = await invoice(noRate, noRate.cust.other, [stocked(noRate, noRate.item.widget)], { invoiceDate: '2025-04-01' });
    expect(early.status).toBe(201); // rate starts 2025-04-01
    const exemptInv = ok(await invoice(s, s.cust.other, [stocked(s, s.item.exemptItem)]));
    expect(exemptInv).toMatchObject({ igstTotal: '0.0000', grandTotal: '1000.0000' });
  });
  it('needs a tax code, an effective rate, an active registration, a customer and a sellable stocked item', async () => {
    const s = await shop('Rules Co');
    const nos = await unitId(s.tenant, 'NOS');
    const bare = ok(await call(server, 'POST', '/v1/items', { tenant: s.tenant, body: { code: 'BARE', name: 'Bare', itemType: 'finished_good', baseUomId: nos } })).id as string;
    expect((await invoice(s, s.cust.local, [stocked(s, bare)])).json.code).toBe('tax_code_required');
    const override = ok(await invoice(s, s.cust.consumer, [stocked(s, s.item.widget, { taxCodeId: s.tax.gst5 })]));
    expect(override.lines[0].cgstRate).toBe('2.5000');
    expect((await invoice(s, s.cust.consumer, [{ itemId: s.item.widget, quantity: '1', unitPrice: '1' }])).json.errors[0].message).toMatch(/warehouse/);
    expect((await invoice(s, s.cust.consumer, [{ itemId: s.item.service, quantity: '1', unitPrice: '1', warehouseId: s.wh }])).status).toBe(422);
    const supplier = ok(await call(server, 'POST', '/v1/parties', { tenant: s.tenant, body: { code: 'SUP', legalName: 'Only supplier', isSupplier: true, gstTreatment: 'consumer' } })).id;
    expect((await invoice(s, supplier, [stocked(s, s.item.widget)])).json.code).toBe('not_a_customer');
    await call(server, 'PATCH', `/v1/parties/${s.cust.consumer}`, { tenant: s.tenant, headers: { 'if-match': '1' }, body: { status: 'blocked' } });
    expect((await invoice(s, s.cust.consumer, [stocked(s, s.item.widget)])).json.code).toBe('customer_not_active');
    await supers.query("UPDATE erp.gst_registrations SET effective_to = '2025-04-05' WHERE id = $1", [s.regId]);
    expect((await invoice(s, s.cust.local, [stocked(s, s.item.widget)])).json.code).toBe('registration_not_effective');
    const other = await shop('Rules Other Co');
    expect((await call(server, 'POST', '/v1/sales/invoices', { tenant: s.tenant, body: { companyId: s.companyId, gstRegistrationId: other.regId, invoiceDate: '2025-04-10', customerId: s.cust.local, lines: [stocked(s, s.item.widget)] } })).status).toBe(422);
  });
});

describe('composition suppliers and bills of supply', () => {
  it('lets a composition supplier issue only a tax-free bill of supply', async () => {
    const s = await shop('Composition Co', { registrationType: 'composition' });
    expect((await invoice(s, s.cust.consumer, [stocked(s, s.item.widget)])).json.code).toBe('composition_cannot_issue_tax_invoice');
    const bos = ok(await invoice(s, s.cust.consumer, [stocked(s, s.item.widget, { quantity: '2' })], { documentType: 'bill_of_supply' }));
    expect(bos).toMatchObject({ documentType: 'bill_of_supply', invoiceNo: 'BOS/2526/00001', taxableTotal: '2000.0000', cgstTotal: '0.0000', igstTotal: '0.0000', grandTotal: '2000.0000' });
    expect(bos.lines[0]).toMatchObject({ cgstRate: '0.0000', igstRate: '0.0000' });
  });
  it('lets a regular supplier use a bill of supply only for tax-free goods', async () => {
    const s = await shop('Regular BoS Co');
    const taxed = await invoice(s, s.cust.local, [stocked(s, s.item.widget)], { documentType: 'bill_of_supply' });
    expect(taxed.status).toBe(201); // bill of supply is tax-free by definition: rates are not applied
    expect(taxed.json.igstTotal).toBe('0.0000');
  });
  it('refuses registration types that do not issue sales invoices', async () => {
    const s = await shop('Casual Co', { registrationType: 'casual' });
    expect((await invoice(s, s.cust.consumer, [stocked(s, s.item.widget)])).json.code).toBe('registration_type_not_supported');
  });
});

describe('stock, numbering and atomicity', () => {
  it('rolls everything back when stock is short, leaving the invoice number free', async () => {
    const s = await shop('Short Co');
    const before = await balance(s, s.item.widget);
    const res = await invoice(s, s.cust.consumer, [stocked(s, s.item.widget, { quantity: '500' })]);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('insufficient_stock');
    expect(await balance(s, s.item.widget)).toEqual(before);
    const n = (await supers.query('SELECT (SELECT count(*) FROM erp.sales_invoices WHERE tenant_id = $1)::int AS i, (SELECT count(*) FROM erp.journal_entries WHERE tenant_id = $1 AND source_type = $2)::int AS j', [s.tenant, 'sales_invoice'])).rows[0];
    expect(n).toEqual({ i: 0, j: 0 });
    expect(ok(await invoice(s, s.cust.consumer, [stocked(s, s.item.widget)])).invoiceNo).toBe('INV/2526/00001'); // the number was not burnt
  });
  it('needs the number series and the accounts, and reports what is missing', async () => {
    const s = await shop('Missing Co');
    await supers.query("UPDATE erp.number_series SET status = 'closed' WHERE tenant_id = $1 AND document_type = 'tax_invoice'", [s.tenant]);
    expect((await invoice(s, s.cust.consumer, [stocked(s, s.item.widget)])).json.code).toBe('number_series_closed');
    const t = await shop('Missing 2 Co');
    ok(await call(server, 'PUT', `/v1/companies/${t.companyId}/sales-settings`, { tenant: t.tenant, body: { roundOffAccountId: null } }), 200);
    const res = await invoice(t, t.cust.consumer, [stocked(t, t.item.cheap, { unitPrice: '99.99' })]); // produces a round-off
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: 'sales_accounts_not_configured', missing: ['roundOffAccountId'] });
  });
  it('carries batches, serial numbers and FIFO costing through to cost of goods', async () => {
    const s = await shop('Trace Sales Co');
    const nos = await unitId(s.tenant, 'NOS');
    const mk = async (o: object) => ok(await call(server, 'POST', '/v1/items', { tenant: s.tenant, body: { code: `T-${++seq}`, name: 'T', itemType: 'finished_good', baseUomId: nos, taxCodeId: s.tax.gst18, ...o } })).id as string;
    const serial = await mk({ tracking: 'serial' });
    const fifo = await mk({ costingMethod: 'fifo' });
    const batch = await mk({ tracking: 'batch' });
    const receive = async (itemId: string, q: string, c: string, date: string, extra: object = {}) => ok(await call(server, 'POST', '/v1/stock/movements', { tenant: s.tenant, body: { companyId: s.companyId, movementType: 'receipt', postingDate: date, description: 'R', offsetAccountId: s.acc['2140'], lines: [{ warehouseId: s.wh, itemId, quantity: q, unitCost: c, ...extra }] } }));
    await receive(serial, '2', '700', '2025-04-02', { serialNos: ['SN1', 'SN2'] });
    await receive(fifo, '5', '100', '2025-04-02');
    await receive(fifo, '5', '150', '2025-04-05');
    const b = await receive(batch, '10', '30', '2025-04-02', { batch: { batchNo: 'LOT-9', expiryDate: '2026-02-01' } });
    const inv = ok(await invoice(s, s.cust.consumer, [stocked(s, serial, { serialNos: ['SN2'] }), stocked(s, fifo, { quantity: '7' }), stocked(s, batch, { quantity: '4', batchId: b.lines[0].batchId })]));
    expect(inv.lines[0]).toMatchObject({ serialNos: ['SN2'], unitCost: '700.000000', costValue: '700.0000' });
    expect(inv.lines[1]).toMatchObject({ costValue: '800.0000' }); // 5 @ 100 + 2 @ 150
    expect(inv.lines[2]).toMatchObject({ batchId: b.lines[0].batchId, costValue: '120.0000' });
    expect((await supers.query("SELECT serial_no, status FROM erp.stock_serials WHERE tenant_id = $1 ORDER BY serial_no", [s.tenant])).rows).toEqual([{ serial_no: 'SN1', status: 'in_stock' }, { serial_no: 'SN2', status: 'issued' }]);
    expect((await recon(s)).reconciled).toBe(true);
  });
  it('warns, without blocking, when a customer exceeds their credit limit', async () => {
    const s = await shop('Credit Co');
    const limited = ok(await call(server, 'POST', '/v1/parties', { tenant: s.tenant, body: { code: 'LTD', legalName: 'Limited', isCustomer: true, gstTreatment: 'consumer', creditLimit: '1500' } })).id as string;
    expect(ok(await invoice(s, limited, [stocked(s, s.item.widget)])).warnings).toBeUndefined(); // 1180 of 1500
    const over = ok(await invoice(s, limited, [stocked(s, s.item.widget)]));
    expect(over.warnings).toEqual([{ code: 'credit_limit_exceeded', message: 'This customer is over their credit limit', creditLimit: '1500.0000', exposure: '2360.0000' }]);
  });
  it('replays an idempotent request and posts once', async () => {
    const s = await shop('Idem Sales Co');
    const body = { companyId: s.companyId, gstRegistrationId: s.regId, invoiceDate: '2025-04-10', customerId: s.cust.consumer, lines: [stocked(s, s.item.widget)] };
    const one = await call(server, 'POST', '/v1/sales/invoices', { tenant: s.tenant, headers: { 'idempotency-key': 'inv-1' }, body });
    const two = await call(server, 'POST', '/v1/sales/invoices', { tenant: s.tenant, headers: { 'idempotency-key': 'inv-1' }, body });
    expect(two.headers.get('idempotent-replayed')).toBe('true');
    expect(two.json.id).toBe(one.json.id);
    expect((await balance(s, s.item.widget)).quantity).toBe('99.000000');
  });
  it('numbers 20 simultaneous invoices consecutively and never oversells', async () => {
    const s = await shop('Race Sales Co');
    const nos = await unitId(s.tenant, 'NOS');
    const scarce = ok(await call(server, 'POST', '/v1/items', { tenant: s.tenant, body: { code: 'SCARCE', name: 'Scarce', itemType: 'finished_good', baseUomId: nos, taxCodeId: s.tax.gst18 } })).id as string;
    ok(await call(server, 'POST', '/v1/stock/movements', { tenant: s.tenant, body: { companyId: s.companyId, movementType: 'opening', postingDate: '2025-04-01', description: 'o', lines: [{ warehouseId: s.wh, itemId: scarce, quantity: '12', unitCost: '10' }] } }));
    const results = await Promise.all(Array.from({ length: 20 }, () => invoice(s, s.cust.consumer, [stocked(s, scarce, { unitPrice: '50' })])));
    const good = results.filter((r) => r.status === 201);
    expect(good).toHaveLength(12);
    expect(results.filter((r) => r.status !== 201).every((r) => r.json.code === 'insufficient_stock')).toBe(true);
    expect(good.map((r) => Number(r.json.invoiceNo.slice(-5))).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect((await balance(s, scarce)).quantity).toBe('0.000000');
  });
});

describe('credit and debit notes', () => {
  it('returns stock at the ORIGINAL cost and reverses tax at the ORIGINAL rate', async () => {
    const s = await shop('Credit Note Co');
    const inv = ok(await invoice(s, s.cust.other, [stocked(s, s.item.widget, { quantity: '10', unitPrice: '1000' })])); // cost 400
    ok(await call(server, 'POST', `/v1/tax-codes/${s.tax.gst18}/rates`, { tenant: s.tenant, body: { effectiveFrom: '2025-10-01', igstRate: 12 } }));
    ok(await call(server, 'POST', '/v1/stock/movements', { tenant: s.tenant, body: { companyId: s.companyId, movementType: 'receipt', postingDate: '2025-10-02', description: 'dearer', offsetAccountId: s.acc['2140'], lines: [{ warehouseId: s.wh, itemId: s.item.widget, quantity: '10', unitCost: '900' }] } }));
    const before = await balance(s, s.item.widget);
    const cn = ok(await call(server, 'POST', '/v1/sales/credit-notes', { tenant: s.tenant, body: { originalInvoiceId: inv.id, noteDate: '2025-10-10', reason: 'Damaged on arrival', lines: [{ originalLineId: inv.lines[0].id, quantity: '4' }] } }));
    expect(cn).toMatchObject({ documentType: 'credit_note', invoiceNo: 'CN/2526/00001', originalInvoiceId: inv.id, reason: 'Damaged on arrival', taxableTotal: '4000.0000', igstTotal: '720.0000', grandTotal: '4720.0000', placeOfSupply: '29' }); // still 18%
    expect(cn.lines[0]).toMatchObject({ originalLineId: inv.lines[0].id, igstRate: '18.0000', unitCost: '400.000000', costValue: '1600.0000' });
    const after = await balance(s, s.item.widget);
    expect(Number(after.quantity) - Number(before.quantity)).toBe(4);
    expect(Number(after.value) - Number(before.value)).toBe(1600); // back at 400 each, not at today's average
    const j = await journalOf(s, cn.id);
    expect(j).toEqual([{ code: '1130', dr: '0.0000', cr: '4720.0000', party_id: s.cust.other }, { code: '2230', dr: '720.0000', cr: '0.0000', party_id: null }, { code: '4100', dr: '4000.0000', cr: '0.0000', party_id: null }]);
    expect((await tb(s)).balanced).toBe(true);
    expect((await recon(s)).reconciled).toBe(true);
    // limits
    const second = await call(server, 'POST', '/v1/sales/credit-notes', { tenant: s.tenant, body: { originalInvoiceId: inv.id, noteDate: '2025-10-11', reason: 'More', lines: [{ originalLineId: inv.lines[0].id, quantity: '7' }] } });
    expect(second.status).toBe(409);
    expect(second.json.code).toBe('credit_exceeds_invoice');
    ok(await call(server, 'POST', '/v1/sales/credit-notes', { tenant: s.tenant, body: { originalInvoiceId: inv.id, noteDate: '2025-10-11', reason: 'Rest', lines: [{ originalLineId: inv.lines[0].id, quantity: '6' }] } }));
    expect((await call(server, 'POST', '/v1/sales/credit-notes', { tenant: s.tenant, body: { originalInvoiceId: inv.id, noteDate: '2025-10-12', reason: 'x', lines: [{ originalLineId: inv.lines[0].id, quantity: '1' }] } })).json.code).toBe('credit_exceeds_invoice');
  });
  it('credits at a lower price without returning goods, and never above the invoiced price', async () => {
    const s = await shop('Price Credit Co');
    const inv = ok(await invoice(s, s.cust.consumer, [stocked(s, s.item.widget, { quantity: '5' })]));
    const before = await balance(s, s.item.widget);
    const note = (o: object) => call(server, 'POST', '/v1/sales/credit-notes', { tenant: s.tenant, body: { originalInvoiceId: inv.id, noteDate: '2025-04-12', reason: 'Rate difference', lines: [{ originalLineId: inv.lines[0].id, quantity: '5', ...o }] } });
    expect((await note({ unitPrice: '1100' })).status).toBe(422);
    const cn = ok(await note({ unitPrice: '900', returnStock: false }));
    expect(cn).toMatchObject({ taxableTotal: '4500.0000', cgstTotal: '405.0000', grandTotal: '5310.0000', stockMovementId: null });
    expect(await balance(s, s.item.widget)).toEqual(before);
  });
  it('takes returned serial numbers back into stock, only those that were invoiced', async () => {
    const s = await shop('Serial Return Co');
    const nos = await unitId(s.tenant, 'NOS');
    const serial = ok(await call(server, 'POST', '/v1/items', { tenant: s.tenant, body: { code: 'SER', name: 'S', itemType: 'finished_good', tracking: 'serial', baseUomId: nos, taxCodeId: s.tax.gst18 } })).id as string;
    ok(await call(server, 'POST', '/v1/stock/movements', { tenant: s.tenant, body: { companyId: s.companyId, movementType: 'receipt', postingDate: '2025-04-01', description: 'r', offsetAccountId: s.acc['2140'], lines: [{ warehouseId: s.wh, itemId: serial, quantity: '3', unitCost: '100', serialNos: ['A1', 'A2', 'A3'] }] } }));
    const inv = ok(await invoice(s, s.cust.consumer, [stocked(s, serial, { quantity: '2', serialNos: ['A1', 'A2'] })]));
    const ret = (serialNos?: string[]) => call(server, 'POST', '/v1/sales/credit-notes', { tenant: s.tenant, body: { originalInvoiceId: inv.id, noteDate: '2025-04-12', reason: 'Faulty', lines: [{ originalLineId: inv.lines[0].id, quantity: '1', ...(serialNos ? { serialNos } : {}) }] } });
    expect((await ret()).json.code).toBe('serial_required');
    expect((await ret(['A3'])).json.code).toBe('serial_required'); // never invoiced on this line
    ok(await ret(['A2']));
    expect((await supers.query('SELECT serial_no, status FROM erp.stock_serials WHERE tenant_id = $1 ORDER BY serial_no', [s.tenant])).rows).toEqual([{ serial_no: 'A1', status: 'issued' }, { serial_no: 'A2', status: 'in_stock' }, { serial_no: 'A3', status: 'in_stock' }]);
  });
  it('issues debit notes that add to the receivable without touching stock, and refuses notes on notes or before the invoice', async () => {
    const s = await shop('Debit Co');
    const inv = ok(await invoice(s, s.cust.local, [{ itemId: s.item.service, quantity: '1', unitPrice: '1000' }]));
    const dn = ok(await call(server, 'POST', '/v1/sales/debit-notes', { tenant: s.tenant, body: { originalInvoiceId: inv.id, noteDate: '2025-04-15', reason: 'Price revision', lines: [{ originalLineId: inv.lines[0].id, quantity: '1', unitPrice: '200' }] } }));
    expect(dn).toMatchObject({ documentType: 'debit_note', invoiceNo: 'DN/2526/00001', taxableTotal: '200.0000', cgstTotal: '18.0000', grandTotal: '236.0000' });
    expect((await journalOf(s, dn.id)).find((l) => l.code === '1130')).toMatchObject({ dr: '236.0000' });
    const post = (body: object) => call(server, 'POST', '/v1/sales/credit-notes', { tenant: s.tenant, body: { reason: 'x', lines: [{ originalLineId: inv.lines[0].id, quantity: '1' }], ...body } });
    expect((await post({ originalInvoiceId: dn.id, noteDate: '2025-04-16' })).json.code).toBe('original_is_a_note');
    expect((await post({ originalInvoiceId: inv.id, noteDate: '2025-04-01' })).status).toBe(422);
  });
});

describe('cancellation', () => {
  it('reverses the books and the stock exactly, keeps the number, and cannot be repeated', async () => {
    const s = await shop('Cancel Co');
    const startBalance = await balance(s, s.item.widget);
    const inv = ok(await invoice(s, s.cust.other, [stocked(s, s.item.widget, { quantity: '6' })]));
    const out = ok(await call(server, 'POST', `/v1/sales/invoices/${inv.id}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-04-12', reason: 'Wrong customer' } }), 200);
    expect(out).toMatchObject({ status: 'cancelled', cancelReason: 'Wrong customer', cancelDate: '2025-04-12', invoiceNo: 'INV/2526/00001' });
    expect(await balance(s, s.item.widget)).toMatchObject({ quantity: startBalance.quantity, value: startBalance.value });
    const t = await tb(s);
    expect(t.balanced).toBe(true);
    for (const code of ['1130', '4100', '2230', '5100']) expect(row(t, code)).toMatchObject({ closingDebit: '0.0000', closingCredit: '0.0000' });
    expect((await recon(s)).reconciled).toBe(true);
    const alloc = (await supers.query("SELECT status, cancel_reason FROM erp.number_allocations WHERE tenant_id = $1 AND formatted = 'INV/2526/00001'", [s.tenant])).rows[0];
    expect(alloc).toEqual({ status: 'cancelled', cancel_reason: 'Wrong customer' });
    expect(ok(await invoice(s, s.cust.local, [stocked(s, s.item.widget)])).invoiceNo).toBe('INV/2526/00002'); // the cancelled number is never reused
    expect((await call(server, 'POST', `/v1/sales/invoices/${inv.id}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-04-13', reason: 'again' } })).json.code).toBe('already_cancelled');
    expect((await call(server, 'POST', `/v1/sales/credit-notes`, { tenant: s.tenant, body: { originalInvoiceId: inv.id, noteDate: '2025-04-13', reason: 'x', lines: [{ originalLineId: inv.lines[0].id, quantity: '1' }] } })).json.code).toBe('invoice_cancelled');
    expect((await call(server, 'GET', `/v1/sales/invoices?companyId=${s.companyId}&status=cancelled`, { tenant: s.tenant })).json.items).toHaveLength(1);
  });
  it('is refused once a note exists, for a note, in a closed period, or before the invoice date; serials come back', async () => {
    const s = await shop('Cancel Rules Co');
    const inv = ok(await invoice(s, s.cust.consumer, [stocked(s, s.item.widget)]));
    ok(await call(server, 'POST', '/v1/sales/credit-notes', { tenant: s.tenant, body: { originalInvoiceId: inv.id, noteDate: '2025-04-11', reason: 'r', lines: [{ originalLineId: inv.lines[0].id, quantity: '1', returnStock: false }] } }), 201);
    const cancel = (id: string, cancelDate = '2025-04-12') => call(server, 'POST', `/v1/sales/invoices/${id}/cancel`, { tenant: s.tenant, body: { cancelDate, reason: 'x' } });
    expect((await cancel(inv.id)).json.code).toBe('has_notes');
    const fresh = ok(await invoice(s, s.cust.consumer, [stocked(s, s.item.widget)], { invoiceDate: '2025-04-20' }));
    expect((await cancel(fresh.id, '2025-04-10')).status).toBe(422);
    const note = (await call(server, 'GET', `/v1/sales/invoices?companyId=${s.companyId}&documentType=credit_note`, { tenant: s.tenant })).json.items[0];
    expect((await cancel(note.id)).json.code).toBe('note_cannot_be_cancelled');
    ok(await call(server, 'POST', `/v1/accounting-periods/${s.periods.find((p) => p.name === 'Apr 2025')?.id}/close`, { tenant: s.tenant }), 200);
    const closed = await cancel(fresh.id, '2025-04-25');
    expect(closed.json.code).toBe('period_closed');
    const still = await call(server, 'GET', `/v1/sales/invoices/${fresh.id}`, { tenant: s.tenant });
    expect(still.json.status).toBe('posted'); // the failed cancellation left nothing behind
  });
  it('gives serial numbers back to stock when a sale is cancelled', async () => {
    const s = await shop('Cancel Serial Co');
    const nos = await unitId(s.tenant, 'NOS');
    const serial = ok(await call(server, 'POST', '/v1/items', { tenant: s.tenant, body: { code: 'CSER', name: 'S', itemType: 'finished_good', tracking: 'serial', baseUomId: nos, taxCodeId: s.tax.gst18 } })).id as string;
    ok(await call(server, 'POST', '/v1/stock/movements', { tenant: s.tenant, body: { companyId: s.companyId, movementType: 'receipt', postingDate: '2025-04-01', description: 'r', offsetAccountId: s.acc['2140'], lines: [{ warehouseId: s.wh, itemId: serial, quantity: '2', unitCost: '100', serialNos: ['Z1', 'Z2'] }] } }));
    const inv = ok(await invoice(s, s.cust.consumer, [stocked(s, serial, { quantity: '2', serialNos: ['Z1', 'Z2'] })]));
    ok(await call(server, 'POST', `/v1/sales/invoices/${inv.id}/cancel`, { tenant: s.tenant, body: { cancelDate: '2025-04-12', reason: 'x' } }), 200);
    expect((await supers.query("SELECT status FROM erp.stock_serials WHERE tenant_id = $1", [s.tenant])).rows).toEqual([{ status: 'in_stock' }, { status: 'in_stock' }]);
    ok(await invoice(s, s.cust.consumer, [stocked(s, serial, { quantity: '1', serialNos: ['Z1'] })])); // and they can be sold again
  });
});

describe('the database guards the documents', () => {
  it('refuses edits and deletions by any role, and a header that does not add up', async () => {
    const s = await shop('Guard Co');
    const inv = ok(await invoice(s, s.cust.local, [stocked(s, s.item.widget)]));
    for (const sql of ["UPDATE erp.sales_invoices SET grand_total = 1 WHERE id = $1", 'DELETE FROM erp.sales_invoices WHERE id = $1', "UPDATE erp.sales_invoice_lines SET unit_price = 1 WHERE invoice_id = $1", 'DELETE FROM erp.sales_invoice_lines WHERE invoice_id = $1']) {
      await expect(supers.query(sql, [inv.id]), sql).rejects.toMatchObject({ code: '55000' });
    }
    const client = await supers.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO erp.sales_invoices (tenant_id, id, company_id, gst_registration_id, document_type, invoice_no, invoice_date, customer_id, customer_name, customer_gst_treatment, place_of_supply, supply_type, tax_regime, taxable_total, grand_total)
        VALUES ($1, '00000000-0000-7000-8000-0000000000aa', $2, $3, 'tax_invoice', 'RAW/1', '2025-04-10', $4, 'x', 'consumer', '27', 'b2c', 'intra', 100, 100)`, [s.tenant, s.companyId, s.regId, s.cust.consumer]);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' }); // a header with no lines
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('BEGIN');
      await expect(client.query(`INSERT INTO erp.sales_invoices (tenant_id, id, company_id, gst_registration_id, document_type, invoice_no, invoice_date, customer_id, customer_name, customer_gst_treatment, place_of_supply, supply_type, tax_regime, taxable_total, igst_total, grand_total)
        VALUES ($1, gen_random_uuid(), $2, $3, 'tax_invoice', 'RAW/2', '2025-04-10', $4, 'x', 'consumer', '27', 'b2c', 'intra', 100, 18, 118)`, [s.tenant, s.companyId, s.regId, s.cust.consumer])).rejects.toMatchObject({ code: '23514' }); // IGST inside a state
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});

describe('access and isolation', () => {
  it('separates reading, posting, cancelling and configuring, and keeps tenants apart', async () => {
    const s = await shop('Sales Access Co');
    const inv = ok(await invoice(s, s.cust.local, [stocked(s, s.item.widget)]));
    const key = async (permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: s.tenant, body: { name: 'k', permissions } })).json.key as string;
    const reader = await key(['sales:read']);
    expect((await call(server, 'GET', `/v1/sales/invoices/${inv.id}`, { token: reader })).status).toBe(200);
    expect((await call(server, 'POST', '/v1/sales/invoices', { token: reader, body: {} })).status).toBe(403);
    const poster = await key(['sales:post']);
    expect((await call(server, 'POST', `/v1/sales/invoices/${inv.id}/cancel`, { token: poster, body: { cancelDate: '2025-04-12', reason: 'x' } })).status).toBe(403);
    expect((await call(server, 'PUT', `/v1/companies/${s.companyId}/sales-settings`, { token: poster, body: { cogsAccountId: null } })).status).toBe(403);
    const other = await shop('Sales Access Other');
    expect((await call(server, 'GET', `/v1/sales/invoices/${inv.id}`, { tenant: other.tenant })).status).toBe(404);
    expect((await call(server, 'GET', `/v1/sales/invoices?companyId=${s.companyId}`, { tenant: other.tenant })).json.items).toEqual([]);
    expect((await call(server, 'POST', '/v1/sales/invoices', { tenant: other.tenant, body: { companyId: other.companyId, gstRegistrationId: other.regId, invoiceDate: '2025-04-10', customerId: s.cust.local, lines: [stocked(other, other.item.widget)] } })).status).toBe(404); // another tenant's customer
    const page = (await call(server, 'GET', `/v1/sales/invoices?companyId=${s.companyId}&customerId=${s.cust.local}&documentType=tax_invoice`, { tenant: s.tenant })).json;
    expect(page.items).toHaveLength(1);
  });
});
