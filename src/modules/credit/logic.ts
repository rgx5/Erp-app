import type { Bill, Payment } from '@/domain/types'
import { onAccountOf } from '@/domain/checkout'
import { round2 } from '@/domain/money'
import { listOf, type DataState } from '@/data/state'
import type { Collection, CustomerTerms, CreditSettings } from './types'

export const DAY = 86_400_000
export const DEFAULT_CREDIT_DAYS = 30

/** One bill that was sold, wholly or partly, on account. */
export interface BillDue {
  billId: string
  no: string
  customerId: string
  date: number
  dueDate: number
  /** What was put on account when it was sold. */
  amount: number
  /** Collected against this bill. */
  collected: number
  /** Taken off by returns. */
  returned: number
  outstanding: number
}

export interface CustomerDues {
  customerId: string
  bills: BillDue[]
  /** Owed on bills that are not fully settled. */
  outstanding: number
  /** Paid in advance, not yet applied to a bill. */
  advance: number
  /** `outstanding − advance`: what the customer owes (negative = they are in credit). */
  net: number
  /** The earliest due date among unsettled bills. */
  oldestDue: number | null
}

export interface Receivables {
  byCustomer: Record<string, CustomerDues>
  /** Everything customers owe the shop (customers who are owed money back are not netted off). */
  total: number
}

const settingsOf = (state: DataState): CreditSettings | undefined => state.creditSettings?.credit
export const creditDaysFor = (state: DataState, customerId: string): number =>
  state.customerTerms?.[customerId]?.creditDays ?? settingsOf(state)?.defaultDays ?? DEFAULT_CREDIT_DAYS

/** The date a bill sold on account must be paid by: what the till recorded, or the sale date plus the customer's credit days. */
export function dueDateOf(state: DataState, bill: Pick<Bill, 'date' | 'customerId' | 'ext'>): number {
  const stored = (bill.ext?.credit as { dueDate?: number } | undefined)?.dueDate
  if (typeof stored === 'number') return stored
  return bill.date + (bill.customerId ? creditDaysFor(state, bill.customerId) : DEFAULT_CREDIT_DAYS) * DAY
}

/**
 * Who owes what, worked out from the documents (never stored): the amounts put on account by bills, less collections allocated
 * to them and returns that reduced them. Money received that was not allocated is an *advance* on the customer's account.
 */
export function receivables(state: DataState): Receivables {
  const bills = listOf(state.bills).filter((b) => b.status !== 'held')
  const sales = new Map<string, BillDue>()
  const returned = new Map<string, number>()
  for (const b of bills) {
    if (!b.customerId) continue
    const due = onAccountOf(b.payments)
    if (b.refundOfBillId) { if (due < 0) returned.set(b.refundOfBillId, round2((returned.get(b.refundOfBillId) ?? 0) - due)); continue }
    if (due <= 0) continue
    sales.set(b.id, { billId: b.id, no: b.no, customerId: b.customerId, date: b.date, dueDate: dueDateOf(state, b), amount: due, collected: 0, returned: 0, outstanding: due })
  }
  const advance = new Map<string, number>()
  for (const c of listOf(state.collections ?? {})) {
    for (const a of c.allocations) { const d = sales.get(a.billId); if (d) d.collected = round2(d.collected + a.amount) }
    if (c.advance > 0) advance.set(c.customerId, round2((advance.get(c.customerId) ?? 0) + c.advance))
  }
  for (const [id, r] of returned) { const d = sales.get(id); if (d) d.returned = r }

  const byCustomer: Record<string, CustomerDues> = {}
  const ensure = (id: string): CustomerDues => (byCustomer[id] ??= { customerId: id, bills: [], outstanding: 0, advance: 0, net: 0, oldestDue: null })
  for (const d of sales.values()) {
    d.outstanding = Math.max(0, round2(d.amount - d.collected - d.returned))
    const c = ensure(d.customerId)
    c.bills.push(d)
  }
  for (const [id, a] of advance) ensure(id).advance = a
  let total = 0
  for (const c of Object.values(byCustomer)) {
    c.bills.sort((x, y) => x.date - y.date)
    c.outstanding = round2(c.bills.reduce((s, d) => s + d.outstanding, 0))
    c.net = round2(c.outstanding - c.advance)
    const open = c.bills.filter((d) => d.outstanding > 0)
    c.oldestDue = open.length ? Math.min(...open.map((d) => d.dueDate)) : null
    if (c.net > 0) total = round2(total + c.net)
  }
  return { byCustomer, total }
}

