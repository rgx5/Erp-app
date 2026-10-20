import { applyChanges, listOf, mergeChanges, type Changes, type DataState } from '@/data/state'
import { audit, OpError, saveBill, type OpCtx } from '@/data/ops'
import { endOfDay, startOfDay } from '@/domain/dates'
import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import type { Bill, DiscountType } from '@/domain/types'
import { paymentMethodList } from '@/modules/registry'
import { nextNo } from '../numbering'
import { billInputFromLines } from './logic/billing'
import { canEditQuote, DEFAULT_TERMS, DEFAULT_VALIDITY_DAYS } from './logic/quotes'
import { moneyOf, isOpenOrder } from './logic/orders'
import { docTotal, unpricedLines } from './logic/lines'
import { nextChallanStatus, undispatched } from './logic/challans'
import { nextAfter, periodsDue } from './logic/subscriptions'
import { openShiftFor, shiftFigures } from './logic/shifts'
import type {
  Challan, ChallanLine, ChallanStatus, CommissionRule, DocLine, Frequency, Instalment, OrderPayMode, OrderPayment, Quotation, QuoteStatus, SalesOrder, SalesTarget,
  Shift, Subscription, SubPayMode, SubscriptionKind, CashMove,
} from './types'
import './replication'

const day = 86_400_000
const branch = (ctx: OpCtx) => (ctx.branchId ? { branchId: ctx.branchId } : {})

function checkLines(state: DataState, lines: DocLine[], what: string) {
  if (!lines.length) throw new OpError(`Add at least one item to the ${what}.`)
  for (const l of lines) {
    if (!state.variants[l.variantId]) throw new OpError(`${l.name} no longer exists.`)
    if (!(l.qty > 0)) throw new OpError(`Every line needs a quantity (${l.name}).`)
    if (!(l.price > 0)) throw new OpError(`${l.name} has no price — price it first, or remove it.`)
  }
  if (unpricedLines(lines)) throw new OpError('Every item needs a price.')
}

// ───────────────────────────── quotations ─────────────────────────────

export interface QuoteDraft {
  customerId: string | null
  partyName: string
  partyPhone: string
  items: DocLine[]
  billDiscountType: DiscountType
  billDiscountValue: number
  validUntil: number
  notes: string
  terms: string
}

/** The validity a new quotation starts with. */
export const defaultValidity = (now: number) => endOfDay(now + DEFAULT_VALIDITY_DAYS * day)

/** Writes a quotation, or changes one that has not been accepted, rejected or billed. */
export function saveQuotation(state: DataState, d: QuoteDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; quotation: Quotation } {
  const customer = d.customerId ? state.customers[d.customerId] : undefined
  if (d.customerId && !customer) throw new OpError('That customer no longer exists.')
  const partyName = (customer?.name ?? d.partyName).trim()
  if (!partyName) throw new OpError('Say who the quotation is for.')
  checkLines(state, d.items, 'quotation')
  if (!(d.validUntil >= startOfDay(ctx.now)) && !existingId) throw new OpError('The “valid until” date is already past.')
  const base = { customerId: d.customerId, partyName, partyPhone: (customer?.phone ?? d.partyPhone).trim(), items: d.items, billDiscountType: d.billDiscountType, billDiscountValue: d.billDiscountValue, validUntil: d.validUntil, notes: d.notes.trim(), terms: d.terms.trim() }
  if (existingId) {
    const cur = state.quotations[existingId]
    if (!cur) throw new OpError('That quotation no longer exists.')
    if (!canEditQuote(cur)) throw new OpError('Only a draft or a sent quotation can be changed.')
    const q: Quotation = { ...cur, ...base }
    return { quotation: q, changes: { put: { quotations: [q], audit: [audit(ctx, 'QUOTE_EDIT', cur.no)] } } }
  }
  const q: Quotation = {
    id: id('qt', ctx.now), no: nextNo('QT-', listOf(state.quotations).map((x) => x.no), ctx), date: ctx.now, status: 'draft', createdBy: ctx.userId, ...branch(ctx),
    ...base, terms: base.terms || DEFAULT_TERMS,
  }
  return { quotation: q, changes: { put: { quotations: [q], audit: [audit(ctx, 'QUOTE_CREATE', `${q.no} — ₹${docTotal(q.items, q.billDiscountType, q.billDiscountValue, state.store!)}`)] } } }
}

