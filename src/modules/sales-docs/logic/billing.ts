import { priceCart, type CartLine } from '@/domain/cart'
import { pointsEarned } from '@/domain/checkout'
import { round2 } from '@/domain/money'
import type { BillStatus, Customer, DiscountType, Payment } from '@/domain/types'
import type { BillInput } from '@/data/ops'
import type { DataState } from '@/data/state'
import type { DocLine } from '../types'

/**
 * A ready-to-save bill for a document's lines, priced like the counter prices them. Used where the app (not a person at the
 * checkout screen) creates the bill: a subscription's invoice.
 */
export function billInputFromLines(state: DataState, a: {
  lines: DocLine[]
  customerId: string | null
  discountType?: DiscountType
  discountValue?: number
  payments: Payment[]
  userId: string
  now: number
  notes?: string
  ext?: Record<string, unknown>
  status?: BillStatus
}): BillInput {
  const store = state.store!
  const customer: Customer | undefined = a.customerId ? state.customers[a.customerId] : undefined
  const cartLines: CartLine[] = a.lines.map((l) => ({ ...l, stock: 0 }))
  const t = priceCart(cartLines, a.discountType ?? 'amt', a.discountValue ?? 0, store.slabs, store.priceIncludesTax)
  const paid = round2(a.payments.filter((p) => p.mode !== 'due').reduce((s, p) => s + p.amount, 0))
  return {
    date: a.now, customerId: a.customerId, items: t.items.map((it) => ({ ...it, soldBy: a.userId })),
    grossMrp: t.grossMrp, itemDiscount: t.itemDiscount, billDiscountType: a.discountType ?? 'amt', billDiscountValue: a.discountValue ?? 0, billDiscount: t.billDiscount,
    coupon: '', subtotal: t.subtotal, taxableTotal: t.taxableTotal, cgstTotal: t.cgstTotal, sgstTotal: t.sgstTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total,
    payments: a.payments, paid, changeDue: 0, loyaltyEarned: customer ? pointsEarned(t.total, store.loyaltyEarnPct) : 0, loyaltyRedeemed: 0, creditUsed: 0,
    cashierId: a.userId, soldBy: a.userId, status: a.status ?? 'paid', notes: a.notes ?? '', ...(a.ext ? { ext: a.ext } : {}),
  }
}
