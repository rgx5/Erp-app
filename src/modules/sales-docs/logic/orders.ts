import { endOfDay } from '@/domain/dates'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import { listOf, type DataState } from '@/data/state'
import type { Instalment, OrderPayment, SalesOrder } from '../types'

export const isOpenOrder = (o: Pick<SalesOrder, 'status'>) => o.status === 'open' || o.status === 'ready'
export const ORDER_LABEL: Record<SalesOrder['status'], string> = { open: 'Open', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled' }

export interface OrderMoney {
  received: number
  refunded: number
  /** Advance used up against bills. */
  applied: number
  /** Money paid in and kept: received − refunded. */
  paidIn: number
  /** Advance still held for the customer: what can be used against a bill. */
  onHand: number
  /** What is still to be paid on the order. */
  toPay: number
}

/** Everything that has moved against an order, worked out from its payment documents (never stored). */
export function orderMoney(order: Pick<SalesOrder, 'id' | 'total'>, payments: OrderPayment[]): OrderMoney {
  let received = 0, refunded = 0, applied = 0
  for (const p of payments) {
    if (p.orderId !== order.id) continue
    if (p.kind === 'advance') received += p.amount
    else if (p.kind === 'refund') refunded += p.amount
    else applied += p.amount
  }
  const paidIn = round2(received - refunded)
  return { received: round2(received), refunded: round2(refunded), applied: round2(applied), paidIn, onHand: round2(Math.max(0, paidIn - applied)), toPay: round2(Math.max(0, order.total - paidIn)) }
}

export const paymentsOf = (state: DataState, orderId: string) => listOf(state.orderPayments).filter((p) => p.orderId === orderId).sort((a, b) => a.date - b.date)

export const moneyOf = (state: DataState, order: SalesOrder) => orderMoney(order, paymentsOf(state, order.id))

/** How many of an item are promised to customers on orders that have not been delivered or cancelled. */
export function reservedQty(state: DataState, variantId: string): number {
  let n = 0
  for (const o of listOf(state.salesOrders)) {
    if (!isOpenOrder(o)) continue
    for (const l of o.items) if (l.variantId === variantId) n += l.qty
  }
  return round3(n)
}

/** Reserved quantity for every item at once (one pass, for lists). */
export function reservedByVariant(state: DataState): Map<string, number> {
  const m = new Map<string, number>()
  for (const o of listOf(state.salesOrders)) {
    if (!isOpenOrder(o)) continue
    for (const l of o.items) m.set(l.variantId, round3((m.get(l.variantId) ?? 0) + l.qty))
  }
  return m
}

/** Advance a customer holds across all their open orders. */
export function advanceOnHand(state: DataState, customerId: string | null | undefined): number {
  if (!customerId) return 0
  let n = 0
  for (const o of listOf(state.salesOrders)) if (o.customerId === customerId && isOpenOrder(o)) n += moneyOf(state, o).onHand
  return round2(n)
}

/**
 * Which order an advance payment is drawn from: the order the cart was loaded from, else the customer's oldest open order that
 * still holds advance. Null when there is nothing to draw on.
 */
export function advanceSource(state: DataState, customerId: string | null | undefined, orderId?: string): { order: SalesOrder; onHand: number } | null {
  if (!customerId) return null
  const open = listOf(state.salesOrders).filter((o) => o.customerId === customerId && isOpenOrder(o)).sort((a, b) => a.date - b.date)
  const pick = (orderId ? open.find((o) => o.id === orderId) : undefined) ?? open.find((o) => moneyOf(state, o).onHand > 0)
  if (!pick) return null
  const onHand = moneyOf(state, pick).onHand
  return onHand > 0 ? { order: pick, onHand } : null
}

// ───────────────────────────── layaway ─────────────────────────────

/** Splits an amount into `count` equal instalments `everyDays` apart; the last takes the rounding remainder. */
export function buildInstalments(total: number, count: number, firstDue: number, everyDays: number): Instalment[] {
  const n = Math.max(1, Math.floor(count))
  const each = Math.floor((total / n) * 100) / 100
  const out: Instalment[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(firstDue)
    d.setDate(d.getDate() + i * everyDays)
    out.push({ dueDate: d.getTime(), amount: i === n - 1 ? round2(total - each * (n - 1)) : each })
  }
  return out
}

export type InstalmentState = 'paid' | 'overdue' | 'due' | 'upcoming'
export interface InstalmentRow { dueDate: number; amount: number; cumulative: number; state: InstalmentState }

/**
 * Where a layaway stands: each instalment is paid once the money received covers everything scheduled up to it; the first
 * unpaid one is "due" (or "overdue" once its date has passed) and the rest are upcoming.
 */
export function layawayStatus(order: Pick<SalesOrder, 'instalments'>, paidIn: number, now: number) {
  const rows: InstalmentRow[] = []
  let cum = 0
  let foundNext = false
  for (const ins of [...(order.instalments ?? [])].sort((a, b) => a.dueDate - b.dueDate)) {
    cum = round2(cum + ins.amount)
    let state: InstalmentState
    if (paidIn + 0.005 >= cum) state = 'paid'
    else if (endOfDay(ins.dueDate) < now) state = 'overdue'
    else if (!foundNext) { state = 'due'; foundNext = true } else state = 'upcoming'
    rows.push({ dueDate: ins.dueDate, amount: ins.amount, cumulative: cum, state })
  }
  const next = rows.find((r) => r.state !== 'paid') ?? null
  const lastOverdue = rows.filter((r) => r.state === 'overdue').reduce((m, r) => Math.max(m, r.cumulative), 0)
  const overdueAmount = round2(Math.max(0, lastOverdue - paidIn))
  return { rows, next, overdue: rows.filter((r) => r.state === 'overdue').length, overdueAmount }
}

/** Orders with a layaway instalment past its date. */
export function overdueLayaways(state: DataState, now: number): Array<{ order: SalesOrder; amount: number }> {
  const out: Array<{ order: SalesOrder; amount: number }> = []
  for (const o of listOf(state.salesOrders)) {
    if (!isOpenOrder(o) || !o.instalments?.length) continue
    const s = layawayStatus(o, moneyOf(state, o).paidIn, now)
    if (s.overdue) out.push({ order: o, amount: s.overdueAmount })
  }
  return out
}