const QUOTE_MOVES: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['sent', 'accepted', 'rejected'], sent: ['draft', 'accepted', 'rejected'], accepted: ['sent', 'rejected'], rejected: ['draft', 'sent'], expired: ['draft', 'sent', 'rejected'], converted: [],
}

/** Moves a quotation along: sent to the customer, accepted, rejected, or back to draft. */
export function setQuoteStatus(state: DataState, quoteId: string, to: Extract<QuoteStatus, 'draft' | 'sent' | 'accepted' | 'rejected'>, ctx: OpCtx): { changes: Changes; quotation: Quotation } {
  const cur = state.quotations[quoteId]
  if (!cur) throw new OpError('That quotation no longer exists.')
  if (cur.status === 'converted') throw new OpError('This quotation has already been billed.')
  if (!QUOTE_MOVES[cur.status].includes(to)) throw new OpError(`A ${cur.status} quotation cannot become ${to}.`)
  const q: Quotation = { ...cur, status: to }
  return { quotation: q, changes: { put: { quotations: [q], audit: [audit(ctx, 'QUOTE_STATUS', `${cur.no} → ${to}`)] } } }
}

/** Gives a lapsed quotation a new last day. */
export function extendQuote(state: DataState, quoteId: string, validUntil: number, ctx: OpCtx): { changes: Changes; quotation: Quotation } {
  const cur = state.quotations[quoteId]
  if (!cur) throw new OpError('That quotation no longer exists.')
  if (cur.status === 'converted') throw new OpError('This quotation has already been billed.')
  if (!(validUntil >= startOfDay(ctx.now))) throw new OpError('Pick a date from today onward.')
  const q: Quotation = { ...cur, validUntil, status: cur.status === 'expired' ? 'sent' : cur.status }
  return { quotation: q, changes: { put: { quotations: [q], audit: [audit(ctx, 'QUOTE_EXTEND', cur.no)] } } }
}

export function deleteQuotation(state: DataState, quoteId: string, ctx: OpCtx): { changes: Changes } {
  const cur = state.quotations[quoteId]
  if (!cur) throw new OpError('That quotation no longer exists.')
  if (cur.status !== 'draft') throw new OpError('Only a draft can be deleted.')
  return { changes: { del: { quotations: [quoteId] }, put: { audit: [audit(ctx, 'QUOTE_DELETE', cur.no)] } } }
}

// ───────────────────────────── sales orders ─────────────────────────────

export interface OrderDraft {
  customerId: string
  items: DocLine[]
  billDiscountType: DiscountType
  billDiscountValue: number
  expectedDate?: number
  notes: string
  instalments?: Instalment[]
}

/** Takes an order (or changes one that is still open and has had nothing applied to a bill). */
export function saveSalesOrder(state: DataState, d: OrderDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; order: SalesOrder } {
  if (!state.customers[d.customerId]) throw new OpError('Choose the customer the order is for.')
  checkLines(state, d.items, 'order')
  const total = docTotal(d.items, d.billDiscountType, d.billDiscountValue, state.store!)
  if (d.instalments?.length) {
    const sum = round2(d.instalments.reduce((s, i) => s + i.amount, 0))
    if (Math.abs(sum - total) > 0.01) throw new OpError(`The instalments add up to ₹${sum}, but the order is ₹${total}.`)
    if (d.instalments.some((i) => !(i.amount > 0))) throw new OpError('Every instalment needs an amount.')
  }
  const base = {
    customerId: d.customerId, items: d.items, billDiscountType: d.billDiscountType, billDiscountValue: d.billDiscountValue, expectedDate: d.expectedDate, total, notes: d.notes.trim(),
    instalments: d.instalments?.length ? d.instalments : undefined,
  }
  if (existingId) {
    const cur = state.salesOrders[existingId]
    if (!cur) throw new OpError('That order no longer exists.')
    if (!isOpenOrder(cur)) throw new OpError('A delivered or cancelled order cannot be changed.')
    const m = moneyOf(state, cur)
    if (m.applied > 0) throw new OpError('Part of this order has already been billed against its advance.')
    if (m.paidIn > total + 0.005) throw new OpError(`₹${m.paidIn} has been paid in, which is more than the new total of ₹${total}. Refund the difference first.`)
    const order: SalesOrder = { ...cur, ...base }
    return { order, changes: { put: { salesOrders: [order], audit: [audit(ctx, 'ORDER_EDIT', `${cur.no} — ₹${total}`)] } } }
  }
  const order: SalesOrder = {
    id: id('so', ctx.now), no: nextNo('SO-', listOf(state.salesOrders).map((o) => o.no), ctx), date: ctx.now, status: 'open', createdBy: ctx.userId, ...branch(ctx), ...base,
  }
  return { order, changes: { put: { salesOrders: [order], audit: [audit(ctx, 'ORDER_CREATE', `${order.no} — ₹${total}`)] } } }
}

