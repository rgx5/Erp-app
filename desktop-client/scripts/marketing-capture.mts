// Builds a believable demo business on a scratch backend and captures product screenshots for marketing. Run from desktop-client/:
//   npx tsx scripts/marketing-capture.mts
import { chromium } from '@playwright/test'
import { bootBackend } from '../tests/backend-boot.ts'
import { seedBusiness, makeGstin } from '../tests/seed.ts'
import { spawn, type ChildProcess } from 'node:child_process'

const OUT = '/home/user/Erp-app/marketing/raw/'
const b = await bootBackend()
let web: ChildProcess | undefined
try {
  const s = await seedBusiness(b.baseUrl, b.platformToken, { prefix: 'demo', name: 'Sunrise Traders' })
  const H = { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown) => { const r = await fetch(b.baseUrl + path, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t.slice(0, 300)}`); return JSON.parse(t) as any }
  const tax = Object.fromEntries((await call('GET', '/v1/tax-codes?limit=50')).items.map((t: any) => [t.code, t.id]))
  const nos = (await call('GET', '/v1/units?limit=200')).items.find((u: any) => u.code === 'NOS')
  const today = new Date(); const iso = (d: Date) => d.toISOString().slice(0, 10)
  const monthsAgo = (m: number, day: number) => { const d = new Date(today.getFullYear(), today.getMonth() - m, day); return d > today ? today : d }

  // catalogue
  const catalogue: Array<[string, string, string, number, number, string]> = [
    ['CMT-50', 'Cement 50 kg bag', 'GST28', 390, 520, '2523'], ['TMT-12', 'TMT steel bar 12 mm', 'GST18', 62, 78, '7214'], ['PNT-WH', 'Wall paint white 20 L', 'GST18', 2900, 3650, '3208'],
    ['SW-6A', 'Modular switch 6 A', 'GST18', 95, 140, '8536'], ['PVC-1', 'PVC pipe 1 inch', 'GST18', 180, 245, '3917'], ['LED-9', 'LED bulb 9 W', 'GST12', 55, 90, '8539'],
    ['FAN-CL', 'Ceiling fan 1200 mm', 'GST18', 1650, 2290, '8414'], ['TILE-60', 'Floor tile 600x600', 'GST18', 380, 540, '6908'], ['DRL-13', 'Drill machine 13 mm', 'GST18', 1900, 2650, '8467'],
    ['LCK-DR', 'Door lock set', 'GST18', 420, 640, '8301'],
  ]
  const items: any[] = []
  for (const [code, name, tc, cost, price, hsn] of catalogue) {
    const it = await call('POST', '/v1/items', { code, name, baseUomId: nos.id, itemType: 'finished_good', taxCodeId: tax[tc], hsnSacCode: hsn, mrp: String(price) })
    await call('POST', '/v1/stock/movements', { companyId: s.company.id, movementType: 'opening', postingDate: `${s.year}-04-01`, description: 'Opening stock', lines: [{ warehouseId: s.warehouse.id, itemId: it.id, quantity: '400', unitCost: String(cost) }] })
    items.push({ ...it, price })
  }
  // customers
  const people = ['Prashant Dange Patil', 'Kulkarni Constructions', 'Shree Ganesh Hardware', 'Mehta & Sons Builders', 'Anand Electricals', 'Patil Infra Pvt Ltd', 'Sai Furnishing House', 'Joshi Contractors', 'Rathod Interiors', 'Bhosale Brothers']
  const custs: any[] = [{ id: s.customer.id }]
  for (const [i, n] of people.entries()) {
    const c = await call('POST', '/v1/parties', { code: `C-${100 + i}`, legalName: n, gstTreatment: 'registered_regular', gstin: makeGstin(i % 4 === 3 ? '29' : '27', `AB${String.fromCharCode(65 + i)}DE${1000 + i}F`), isCustomer: true, phone: `98${String(20000000 + i * 111111).slice(0, 8)}` })
    await call('POST', `/v1/parties/${c.id}/addresses`, { kind: 'billing', line1: `${10 + i} Market Road`, city: i % 4 === 3 ? 'Bengaluru' : 'Pune', stateCode: i % 4 === 3 ? '29' : '27', pincode: i % 4 === 3 ? '560001' : '411001', isDefault: true })
    custs.push(c)
  }
  // a year of selling: more each month, so the chart climbs
  const invoices: any[] = []
  let n = 0
  for (let m = 5; m >= 0; m--) {
    const count = 6 + (5 - m) * 2
    for (let k = 0; k < count; k++) {
      n++
      const cust = custs[(n * 3) % custs.length]
      const lines = [0, 1, 2].slice(0, 1 + (n % 3)).map((j) => { const it = items[(n + j * 2) % items.length]; return { itemId: it.id, warehouseId: s.warehouse.id, quantity: String(1 + ((n + j) % 7) * (it.price < 200 ? 6 : 1)), unitPrice: String(it.price), discountPercent: n % 5 === 0 ? '5' : '0' } })
      try { invoices.push(await call('POST', '/v1/sales/invoices', { companyId: s.company.id, gstRegistrationId: s.registration.id, invoiceDate: iso(monthsAgo(m, 3 + ((k * 4) % 24))), customerId: cust.id, lines })) } catch (e) { if (n < 3) console.log(String(e).slice(0, 700)) }
    }
  }
  console.log('invoices', invoices.length)
  // payments on most of them
  for (const [i, inv] of invoices.entries()) {
    if (i % 4 === 3) continue
    try { await call('POST', '/v1/receivables/receipts', { companyId: s.company.id, customerId: inv.customerId, receiptDate: iso(today), amount: String(inv.grandTotal).replace(/0+$/, '').replace(/\.$/, ''), method: i % 2 ? 'upi' : 'bank_transfer', depositAccountId: s.bank, allocations: [{ invoiceId: inv.id, amount: String(inv.grandTotal).replace(/0+$/, '').replace(/\.$/, '') }] }) } catch (e) { if (i < 6) console.log('receipt', String(e).slice(0, 160)) }
  }
  // cheques
  for (const [i, amount] of ['25000', '48500', '12000'].entries()) await call('POST', '/v1/cheques/received', { companyId: s.company.id, partyId: custs[i + 1].id, chequeNo: `4950${3030 + i}`, chequeDate: iso(new Date(today.getTime() + (i - 1) * 6 * 86400000)), bankName: ['HDFC Bank', 'SBI', 'ICICI Bank'][i], amount }).catch((e) => console.log('cheque', String(e).slice(0, 120)))

  // a till with an open shift, so the counter screen is live
  const term = await call('POST', '/v1/pos/terminals', { companyId: s.company.id, businessLocationId: s.location.id, code: 'T1', name: 'Counter 1', warehouseId: s.warehouse.id, gstRegistrationId: s.registration.id })
  await call('PUT', `/v1/pos/payment-accounts?companyId=${s.company.id}`, { method: 'cash', accountId: s.cash })
  await call('PUT', `/v1/pos/payment-accounts?companyId=${s.company.id}`, { method: 'upi', accountId: s.bank })
  await call('PUT', `/v1/pos/settings?companyId=${s.company.id}`, { walkInCustomerId: s.walkIn.id })
  await call('POST', '/v1/pos/shifts', { terminalId: term.id, openingCash: '2000' })

  // the app, served as a web page
  const port = 5173
  web = spawn('npx', ['vite', '--config', 'vite.web.config.mts', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true })
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}`)).ok) break } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)) }
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage()
  await page.goto(`http://localhost:${port}/`)
  await page.getByLabel('Server address').fill(b.baseUrl); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Business code').fill(s.slug); await page.getByLabel('Email').fill(s.email); await page.getByLabel('Password').fill(s.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
  const shot = async (name: string, path: string, wait = 1800, act?: () => Promise<void>) => { await page.goto(`http://localhost:${port}/#${path}`); await page.waitForTimeout(wait); if (act) await act(); await page.screenshot({ path: `${OUT}${name}.png` }); console.log('shot', name) }
  await shot('dashboard', '/', 2500)
  await shot('invoices', '/sales/invoices')
  await shot('invoice-new', '/sales/invoices/new', 1500, async () => {
    await page.getByLabel('Customer', { exact: true }).fill('kulk'); await page.waitForTimeout(1000); await page.getByLabel('Customer', { exact: true }).press('Enter')
    for (const [i, [q, qty]] of ([['cement', '40'], ['tile', '120'], ['paint', '6']] as Array<[string, string]>).entries()) {
      if (i > 0) await page.getByRole('button', { name: /Add line/ }).click()
      const row = page.getByLabel('Item', { exact: true }).nth(i)
      await row.fill(q); await page.waitForTimeout(900); await row.press('Enter')
      await page.getByLabel('Quantity').nth(i).fill(qty)
    }
    await page.waitForTimeout(1200)
  })
  await shot('customers', '/masterdata/customers')
  await shot('cheques', '/sales/cheques')
  await shot('receivables', '/sales/receivables')
  await shot('counter', '/pos/counter', 2500, async () => {
    const scan = page.getByLabel(/Scan or type item code/)
    for (const code of ['LED-9', 'LED-9', 'SW-6A', 'PVC-1', 'FAN-CL']) { await scan.fill(code); await scan.press('Enter'); await page.waitForTimeout(700) }
  })
  await shot('reports', '/accounting/reports')
  await shot('gst', '/gst')
  await shot('inventory', '/inventory/stock')
  await shot('migrate', '/data/migrate')
  await browser.close()
} finally { if (web?.pid) try { process.kill(-web.pid) } catch { /* gone */ } await b.stop() }
