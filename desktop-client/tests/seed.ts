import { gstinCheckCharacter } from '../src/domain/india'

export const PASSWORD = 'a long passphrase for tests 42'
export const makeGstin = (state: string, pan: string): string => { const f = `${state}${pan}1Z`; return f + gstinCheckCharacter(f) }

type Json = Record<string, unknown> & { id: string }

/** A ready-to-invoice business built through the public API only: set up, one stocked item, one customer with an address. */
export async function seedBusiness(base: string, platformToken: string, o: { name?: string; prefix?: string } = {}) {
  const slug = `${o.prefix ?? 'seed'}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`
  const email = `owner@${slug}.example.com`
  const json = { 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown, token?: string): Promise<Json & { accessToken?: string; items?: Json[] }> => {
    const r = await fetch(`${base}${path}`, { method, headers: { ...json, ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`)
    return (await r.json()) as Json
  }
  await call('POST', '/v1/platform/tenants', { name: o.name ?? 'Seed Co', slug, owner: { email, displayName: 'Seed Owner', password: PASSWORD } }, platformToken)
  const token = (await call('POST', '/v1/auth/login', { tenant: slug, email, password: PASSWORD })).accessToken as string
  const company = await call('POST', '/v1/companies', { legalName: 'Sunrise Traders Pvt Ltd', tradeName: 'Sunrise', pan: 'ABCDE1234F' }, token)
  const registration = await call('POST', `/v1/companies/${company.id}/gst-registrations`, { gstin: makeGstin('27', 'ABCDE1234F'), legalName: 'Sunrise Traders Pvt Ltd', effectiveFrom: '2025-04-01' }, token)
  const location = await call('POST', '/v1/business-locations', { companyId: company.id, gstRegistrationId: registration.id, code: 'MUM', name: 'Mumbai', isPrincipalPlace: true, addressLine1: '12 Mill Road', city: 'Mumbai', stateCode: '27', pincode: '400001' }, token)
  const warehouse = await call('POST', '/v1/warehouses', { businessLocationId: location.id, code: 'MAIN', name: 'Main', kind: 'finished_goods' }, token)
  const year = new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0)
  await call('POST', '/v1/fiscal-years', { companyId: company.id, startDate: `${year}-04-01` }, token)
  await call('POST', `/v1/companies/${company.id}/setup/apply-defaults`, {}, token)
  const taxCodes = (await call('GET', '/v1/tax-codes?limit=50', undefined, token)).items as Json[]
  const gst18 = taxCodes.find((t) => t['code'] === 'GST18') as Json
  const gst5 = taxCodes.find((t) => t['code'] === 'GST5') as Json
  const nos = ((await call('GET', '/v1/units?limit=200', undefined, token)).items as Json[]).find((u) => u['code'] === 'NOS') as Json
  const widget = await call('POST', '/v1/items', { code: 'WIDGET', name: 'Steel widget', baseUomId: nos.id, itemType: 'finished_good', taxCodeId: gst18.id, hsnSacCode: '8479' }, token)
  const cheap = await call('POST', '/v1/items', { code: 'TOY', name: 'Plastic toy', baseUomId: nos.id, itemType: 'finished_good', taxCodeId: gst5.id, hsnSacCode: '9503' }, token)
  for (const item of [widget, cheap]) await call('POST', '/v1/stock/movements', { companyId: company.id, movementType: 'opening', postingDate: `${year}-04-01`, description: 'Opening stock', lines: [{ warehouseId: warehouse.id, itemId: item.id, quantity: '100', unitCost: '400' }] }, token)
  const customer = await call('POST', '/v1/parties', { code: 'C-001', legalName: 'Asha Traders', gstTreatment: 'registered_regular', gstin: makeGstin('27', 'FGHIJ5678K'), isCustomer: true }, token)
  const address = await call('POST', `/v1/parties/${customer.id}/addresses`, { kind: 'billing', line1: '5 Market Street', city: 'Pune', stateCode: '27', pincode: '411001', isDefault: true }, token)
  const supplier = await call('POST', '/v1/parties', { code: 'S-001', legalName: 'Vendor Supplies', gstTreatment: 'registered_regular', gstin: makeGstin('27', 'PQRST3456U'), isSupplier: true }, token)
  await call('POST', `/v1/parties/${supplier.id}/addresses`, { kind: 'billing', line1: '1 Industrial Area', city: 'Thane', stateCode: '27', pincode: '400601', isDefault: true }, token)
  const walkIn = await call('POST', '/v1/parties', { code: 'WALKIN', legalName: 'Walk-in customer', gstTreatment: 'consumer', isCustomer: true }, token)
  const accounts = ((await call('GET', `/v1/accounts?companyId=${company.id}&limit=200`, undefined, token)).items as Json[])
  const account = (code: string): string => (accounts.find((a) => a['code'] === code) as Json).id
  return { base, slug, email, password: PASSWORD, token, year, company, registration, location, warehouse, widget, cheap, customer, address, supplier, walkIn, bank: account('1120'), cash: account('1110'), call: (m: string, p: string, b?: unknown) => call(m, p, b, token) }
}
export type Seed = Awaited<ReturnType<typeof seedBusiness>>
