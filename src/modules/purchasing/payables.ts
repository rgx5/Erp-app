import { round2 } from '@/domain/money'
import { listOf, type DataState } from '@/data/state'
import { settingsOf } from './approvals'
import { live } from './reversal'
import type { PayableRef } from './types'

/**
 * What we owe suppliers, worked out from the documents (never stored): receipts and standalone purchase invoices raise it,
 * payments, debit notes and money paid at the time of receipt bring it down. Money paid beyond what was owed is an *advance*
 * with the supplier. Reversed documents (and their reversals) are left out.
 */

export const DAY = 86_400_000

/** One thing we owe: a goods receipt, a supplier invoice, a bill for landed costs, or the balance the books started with. */
export interface PayableDoc {
  ref: PayableRef
  kind: 'receipt' | 'invoice' | 'charges' | 'opening'
  no: string
  supplierId: string
  date: number
  /** Null for an opening balance with nothing to age it from. */
  dueDate: number | null
  amount: number
  /** Paid when the goods arrived. */
  paidAtSource: number
  /** Paid since, by supplier payments. */
  settled: number
  /** Taken off by debit notes. */
  returned: number
  outstanding: number
}

export interface SupplierDues {
  supplierId: string
  docs: PayableDoc[]
  /** Owed on documents not fully settled. */
  outstanding: number
  /** Paid in advance (or credited) and not yet applied to a document. */
  advance: number
  /** `outstanding − advance`: what we owe (negative = they owe us / we are in credit). */
  net: number
  oldestDue: number | null
}

export interface Payables { bySupplier: Record<string, SupplierDues>; total: number }

export const refOf = (coll: 'purchases' | 'purchaseInvoices' | 'landedCosts', id: string): PayableRef => `${coll}:${id}`
export const openingRef = (supplierId: string): PayableRef => `opening:${supplierId}`

export const creditDaysFor = (state: DataState, supplierId: string): number => state.supplierTerms?.[supplierId]?.creditDays ?? settingsOf(state).defaultDays

