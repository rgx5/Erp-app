#!/usr/bin/env node
/**
 * Fills a demo server with a believable business so every screen has something to show.
 *
 * Creates one business (default code "demo") with a company, GST registration, warehouse, chart of accounts, 12 items with stock, 8 customers,
 * 3 suppliers, about 45 sales invoices across the current financial year (CGST/SGST and IGST), and receipts against most of them (some
 * partial, some left overdue). Everything goes through the normal API, so the numbers are real ledger postings.
 *
 * Run it where the platform routes are reachable. On the Dokploy demo cell that is inside the api container (Dokploy -> service ->
 * Terminal -> container "api"), where the platform token is already in the environment:
 *
 *     node scripts/seed-demo.mjs
 *
 * Or from any machine that can reach the API directly:
 *
 *     BASE_URL=http://127.0.0.1:8081 PLATFORM_ADMIN_TOKEN=... node scripts/seed-demo.mjs
 *
 * Optional: DEMO_SLUG (business code, default demo), DEMO_PASSWORD, DEMO_OWNER_EMAIL, DEMO_NAME.
 * Safe to run twice: if the business already has a company it stops without adding anything.
 */
const BASE = (process.env.BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`).replace(/\/$/, '');
const PLATFORM_TOKEN = process.env.PLATFORM_ADMIN_TOKEN ?? '';
const SLUG = process.env.DEMO_SLUG ?? 'demo';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-passphrase-2026';
const EMAIL = process.env.DEMO_OWNER_EMAIL ?? `owner@${SLUG}.example.com`;
const NAME = process.env.DEMO_NAME ?? 'Sunrise Traders';

if (!PLATFORM_TOKEN) { console.error('PLATFORM_ADMIN_TOKEN is not set. Run this inside the api container, or export it.'); process.exit(2); }

async function call(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) { const e = new Error(`${method} ${path} -> ${res.status} ${json.detail ?? json.title ?? text.slice(0, 200)}`); e.status = res.status; e.body = json; throw e; }
  return json;
}
const step = (m) => console.log(`- ${m}`);

// ---- helpers -----------------------------------------------------------------------------------------------------
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstin(state, pan, entity = '1') {
  const first14 = `${state}${pan}${entity}Z`;
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = ALPHABET.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36); }
  return first14 + ALPHABET[(36 - (sum % 36)) % 36];
}
let seed = 20260419;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; // the same demo every time
const pick = (a) => a[Math.floor(rnd() * a.length)];
const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const fyStart = new Date(Date.UTC(today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1, 3, 1));
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

// ---- the business ------------------------------------------------------------------------------------------------
let tenantExisted = false;
try {
  await call('POST', '/v1/platform/tenants', { name: NAME, slug: SLUG, owner: { email: EMAIL, displayName: 'Demo Owner', password: PASSWORD } }, PLATFORM_TOKEN);
  step(`business "${SLUG}" created`);
} catch (e) {
  if (e.status === 409) { tenantExisted = true; step(`business "${SLUG}" already exists`); } else throw e;
}
let token;
try { token = (await call('POST', '/v1/auth/login', { tenant: SLUG, email: EMAIL, password: PASSWORD })).accessToken; }
catch (e) { console.error(`Could not sign in as ${EMAIL}: ${e.message}\nIf this business was made with another password, set DEMO_PASSWORD (and DEMO_OWNER_EMAIL).`); process.exit(1); }
const api = (m, p, b) => call(m, p, b, token);

const existing = (await api('GET', '/v1/companies?limit=5')).items ?? [];
if (existing.length > 0) { console.log(`\n"${SLUG}" already has a company (${existing[0].tradeName ?? existing[0].legalName}); nothing added.\nSign in: business code ${SLUG}, ${EMAIL}, password ${tenantExisted ? '(as set earlier)' : PASSWORD}`); process.exit(0); }

const company = await api('POST', '/v1/companies', { legalName: `${NAME} Pvt Ltd`, tradeName: NAME, pan: 'ABCDE1234F' });
const reg = await api('POST', `/v1/companies/${company.id}/gst-registrations`, { gstin: gstin('27', 'ABCDE1234F'), legalName: `${NAME} Pvt Ltd`, effectiveFrom: iso(fyStart) });
const location = await api('POST', '/v1/business-locations', { companyId: company.id, gstRegistrationId: reg.id, code: 'MUM', name: 'Mumbai head office', isPrincipalPlace: true, addressLine1: '12 Mill Road', city: 'Mumbai', stateCode: '27', pincode: '400001' });
const warehouse = await api('POST', '/v1/warehouses', { businessLocationId: location.id, code: 'MAIN', name: 'Main warehouse', kind: 'finished_goods' });
await api('POST', '/v1/fiscal-years', { companyId: company.id, startDate: iso(fyStart) });
await api('POST', `/v1/companies/${company.id}/setup/apply-defaults`, {});
step('company, GST registration, warehouse, financial year and chart of accounts ready');

const taxCodes = (await api('GET', '/v1/tax-codes?limit=50')).items;
const tax = (code) => taxCodes.find((t) => t.code === code) ?? taxCodes.find((t) => t.code === 'GST18');
const units = (await api('GET', '/v1/units?limit=200')).items;
const NOS = units.find((u) => u.code === 'NOS');
const accounts = (await api('GET', `/v1/accounts?companyId=${company.id}&limit=200`)).items;
const acct = (code) => accounts.find((a) => a.code === code)?.id;
const BANK = acct('1120'); const CASH = acct('1110');

// ---- items and stock ---------------------------------------------------------------------------------------------
const catalogue = [
  ['STL-WIDGET', 'Steel widget', 'GST18', '8479', 1000, 640], ['BRS-FIT', 'Brass fitting 1/2"', 'GST18', '7412', 240, 150], ['PVC-PIPE', 'PVC pipe 20 mm (3 m)', 'GST18', '3917', 180, 110],
  ['CBL-2C', 'Copper cable 2 core (90 m)', 'GST18', '8544', 2650, 2050], ['LED-9W', 'LED bulb 9 W', 'GST12', '8539', 95, 58], ['SW-6A', 'Modular switch 6 A', 'GST18', '8536', 120, 74],
  ['PNT-WH', 'Wall paint white 20 L', 'GST18', '3209', 4200, 3300], ['CMT-50', 'Cement 50 kg bag', 'GST18', '2523', 390, 335], ['TOY-CAR', 'Plastic toy car', 'GST5', '9503', 150, 85],
  ['NTB-A4', 'Notebook A4 (pack of 6)', 'GST12', '4820', 210, 128], ['TEA-1KG', 'Tea 1 kg', 'GST5', '0902', 480, 360], ['SUG-5KG', 'Sugar 5 kg', 'GST5', '1701', 260, 215],
];
const items = [];
for (const [code, name, taxCode, hsn, price, cost] of catalogue) {
  const it = await api('POST', '/v1/items', { code, name, baseUomId: NOS.id, itemType: 'finished_good', taxCodeId: tax(taxCode).id, hsnSacCode: hsn });
  items.push({ ...it, price, cost });
}
await api('POST', '/v1/stock/movements', { companyId: company.id, movementType: 'opening', postingDate: iso(fyStart), description: 'Opening stock', lines: items.map((i) => ({ warehouseId: warehouse.id, itemId: i.id, quantity: '600', unitCost: String(i.cost) })) });
step(`${items.length} items with opening stock`);

// ---- parties -----------------------------------------------------------------------------------------------------
const custSpec = [
  ['Asha Traders', '27', 'Pune', '411001', 'FGHIJ5678K'], ['Bharat Stores', '27', 'Nashik', '422001', 'KLMNO1234P'], ['Carnatic Retail', '29', 'Bengaluru', '560001', 'LMNOP2345Q'],
  ['Deccan Wholesale', '27', 'Nagpur', '440001', 'MNOPQ3456R'], ['Eastern Mart', '19', 'Kolkata', '700001', 'NOPQR4567S'], ['Fortune Agencies', '24', 'Surat', '395003', 'OPQRS5678T'],
  ['Gujarat Supplies', '24', 'Ahmedabad', '380001', 'PQRST6789U'], ['Himalaya Distributors', '07', 'Delhi', '110001', 'QRSTU7890V'],
];
const customers = [];
for (const [i, [name, state, city, pin, pan]] of custSpec.entries()) {
  const c = await api('POST', '/v1/parties', { code: `C-${101 + i}`, legalName: name, gstTreatment: 'registered_regular', gstin: gstin(state, pan), isCustomer: true });
  await api('POST', `/v1/parties/${c.id}/addresses`, { kind: 'billing', line1: `${3 + i * 4} Market Road`, city, stateCode: state, pincode: pin, isDefault: true });
  customers.push(c);
}
for (const [i, [name, state, city, pin, pan]] of [['Vendor Supplies', '27', 'Thane', '400601', 'AAAPV1234A'], ['Metro Industrial', '27', 'Pune', '411019', 'BBBPM2345B'], ['Southern Components', '29', 'Bengaluru', '560058', 'CCCPS3456C']].entries()) {
  const s = await api('POST', '/v1/parties', { code: `S-${101 + i}`, legalName: name, gstTreatment: 'registered_regular', gstin: gstin(state, pan), isSupplier: true });
  await api('POST', `/v1/parties/${s.id}/addresses`, { kind: 'billing', line1: `${i + 1} Industrial Area`, city, stateCode: state, pincode: pin, isDefault: true });
}
await api('POST', '/v1/parties', { code: 'WALKIN', legalName: 'Walk-in customer', gstTreatment: 'consumer', isCustomer: true });
step(`${customers.length} customers, 3 suppliers and a walk-in customer`);

// ---- invoices and receipts ---------------------------------------------------------------------------------------
const days = Math.max(20, Math.floor((today - fyStart) / 86_400_000));
const dates = Array.from({ length: 45 }, () => Math.floor(rnd() * days)).sort((a, b) => a - b);
let made = 0; let paid = 0; let partial = 0; let revenue = 0;
for (const offset of dates) {
  const date = iso(addDays(fyStart, offset));
  const customer = pick(customers);
  const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => { const it = pick(items); return { itemId: it.id, quantity: String(1 + Math.floor(rnd() * 12)), unitPrice: String(Math.round(it.price * (0.95 + rnd() * 0.15))), warehouseId: warehouse.id }; });
  try {
    const inv = await api('POST', '/v1/sales/invoices', { companyId: company.id, gstRegistrationId: reg.id, invoiceDate: date, customerId: customer.id, lines });
    made++; revenue += Number(inv.grandTotal ?? 0);
    const roll = rnd();
    if (roll < 0.62) { // paid in full, 1 to 30 days later (never in the future)
      const rd = iso(new Date(Math.min(addDays(new Date(date), 1 + Math.floor(rnd() * 30)).getTime(), today.getTime())));
      await api('POST', '/v1/receivables/receipts', { companyId: company.id, customerId: customer.id, receiptDate: rd, amount: String(inv.grandTotal), method: pick(['bank_transfer', 'upi', 'cheque', 'cash']), depositAccountId: BANK, allocations: [{ invoiceId: inv.id, amount: String(inv.grandTotal) }] }).catch(async () => undefined);
      paid++;
    } else if (roll < 0.74) { // part paid
      const part = (Number(inv.grandTotal) * 0.4).toFixed(2);
      await api('POST', '/v1/receivables/receipts', { companyId: company.id, customerId: customer.id, receiptDate: date, amount: part, method: 'bank_transfer', depositAccountId: BANK, allocations: [{ invoiceId: inv.id, amount: part }] }).catch(() => undefined);
      partial++;
    } // the rest stay unpaid: the older ones show as overdue
  } catch (e) { console.error(`  invoice on ${date} skipped: ${e.message}`); }
}
step(`${made} invoices (${paid} paid, ${partial} part-paid, ${made - paid - partial} unpaid), about ₹${Math.round(revenue).toLocaleString('en-IN')} of sales`);

console.log(`\nDone. Sign in with:\n  business code  ${SLUG}\n  email          ${EMAIL}\n  password       ${PASSWORD}\n`);