/** What one customer owes now (0 for someone with no account activity). */
export const netDue = (r: Receivables, customerId: string) => r.byCustomer[customerId]?.net ?? 0

/**
 * Splits a received amount over the customer's unsettled bills, oldest first. Whatever is left becomes an advance.
 */
export function allocateOldestFirst(open: Array<Pick<BillDue, 'billId' | 'outstanding' | 'date'>>, amount: number): { allocations: Collection['allocations']; advance: number } {
  let left = round2(amount)
  const allocations: Collection['allocations'] = []
  for (const b of [...open].filter((x) => x.outstanding > 0).sort((x, y) => x.date - y.date)) {
    if (left <= 0) break
    const take = Math.min(left, b.outstanding)
    allocations.push({ billId: b.billId, amount: round2(take) })
    left = round2(left - take)
  }
  return { allocations, advance: Math.max(0, left) }
}

// ───────────────────────────── ageing ─────────────────────────────

export const AGE_BUCKETS = [
  { key: 'notDue', label: 'Not due', from: -Infinity, to: 0 },
  { key: 'd1_30', label: '1–30 days', from: 1, to: 30 },
  { key: 'd31_60', label: '31–60 days', from: 31, to: 60 },
  { key: 'd61_90', label: '61–90 days', from: 61, to: 90 },
  { key: 'd90', label: 'Over 90 days', from: 91, to: Infinity },
] as const
export type BucketKey = (typeof AGE_BUCKETS)[number]['key']

export interface AgingRow {
  customerId: string
  buckets: Record<BucketKey, number>
  total: number
  advance: number
  oldestDaysOverdue: number
}
export interface AgingReport { asOf: number; rows: AgingRow[]; totals: Record<BucketKey, number>; total: number }

export const daysOverdue = (dueDate: number, asOf: number) => Math.floor((asOf - dueDate) / DAY)
const bucketOf = (days: number): BucketKey => AGE_BUCKETS.find((b) => days >= b.from && days <= b.to)!.key

/**
 * Receivables by how late they are. A customer's advance is applied to their oldest bills first, so the buckets show what is
 * still genuinely outstanding. Sorted with the biggest debts first.
 */
export function agingReport(state: DataState, asOf: number, rec: Receivables = receivables(state)): AgingReport {
  const empty = (): Record<BucketKey, number> => ({ notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 })
  const rows: AgingRow[] = []
  const totals = empty()
  for (const c of Object.values(rec.byCustomer)) {
    let credit = c.advance
    const buckets = empty()
    let oldest = 0
    for (const d of [...c.bills].filter((x) => x.outstanding > 0).sort((x, y) => x.dueDate - y.dueDate)) {
      let amt = d.outstanding
      const use = Math.min(credit, amt)
      credit = round2(credit - use); amt = round2(amt - use)
      if (amt <= 0) continue
      const days = daysOverdue(d.dueDate, asOf)
      buckets[bucketOf(days)] = round2(buckets[bucketOf(days)] + amt)
      oldest = Math.max(oldest, days)
    }
    const total = round2(Object.values(buckets).reduce((s, v) => s + v, 0))
    if (total <= 0) continue
    rows.push({ customerId: c.customerId, buckets, total, advance: c.advance, oldestDaysOverdue: Math.max(0, oldest) })
    for (const k of Object.keys(buckets) as BucketKey[]) totals[k] = round2(totals[k] + buckets[k])
  }
  rows.sort((a, b) => b.total - a.total)
  return { asOf, rows, totals, total: round2(Object.values(totals).reduce((s, v) => s + v, 0)) }
}

/** Overdue customers and the amount that is past its due date. */
export function overdueSummary(state: DataState, asOf: number, rec: Receivables = receivables(state)): { customers: number; amount: number } {
  const rep = agingReport(state, asOf, rec)
  const past = rep.rows.map((r) => round2(r.total - r.buckets.notDue)).filter((v) => v > 0)
  return { customers: past.length, amount: round2(past.reduce((s, v) => s + v, 0)) }
}

