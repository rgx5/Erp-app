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
  const show = async (label: string, r: Response) => console.log(label, r.status, r.ok ? '' : (await r.text()).slice(0, 200))
  // a customer made on the phone, then sold to
  const newCust = 'c_NEWCUST1'
  await show('sale to phone-made customer', await api.raw('POST', '/bills', { ...bill, id: 'b_TEST0003', customerId: newCust, payments: [{ mode: 'cash', amount: 236 }] }))
  await show('customer edit', await api.raw('PUT', `/customers/${newCust}`, { id: newCust, name: 'Phone Customer Renamed', phone: '9888888888' }))
  // a return against the first sale (it was made on the phone, so the platform id comes from the remembered mapping)
  const credit = { ...bill, id: 'b_RET0001', no: 'CN-1', refundOfBillId: billId, items: [{ ...bill.items[0]!, qty: 1 }], total: -118, refundAmount: 118, payments: [{ mode: 'cash', amount: -118 }], notes: 'Return against INV-X-0001 · damaged', status: 'returned' }
  await show('return', await api.raw('POST', `/bills/${billId}/return`, credit))
  await show('return again, same id (retry)', await api.raw('POST', `/bills/${billId}/return`, credit))
  await show('expense', await api.raw('POST', '/expenses', { id: 'e_EXP00001', date: Date.now(), category: 'Tea and snacks', amount: 150, mode: 'cash', vendor: 'Canteen', note: 'staff tea', recurring: false, userId: 'x' }))
  await show('stock adjust out', await api.raw('POST', '/stock/adjust', { id: 'm_ADJ00001', variantId: widget.id, qty: -3, type: 'adjust', ref: 'phone', reason: 'broken', at: Date.now(), userId: 'x' }))
  await show('stock adjust in', await api.raw('POST', '/stock/adjust', { id: 'm_ADJ00002', variantId: widget.id, qty: 5, type: 'adjust', ref: 'phone', reason: 'found', at: Date.now(), userId: 'x' }))
  await show('new product', await api.raw('POST', '/products', { id: 'p_NEWPROD1', styleCode: 'MUG', name: 'Coffee mug', categoryId: '', brand: 'Acme', fabric: '', season: '', hsn: '6912', active: true, createdAt: Date.now(), gstRate: 12, trackStock: true }))
  await show('new variant', await api.raw('POST', '/variants', { id: 'v_NEWVAR01', productId: 'p_NEWPROD1', sku: 'MUG-RED', barcode: '', size: '', color: 'Red', cost: 0, mrp: 250, price: 250, stock: 0, reorderLevel: 2 }))
  await show('price change', await api.raw('PUT', '/variants/v_NEWVAR01', { id: 'v_NEWVAR01', price: 275, mrp: 275 }))
  await show('sale of the phone-made item', await api.raw('POST', '/bills', { ...bill, id: 'b_TEST0004', items: [{ ...bill.items[0]!, variantId: 'v_NEWVAR01', qty: 1, price: 275, mrp: 275 }], total: 308, payments: [{ mode: 'cash', amount: 308 }] }))
  await show('supplier', await api.raw('POST', '/suppliers', { id: 's_NEWSUP01', name: 'Phone Supplier', phone: '9777777777', gstin: '', address: '', openingBalance: 0 }))
  await show('purchase (goods in, bill, part payment)', await api.raw('POST', '/purchases', { id: 'pu_PURCH0001', no: 'GRN-1', supplierId: 's_NEWSUP01', date: Date.now(), invoiceRef: 'SUP-77', items: [{ variantId: 'v_NEWVAR01', qty: 10, cost: 120 }, { variantId: widget.id, qty: 5, cost: 300 }], total: 2700, paid: 1000, notes: '', userId: 'x' }))
  await show('purchase retry', await api.raw('POST', '/purchases', { id: 'pu_PURCH0001', no: 'GRN-1', supplierId: 's_NEWSUP01', date: Date.now(), invoiceRef: 'SUP-77', items: [{ variantId: 'v_NEWVAR01', qty: 10, cost: 120 }, { variantId: widget.id, qty: 5, cost: 300 }], total: 2700, paid: 1000, notes: '', userId: 'x' }))
  await show('sale of the item after the purchase', await api.raw('POST', '/bills', { ...bill, id: 'b_TEST0005', items: [{ ...bill.items[0]!, variantId: 'v_NEWVAR01', qty: 1, price: 275, mrp: 275 }], total: 308, payments: [{ mode: 'cash', amount: 308 }] }))
  const after = await api.snapshot()
  console.log('after: stock', after.variants.map((v) => `${v.sku}=${v.stock}@${v.price}`).join(' '), 'moves', 'bills', after.bills.map((x) => `${x.no}=${x.total}/${x.payments.map((p) => p.mode + p.amount).join('+')}`), 'customers', after.customers.length)
  // expired access token: the client renews it with the refresh token
  tokens = { ...tokens, access: 'expired.invalid.token' }
  console.log('renew', (await api.snapshot()).products.length, 'products after token refresh')
} finally { await b.stop() }
