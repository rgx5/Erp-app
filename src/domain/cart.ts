import type { BillItem, DiscountType } from './types'
import { computeLineTax, type LineTaxOptions, type TaxSlab } from './tax'
import { round2, roundOff } from './money'

export interface CartLine {
  variantId: string
  /** Which product this variant belongs to — groups lines and powers the option swap. */
  productId?: string
  sku: string
  barcode: string
  name: string
  size: string
  color: string
  hsn: string
  mrp: number
  price: number
  qty: number
  stock: number
  discountType: DiscountType
  discountValue: number
  priceOverridden?: boolean
  /** The item has no selling price in the system; the manager typed this one at the counter. */
  unpricedSale?: boolean
  /** With `unpricedSale`: also keep the typed price as the item's price. */
  savePrice?: boolean
  /** How it is sold: unit, fractions allowed, step and minimum (see domain/qty). */
  unit?: string
  fractional?: boolean
  step?: number
  minQty?: number
  /** No stock to check or deduct (a service). */
  noStock?: boolean
  /** No item / bill discount applies. */
  noDiscount?: boolean
  /** Fixed GST rate for this item (overrides the per-piece slabs). */
  fixedRate?: number
  /** Seller picked for this item alone; empty = the bill's default seller. */
  staffId?: string
  /** Purchase cost per unit, copied onto the bill line when it is sold. */
  cost?: number
  /** Data a module attaches to the line; copied onto the bill line (`BillItem.ext`). */
  ext?: Record<string, unknown>
}

export interface CartTotals {
  items: BillItem[]
  grossMrp: number
  itemDiscount: number
  billDiscount: number
  subtotal: number
  taxableTotal: number
  cgstTotal: number
  sgstTotal: number
  /** Present only on an inter-state sale (then `cgstTotal` and `sgstTotal` are 0). */
  igstTotal?: number
  taxTotal: number
  roundOff: number
  total: number
  qtyTotal: number
}

export function lineDiscount(line: CartLine): number {
  if (line.noDiscount) return 0
  const gross = line.price * line.qty
  const d = line.discountType === 'pct'
    ? (gross * line.discountValue) / 100
    : line.discountValue
  return round2(Math.min(Math.max(d, 0), gross))
}

/**
 * Prices the whole cart. A bill-level discount is spread across lines in proportion
 * to their value, so each line's GST slab is decided on what the customer actually pays.
 */
export function priceCart(
  lines: CartLine[],
  billDiscountType: DiscountType,
  billDiscountValue: number,
  slabs: TaxSlab[],
  priceIncludesTax: boolean,
  /** Inter-state supply (IGST) or no tax at all (bill of supply). Left out, a sale is the ordinary local CGST + SGST one. */
  tax?: LineTaxOptions,
): CartTotals {
  const grossMrp = round2(lines.reduce((s, l) => s + l.mrp * l.qty, 0))

  const netBeforeBill = lines.map((l) => round2(l.price * l.qty - lineDiscount(l)))
  const sumNet = round2(netBeforeBill.reduce((s, n) => s + n, 0))

  // Items marked "no discount" are left out of the bill-level discount: it is worked out on, and spread over, the rest.
  const eligible = lines.map((l) => !l.noDiscount)
  const discountBase = round2(netBeforeBill.reduce((s, n, i) => s + (eligible[i] ? n : 0), 0))
  const rawBillDiscount = billDiscountType === 'pct'
    ? (discountBase * billDiscountValue) / 100
    : billDiscountValue
  const billDiscount = round2(Math.min(Math.max(rawBillDiscount, 0), discountBase))

  // Distribute proportionally; the last line absorbs the rounding remainder.
  const shares = netBeforeBill.map((n, i) => (eligible[i] && discountBase > 0 ? round2((billDiscount * n) / discountBase) : 0))
  const drift = round2(billDiscount - shares.reduce((s, v) => s + v, 0))
  // The last eligible line absorbs the rounding remainder, but never so much that it ends up below zero (a 100% discount).
  const lastEligible = eligible.lastIndexOf(true)
  if (lastEligible >= 0) shares[lastEligible] = Math.min(round2(shares[lastEligible] + drift), netBeforeBill[lastEligible])

  const items: BillItem[] = lines.map((l, i) => {
    const itemDisc = lineDiscount(l)
    const net = round2(netBeforeBill[i] - shares[i])
    const t = computeLineTax(net, l.qty, slabs, priceIncludesTax, l.fixedRate, tax)
    return {
      variantId: l.variantId,
      sku: l.sku,
      barcode: l.barcode,
      name: l.name,
      size: l.size,
      color: l.color,
      hsn: l.hsn,
      qty: l.qty,
      mrp: l.mrp,
      price: l.price,
      discountType: l.discountType,
      discountValue: l.discountValue,
      discountAmount: round2(itemDisc + shares[i]),
      net,
      taxable: t.taxable,
      taxRate: t.rate,
      cgst: t.cgst,
      sgst: t.sgst,
      ...(t.igst !== undefined ? { igst: t.igst } : {}),
      lineTotal: priceIncludesTax ? net : t.gross,
      returnedQty: 0,
      priceOverridden: l.priceOverridden,
      ...(l.unpricedSale ? { unpricedSale: true } : {}),
      unit: l.unit,
      cost: l.cost,
      ...(l.ext ? { ext: l.ext } : {}),
    }
  })

  const taxableTotal = round2(items.reduce((s, i) => s + i.taxable, 0))
  const cgstTotal = round2(items.reduce((s, i) => s + i.cgst, 0))
  const sgstTotal = round2(items.reduce((s, i) => s + i.sgst, 0))
  const igstTotal = round2(items.reduce((s, i) => s + (i.igst ?? 0), 0))
  const subtotal = round2(items.reduce((s, i) => s + i.lineTotal, 0))
  const [total, off] = roundOff(subtotal)

  return {
    items,
    grossMrp,
    itemDiscount: round2(grossMrp - sumNet),
    billDiscount,
    subtotal,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    ...(tax?.interState ? { igstTotal } : {}),
    taxTotal: round2(cgstTotal + sgstTotal + igstTotal),
    roundOff: off,
    total,
    qtyTotal: lines.reduce((s, l) => s + l.qty, 0),
  }
}