export interface PaymentInput { amount: number; mode: Exclude<OrderPayMode, 'advance'>; ref?: string; note?: string }

function orderPayment(order: SalesOrder, kind: OrderPayment['kind'], p: { amount: number; mode: OrderPayMode; ref?: string; note?: string; billId?: string }, ctx: OpCtx): OrderPayment {
  return {
    id: id('opy', ctx.now), orderId: order.id, customerId: order.customerId, date: ctx.now, kind, amount: round2(p.amount), mode: p.mode, ref: (p.ref ?? '').trim(), note: (p.note ?? '').trim(),
    ...(p.billId ? { billId: p.billId } : {}), userId: ctx.userId, ...branch(ctx),
  }
}

/** Receives an advance (or an instalment) against an order. */
export function takeOrderPayment(state: DataState, orderId: string, p: PaymentInput, ctx: OpCtx): { changes: Changes; payment: OrderPayment } {
  const order = state.salesOrders[orderId]
  if (!order) throw new OpError('That order no longer exists.')
  if (!isOpenOrder(order)) throw new OpError('This order is closed.')
  if (!(p.amount > 0)) throw new OpError('Enter the amount received.')
  const m = moneyOf(state, order)
  if (p.amount > m.toPay + 0.005) throw new OpError(`That is more than the order's balance of ₹${m.toPay}.`)
  const payment = orderPayment(order, 'advance', p, ctx)
  return { payment, changes: { put: { orderPayments: [payment], audit: [audit(ctx, 'ORDER_ADVANCE', `${order.no} — ₹${payment.amount} by ${p.mode}`)] } } }
}

/** Gives some of the advance back. */
export function refundOrderPayment(state: DataState, orderId: string, p: PaymentInput, ctx: OpCtx): { changes: Changes; payment: OrderPayment } {
  const order = state.salesOrders[orderId]
  if (!order) throw new OpError('That order no longer exists.')
  if (!(p.amount > 0)) throw new OpError('Enter the amount to give back.')
  const m = moneyOf(state, order)
  if (p.amount > m.onHand + 0.005) throw new OpError(`Only ₹${m.onHand} of advance is held for this order.`)
  const payment = orderPayment(order, 'refund', p, ctx)
  return { payment, changes: { put: { orderPayments: [payment], audit: [audit(ctx, 'ORDER_REFUND', `${order.no} — ₹${payment.amount} by ${p.mode}`)] } } }
}

/** Marks an order ready for collection, or back to open. */
export function setOrderReady(state: DataState, orderId: string, ready: boolean, ctx: OpCtx): { changes: Changes; order: SalesOrder } {
  const cur = state.salesOrders[orderId]
  if (!cur) throw new OpError('That order no longer exists.')
  if (!isOpenOrder(cur)) throw new OpError('This order is closed.')
  const order: SalesOrder = { ...cur, status: ready ? 'ready' : 'open' }
  return { order, changes: { put: { salesOrders: [order], audit: [audit(ctx, 'ORDER_STATUS', `${cur.no} ${ready ? 'ready' : 'open'}`)] } } }
}

