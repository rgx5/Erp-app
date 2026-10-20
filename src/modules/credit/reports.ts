import { toCsv } from '@/domain/csv'
import { fmtDayShort } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import type { DataState } from '@/data/state'
import { AGE_BUCKETS, agingReport, customerStatement, type Statement } from './logic'

/** The ageing report as CSV rows (one per customer, buckets across), ready for `toCsv`. */
export function agingCsv(state: DataState, asOf: number): string {
  const rep = agingReport(state, asOf)
  const head = ['Customer', 'Phone', ...AGE_BUCKETS.map((b) => b.label), 'Total', 'Advance held', 'Oldest overdue (days)']
  const rows = rep.rows.map((r) => {
    const c = state.customers[r.customerId]
    return [c?.name ?? r.customerId, c?.phone ?? '', ...AGE_BUCKETS.map((b) => r.buckets[b.key]), r.total, r.advance, r.oldestDaysOverdue]
  })
  rows.push(['Total', '', ...AGE_BUCKETS.map((b) => rep.totals[b.key]), rep.total, '', ''])
  return toCsv([head, ...rows])
}

/** A statement as CSV. */
export function statementCsv(state: DataState, st: Statement): string {
  const name = state.customers[st.customerId]?.name ?? st.customerId
  return toCsv([
    ['Statement of', name, 'from', fmtDayShort(st.from), 'to', fmtDayShort(st.to)],
    ['Date', 'Document', 'Details', 'Debit (owed)', 'Credit (paid)', 'Balance'],
    ['', '', 'Opening balance', '', '', st.opening],
    ...st.entries.map((e) => [fmtDayShort(e.date), e.ref, e.memo, e.debit || '', e.credit || '', e.balance]),
    ['', '', 'Closing balance', st.totalDebit, st.totalCredit, st.closing],
  ])
}

/** A statement as plain text, for WhatsApp / SMS (keeps the last `max` lines). */
export function statementText(state: DataState, st: Statement, max = 12): string {
  const shop = state.store?.name || 'Statement'
  const name = state.customers[st.customerId]?.name ?? ''
  const shown = st.entries.slice(-max)
  const lines = [
    `${shop} — statement for ${name}`,
    `${fmtDayShort(st.from)} to ${fmtDayShort(st.to)}`,
    `Opening: ${inr(st.opening, 0)}`,
    ...(shown.length < st.entries.length ? [`… ${st.entries.length - shown.length} earlier entries`] : []),
    ...shown.map((e) => `${fmtDayShort(e.date)}  ${e.ref}  ${e.debit ? `+${inr(e.debit, 0)}` : `−${inr(e.credit, 0)}`}`),
    `You owe: ${inr(st.closing, 0)}`,
  ]
  return lines.join('\n')
}

/** Convenience for the screens: a customer's statement for the last `days` days. */
export const recentStatement = (state: DataState, customerId: string, now: number, days = 90) => customerStatement(state, customerId, now - days * 86_400_000, now)

/** Dues, expressed as the cash the shop is waiting for: what is owed, how much is late, and how many customers are late. */
export function receivablesSummary(state: DataState, asOf: number): { total: number; overdue: number; customers: number; overdueCustomers: number } {
  const rep = agingReport(state, asOf)
  const overdue = round2(rep.total - rep.totals.notDue)
  return { total: rep.total, overdue, customers: rep.rows.length, overdueCustomers: rep.rows.filter((r) => r.total - r.buckets.notDue > 0).length }
}
