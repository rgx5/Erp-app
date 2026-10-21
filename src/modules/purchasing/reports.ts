import { toCsv } from '@/domain/csv'
import { fmtDayShort } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import type { DataState } from '@/data/state'
import { itcRegister } from './itc'
import { AGE_BUCKETS, agingReport, dueList, type DueItem, type Statement } from './payables'
import type { SupplierPayment } from './types'

/** The payables ageing as CSV (one row per supplier, buckets across). */
export function agingCsv(state: DataState, asOf: number): string {
  const rep = agingReport(state, asOf)
  const head = ['Supplier', 'Phone', ...AGE_BUCKETS.map((b) => b.label), 'Total', 'Advance held', 'Oldest overdue (days)']
  const rows = rep.rows.map((r) => {
    const s = state.suppliers[r.supplierId]
    return [s?.name ?? r.supplierId, s?.phone ?? '', ...AGE_BUCKETS.map((b) => r.buckets[b.key]), r.total, r.advance, r.oldestDaysOverdue]
  })
  rows.push(['Total', '', ...AGE_BUCKETS.map((b) => rep.totals[b.key]), rep.total, '', ''])
  return toCsv([head, ...rows])
}

/** A supplier's account as CSV. */
export function statementCsv(state: DataState, st: Statement): string {
  const name = state.suppliers[st.supplierId]?.name ?? st.supplierId
  return toCsv([
    ['Ledger of', name, 'from', fmtDayShort(st.from), 'to', fmtDayShort(st.to)],
    ['Date', 'Document', 'Details', 'Added to what we owe', 'Taken off', 'Balance'],
    ['', '', 'Opening balance', '', '', st.opening],
    ...st.entries.map((e) => [fmtDayShort(e.date), e.ref, e.memo, e.added || '', e.reduced || '', e.balance]),
    ['', '', 'Closing balance', st.totalAdded, st.totalReduced, st.closing],
  ])
}

/** Payments falling due, for the planner. */
export function dueCsv(state: DataState, asOf: number): string {
  const rows = dueList(state, asOf).map((d: DueItem) => [state.suppliers[d.supplierId]?.name ?? d.supplierId, d.no, fmtDayShort(d.dueDate), d.when === 'overdue' ? `${d.days} days late` : d.when === 'soon' ? 'due soon' : 'later', d.owed])
  return toCsv([['Supplier', 'Document', 'Due', 'Status', 'Amount'], ...rows])
}

/** The ITC register as CSV, one row per purchase invoice with its tax heads and whether credit may be claimed. */
export function itcCsv(state: DataState, from: number, to: number): string {
  const r = itcRegister(state, from, to)
  const rows = r.rows.map((x) => [x.supplier, x.gstin, x.invoiceNo, fmtDayShort(x.date), x.taxable, x.tax.cgst, x.tax.sgst, x.tax.igst, x.eligible ? 'Yes' : 'No', x.reason, fmtDayShort(x.deadline)])
  return toCsv([
    ['Supplier', 'GSTIN', 'Invoice no.', 'Invoice date', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Credit claimable', 'Why not', 'Claim by'],
    ...rows,
    [],
    ['Credit to claim', '', '', '', '', r.eligible.cgst, r.eligible.sgst, r.eligible.igst],
    ['Credit given back (returns)', '', '', '', '', r.reversed.cgst, r.reversed.sgst, r.reversed.igst],
    ['Net credit', '', '', '', '', r.net.cgst, r.net.sgst, r.net.igst],
    ['Tax with no credit', '', '', '', '', r.blocked.cgst, r.blocked.sgst, r.blocked.igst],
  ])
}

/** Words to send a supplier after paying them (remittance advice). Nothing is sent from here; the person presses send. */
export function paymentAdviceText(state: DataState, p: SupplierPayment): string {
  const shop = state.store?.name || 'We'
  const s = state.suppliers[p.supplierId]
  const against = p.allocations.map((a) => {
    const id = a.ref.split(':')[1]
    const no = a.ref.startsWith('purchases:') ? state.purchases[id]?.invoiceRef || state.purchases[id]?.no : a.ref.startsWith('purchaseInvoices:') ? state.purchaseInvoices[id]?.invoiceNo : a.ref.startsWith('landedCosts:') ? state.landedCosts[id]?.no : 'opening balance'
    return `${no ?? 'bill'} ${inr(a.amount, 0)}`
  })
  return [
    `Dear ${s?.name ?? 'supplier'}, ${shop} has paid you ${inr(p.amount, 0)} on ${fmtDayShort(p.date)} by ${p.mode}${p.ref ? ` (${p.ref})` : ''}.`,
    against.length ? `Against: ${against.join(', ')}.` : '',
    p.advance > 0 ? `${inr(p.advance, 0)} is kept as an advance.` : '',
    `Receipt no. ${p.no}. Thank you.`,
  ].filter(Boolean).join('\n')
}

/** A supplier's account as plain text for WhatsApp / SMS. */
export function statementText(state: DataState, st: Statement, max = 12): string {
  const shop = state.store?.name || 'Ledger'
  const name = state.suppliers[st.supplierId]?.name ?? ''
  const shown = st.entries.slice(-max)
  return [
    `${shop} — our account with ${name}`, `${fmtDayShort(st.from)} to ${fmtDayShort(st.to)}`, `Opening: ${inr(st.opening, 0)}`,
    ...(shown.length < st.entries.length ? [`… ${st.entries.length - shown.length} earlier entries`] : []),
    ...shown.map((e) => `${fmtDayShort(e.date)}  ${e.ref}  ${e.added ? `+${inr(e.added, 0)}` : `−${inr(e.reduced, 0)}`}`),
    `We owe: ${inr(st.closing, 0)}`,
  ].join('\n')
}

/** Money owed to suppliers: total, how much is late and to how many. */
export function payablesSummary(state: DataState, asOf: number): { total: number; overdue: number; suppliers: number; overdueSuppliers: number } {
  const rep = agingReport(state, asOf)
  return { total: rep.total, overdue: round2(rep.total - rep.totals.notDue), suppliers: rep.rows.length, overdueSuppliers: rep.rows.filter((r) => r.total - r.buckets.notDue > 0).length }
}