/** Cancels an order. Advance still held must be given back (say how) — it cannot just disappear. */
export function cancelOrder(state: DataState, orderId: string, refund: { mode: Exclude<OrderPayMode, 'advance'>; ref?: string } | null, ctx: OpCtx): { changes: Changes; order: SalesOrder } {
  const cur = state.salesOrders[orderId]
  if (!cur) throw new OpError('That order no longer exists.')
  if (!isOpenOrder(cur)) throw new OpError('This order is already closed.')
  const m = moneyOf(state, cur)
  const parts: Changes[] = []
  if (m.onHand > 0) {
    if (!refund) throw new OpError(`₹${m.onHand} of advance is held for this order — choose how it is given back.`)
    parts.push(refundOrderPayment(state, orderId, { amount: m.onHand, mode: refund.mode, ref: refund.ref, note: 'Order cancelled' }, ctx).changes)
  }
  const order: SalesOrder = { ...cur, status: 'cancelled' }
  parts.push({ put: { salesOrders: [order], audit: [audit(ctx, 'ORDER_CANCEL', cur.no)] } })
  return { order, changes: mergeChanges(...parts) }
}

/** A mistaken order with no money against it can simply be deleted. */
export function deleteSalesOrder(state: DataState, orderId: string, ctx: OpCtx): { changes: Changes } {
  const cur = state.salesOrders[orderId]
  if (!cur) throw new OpError('That order no longer exists.')
  if (listOf(state.orderPayments).some((p) => p.orderId === orderId)) throw new OpError('Money has been recorded against this order — cancel it instead.')
  if (cur.status === 'delivered') throw new OpError('A delivered order cannot be deleted.')
  return { changes: { del: { salesOrders: [orderId] }, put: { audit: [audit(ctx, 'ORDER_DELETE', cur.no)] } } }
}

// ───────────────────────────── challans ─────────────────────────────

export interface ChallanDraft {
  orderId?: string
  customerId: string | null
  partyName: string
  partyPhone: string
  address: string
  items: ChallanLine[]
  vehicle: string
  driver: string
  trackingNo: string
  notes: string
}

/** Writes a delivery challan. Lines taken from an order may not exceed what is still left to send. */
export function saveChallan(state: DataState, d: ChallanDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; challan: Challan } {
  const customer = d.customerId ? state.customers[d.customerId] : undefined
  const partyName = (customer?.name ?? d.partyName).trim()
  if (!partyName) throw new OpError('Say who the goods are going to.')
  if (!d.items.length) throw new OpError('Add at least one item to the challan.')
  if (d.items.some((l) => !(l.qty > 0))) throw new OpError('Every line needs a quantity.')
  if (d.orderId) {
    const order = state.salesOrders[d.orderId]
    if (!order) throw new OpError('That order no longer exists.')
    const others = listOf(state.challans).filter((c) => c.id !== existingId)
    const left = undispatched(order, others)
    for (const l of d.items) {
      const room = left.find((x) => x.variantId === l.variantId)?.qty ?? 0
      if (l.variantId && l.qty > round3(room) + 0.0005) throw new OpError(`Only ${room} of ${l.name} is left to send on ${order.no}.`)
    }
  }
  const base = { orderId: d.orderId, customerId: d.customerId, partyName, partyPhone: (customer?.phone ?? d.partyPhone).trim(), address: d.address.trim() || customer?.address || '', items: d.items, vehicle: d.vehicle.trim(), driver: d.driver.trim(), trackingNo: d.trackingNo.trim(), notes: d.notes.trim() }
  if (existingId) {
    const cur = state.challans[existingId]
    if (!cur) throw new OpError('That challan no longer exists.')
    if (cur.status !== 'packed') throw new OpError('A challan that has gone out cannot be changed.')
    const c: Challan = { ...cur, ...base }
    return { challan: c, changes: { put: { challans: [c], audit: [audit(ctx, 'CHALLAN_EDIT', cur.no)] } } }
  }
  const c: Challan = {
    id: id('dc', ctx.now), no: nextNo('DC-', listOf(state.challans).map((x) => x.no), ctx), date: ctx.now, status: 'packed', proof: '', createdBy: ctx.userId, ...branch(ctx), ...base,
  }
  return { challan: c, changes: { put: { challans: [c], audit: [audit(ctx, 'CHALLAN_CREATE', c.no)] } } }
}

