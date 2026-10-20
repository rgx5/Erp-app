import { priceCart, type CartLine, type CartTotals } from '@/domain/cart'
import { costFor, needsPricing } from '@/domain/pricing'
import { minQtyOf } from '@/domain/qty'
import type { DiscountType, StoreSettings } from '@/domain/types'
import type { VariantView } from '@/domain/views'
import type { DocLine } from '../types'

/** A document line for an item, using how the item is sold (unit, fractions, GST rule) and today's price. */
export function docLineFor(v: VariantView, basis: StoreSettings['costBasis'], qty?: number): DocLine {
  return {
    variantId: v.id, productId: v.productId, sku: v.sku, barcode: v.barcode, name: v.productName, size: v.size, color: v.color, hsn: v.hsn,
    mrp: v.mrp, price: v.price, qty: qty ?? minQtyOf(v), discountType: 'amt', discountValue: 0,
    unit: v.unit, fractional: v.fractional, step: v.step, minQty: v.minQty, noStock: !v.trackStock, noDiscount: v.noDiscount, fixedRate: v.gstRate,
    cost: costFor(v, basis),
  }
}

/** The cart line a document line becomes at the counter. `stock` is what is on hand now. */
export const toCartLine = (l: DocLine, stock: number): CartLine => ({ ...l, stock })

/** A document line priced like a cart line (stock plays no part in pricing). */
const priced = (l: DocLine): CartLine => ({ ...l, stock: 0 })

type Taxing = Pick<StoreSettings, 'slabs' | 'priceIncludesTax'>

/** Totals of a document, worked out exactly as the counter will work them out when it becomes a bill. */
export function docTotals(lines: DocLine[], discountType: DiscountType, discountValue: number, store: Taxing): CartTotals {
  return priceCart(lines.map(priced), discountType, discountValue, store.slabs, store.priceIncludesTax)
}

export const docTotal = (lines: DocLine[], discountType: DiscountType, discountValue: number, store: Taxing) =>
  lines.length ? docTotals(lines, discountType, discountValue, store).total : 0

/** An item with no selling price cannot be quoted, ordered or invoiced. */
export const unpricedLines = (lines: Array<Pick<DocLine, 'price'>>) => lines.filter((l) => !(l.price > 0)).length

export { needsPricing }
