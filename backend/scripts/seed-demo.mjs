#!/usr/bin/env node
/**
 * Fills a demo server with a believable business so every screen has something to show.
 *
 * Creates one business (default code "demo") with a company, GST registration, warehouse and chart of accounts, then fills every module:
 * 12 items with stock, 8 customers, 3 suppliers, about 80 sales invoices with receipts (some part-paid, some overdue), owner capital, purchase
 * orders/receipts/bills/payments, quotes and sales orders, expense categories and vouchers, a bank account with a statement to reconcile, a counter
 * (price list, coupons, an open shift with sales and a return), manufacturing (bill of materials, completed and released work orders), payroll
 * (4 employees and a processed run), 3 roles with 3 users, and an approval policy. Everything goes through the normal API, so the numbers are
 * real ledger postings and the books balance.
 *
 * It tops up: run it on a business that already has the basics and it adds only the modules that are still empty.
 *
 * Three ways to run it (all do the same thing, and running it twice adds nothing):
 *
 *   1. Over HTTP, on a server started with DEMO_SEED_ENABLED=true (see backend/src/modules/demo):
 *        curl -X POST https://app.example.in/v1/demo/seed -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN"
 *   2. In the api container's terminal:      node scripts/seed-demo.mjs
 *   3. From a machine that can reach the platform routes:
 *        BASE_URL=http://127.0.0.1:8081 PLATFORM_ADMIN_TOKEN=... node scripts/seed-demo.mjs
 *
 * Optional: DEMO_SLUG (business code, default demo), DEMO_PASSWORD, DEMO_OWNER_EMAIL, DEMO_NAME.
 */
import { pathToFileURL } from 'node:url';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstin(state, pan, entity = '1') {
  const first14 = `${state}${pan}${entity}Z`;
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = ALPHABET.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36); }
  return first14 + ALPHABET[(36 - (sum % 36)) % 36];
}
const CATALOGUE = [
  ['STL-WIDGET', 'Steel widget', 'GST18', '8479', 1000, 640], ['BRS-FIT', 'Brass fitting 1/2"', 'GST18', '7412', 240, 150], ['PVC-PIPE', 'PVC pipe 20 mm (3 m)', 'GST18', '3917', 180, 110],
  ['CBL-2C', 'Copper cable 2 core (90 m)', 'GST18', '8544', 2650, 2050], ['LED-9W', 'LED bulb 9 W', 'GST12', '8539', 95, 58], ['SW-6A', 'Modular switch 6 A', 'GST18', '8536', 120, 74],
  ['PNT-WH', 'Wall paint white 20 L', 'GST18', '3209', 4200, 3300], ['CMT-50', 'Cement 50 kg bag', 'GST18', '2523', 390, 335], ['TOY-CAR', 'Plastic toy car', 'GST5', '9503', 150, 85],
  ['NTB-A4', 'Notebook A4 (pack of 6)', 'GST12', '4820', 210, 128], ['TEA-1KG', 'Tea 1 kg', 'GST5', '0902', 480, 360], ['SUG-5KG', 'Sugar 5 kg', 'GST5', '1701', 260, 215],
];
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

/**
 * @param {{ base: string; platformToken: string; slug?: string; password?: string; email?: string; name?: string; log?: (m: string) => void }} o
 * @returns {Promise<{ created: boolean; steps: string[]; login: { businessCode: string; email: string; password: string | null }; invoices?: number }>}
 */