/** Takes a challan to its next step: dispatched (vehicle, driver, tracking) then delivered (who received it). */
export function advanceChallan(state: DataState, challanId: string, to: ChallanStatus, info: { vehicle?: string; driver?: string; trackingNo?: string; proof?: string }, ctx: OpCtx): { changes: Changes; challan: Challan } {
  const cur = state.challans[challanId]
  if (!cur) throw new OpError('That challan no longer exists.')
  if (nextChallanStatus(cur.status) !== to) throw new OpError(`A ${cur.status} challan cannot go straight to ${to}.`)
  const c: Challan = {
    ...cur, status: to,
    vehicle: info.vehicle?.trim() ?? cur.vehicle, driver: info.driver?.trim() ?? cur.driver, trackingNo: info.trackingNo?.trim() ?? cur.trackingNo,
    ...(to === 'dispatched' ? { dispatchedAt: ctx.now } : { deliveredAt: ctx.now, proof: (info.proof ?? '').trim() }),
  }
  return { challan: c, changes: { put: { challans: [c], audit: [audit(ctx, 'CHALLAN_STATUS', `${cur.no} → ${to}`)] } } }
}

export function deleteChallan(state: DataState, challanId: string, ctx: OpCtx): { changes: Changes } {
  const cur = state.challans[challanId]
  if (!cur) throw new OpError('That challan no longer exists.')
  if (cur.status !== 'packed') throw new OpError('A challan that has gone out cannot be deleted.')
  return { changes: { del: { challans: [challanId] }, put: { audit: [audit(ctx, 'CHALLAN_DELETE', cur.no)] } } }
}

// ───────────────────────────── subscriptions & AMC ─────────────────────────────

export interface SubscriptionDraft {
  kind: SubscriptionKind
  customerId: string
  items: DocLine[]
  frequency: Frequency
  startDate: number
  endDate?: number
  payMode: SubPayMode
  coverage: string
  notes: string
}

export function saveSubscription(state: DataState, d: SubscriptionDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; subscription: Subscription } {
  if (!state.customers[d.customerId]) throw new OpError('Choose the customer.')
  checkLines(state, d.items, 'plan')
  if (d.endDate && d.endDate < d.startDate) throw new OpError('The end date is before the start date.')
  const base = { kind: d.kind, customerId: d.customerId, items: d.items, frequency: d.frequency, endDate: d.endDate, payMode: d.payMode, coverage: d.coverage.trim(), notes: d.notes.trim() }
  if (existingId) {
    const cur = state.subscriptions[existingId]
    if (!cur) throw new OpError('That plan no longer exists.')
    const s: Subscription = { ...cur, ...base, startDate: cur.billCount ? cur.startDate : d.startDate, nextDate: cur.billCount ? cur.nextDate : d.startDate }
    return { subscription: s, changes: { put: { subscriptions: [s], audit: [audit(ctx, 'SUB_EDIT', cur.no)] } } }
  }
  const s: Subscription = {
    id: id('sub', ctx.now), no: nextNo(d.kind === 'amc' ? 'AMC-' : 'SUB-', listOf(state.subscriptions).filter((x) => x.kind === d.kind).map((x) => x.no), ctx),
    startDate: d.startDate, nextDate: d.startDate, active: true, billCount: 0, createdBy: ctx.userId, ...branch(ctx), ...base,
  }
  return { subscription: s, changes: { put: { subscriptions: [s], audit: [audit(ctx, 'SUB_CREATE', s.no)] } } }
}

export function setSubscriptionActive(state: DataState, subId: string, active: boolean, ctx: OpCtx): { changes: Changes; subscription: Subscription } {
  const cur = state.subscriptions[subId]
  if (!cur) throw new OpError('That plan no longer exists.')
  const s: Subscription = { ...cur, active }
  return { subscription: s, changes: { put: { subscriptions: [s], audit: [audit(ctx, 'SUB_STATUS', `${cur.no} ${active ? 'resumed' : 'paused'}`)] } } }
}

export function deleteSubscription(state: DataState, subId: string, ctx: OpCtx): { changes: Changes } {
  const cur = state.subscriptions[subId]
  if (!cur) throw new OpError('That plan no longer exists.')
  if (cur.billCount > 0) throw new OpError('This plan has already billed — pause it instead.')
  return { changes: { del: { subscriptions: [subId] }, put: { audit: [audit(ctx, 'SUB_DELETE', cur.no)] } } }
}

/** Whether a way to put a sale "on account" is installed (the credit app registers it). */
export const hasOnAccount = () => paymentMethodList().some((m) => m.id === 'due')

/**
 * Creates the invoices that have fallen due on one plan — one per missed period — through the ordinary bill path (stock, points,
 * numbering, hooks all apply), then moves the plan on. `payMode` overrides how they are settled this time.
 */