export function payables(state: DataState): Payables {
  const docs = new Map<PayableRef, PayableDoc>()
  const credit = new Map<string, number>()
  const addCredit = (supplierId: string, n: number) => { if (n > 0) credit.set(supplierId, round2((credit.get(supplierId) ?? 0) + n)) }
  const days = (supplierId: string) => creditDaysFor(state, supplierId) * DAY
  const make = (d: Omit<PayableDoc, 'settled' | 'returned' | 'outstanding'>) => docs.set(d.ref, { ...d, settled: 0, returned: 0, outstanding: 0 })

  for (const p of listOf(state.purchases)) {
    make({ ref: refOf('purchases', p.id), kind: 'receipt', no: p.no, supplierId: p.supplierId, date: p.date, dueDate: p.date + days(p.supplierId), amount: p.total, paidAtSource: Math.max(0, p.paid) })
  }
  const invoices = live(listOf(state.purchaseInvoices))
  for (const i of invoices) {
    if (i.basis === 'standalone') {
      make({ ref: refOf('purchaseInvoices', i.id), kind: 'invoice', no: i.invoiceNo ? `${i.no} · ${i.invoiceNo}` : i.no, supplierId: i.supplierId, date: i.invoiceDate, dueDate: i.dueDate ?? i.invoiceDate + days(i.supplierId), amount: i.payable, paidAtSource: 0 })
    } else if (i.basis === 'receipt-net' && i.purchaseId) {
      const g = docs.get(refOf('purchases', i.purchaseId))
      if (g) g.amount = round2(g.amount + i.payable)
    }
  }
  for (const l of live(listOf(state.landedCosts))) {
    if (!l.payeeId) continue
    make({ ref: refOf('landedCosts', l.id), kind: 'charges', no: l.no, supplierId: l.payeeId, date: l.date, dueDate: l.date + days(l.payeeId), amount: l.total, paidAtSource: 0 })
  }
  // The balance the books started with has no date: it ages from the supplier's first document, or not at all.
  const firstDate = new Map<string, number>()
  for (const d of docs.values()) firstDate.set(d.supplierId, Math.min(firstDate.get(d.supplierId) ?? Infinity, d.date))
  for (const s of listOf(state.suppliers)) {
    const ob = round2(s.openingBalance || 0)
    if (ob > 0) {
      const f = firstDate.get(s.id)
      make({ ref: openingRef(s.id), kind: 'opening', no: 'Opening balance', supplierId: s.id, date: f ?? 0, dueDate: f === undefined ? null : f + days(s.id), amount: ob, paidAtSource: 0 })
    } else if (ob < 0) addCredit(s.id, -ob)
  }

  for (const pay of live(listOf(state.supplierPayments))) {
    addCredit(pay.supplierId, pay.advance)
    for (const a of pay.allocations) {
      const d = docs.get(a.ref)
      if (d) d.settled = round2(d.settled + a.amount)
      else addCredit(pay.supplierId, a.amount)
    }
  }
  for (const r of live(listOf(state.purchaseReturns))) {
    const net = round2(r.total - r.refund)
    const inv = r.invoiceId ? state.purchaseInvoices?.[r.invoiceId] : undefined
    const target = r.purchaseId ? refOf('purchases', r.purchaseId) : inv ? (inv.basis === 'standalone' ? refOf('purchaseInvoices', inv.id) : inv.purchaseId ? refOf('purchases', inv.purchaseId) : '') : ''
    const d = target ? docs.get(target) : undefined
    if (d) d.returned = round2(d.returned + net)
    else addCredit(r.supplierId, net)
  }

  const bySupplier: Record<string, SupplierDues> = {}
  const ensure = (id: string): SupplierDues => (bySupplier[id] ??= { supplierId: id, docs: [], outstanding: 0, advance: 0, net: 0, oldestDue: null })
  for (const d of docs.values()) {
    const left = round2(d.amount - d.paidAtSource - d.settled - d.returned)
    d.outstanding = Math.max(0, left)
    if (left < 0) addCredit(d.supplierId, -left)
    ensure(d.supplierId).docs.push(d)
  }
  for (const [id, c] of credit) ensure(id).advance = c
  let total = 0
  for (const s of Object.values(bySupplier)) {
    s.docs.sort((a, b) => a.date - b.date)
    s.outstanding = round2(s.docs.reduce((t, d) => t + d.outstanding, 0))
    s.net = round2(s.outstanding - s.advance)
    const open = s.docs.filter((d) => d.outstanding > 0 && d.dueDate !== null)
    s.oldestDue = open.length ? Math.min(...open.map((d) => d.dueDate as number)) : null
    if (s.net > 0) total = round2(total + s.net)
  }
  return { bySupplier, total }
}

/** What we owe one supplier now (0 when there is no activity; negative = paid in advance). */
export const netOwed = (p: Payables, supplierId: string) => p.bySupplier[supplierId]?.net ?? 0

