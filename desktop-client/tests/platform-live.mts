import { bootBackend } from './backend-boot.ts'
import { seedBusiness } from './seed.ts'
import { createPlatformApi, type PlatformCtx } from '../../src/data/platform/api.ts'

delete process.env['TSX_TSCONFIG_PATH'] // the backend child must not inherit the app's path aliases
const b = await bootBackend()
try {
  const s = await seedBusiness(b.baseUrl, b.platformToken, { prefix: 'ph' })
  const H = { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }
  await fetch(`${b.baseUrl}/v1/pos/payment-accounts?companyId=${s.company.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ method: 'cash', accountId: s.cash }) })
  await fetch(`${b.baseUrl}/v1/pos/payment-accounts?companyId=${s.company.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ method: 'upi', accountId: s.bank }) })
  let tokens = { access: '', refresh: '' }; let ctx: PlatformCtx | undefined
  const api = createPlatformApi(b.baseUrl, { getToken: () => tokens.access, getRefresh: () => tokens.refresh, setTokens: (t) => { tokens = t }, ctx: () => ctx, setCtx: (c) => { ctx = c }, deviceName: () => 'Phone TEST' })
  console.log('health', await api.health())
  const session = await api.login(s.slug, s.email, s.password)
  console.log('session', session.user.name, session.user.role)
  const company = (await api.companies())[0]!
  ctx = { tenant: s.slug, companyId: company.id, companyName: 'Sunrise', priceIncludesTax: true }
  const snap = await api.snapshot()
  console.log('snapshot products', snap.products.length, 'variants', snap.variants.map((v) => `${v.sku}:stock=${v.stock}:gst=${snap.products.find((p) => p.id === v.productId)?.gstRate}`), 'customers', snap.customers.map((c) => c.name), 'suppliers', snap.suppliers.length)
  console.log('ctx', JSON.stringify(ctx))
  const widget = snap.variants.find((v) => v.sku === 'WIDGET')!
  const billId = 'b_TEST0001'
  const bill = { id: billId, no: 'INV-X-0001', date: Date.now(), customerId: snap.customers[0]!.id, items: [{ variantId: widget.id, sku: 'WIDGET', barcode: '', name: 'Steel widget', size: '', color: '', hsn: '8479', qty: 2, mrp: 118, price: 118, discountType: 'pct', discountValue: 0, discountAmount: 0, net: 236, taxable: 200, taxRate: 18, cgst: 18, sgst: 18, lineTotal: 236, returnedQty: 0 }], grossMrp: 236, itemDiscount: 0, billDiscountType: 'amt', billDiscountValue: 0, billDiscount: 0, coupon: '', subtotal: 236, taxableTotal: 200, cgstTotal: 18, sgstTotal: 18, taxTotal: 36, roundOff: 0, total: 236, payments: [{ mode: 'cash', amount: 300 }], paid: 300, changeDue: 64, loyaltyEarned: 0, loyaltyRedeemed: 0, creditUsed: 0, cashierId: 'x', status: 'paid', notes: '' }
  const r1 = await api.raw('POST', '/bills', bill)
  console.log('bill post', r1.status, (await r1.text()).slice(0, 200))
  const r2 = await api.raw('POST', '/bills', bill)
  console.log('bill retry (same id)', r2.status)
  // a split payment and a rounding difference the server must be told about
  const r3 = await api.raw('POST', '/bills', { ...bill, id: 'b_TEST0002', total: 235.5, payments: [{ mode: 'upi', amount: 100 }, { mode: 'cash', amount: 135.5 }] })
  console.log('bill with different total', r3.status, (await r3.text()).slice(0, 200))
  const rc = await api.raw('POST', '/customers', { id: 'c_NEWCUST1', name: 'Phone Customer', phone: '9999999999', email: '', gstin: '' })
  console.log('customer post', rc.status)
  const after = await api.snapshot()
  console.log('after: stock', after.variants.find((v) => v.sku === 'WIDGET')?.stock, 'bills', after.bills.map((x) => `${x.no}=${x.total}/${x.payments.map((p) => p.mode + p.amount).join('+')}`), 'customers', after.customers.length)
  // expired access token: the client renews it with the refresh token
  tokens = { ...tokens, access: 'expired.invalid.token' }
  console.log('renew', (await api.snapshot()).products.length, 'products after token refresh')
} finally { await b.stop() }