export function generateInvoices(state: DataState, subId: string, payMode: SubPayMode | undefined, ctx: OpCtx): { changes: Changes; bills: Bill[] } {
  const sub = state.subscriptions[subId]
  if (!sub) throw new OpError('That plan no longer exists.')
  const dates = periodsDue(sub, ctx.now)
  if (!dates.length) throw new OpError(`${sub.no} has nothing due yet.`)
  const mode = payMode ?? sub.payMode
  if (mode === 'due' && !hasOnAccount()) throw new OpError('Billing on account needs the Credit app. Choose cash, UPI or card.')
  if (!state.customers[sub.customerId]) throw new OpError('The customer on this plan no longer exists.')

  let s = state
  let acc: Changes = {}
  const bills: Bill[] = []
  for (const date of dates) {
    for (const l of sub.items) {
      const v = s.variants[l.variantId]
      if (!v) throw new OpError(`${l.name} no longer exists.`)
      if (!l.noStock && s.products[v.productId]?.trackStock !== false && v.stock < l.qty) throw new OpError(`Only ${v.stock} of ${l.name} in stock — receive stock before billing ${sub.no}.`)
    }
    const total = docTotal(sub.items, 'amt', 0, s.store!)
    const label = new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    const input = billInputFromLines(s, {
      lines: sub.items, customerId: sub.customerId, payments: [{ mode, amount: total }], userId: ctx.userId, now: ctx.now,
      notes: `${sub.kind === 'amc' ? 'AMC' : 'Subscription'} ${sub.no} · ${label}`, ext: { 'sales-docs': { subscriptionId: sub.id, period: date } },
    })
    const r = saveBill(s, input, ctx)
    bills.push(r.bill)
    acc = mergeChanges(acc, r.changes)
    s = applyChanges(s, r.changes)
  }
  const next = nextAfter(sub, dates.length)
  const updated: Subscription = { ...sub, nextDate: next, billCount: sub.billCount + dates.length, lastBillId: bills[bills.length - 1].id, active: sub.endDate && startOfDay(next) > endOfDay(sub.endDate) ? false : sub.active }
  return { bills, changes: mergeChanges(acc, { put: { subscriptions: [updated], audit: [audit(ctx, 'SUB_BILLED', `${sub.no} — ${bills.length} invoice${bills.length === 1 ? '' : 's'}`)] } }) }
}

// ───────────────────────────── commissions & targets ─────────────────────────────

export type RuleDraft = Omit<CommissionRule, 'id'>

export function saveCommissionRule(state: DataState, d: RuleDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; rule: CommissionRule } {
  if (!d.name.trim()) throw new OpError('Give the rule a name.')
  if (!(d.rate >= 0)) throw new OpError('The rate cannot be negative.')
  if (d.basis === 'pct' && d.rate > 100) throw new OpError('A percentage cannot be above 100.')
  if (d.scope === 'category' && !(d.categoryId && state.categories[d.categoryId])) throw new OpError('Choose a category.')
  if (d.scope === 'item' && !(d.productId && state.products[d.productId])) throw new OpError('Choose an item.')
  if (d.staffId && !state.users[d.staffId]) throw new OpError('That person no longer exists.')
  for (const sl of d.slabs ?? []) if (!(sl.minAchievementPct >= 0) || !(sl.rate >= 0)) throw new OpError('Slabs need a target percentage and a rate.')
  if (existingId && !state.commissionRules[existingId]) throw new OpError('That rule no longer exists.')
  const rule: CommissionRule = { ...d, name: d.name.trim(), slabs: d.slabs?.length ? d.slabs : undefined, id: existingId ?? id('cr', ctx.now) }
  return { rule, changes: { put: { commissionRules: [rule], audit: [audit(ctx, 'COMMISSION_RULE', rule.name)] } } }
}

export function deleteCommissionRule(state: DataState, ruleId: string, ctx: OpCtx): { changes: Changes } {
  const cur = state.commissionRules[ruleId]
  if (!cur) throw new OpError('That rule no longer exists.')
  return { changes: { del: { commissionRules: [ruleId] }, put: { audit: [audit(ctx, 'COMMISSION_RULE_DELETE', cur.name)] } } }
}

