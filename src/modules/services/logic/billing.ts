import { priceCart, type CartLine } from '@/domain/cart'
import { pointsEarned } from '@/domain/checkout'
import { round2 } from '@/domain/money'
import type { BillStatus, Customer, Payment } from '@/domain/types'
import type { BillInput } from '@/data/ops'
import type { DataState } from '@/data/state'

export interface ServiceBillLine { variantId: string; name: string; qty: number; price: number }

/** A line priced like the counter prices it: the item's GST rate and HSN, its cost for the profit report, never a stock check. */
export function cartLineFor(state: DataState, l: ServiceBillLine, stock = 0): CartLine {
  const v = state.variants[l.variantId]
  const p = v ? state.products[v.productId] : undefined
  return {
    variantId: l.variantId, ...(p ? { productId: p.id } : {}), sku: v?.sku ?? '', barcode: v?.barcode ?? '', name: l.name, size: v?.size ?? '', color: v?.color ?? '', hsn: p?.hsn ?? '',
    mrp: Math.max(v?.mrp ?? 0, l.price), price: l.price, qty: l.qty, stock, discountType: 'amt', discountValue: 0, noDiscount: false,
    ...(p?.gstRate !== undefined ? { fixedRate: p.gstRate } : {}), ...(p?.unit ? { unit: p.unit } : {}), ...(p?.trackStock === false ? { noStock: true } : {}),
    ...(v && p?.trackStock !== false ? { cost: v.avgCost ?? v.cost } : {}),
  }
}

/** A ready-to-save bill for lines of work (an appointment, a repair, hours) — the app, not a person at the checkout, makes it. */
export function serviceBillInput(state: DataState, a: {
  lines: ServiceBillLine[]; customerId: string | null; payments: Payment[]; userId: string; now: number; notes?: string; ext?: Record<string, unknown>; status?: BillStatus
}): BillInput {
  const store = state.store!
  const customer: Customer | undefined = a.customerId ? state.customers[a.customerId] : undefined
  const t = priceCart(a.lines.map((l) => cartLineFor(state, l)), 'amt', 0, store.slabs, store.priceIncludesTax)
  const paid = round2(a.payments.filter((p) => p.mode !== 'due').reduce((s, p) => s + p.amount, 0))
  return {
    date: a.now, customerId: a.customerId, items: t.items.map((it) => ({ ...it, soldBy: a.userId })),
    grossMrp: t.grossMrp, itemDiscount: t.itemDiscount, billDiscountType: 'amt', billDiscountValue: 0, billDiscount: t.billDiscount,
    coupon: '', subtotal: t.subtotal, taxableTotal: t.taxableTotal, cgstTotal: t.cgstTotal, sgstTotal: t.sgstTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total,
    payments: a.payments, paid, changeDue: 0, loyaltyEarned: customer ? pointsEarned(t.total, store.loyaltyEarnPct) : 0, loyaltyRedeemed: 0, creditUsed: 0,
    cashierId: a.userId, soldBy: a.userId, status: a.status ?? 'paid', notes: a.notes ?? '', ...(a.ext ? { ext: a.ext } : {}),
  }
}

/** What a bill for these lines will come to, before it is made. */
export function previewTotal(state: DataState, lines: ServiceBillLine[]): number {
  if (!state.store || !lines.length) return 0
  return priceCart(lines.map((l) => cartLineFor(state, l)), 'amt', 0, state.store.slabs, state.store.priceIncludesTax).total
}
