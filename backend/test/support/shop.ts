import { expect } from 'vitest';
import type pg from 'pg';
import { call, createRegistration, createTenant, makeGstin, type TestServer } from './harness.js';

export const ok = (res: { status: number; json: unknown }, status = 201) => { expect(res.status, JSON.stringify(res.json)).toBe(status); return res.json as any; }; // eslint-disable-line

export interface Shop {
  tenant: string; companyId: string; regId: string; acc: Record<string, string>; wh: string; periods: { id: string; name: string }[];
  tax: { gst18: string; gst5: string; exempt: string };
  item: { widget: string; cheap: string; service: string; exemptItem: string };
  cust: { local: string; other: string; consumer: string; sez: string; overseas: string };
  addr: { localShip: string; otherBill: string };
}
/** A seller registered in Maharashtra (27) with chart, books, stock, tax codes, items, customers and number series ready. */
export function shopKit(server: TestServer, supers: pg.Pool) {
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


  return { shop, unitId };
}
