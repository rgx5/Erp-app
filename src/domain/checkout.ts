import type { Customer, PayMode, Payment } from './types'
import { round2 } from './money'

/**
 * How a bill gets paid: store credit and loyalty points are *tender* (they pay part of the bill, they are not a discount),
 * the rest goes by cash / UPI / card — possibly split across several modes. Cash may be handed over in excess (change).
 */
export interface SettleInput {
  total: number
  customer: Pick<Customer, 'storeCredit' | 'loyaltyPoints'> | null
  /** Rupees one loyalty point is worth. */
  loyaltyValue: number
  redeemPts: number
  useCredit: boolean
  /** Part-payments already taken on other modes. */
  split: Payment[]
  /** The mode being entered now. */
  mode: PayMode
  /** What the person typed; empty means "exactly what is due". */
  tendered: string
}

export interface Settlement {
  creditUsed: number
  /** Most points that may be redeemed on this bill. */
  maxPts: number
  pts: number
  loyaltyRupees: number
  /** What is left to pay after credit and points. */
  payable: number
  splitPaid: number
  remaining: number
  amount: number
  covers: boolean
  change: number
  shortBy: number
}

export function settle(i: SettleInput): Settlement {
  const { total, customer, loyaltyValue } = i
  const creditUsed = i.useCredit && customer ? Math.min(customer.storeCredit, total) : 0
  // Points can only pay for what is still owed after store credit — never more than the bill.
  const maxPts = customer && loyaltyValue > 0 ? Math.min(customer.loyaltyPoints, Math.floor(round2(total - creditUsed) / loyaltyValue + 1e-9)) : 0
  const pts = Math.max(0, Math.min(i.redeemPts, maxPts))
  const loyaltyRupees = round2(pts * loyaltyValue)
  const payable = round2(Math.max(0, total - creditUsed - loyaltyRupees))
  const splitPaid = round2(i.split.reduce((s, p) => s + p.amount, 0))
  const remaining = round2(Math.max(0, payable - splitPaid))

  const isCash = i.mode === 'cash'
  const amount = i.tendered === '' ? remaining : Number(i.tendered) || 0
  const covers = amount >= remaining
  const change = isCash && covers ? round2(amount - remaining) : 0
  const shortBy = covers ? 0 : round2(remaining - amount)
  return { creditUsed, maxPts, pts, loyaltyRupees, payable, splitPaid, remaining, amount, covers, change, shortBy }
}

/** The payment lines that go on the bill when the sale is completed. */
export function finalPayments(i: SettleInput, s: Settlement, ref = ''): Payment[] {
  const payments = [...i.split]
  if (s.remaining > 0) payments.push({ mode: i.mode, amount: s.remaining, ...(ref.trim() ? { ref: ref.trim() } : {}) })
  if (s.creditUsed > 0) payments.push({ mode: 'credit', amount: s.creditUsed })
  if (s.loyaltyRupees > 0) payments.push({ mode: 'credit', amount: s.loyaltyRupees, ref: `${s.pts} loyalty points` })
  return payments
}

/** Round-up tender suggestions for cash: the next "nice" amounts above what's due, e.g. 2,999 → 3,000 · 3,500 · 5,000. */
export function cashSuggestions(due: number): number[] {
  const out: number[] = []
  for (const step of [10, 50, 100, 500, 1000, 2000, 5000]) {
    const v = Math.ceil(due / step) * step
    if (v > due && !out.includes(v)) out.push(v)
    if (out.length === 4) break
  }
  return out
}

/** Loyalty points earned on a bill. */
export const pointsEarned = (total: number, earnPct: number) => Math.floor((total * earnPct) / 100)
