import { baseState, line, NOW, product, variant } from '@/data/__tests__/helpers'
import { gstinCheckChar } from '@/domain/gst'
import type { DataState } from '@/data/state'
import type { CartLine } from '@/domain/cart'
import { priceListItemId, type PriceList, type Promotion, type QtyBreakRule } from '../types'
import '../register'
import { priceCart } from '@/domain/cart'
import { supplyOptions, type BillTaxInfo } from '@/domain/gst'
import type { BillInput } from '@/data/ops'
import { adjustLines } from '../../registry'
import { billTaxInfo } from '../b2b'

export { NOW }
const mk = (first14: string) => first14 + gstinCheckChar(first14)
export const MH = mk('27ABCDE1234F1Z')
export const KA = mk('29AAACB1234H1Z')

export const wholesale: PriceList = { id: 'pl_ws', name: 'Wholesale', tier: 'wholesale', basis: 'price', pct: -10, roundTo: 0, active: true }
export const dealer: PriceList = { id: 'pl_dl', name: 'Dealer', tier: 'dealer', basis: 'cost', pct: 20, roundTo: 5, active: true }

/** A shop in Maharashtra with shirts (v1 ₹999, v2 ₹999), jeans (v3 ₹1500) and a book that takes no discount (v4 ₹200). */
export function shop(over: { registrationType?: 'regular' | 'composition' | 'unregistered'; gstin?: string } = {}): DataState {
  const s = baseState({ store: { gstin: over.gstin ?? MH, registrationType: over.registrationType ?? 'regular', address: '12 MG Road', city: 'Pune', phone: '9822012345', email: 'shop@example.com', priceIncludesTax: true } })
  s.categories = { ...s.categories, cat_jeans: { id: 'cat_jeans', name: 'Jeans', group: 'Men' }, cat_books: { id: 'cat_books', name: 'Books', group: 'Other' } }
  s.products = { ...s.products, p2: product({ id: 'p2', name: 'Slim Jeans', categoryId: 'cat_jeans', hsn: '6203' }), p3: product({ id: 'p3', name: 'Novel', categoryId: 'cat_books', hsn: '4901', noDiscount: true }) }
  s.variants = {
    ...s.variants,
    v3: variant({ id: 'v3', productId: 'p2', sku: 'JN-1', barcode: '2100000000039', size: '32', price: 1500, mrp: 1999, cost: 900, avgCost: 900, stock: 20 }),
    v4: variant({ id: 'v4', productId: 'p3', sku: 'BK-1', barcode: '2100000000046', size: '', color: '', price: 200, mrp: 200, cost: 120, avgCost: 120, stock: 20 }),
  }
  s.customers = { ...s.customers, c1: { ...s.customers.c1, gstin: KA, priceListId: 'pl_ws' }, c2: { ...s.customers.c1, id: 'c2', name: 'Retail Ravi', gstin: '' } }
  s.priceLists = { pl_ws: wholesale, pl_dl: dealer }
  return s
}

export const cartLine = (s: DataState, variantId: string, qty = 1, over: Partial<CartLine> = {}): CartLine => {
  const v = s.variants[variantId]
  const p = s.products[v.productId]
  return line(v, qty, { name: p.name, hsn: p.hsn, noDiscount: p.noDiscount, ...over })
}

export const withBreaks = (s: DataState, ...rules: QtyBreakRule[]): DataState => ({ ...s, qtyBreakRules: Object.fromEntries(rules.map((r) => [r.id, r])) })
export const withPromos = (s: DataState, ...promos: Promotion[]): DataState => ({ ...s, promotions: Object.fromEntries(promos.map((p) => [p.id, p])) })
export const withListPrice = (s: DataState, listId: string, variantId: string, price: number): DataState => ({
  ...s, priceListItems: { ...s.priceListItems, [priceListItemId(listId, variantId)]: { id: priceListItemId(listId, variantId), listId, variantId, price } },
})


/** What checkout does: reprice through the registered adjusters, tax by the supply rules, and carry the tax info as `ext.pricing`. */
export function sale(s: DataState, lines: CartLine[], o: { customerId?: string | null; info?: BillTaxInfo; now?: number } = {}): BillInput {
  const customerId = o.customerId ?? null
  const customer = customerId ? s.customers[customerId] : null
  const info = billTaxInfo(s.store, customer, o.info)
  const extras = info ? { pricing: info } : {}
  const priced = adjustLines(lines, { state: s, customerId, extras })
  const supply = supplyOptions(s.store, customer?.gstin, info)
  const t = priceCart(priced, 'amt', 0, s.store!.slabs, s.store!.priceIncludesTax, supply.interState || supply.noTax ? supply : undefined)
  return {
    date: o.now ?? NOW, customerId, items: t.items.map((i) => ({ ...i, soldBy: 'u_owner' })), grossMrp: t.grossMrp, itemDiscount: t.itemDiscount, billDiscountType: 'amt', billDiscountValue: 0,
    billDiscount: t.billDiscount, coupon: '', subtotal: t.subtotal, taxableTotal: t.taxableTotal, cgstTotal: t.cgstTotal, sgstTotal: t.sgstTotal,
    ...(t.igstTotal !== undefined ? { igstTotal: t.igstTotal } : {}), taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total, payments: [{ mode: 'cash', amount: t.total }],
    paid: t.total, changeDue: 0, loyaltyEarned: 0, loyaltyRedeemed: 0, creditUsed: 0, cashierId: 'u_owner', soldBy: 'u_owner', status: 'paid', notes: '', ...(info ? { ext: { pricing: info } } : {}),
  }
}