export async function seedDemo(o) {
  const BASE = o.base.replace(/\/$/, '');
  const SLUG = o.slug ?? 'demo';
  const PASSWORD = o.password ?? 'demo-passphrase-2026';
  const EMAIL = o.email ?? `owner@${SLUG}.example.com`;
  const NAME = o.name ?? 'Sunrise Traders';
  const steps = [];
  const step = (m) => { steps.push(m); o.log?.(`- ${m}`); };

  async function call(method, path, body, token) {
    const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) { const e = new Error(`${method} ${path} -> ${res.status} ${json.detail ?? json.title ?? text.slice(0, 200)}`); e.status = res.status; throw e; }
    return json;
  }
  let seed = 20260419;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; // the same demo every time
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const today = new Date();
  const fyStart = new Date(Date.UTC(today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1, 3, 1));

  // ---- the business ----
  let tenantExisted = false;
  try {
    await call('POST', '/v1/platform/tenants', { name: NAME, slug: SLUG, owner: { email: EMAIL, displayName: 'Demo Owner', password: PASSWORD } }, o.platformToken);
    step(`business "${SLUG}" created`);
  } catch (e) {
    if (e.status === 409) { tenantExisted = true; step(`business "${SLUG}" already exists`); } else throw e;
  }
  let token;
  try { token = (await call('POST', '/v1/auth/login', { tenant: SLUG, email: EMAIL, password: PASSWORD })).accessToken; }
  catch (e) { throw new Error(`Could not sign in as ${EMAIL}: ${e.message}. If this business was made with another password, send that password (and email).`); }
  const api = (m, p, b) => call(m, p, b, token);

  const existing = (await api('GET', '/v1/companies?limit=5')).items ?? [];
  let createdCore = false;
  if (existing.length > 0) step(`it already has a company (${existing[0].tradeName ?? existing[0].legalName}): checking what else it needs`);
  else {

  const company = await api('POST', '/v1/companies', { legalName: `${NAME} Pvt Ltd`, tradeName: NAME, pan: 'ABCDE1234F' });
  const reg = await api('POST', `/v1/companies/${company.id}/gst-registrations`, { gstin: gstin('27', 'ABCDE1234F'), legalName: `${NAME} Pvt Ltd`, effectiveFrom: iso(fyStart) });
  const location = await api('POST', '/v1/business-locations', { companyId: company.id, gstRegistrationId: reg.id, code: 'MUM', name: 'Mumbai head office', isPrincipalPlace: true, addressLine1: '12 Mill Road', city: 'Mumbai', stateCode: '27', pincode: '400001' });
  const warehouse = await api('POST', '/v1/warehouses', { businessLocationId: location.id, code: 'MAIN', name: 'Main warehouse', kind: 'finished_goods' });
  await api('POST', '/v1/fiscal-years', { companyId: company.id, startDate: iso(fyStart) });
  await api('POST', `/v1/companies/${company.id}/setup/apply-defaults`, {});
  step('company, GST registration, warehouse, financial year and chart of accounts ready');

  const taxCodes = (await api('GET', '/v1/tax-codes?limit=50')).items;
  const tax = (code) => taxCodes.find((t) => t.code === code) ?? taxCodes.find((t) => t.code === 'GST18');
  const NOS = (await api('GET', '/v1/units?limit=200')).items.find((u) => u.code === 'NOS');
  const accounts = (await api('GET', `/v1/accounts?companyId=${company.id}&limit=200`)).items;
  const BANK = accounts.find((a) => a.code === '1120')?.id;

  // ---- items and stock ----
  const catalogue = CATALOGUE;
  const items = [];
  for (const [code, name, taxCode, hsn, price, cost] of catalogue) {
    const it = await api('POST', '/v1/items', { code, name, baseUomId: NOS.id, itemType: 'finished_good', taxCodeId: tax(taxCode).id, hsnSacCode: hsn });
    items.push({ ...it, price, cost });
  }
  await api('POST', '/v1/stock/movements', { companyId: company.id, movementType: 'opening', postingDate: iso(fyStart), description: 'Opening stock', lines: items.map((i) => ({ warehouseId: warehouse.id, itemId: i.id, quantity: '300', unitCost: String(i.cost) })) });
  step(`${items.length} items with opening stock`);

  // ---- parties ----
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

  // ---- invoices and receipts ----
  const days = Math.max(20, Math.floor((today - fyStart) / 86_400_000));
  const dates = Array.from({ length: 80 }, () => Math.floor(rnd() * days)).sort((a, b) => a - b);
  let made = 0; let paid = 0; let partial = 0; let revenue = 0;
  for (const offset of dates) {
    const date = iso(addDays(fyStart, offset));
    const customer = pick(customers);
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => { const it = pick(items); return { itemId: it.id, quantity: String(2 + Math.floor(rnd() * 12)), unitPrice: String(Math.round(it.price * (1.08 + rnd() * 0.14))), warehouseId: warehouse.id }; });
    try {
      const inv = await api('POST', '/v1/sales/invoices', { companyId: company.id, gstRegistrationId: reg.id, invoiceDate: date, customerId: customer.id, lines });
      made++; revenue += Number(inv.grandTotal ?? 0);
      const roll = rnd();
      if (roll < 0.62) { // paid in full, 1 to 30 days later (never in the future)
        const rd = iso(new Date(Math.min(addDays(new Date(date), 1 + Math.floor(rnd() * 30)).getTime(), today.getTime())));
        await api('POST', '/v1/receivables/receipts', { companyId: company.id, customerId: customer.id, receiptDate: rd, amount: String(inv.grandTotal), method: pick(['bank_transfer', 'upi', 'cheque', 'cash']), depositAccountId: BANK, allocations: [{ invoiceId: inv.id, amount: String(inv.grandTotal) }] });
        paid++;
      } else if (roll < 0.74) { // part paid
        const part = (Number(inv.grandTotal) * 0.4).toFixed(2);
        await api('POST', '/v1/receivables/receipts', { companyId: company.id, customerId: customer.id, receiptDate: date, amount: part, method: 'bank_transfer', depositAccountId: BANK, allocations: [{ invoiceId: inv.id, amount: part }] });
        partial++;
      } // the rest stay unpaid: the older ones show as overdue
    } catch (e) { o.log?.(`  invoice on ${date} skipped: ${e.message}`); }
  }
  step(`${made} invoices (${paid} paid, ${partial} part-paid, ${made - paid - partial} unpaid), about ₹${Math.round(revenue).toLocaleString('en-IN')} of sales`);
  createdCore = true;
  }

  const extra = await seedExtras({ api, step, log: o.log, rnd, pick, today, fyStart });
  return { created: createdCore || extra > 0, steps, login: { businessCode: SLUG, email: EMAIL, password: tenantExisted && !createdCore ? null : PASSWORD } };
}