export function saveSalesTarget(state: DataState, d: { staffId: string; month: string; amount: number }, ctx: OpCtx): { changes: Changes; target: SalesTarget } {
  if (!state.users[d.staffId]) throw new OpError('Choose the salesperson.')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.month)) throw new OpError('The month should look like 2026-10.')
  if (!(d.amount > 0)) throw new OpError('Enter the target amount.')
  // One target per person per month: setting it again replaces it.
  const existing = listOf(state.salesTargets).find((t) => t.staffId === d.staffId && t.month === d.month)
  const target: SalesTarget = { id: existing?.id ?? id('st', ctx.now), staffId: d.staffId, month: d.month, amount: round2(d.amount) }
  return { target, changes: { put: { salesTargets: [target], audit: [audit(ctx, 'SALES_TARGET', `${state.users[d.staffId].name} ${d.month} ₹${target.amount}`)] } } }
}

export function deleteSalesTarget(state: DataState, targetId: string, ctx: OpCtx): { changes: Changes } {
  if (!state.salesTargets[targetId]) throw new OpError('That target no longer exists.')
  return { changes: { del: { salesTargets: [targetId] }, put: { audit: [audit(ctx, 'SALES_TARGET_DELETE', targetId)] } } }
}

// ───────────────────────────── shifts & cash in/out ─────────────────────────────

export function openShift(state: DataState, openingCash: number, note: string, ctx: OpCtx): { changes: Changes; shift: Shift } {
  if (!(openingCash >= 0) || !Number.isFinite(openingCash)) throw new OpError('Enter the cash in the drawer to open the shift (0 if empty).')
  if (openShiftFor(state, ctx.userId)) throw new OpError('You already have a shift open.')
  const shift: Shift = {
    id: id('sh', ctx.now), no: nextNo('SH-', listOf(state.shifts).map((x) => x.no), ctx), userId: ctx.userId, openedAt: ctx.now, openingCash: round2(openingCash), status: 'open', note: note.trim(), ...branch(ctx),
  }
  return { shift, changes: { put: { shifts: [shift], audit: [audit(ctx, 'SHIFT_OPEN', `${shift.no} — float ₹${shift.openingCash}`)] } } }
}

export function addCashMove(state: DataState, shiftId: string, d: { kind: 'in' | 'out'; amount: number; reason: string; note?: string }, ctx: OpCtx): { changes: Changes; move: CashMove } {
  const shift = state.shifts[shiftId]
  if (!shift) throw new OpError('That shift no longer exists.')
  if (shift.status !== 'open') throw new OpError('This shift is closed.')
  if (!(d.amount > 0)) throw new OpError('Enter the amount.')
  if (!d.reason.trim()) throw new OpError('Say what the cash was for.')
  if (d.kind === 'out') {
    const f = shiftFigures(state, shiftId, ctx.now)
    if (f && d.amount > f.expected + 0.005) throw new OpError(`There should only be ₹${f.expected} in the drawer.`)
  }
  const move: CashMove = { id: id('cm', ctx.now), shiftId, date: ctx.now, kind: d.kind, amount: round2(d.amount), reason: d.reason.trim(), note: (d.note ?? '').trim(), userId: ctx.userId, ...branch(ctx) }
  return { move, changes: { put: { cashMoves: [move], audit: [audit(ctx, d.kind === 'in' ? 'CASH_IN' : 'CASH_OUT', `${shift.no} — ₹${move.amount} · ${move.reason}`)] } } }
}

export function closeShift(state: DataState, shiftId: string, counted: number, note: string, ctx: OpCtx): { changes: Changes; shift: Shift } {
  const cur = state.shifts[shiftId]
  if (!cur || cur.status !== 'open') throw new OpError('There is no open shift to close.')
  if (!(counted >= 0) || !Number.isFinite(counted)) throw new OpError('Count the drawer and enter the total.')
  const f = shiftFigures(state, shiftId, ctx.now)!
  const shift: Shift = { ...cur, status: 'closed', closedAt: ctx.now, countedCash: round2(counted), expectedCash: f.expected, variance: round2(counted - f.expected), note: note.trim() || cur.note }
  return { shift, changes: { put: { shifts: [shift], audit: [audit(ctx, 'SHIFT_CLOSE', `${cur.no} — expected ₹${f.expected}, counted ₹${shift.countedCash}`)] } } }
}
