import { startOfDay } from '@/domain/dates'
import { round2 } from '@/domain/money'
import { listOf, type DataState } from '@/data/state'
import { docTotal } from './lines'
import { isOpenOrder, moneyOf, overdueLayaways } from './orders'
import { daysLeft, effectiveStatus } from './quotes'

interface Bucket { count: number; value: number }
const bucket = (): Bucket => ({ count: 0, value: 0 })

export interface QuotePipeline {
  /** Draft, sent or accepted and still within their date. */
  open: Bucket
  /** Of those, how many run out within two days. */
  expiringSoon: number
  expired: Bucket
  converted: Bucket
  rejected: Bucket
  /** Billed ÷ (billed + rejected + expired): how many decided quotations ended in a sale, or null before any has been decided. */
  winRatePct: number | null
}

/** Where the quotations stand, by value: what is still out there, what lapsed, and what turned into sales. */
export function quotePipeline(state: DataState, now: number): QuotePipeline {
  const out: QuotePipeline = { open: bucket(), expiringSoon: 0, expired: bucket(), converted: bucket(), rejected: bucket(), winRatePct: null }
  if (!state.store) return out
  for (const q of listOf(state.quotations)) {
    const st = effectiveStatus(q, now)
    const b = st === 'expired' ? out.expired : st === 'converted' ? out.converted : st === 'rejected' ? out.rejected : out.open
    b.count += 1
    b.value += docTotal(q.items, q.billDiscountType, q.billDiscountValue, state.store)
    if (b === out.open && daysLeft(q, now) <= 2) out.expiringSoon += 1
  }
  for (const b of [out.open, out.expired, out.converted, out.rejected]) b.value = round2(b.value)
  const decided = out.converted.count + out.rejected.count + out.expired.count
  out.winRatePct = decided ? Math.round((out.converted.count / decided) * 100) : null
  return out
}

export interface OrderBook {
  open: Bucket
  ready: number
  /** Advance held for open orders: money owed back in goods. */
  advanceHeld: number
  /** Still to be paid on open orders. */
  balanceDue: number
  /** Open orders past their delivery date. */
  pastDue: number
  /** Orders with a layaway instalment past its date, and the amount behind. */
  layawayOverdue: { count: number; amount: number }
}

/** The order book: what customers are waiting for, what they have paid and what is late. */
export function orderBook(state: DataState, now: number): OrderBook {
  const out: OrderBook = { open: bucket(), ready: 0, advanceHeld: 0, balanceDue: 0, pastDue: 0, layawayOverdue: { count: 0, amount: 0 } }
  for (const o of listOf(state.salesOrders)) {
    if (!isOpenOrder(o)) continue
    const m = moneyOf(state, o)
    out.open.count += 1
    out.open.value += o.total
    out.advanceHeld += m.onHand
    out.balanceDue += m.toPay
    if (o.status === 'ready') out.ready += 1
    if (o.expectedDate && o.expectedDate < startOfDay(now)) out.pastDue += 1
  }
  const late = overdueLayaways(state, now)
  out.layawayOverdue = { count: late.length, amount: round2(late.reduce((s, l) => s + l.amount, 0)) }
  out.open.value = round2(out.open.value); out.advanceHeld = round2(out.advanceHeld); out.balanceDue = round2(out.balanceDue)
  return out
}
