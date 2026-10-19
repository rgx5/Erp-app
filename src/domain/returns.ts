import type { Bill, BillItem } from './types'
import { round2 } from './money'
import { isFrac, round3, rulesOfBillItem } from './qty'

export interface ReturnLine { variantId: string; qty: number }

export interface ReturnPlan {
  items: BillItem[]
  subtotal: number
  /** What is actually handed back: a whole rupee, except the last return of a bill, which settles to exactly what was paid. */
  total: number
  roundOff: number
  /** Every unit of the bill is back after this return. */
  complete: boolean
  /** Loyalty points to take back from the customer for the value returned. */
  loyaltyReverse: number
}

const sumPrior = (prior: Bill[], variantId: string, field: 'discountAmount' | 'net' | 'taxable' | 'cgst' | 'sgst' | 'lineTotal') =>
  round2(prior.reduce((s, cn) => s + cn.items.filter((i) => i.variantId === variantId).reduce((a, i) => a + i[field], 0), 0))

/**
 * Works out a return against `original`, given the credit notes already issued for it (`prior`).
 * The last piece of a line takes whatever is left of that line's amounts, so many small returns add up to exactly the
 * original line (no paise lost to rounding), and the final return also refunds the bill's round-off so the customer
 * gets back precisely what they paid.
 */
export function planReturn(original: Bill, prior: Bill[], lines: ReturnLine[]): ReturnPlan | null {
  const items: BillItem[] = []
  for (const it of original.items) {
    const want = lines.find((x) => x.variantId === it.variantId)?.qty ?? 0
    const remaining = round3(it.qty - it.returnedQty)
    // Whole pieces, or fractions of a metre/kilo for goods sold by measure.
    const qty = Math.min(isFrac(rulesOfBillItem(it)) ? round3(want) : Math.floor(want), remaining)
    if (qty <= 0) continue
    const last = round3(qty - remaining) === 0
    const part = (field: 'discountAmount' | 'net' | 'taxable' | 'cgst' | 'sgst' | 'lineTotal') =>
      last ? round2(it[field] - sumPrior(prior, it.variantId, field)) : round2((it[field] * qty) / it.qty)
    items.push({
      ...it, qty, returnedQty: 0,
      discountAmount: part('discountAmount'), net: part('net'), taxable: part('taxable'),
      cgst: part('cgst'), sgst: part('sgst'), lineTotal: part('lineTotal'),
    })
  }
  if (!items.length) return null

  const subtotal = round2(items.reduce((s, i) => s + i.lineTotal, 0))
  const complete = original.items.every((it) => {
    const r = items.find((x) => x.variantId === it.variantId)
    return round3(it.returnedQty + (r?.qty ?? 0)) >= it.qty
  })
  const refundedBefore = round2(prior.reduce((s, cn) => s + Math.abs(cn.total), 0))
  const total = complete ? Math.max(0, round2(original.total - refundedBefore)) : Math.round(subtotal)

  const reversedBefore = prior.reduce((s, cn) => s + Math.abs(Math.min(cn.loyaltyEarned, 0)), 0)
  const valueBack = round2(prior.reduce((s, cn) => s + cn.subtotal, 0) + subtotal)
  const target = complete ? original.loyaltyEarned
    : original.subtotal > 0 ? Math.floor((original.loyaltyEarned * valueBack) / original.subtotal) : 0
  const loyaltyReverse = Math.max(0, target - reversedBefore)

  return { items, subtotal, total, roundOff: round2(total - subtotal), complete, loyaltyReverse }
}

/** Credit notes already issued against a bill. */
export const creditNotesFor = (all: Bill[], originalId: string) => all.filter((b) => b.refundOfBillId === originalId)