// ---- everything else: purchasing, quotes and orders, expenses, bank, counter, manufacturing, payroll, people, approvals --------------------------
/** Adds the rest of a business's modules. Every phase checks whether it is already there, so a second run adds nothing, and a phase that fails is reported and skipped. */
async function seedExtras({ api, step, log, rnd, pick, today, fyStart }) {
  const first = async (path) => ((await api('GET', path)).items ?? [])[0];
  const company = await first('/v1/companies?limit=5');
  const c = company.id;
  const reg = await first(`/v1/companies/${c}/gst-registrations`);
  const location = await first(`/v1/business-locations?companyId=${c}`);
  const warehouse = ((await api('GET', `/v1/warehouses?limit=50`)).items ?? []).find((w) => w.code === 'MAIN') ?? (await first('/v1/warehouses?limit=50'));
  const items = ((await api('GET', '/v1/items?limit=200&status=active')).items ?? []).filter((i) => i.isStocked !== false);
  const parties = (await api('GET', '/v1/parties?limit=200')).items ?? [];
  const customers = parties.filter((p) => p.isCustomer && p.code !== 'WALKIN');
  const walkIn = parties.find((p) => p.code === 'WALKIN');
  const suppliers = parties.filter((p) => p.isSupplier && !p.isSubcontractor);
  const accounts = (await api('GET', `/v1/accounts?companyId=${c}&limit=200`)).items ?? [];
  const a = (code) => { const x = accounts.find((y) => y.code === code); if (!x) throw new Error(`account ${code} is missing from the chart`); return x.id; };
  const BANK = a('1120'); const CASH = a('1110');
  const day = (n) => iso(addDays(fyStart, Math.min(n, Math.floor((today - fyStart) / 86_400_000))));
  const span = Math.max(30, Math.floor((today - fyStart) / 86_400_000));
  const priceOf = (it) => CATALOGUE.find((x) => x[0] === it.code)?.[4] ?? 100;
  const price = (it) => String(Math.max(10, Math.round(priceOf(it) * 0.6)));
  const stockItems = items.filter((i) => ['STL-WIDGET', 'BRS-FIT', 'PVC-PIPE', 'LED-9W', 'SW-6A', 'CMT-50', 'NTB-A4', 'TEA-1KG', 'SUG-5KG', 'TOY-CAR'].includes(i.code));
  let added = 0;
  async function phase(name, guard, run) {
    try {
      if (await guard()) { log?.(`  ${name}: already there`); return; }
      const what = await run(); added++; step(`${name}: ${what}`);
    } catch (e) { step(`${name} skipped (${e.message.slice(0, 220)})`); }
  }
  const empty = async (path) => ((await api('GET', path)).items ?? []).length > 0;

  // ---- owner's capital into the bank, so the cash position is believable ----
  await phase('owner capital', async () => { const tb = await api('GET', `/v1/accounting/trial-balance?companyId=${c}&from=${iso(fyStart)}&to=${iso(today)}`); return (tb.rows ?? []).some((r) => r.code === '3100' && Number(r.closingCredit) > 0); }, async () => {
    await api('POST', '/v1/journal-entries', { companyId: c, postingDate: iso(fyStart), description: 'Owner capital introduced', lines: [{ accountId: BANK, debit: '2500000' }, { accountId: a('3100'), credit: '2500000' }] });
    return '₹25,00,000 of owner capital in the bank';
  });

  // ---- purchasing: orders, receipts, bills and payments ----
  await phase('purchasing', () => empty(`/v1/purchasing/bills?companyId=${c}&limit=1`), async () => {
    await api('PUT', `/v1/companies/${c}/purchasing-settings`, {
      payableAccountId: a('2110'), grniAccountId: a('2120'), purchasePriceVarianceAccountId: a('5400'), expensePurchaseAccountId: a('5900'), roundOffAccountId: a('5900'), costVarianceAccountId: a('5300'), freightAccountId: a('5220'),
      inputCgstAccountId: a('1310'), inputSgstAccountId: a('1320'), inputIgstAccountId: a('1330'), rcmCgstAccountId: a('2210'), rcmSgstAccountId: a('2220'), rcmIgstAccountId: a('2230'),
    });
    let orders = 0; let bills = 0; let paid = 0;
    for (let i = 0; i < 12; i++) {
      const supplier = suppliers[i % suppliers.length];
      const date = day(8 + Math.floor((span - 12) * (i / 12)));
      const it = stockItems[i % stockItems.length];
      const po = await api('POST', '/v1/purchasing/orders', { companyId: c, gstRegistrationId: reg.id, supplierId: supplier.id, orderDate: date, lines: [{ itemId: it.id, quantity: String(20 + (i % 4) * 10), unitPrice: price(it), warehouseId: warehouse.id }] });
      orders++;
      if (i >= 10) continue; // the last two stay as open orders
      const full = await api('GET', `/v1/purchasing/orders/${po.id}`);
      const rec = await api('POST', '/v1/purchasing/receipts', { companyId: c, supplierId: supplier.id, purchaseOrderId: po.id, receiptDate: date, lines: [{ orderLineId: full.lines[0].id, warehouseId: warehouse.id, quantity: full.lines[0].quantity ?? String(20 + (i % 4) * 10) }] });
      if (i >= 8) continue; // two received but not yet billed
      const recFull = await api('GET', `/v1/purchasing/receipts/${rec.id}`);
      const bill = await api('POST', '/v1/purchasing/bills', { companyId: c, gstRegistrationId: reg.id, supplierId: supplier.id, supplierInvoiceNo: `VS/${100 + i}`, supplierInvoiceDate: date, billDate: date, lines: [{ itemId: it.id, quantity: recFull.lines[0].quantity ?? String(20 + (i % 4) * 10), unitPrice: price(it), grnLineId: recFull.lines[0].id }] });
      bills++;
      if (i % 3 !== 2) { // paid
        await api('POST', '/v1/payables/payments', { companyId: c, supplierId: supplier.id, paymentDate: iso(new Date(Math.min(addDays(new Date(date), 20).getTime(), today.getTime()))), amount: String(bill.grandTotal), method: pick(['bank_transfer', 'cheque', 'upi']), paidFromAccountId: BANK, allocations: [{ billId: bill.id, amount: String(bill.grandTotal) }] });
        paid++;
      }
    }
    return `${orders} orders, ${bills} supplier bills (${paid} paid)`;
  });

  // ---- quotes and sales orders ----
  await phase('quotes and sales orders', () => empty(`/v1/sales/quotes?companyId=${c}&limit=1`), async () => {
    const lines = (n) => Array.from({ length: n }, () => { const it = pick(items); return { itemId: it.id, quantity: String(2 + Math.floor(rnd() * 8)), unitPrice: String(Math.round(priceOf(it))), warehouseId: warehouse.id }; });
    const d = iso(today); const later = iso(addDays(today, 30));
    let q = 0;
    const quotes = [];
    for (let i = 0; i < 5; i++) { quotes.push(await api('POST', '/v1/sales/quotes', { companyId: c, gstRegistrationId: reg.id, customerId: pick(customers).id, quoteDate: iso(addDays(today, -i * 4)), validUntil: later, notes: 'Prices valid for 30 days', lines: lines(1 + (i % 3)) })); q++; }
    await api('POST', `/v1/sales/quotes/${quotes[0].id}/convert`, { orderDate: d, reserveStock: true });
    const o2 = await api('POST', `/v1/sales/quotes/${quotes[1].id}/convert`, { orderDate: d, reserveStock: false });
    await api('POST', `/v1/sales/quotes/${quotes[4].id}/reject`, {}).catch(() => undefined);
    const o3 = await api('POST', '/v1/sales/orders', { companyId: c, gstRegistrationId: reg.id, customerId: pick(customers).id, orderDate: d, lines: lines(2) });
    const o2full = await api('GET', `/v1/sales/orders/${o2.id}`);
    await api('POST', `/v1/sales/orders/${o2.id}/invoice`, { invoiceDate: d, lines: [{ orderLineId: o2full.lines[0].id, quantity: o2full.lines[0].quantity }] }).catch(() => undefined);
    void o3;
    return `${q} quotes, 3 sales orders (one part-invoiced)`;
  });

  // ---- expenses ----
  await phase('expenses', () => empty(`/v1/expenses/categories?companyId=${c}`), async () => {
    const cats = [['RENT', 'Rent', '5900'], ['ELEC', 'Electricity', '5900'], ['TEA', 'Tea and snacks', '5900'], ['TRVL', 'Travel and conveyance', '5900'], ['STAT', 'Printing and stationery', '5900'], ['REPAIR', 'Repairs and maintenance', '5900']];
    const made = [];
    for (const [code, name, acct] of cats) made.push(await api('POST', '/v1/expenses/categories', { companyId: c, code, name, expenseAccountId: a(acct) }));
    let n = 0;
    for (let m = 0; m < Math.max(1, Math.ceil(span / 30)); m++) {
      for (const [i, cat] of made.entries()) {
        const date = day(m * 30 + 2 + i * 3); if (new Date(date) > today) continue;
        await api('POST', '/v1/expenses/vouchers', { companyId: c, voucherDate: date, categoryId: cat.id, amount: String([9000, 3200, 600, 1400, 800, 1800][i] + Math.round(rnd() * 300)), paidFromAccountId: i === 0 || i === 1 ? BANK : CASH, payee: ['Landlord', 'Power company', 'Canteen', 'Cab and fuel', 'Stationers', 'Technician'][i], note: `${cat.name}, month ${m + 1}` });
        n++;
      }
    }
    return `${made.length} categories, ${n} vouchers`;
  });

  // ---- bank account and a statement to reconcile ----
  await phase('bank', () => empty(`/v1/bank-accounts?companyId=${c}`), async () => {
    const acct = await api('POST', '/v1/bank-accounts', { companyId: c, accountId: BANK, name: 'Current account', bankName: 'State Bank of India', accountRef: 'XXXX4821' });
    const from = day(Math.max(0, span - 35)); const to = iso(today);
    const rows = [['NEFT SUNRISE CUSTOMER', 118000], ['UPI COLLECTION', 24500], ['CHQ DEPOSIT 004512', 86400], ['RENT PAYMENT', -18000], ['BANK CHARGES', -354], ['NEFT VENDOR PAYMENT', -62000], ['UPI COLLECTION', 9800], ['ELECTRICITY BILL', -6400]];
    let bal = 250000; const opening = bal;
    const lines = rows.map(([description, amount], i) => { bal += amount; return { date: day(Math.max(0, span - 35) + i * 4), description, reference: `REF${4800 + i}`, amount: String(amount), balance: String(bal) }; });
    await api('POST', `/v1/bank-accounts/${acct.id}/statements`, { periodFrom: from, periodTo: to, openingBalance: String(opening), closingBalance: String(bal), lines });
    return `1 bank account with a statement of ${lines.length} lines to reconcile`;
  });

  // ---- the counter: price list, terminal, shifts, sales, a return ----
  await phase('counter (POS)', () => empty(`/v1/pos/terminals?companyId=${c}`), async () => {
    await api('PUT', `/v1/pos/settings?companyId=${c}`, { walkInCustomerId: walkIn.id, cashVarianceAccountId: a('5900') });
    for (const [m, code] of [['cash', '1110'], ['upi', '1120'], ['card', '1120'], ['bank_transfer', '1120'], ['cheque', '1120'], ['other', '1120']]) await api('PUT', `/v1/pos/payment-accounts?companyId=${c}`, { method: m, accountId: a(code) });
    const nos = (await api('GET', '/v1/units?limit=200')).items.find((u) => u.code === 'NOS');
    const list = await api('POST', '/v1/price-lists', { code: 'COUNTER', name: 'Counter prices', kind: 'sales', taxInclusive: true });
    for (const it of items.slice(0, 8)) await api('POST', `/v1/price-lists/${list.id}/prices`, { itemId: it.id, uomId: nos.id, price: String(Math.round(priceOf(it) * 1.18)), effectiveFrom: iso(fyStart) }).catch(() => undefined);
    const term = await api('POST', '/v1/pos/terminals', { companyId: c, code: 'T1', name: 'Counter 1', gstRegistrationId: reg.id, businessLocationId: location.id, warehouseId: warehouse.id });
    await api('PUT', `/v1/retail/settings?companyId=${c}`, { loyaltyPointsPerHundred: '1', loyaltyRupeesPerPoint: '1', maxDiscountWithoutApproval: '10' }).catch(() => undefined);
    await api('POST', '/v1/retail/coupons', { companyId: c, code: 'WELCOME10', description: '10% off for new customers', kind: 'percent', value: '10', minBill: '500', maxDiscount: '200' }).catch(() => undefined);
    await api('POST', '/v1/retail/coupons', { companyId: c, code: 'FLAT100', description: 'Rs 100 off bills above Rs 1,000', kind: 'fixed', value: '100', minBill: '1000' }).catch(() => undefined);
    const shift = await api('POST', '/v1/pos/shifts', { terminalId: term.id, openingCash: '2000' });
    let sold = 0; let firstSale = null;
    for (let i = 0; i < 8; i++) {
      const it = items[i % items.length]; const unit = Math.round(priceOf(it) * 1.18);
      const qty = 1 + (i % 3); const total = unit * qty;
      const sale = await api('POST', '/v1/pos/sales', { shiftId: shift.id, lines: [{ itemId: it.id, quantity: String(qty), unitPrice: String(unit) }], payments: i % 2 === 0 ? [{ method: 'cash', amount: String(total), tendered: String(Math.ceil(total / 100) * 100) }] : [{ method: 'upi', amount: String(total) }] }).catch(() => null);
      if (sale) { sold++; firstSale ??= sale; }
    }
    if (firstSale?.invoice?.lines?.[0]) await api('POST', '/v1/pos/returns', { shiftId: shift.id, originalSaleId: firstSale.id, reason: 'Customer changed mind', lines: [{ originalLineId: firstSale.invoice.lines[0].id, quantity: '1' }], refunds: [{ method: firstSale.payments?.[0]?.method ?? 'cash', amount: String(firstSale.invoice.lines[0].lineTotal ?? firstSale.invoice.grandTotal) }] }).catch(() => undefined);
    return `terminal, price list, 2 coupons, an open shift with ${sold} sales and a return`;
  });

  // ---- manufacturing ----
  await phase('manufacturing', () => empty(`/v1/manufacturing/work-orders?companyId=${c}&limit=1`), async () => {
    await api('PUT', `/v1/manufacturing/companies/${c}/settings`, { wipAccountId: a('1230'), labourAbsorbedAccountId: a('5210'), overheadAbsorbedAccountId: a('5230'), productionVarianceAccountId: a('5260'), subcontractClearingAccountId: a('5240') });
    const wc = await api('POST', '/v1/manufacturing/work-centres', { companyId: c, code: 'ASM', name: 'Assembly', labourRatePerHour: '200', machineRatePerHour: '100', overheadRatePerHour: '50' });
    const fin = items.find((i) => i.code === 'STL-WIDGET'); const part = items.find((i) => i.code === 'BRS-FIT'); const part2 = items.find((i) => i.code === 'PVC-PIPE');
    await api('POST', '/v1/manufacturing/boms', { companyId: c, itemId: fin.id, baseQuantity: '1', effectiveFrom: iso(fyStart), lines: [{ itemId: part.id, quantity: '2', scrapPercent: '5' }, { itemId: part2.id, quantity: '1' }], operations: [{ opNo: 10, name: 'Assemble', workCentreId: wc.id, setupHours: '0.5', runHours: '1' }] });
    const done = await api('POST', '/v1/manufacturing/work-orders', { companyId: c, itemId: fin.id, orderDate: day(Math.max(0, span - 20)), plannedQuantity: '10', outputWarehouseId: warehouse.id, materialsWarehouseId: warehouse.id });
    const d = day(Math.max(0, span - 18));
    await api('POST', `/v1/manufacturing/work-orders/${done.id}/release`, {});
    await api('POST', `/v1/manufacturing/work-orders/${done.id}/issue-materials`, { date: d, lines: [{ itemId: part.id, quantity: '21' }, { itemId: part2.id, quantity: '10' }] });
    await api('POST', `/v1/manufacturing/work-orders/${done.id}/report-time`, { date: d, lines: [{ opNo: 10, hours: '10' }] });
    await api('POST', `/v1/manufacturing/work-orders/${done.id}/report-output`, { date: d, quantity: '10', scrapQuantity: '1' });
    await api('POST', `/v1/manufacturing/work-orders/${done.id}/complete`, { date: d });
    const open = await api('POST', '/v1/manufacturing/work-orders', { companyId: c, itemId: fin.id, orderDate: iso(today), plannedQuantity: '25', outputWarehouseId: warehouse.id, materialsWarehouseId: warehouse.id });
    await api('POST', `/v1/manufacturing/work-orders/${open.id}/release`, {});
    return 'a work centre, a bill of materials, one completed and one released work order';
  });

  // ---- payroll ----
  await phase('payroll', () => empty(`/v1/payroll/employees?companyId=${c}`), async () => {
    const ym = iso(today).slice(0, 7);
    await api('POST', `/v1/payroll/rules/seed-defaults?companyId=${c}&effectiveFrom=${iso(fyStart)}`, {}).catch(() => undefined);
    const hra = await api('POST', '/v1/payroll/components', { companyId: c, code: 'HRA', name: 'House rent allowance', kind: 'earning', calculation: 'percent_of_basic', percent: '40' });
    const people = [['Ravi Kumar', 18000], ['Sunita Patil', 15500], ['Imran Shaikh', 14000], ['Meena Joshi', 20000]];
    const emps = [];
    for (const [name, basic] of people) {
      const e = await api('POST', '/v1/payroll/employees', { companyId: c, kind: 'employee', dateOfJoining: iso(fyStart), fullName: name, stateCode: '27', pfApplicable: true, esiApplicable: basic <= 21000, ptApplicable: true });
      await api('POST', `/v1/payroll/employees/${e.id}/structures`, { effectiveFrom: iso(fyStart), basic: String(basic), lines: [{ componentId: hra.id }] });
      await api('PUT', `/v1/payroll/employees/${e.id}/inputs/${ym}`, { lopDays: String(emps.length % 2), bonus: '0', otherDeduction: '0' });
      emps.push(e);
    }
    const parent = a('2100');
    const mk = async (code, name) => (await api('POST', '/v1/accounts', { companyId: c, code, name, type: 'liability', parentId: parent })).id;
    const have = (code) => accounts.find((x) => x.code === code)?.id;
    const sp = have('2150') ?? await mk('2150', 'Salary payable'); const pf = have('2160') ?? await mk('2160', 'PF payable'); const esi = have('2170') ?? await mk('2170', 'ESI payable'); const pt = have('2180') ?? await mk('2180', 'PT payable'); const od = have('2190') ?? await mk('2190', 'Other deductions payable');
    await api('PUT', `/v1/payroll/companies/${c}/settings`, { salaryExpenseAccountId: a('5500'), employerCostAccountId: a('5500'), salaryPayableAccountId: sp, pfPayableAccountId: pf, esiPayableAccountId: esi, ptPayableAccountId: pt, tdsPayableAccountId: a('2240'), otherDeductionsAccountId: od });
    const run = await api('POST', '/v1/payroll/runs', { companyId: c, period: ym, payDate: iso(today) });
    await api('POST', `/v1/payroll/runs/${run.id}/pay`, { date: iso(today), paidFromAccountId: BANK }).catch(() => undefined);
    return `${emps.length} employees with salary structures and one processed run`;
  });

  // ---- people, roles and approvals ----
  await phase('users and roles', async () => ((await api('GET', '/v1/users?limit=20')).items ?? []).length > 1, async () => {
    const mkRole = (name, description, permissions) => api('POST', '/v1/roles', { name, description, permissions });
    const acc = await mkRole('Accountant', 'Books, banking and reports', ['dashboard:read', 'organization:read', 'masterdata:read', 'accounting:read', 'accounting:post', 'bank:read', 'bank:manage', 'bank:reconcile', 'receivables:read', 'receivables:post', 'payables:read', 'payables:post', 'sales:read', 'purchasing:read', 'gst:read']);
    const sales = await mkRole('Sales executive', 'Quotes, orders and invoices', ['dashboard:read', 'organization:read', 'masterdata:read', 'sales:read', 'sales:post', 'receivables:read', 'stock:read']);
    const cashier = await mkRole('Cashier', 'Runs the counter', ['organization:read', 'masterdata:read', 'pos:read', 'pos:sell', 'stock:read']);
    const pw = 'demo-passphrase-2026';
    await api('POST', '/v1/users', { email: 'accounts@demo.example.com', displayName: 'Kavita Rao (Accounts)', password: pw, roleIds: [acc.id] });
    await api('POST', '/v1/users', { email: 'sales@demo.example.com', displayName: 'Rahul Desai (Sales)', password: pw, roleIds: [sales.id] });
    await api('POST', '/v1/users', { email: 'counter@demo.example.com', displayName: 'Pooja Nair (Counter)', password: pw, roleIds: [cashier.id] });
    return '3 roles and 3 users (accounts@, sales@, counter@demo.example.com, same password)';
  });
  await phase('approvals', () => empty(`/v1/approval-policies?companyId=${c}`), async () => {
    await api('POST', '/v1/approval-policies', { companyId: c, documentType: 'payment', thresholdAmount: '50000', requiredApprovals: 1 });
    return 'a policy: payments of ₹50,000 and above need approval';
  });
  return added;
}

// ---- command line ------------------------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.PLATFORM_ADMIN_TOKEN ?? '';
  if (!token) { console.error('PLATFORM_ADMIN_TOKEN is not set. Run this inside the api container, or export it.'); process.exit(2); }
  try {
    const r = await seedDemo({ base: process.env.BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`, platformToken: token, slug: process.env.DEMO_SLUG, password: process.env.DEMO_PASSWORD, email: process.env.DEMO_OWNER_EMAIL, name: process.env.DEMO_NAME, log: console.log });
    console.log(`\n${r.created ? 'Done.' : 'Nothing added.'} Sign in with:\n  business code  ${r.login.businessCode}\n  email          ${r.login.email}\n  password       ${r.login.password ?? '(as set earlier)'}\n`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