// ───────────────────────────── statements ─────────────────────────────

export type StatementKind = 'sale' | 'return' | 'collection'
export interface StatementEntry {
  date: number
  kind: StatementKind
  ref: string
  memo: string
  /** Added to what the customer owes. */
  debit: number
  /** Taken off. */
  credit: number
  balance: number
  docId: string
}
export interface Statement { customerId: string; from: number; to: number; opening: number; entries: StatementEntry[]; closing: number; totalDebit: number; totalCredit: number }

const movementOf = (state: DataState, customerId: string): Array<Omit<StatementEntry, 'balance'>> => {
  const out: Array<Omit<StatementEntry, 'balance'>> = []
  for (const b of listOf(state.bills)) {
    if (b.customerId !== customerId || b.status === 'held') continue
    const due = onAccountOf(b.payments)
    if (!due) continue
    if (b.refundOfBillId) out.push({ date: b.date, kind: 'return', ref: b.no, memo: 'Return — reduces what is owed', debit: 0, credit: -due, docId: b.id })
    else {
      const paidNow = round2(b.total - due)
      out.push({ date: b.date, kind: 'sale', ref: b.no, memo: paidNow > 0 ? `Bill ₹${b.total} — ₹${paidNow} paid at the counter` : `Bill ₹${b.total}`, debit: due, credit: 0, docId: b.id })
    }
  }
  for (const c of listOf(state.collections ?? {})) {
    if (c.customerId !== customerId) continue
    out.push({ date: c.date, kind: 'collection', ref: c.no, memo: `Received by ${c.mode}${c.ref ? ` (${c.ref})` : ''}`, debit: 0, credit: c.amount, docId: c.id })
  }
  return out.sort((a, b) => a.date - b.date)
}

/** A customer's account between two dates: what they owed at the start, every movement, and what they owe at the end. */
export function customerStatement(state: DataState, customerId: string, from: number, to: number): Statement {
  const all = movementOf(state, customerId)
  let balance = 0
  let opening = 0
  const entries: StatementEntry[] = []
  for (const m of all) {
    if (m.date < from) { balance = round2(balance + m.debit - m.credit); opening = balance; continue }
    if (m.date > to) continue
    balance = round2(balance + m.debit - m.credit)
    entries.push({ ...m, balance })
  }
  return {
    customerId, from, to, opening, entries, closing: balance,
    totalDebit: round2(entries.reduce((s, e) => s + e.debit, 0)), totalCredit: round2(entries.reduce((s, e) => s + e.credit, 0)),
  }
}

/** Cash collected over a period — the day-close screen can add this to the drawer. */
export const cashCollected = (state: DataState, from: number, to: number) =>
  round2(listOf(state.collections ?? {}).filter((c) => c.mode === 'cash' && c.date >= from && c.date <= to).reduce((s, c) => s + c.amount, 0))

export const dueLine = (p: Payment[]) => onAccountOf(p)
export type { CustomerTerms }

// ───────────────────────────── a customer's standing ─────────────────────────────

export interface CreditStatus {
  customerId: string
  /** What they owe now (negative = in advance). */
  owed: number
  limit: number
  blocked: boolean
  creditDays: number
  /** How much more may go on account; null when there is no limit. */
  available: number | null
  /** The part of what is owed that is past its due date. */
  overdue: number
  oldestDaysOverdue: number
}

/** Where a customer stands against their terms — what the checkout shows before putting a sale on account. */
export function creditStatus(state: DataState, customerId: string, asOf: number, rec: Receivables = receivables(state)): CreditStatus {
  const t = state.customerTerms?.[customerId]
  const owed = netDue(rec, customerId)
  const limit = t?.creditLimit ?? 0
  const row = agingReport(state, asOf, rec).rows.find((r) => r.customerId === customerId)
  return {
    customerId, owed, limit, blocked: !!t?.blocked, creditDays: creditDaysFor(state, customerId),
    available: limit > 0 ? Math.max(0, round2(limit - Math.max(0, owed))) : null,
    overdue: row ? round2(row.total - row.buckets.notDue) : 0,
    oldestDaysOverdue: row?.oldestDaysOverdue ?? 0,
  }
}