/** Splits a payment over a supplier's unsettled documents, oldest first. Whatever is left becomes an advance. */
export function allocateOldestFirst(open: Array<Pick<PayableDoc, 'ref' | 'outstanding' | 'date'>>, amount: number): { allocations: Array<{ ref: PayableRef; amount: number }>; advance: number } {
  let left = round2(amount)
  const allocations: Array<{ ref: PayableRef; amount: number }> = []
  for (const d of [...open].filter((x) => x.outstanding > 0).sort((x, y) => x.date - y.date)) {
    if (left <= 0) break
    const take = Math.min(left, d.outstanding)
    allocations.push({ ref: d.ref, amount: round2(take) })
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

export const daysOverdue = (dueDate: number, asOf: number) => Math.floor((asOf - dueDate) / DAY)
const bucketOf = (days: number): BucketKey => AGE_BUCKETS.find((b) => days >= b.from && days <= b.to)!.key
const emptyBuckets = (): Record<BucketKey, number> => ({ notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 })

/** A document still owed after the supplier's advance is applied to the oldest ones first. */
export interface OpenDoc extends PayableDoc { owed: number; days: number }

export function openDocs(dues: SupplierDues, asOf: number): OpenDoc[] {
  let credit = dues.advance
  const out: OpenDoc[] = []
  for (const d of [...dues.docs].filter((x) => x.outstanding > 0).sort((x, y) => (x.dueDate ?? Infinity) - (y.dueDate ?? Infinity))) {
    const use = Math.min(credit, d.outstanding)
    credit = round2(credit - use)
    const owed = round2(d.outstanding - use)
    if (owed > 0) out.push({ ...d, owed, days: d.dueDate === null ? 0 : daysOverdue(d.dueDate, asOf) })
  }
  return out
}

export interface AgingRow { supplierId: string; buckets: Record<BucketKey, number>; total: number; advance: number; oldestDaysOverdue: number }
export interface AgingReport { asOf: number; rows: AgingRow[]; totals: Record<BucketKey, number>; total: number }

/** Payables by how late they are, biggest debts first. */
export function agingReport(state: DataState, asOf: number, pay: Payables = payables(state)): AgingReport {
  const rows: AgingRow[] = []
  const totals = emptyBuckets()
  for (const s of Object.values(pay.bySupplier)) {
    const buckets = emptyBuckets()
    let oldest = 0
    for (const d of openDocs(s, asOf)) {
      buckets[bucketOf(d.days)] = round2(buckets[bucketOf(d.days)] + d.owed)
      oldest = Math.max(oldest, d.days)
    }
    const total = round2(Object.values(buckets).reduce((t, v) => t + v, 0))
    if (total <= 0) continue
    rows.push({ supplierId: s.supplierId, buckets, total, advance: s.advance, oldestDaysOverdue: Math.max(0, oldest) })
    for (const k of Object.keys(buckets) as BucketKey[]) totals[k] = round2(totals[k] + buckets[k])
  }
  rows.sort((a, b) => b.total - a.total)
  return { asOf, rows, totals, total: round2(Object.values(totals).reduce((t, v) => t + v, 0)) }
}

// ───────────────────────────── what falls due ─────────────────────────────

export type DueWhen = 'overdue' | 'soon' | 'later'
export interface DueItem { supplierId: string; ref: PayableRef; no: string; kind: PayableDoc['kind']; dueDate: number; owed: number; days: number; when: DueWhen }

/** Everything we owe with a due date, soonest first: late ones, ones falling due within `within` days, and the rest. */
export function dueList(state: DataState, asOf: number, within = settingsOf(state).remindDays, pay: Payables = payables(state)): DueItem[] {
  const out: DueItem[] = []
  for (const s of Object.values(pay.bySupplier)) {
    for (const d of openDocs(s, asOf)) {
      if (d.dueDate === null) continue
      const when: DueWhen = d.dueDate < startOfDayOf(asOf) ? 'overdue' : d.dueDate <= asOf + within * DAY ? 'soon' : 'later'
      out.push({ supplierId: d.supplierId, ref: d.ref, no: d.no, kind: d.kind, dueDate: d.dueDate, owed: d.owed, days: d.days, when })
    }
  }
  return out.sort((a, b) => a.dueDate - b.dueDate)
}
const startOfDayOf = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime()

export interface DueSummary { overdue: { suppliers: number; docs: number; amount: number }; soon: { suppliers: number; docs: number; amount: number } }

export function dueSummary(state: DataState, asOf: number, within?: number): DueSummary {
  const items = dueList(state, asOf, within)
  const pick = (w: DueWhen) => {
    const x = items.filter((i) => i.when === w)
    return { suppliers: new Set(x.map((i) => i.supplierId)).size, docs: x.length, amount: round2(x.reduce((t, i) => t + i.owed, 0)) }
  }
  return { overdue: pick('overdue'), soon: pick('soon') }
}

// ───────────────────────────── the supplier's ledger ─────────────────────────────

export type StatementKind = 'receipt' | 'invoice' | 'charges' | 'payment' | 'return' | 'paid-at-receipt'
export interface StatementEntry {
  date: number
  kind: StatementKind
  ref: string
  memo: string
  /** Added to what we owe. */
  added: number
  /** Taken off. */
  reduced: number
  balance: number
  docId: string
}
export interface Statement { supplierId: string; from: number; to: number; opening: number; entries: StatementEntry[]; closing: number; totalAdded: number; totalReduced: number }

type Move = Omit<StatementEntry, 'balance'>

function movesOf(state: DataState, supplierId: string): Move[] {
  const out: Move[] = []
  for (const p of listOf(state.purchases)) {
    if (p.supplierId !== supplierId) continue
    out.push({ date: p.date, kind: 'receipt', ref: p.no, memo: p.invoiceRef ? `Goods received · bill ${p.invoiceRef}` : 'Goods received', added: p.total, reduced: 0, docId: p.id })
    if (p.paid > 0) out.push({ date: p.date, kind: 'paid-at-receipt', ref: p.no, memo: 'Paid when the goods arrived', added: 0, reduced: p.paid, docId: p.id })
  }
  for (const i of live(listOf(state.purchaseInvoices))) {
    if (i.supplierId !== supplierId || i.payable <= 0) continue
    out.push({ date: i.invoiceDate, kind: 'invoice', ref: i.invoiceNo || i.no, memo: i.basis === 'receipt-net' ? 'GST on the goods received' : `Invoice ${i.invoiceNo}`, added: i.payable, reduced: 0, docId: i.id })
  }
  for (const l of live(listOf(state.landedCosts))) {
    if (l.payeeId !== supplierId) continue
    out.push({ date: l.date, kind: 'charges', ref: l.no, memo: 'Freight / duty / handling', added: l.total, reduced: 0, docId: l.id })
  }
  for (const pay of live(listOf(state.supplierPayments))) {
    if (pay.supplierId !== supplierId) continue
    out.push({ date: pay.date, kind: 'payment', ref: pay.no, memo: `Paid by ${pay.mode}${pay.ref ? ` (${pay.ref})` : ''}`, added: 0, reduced: pay.amount, docId: pay.id })
  }
  for (const r of live(listOf(state.purchaseReturns))) {
    if (r.supplierId !== supplierId) continue
    out.push({ date: r.date, kind: 'return', ref: r.no, memo: 'Debit note — goods returned', added: 0, reduced: round2(r.total - r.refund), docId: r.id })
  }
  return out.sort((a, b) => a.date - b.date)
}

/** A supplier's account between two dates: what we owed at the start, every movement, and what we owe at the end. */
export function supplierStatement(state: DataState, supplierId: string, from: number, to: number): Statement {
  let balance = round2(state.suppliers[supplierId]?.openingBalance ?? 0)
  let opening = balance
  const entries: StatementEntry[] = []
  for (const m of movesOf(state, supplierId)) {
    if (m.date < from) { balance = round2(balance + m.added - m.reduced); opening = balance; continue }
    if (m.date > to) continue
    balance = round2(balance + m.added - m.reduced)
    entries.push({ ...m, balance })
  }
  return {
    supplierId, from, to, opening, entries, closing: balance,
    totalAdded: round2(entries.reduce((s, e) => s + e.added, 0)), totalReduced: round2(entries.reduce((s, e) => s + e.reduced, 0)),
  }
}

/** Payments to suppliers, newest first (cancelled ones included, marked by the screen). */
export const paymentsList = (state: DataState, supplierId?: string) =>
  listOf(state.supplierPayments).filter((p) => !p.reverses && (!supplierId || p.supplierId === supplierId)).sort((a, b) => b.date - a.date)
