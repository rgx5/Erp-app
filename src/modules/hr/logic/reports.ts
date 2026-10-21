import { listOf, type DataState } from '@/data/state'
import type { CsvCell } from '@/domain/csv'
import { round2 } from '@/domain/money'
import type { ScorecardRow } from './targets'
import { advanceStandings } from './advances'
import { claimRows, CLAIM_LABEL } from './claims'
import { balancesFor } from './leave'
import { buildIndex, employeeMonth, employedIn } from './select'
import { hrSettings } from './settings'
import { livePayslips, paidOf } from './slips'
import { scorecards } from './targets'
import { firstOf, labelYM, labelYMD, lastOf } from './ymd'
import type { Payslip, YM, YMD } from '../types'

/** A report as plain rows: the screen, the CSV and the printed page are all made from one of these. */
export interface HrTable {
  title: string
  subtitle?: string
  columns: Array<{ label: string; align?: 'left' | 'right' }>
  rows: CsvCell[][]
  /** Indexes into `rows` shown in bold (totals). */
  bold?: number[]
}

const L = (label: string): { label: string } => ({ label })
const R = (label: string): { label: string; align: 'right' } => ({ label, align: 'right' })
const sumBy = (slips: Payslip[], f: (p: Payslip) => number) => round2(slips.reduce((t, p) => t + f(p), 0))
const ded = (p: Payslip, key: string) => round2(p.deductions.filter((d) => d.key === key).reduce((t, d) => t + d.amount, 0))

/** Who was present, on leave, late… for every employee in a month. */
export function attendanceSheetTable(state: DataState, month: YM, now: number): HrTable {
  const idx = buildIndex(state)
  const rows: CsvCell[][] = employedIn(state, firstOf(month), lastOf(month)).map((e) => {
    const { summary: s } = employeeMonth(state, idx, e, month, now)
    return [e.code, e.name, s.presentDays, s.paidLeaveDays, s.unpaidLeaveDays, s.holidayDays + s.weekoffDays, s.absentDays + s.unmarkedDays, s.lateCount, round2(s.overtimeMins / 60), s.lopDays]
  })
  return {
    title: `Attendance ${labelYM(month)}`, columns: [L('Code'), L('Name'), R('Present'), R('Paid leave'), R('Unpaid leave'), R('Off days'), R('Absent'), R('Late'), R('OT hours'), R('Loss of pay')], rows,
  }
}

/** Every payslip of a month with its deductions, and whether it was paid. */
export function payrollRegisterTable(state: DataState, month: YM): HrTable {
  const slips = livePayslips(state).filter((p) => p.month === month).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
  const rows: CsvCell[][] = slips.map((p) => [
    p.employeeCode, p.employeeName, round2(p.basisDays - p.lopDays), p.gross, ded(p, 'pf'), ded(p, 'esi'), ded(p, 'pt'), ded(p, 'tds'), ded(p, 'advance'), ded(p, 'other'), p.net,
    paidOf(state, p.id) >= p.net ? 'Paid' : 'To pay',
  ])
  if (slips.length) rows.push(['', 'Total', '', sumBy(slips, (p) => p.gross), sumBy(slips, (p) => ded(p, 'pf')), sumBy(slips, (p) => ded(p, 'esi')), sumBy(slips, (p) => ded(p, 'pt')), sumBy(slips, (p) => ded(p, 'tds')), sumBy(slips, (p) => ded(p, 'advance')), sumBy(slips, (p) => ded(p, 'other')), sumBy(slips, (p) => p.net), ''])
  return {
    title: `Payroll register ${labelYM(month)}`, columns: [L('Code'), L('Name'), R('Paid days'), R('Gross'), R('PF'), R('ESI'), R('PT'), R('TDS'), R('Advances'), R('Other'), R('Net pay'), L('Status')],
    rows, bold: slips.length ? [rows.length - 1] : [],
  }
}

/** What is owed to the PF office, the ESI office and the tax departments for a month (employee's share plus employer's). */
export function statutoryTable(state: DataState, month: YM): HrTable {
  const slips = livePayslips(state).filter((p) => p.month === month).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
  const rows: CsvCell[][] = slips.map((p) => [p.employeeName, ded(p, 'pf'), p.employerPf, ded(p, 'esi'), p.employerEsi, ded(p, 'pt'), ded(p, 'tds')])
  if (slips.length) rows.push(['Total', sumBy(slips, (p) => ded(p, 'pf')), sumBy(slips, (p) => p.employerPf), sumBy(slips, (p) => ded(p, 'esi')), sumBy(slips, (p) => p.employerEsi), sumBy(slips, (p) => ded(p, 'pt')), sumBy(slips, (p) => ded(p, 'tds'))])
  return { title: `PF, ESI, PT and TDS ${labelYM(month)}`, subtitle: 'At the rates set in Payroll settings. Not tax or legal advice.', columns: [L('Name'), R('PF (employee)'), R('PF (employer)'), R('ESI (employee)'), R('ESI (employer)'), R('Prof. tax'), R('TDS')], rows, bold: slips.length ? [rows.length - 1] : [] }
}

export interface BankExport { rows: CsvCell[][]; total: number; people: number; /** People with neither account details nor UPI. */ missing: string[] }

/** A transfer list for the bank: one line per unpaid payslip. Banks differ in layout — this is the common set of columns. */
export function bankExport(state: DataState, month: YM): BankExport {
  const rows: CsvCell[][] = [['Sr', 'Employee code', 'Beneficiary name', 'Account number', 'IFSC', 'Bank', 'UPI id', 'Amount', 'Narration']]
  const missing: string[] = []
  let total = 0
  let n = 0
  for (const p of livePayslips(state).filter((x) => x.month === month && x.net > 0).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))) {
    if (paidOf(state, p.id) >= p.net) continue
    const b = state.employeePay?.[p.employeeId]?.bank
    if (!b || (!b.account && !b.upi)) { missing.push(p.employeeName); continue }
    rows.push([++n, p.employeeCode, b.holder || p.employeeName, b.account, b.ifsc, b.bankName, b.upi, p.net, `Salary ${labelYM(month)}`])
    total += p.net
  }
  return { rows, total: round2(total), people: n, missing }
}

export function leaveBalanceTable(state: DataState, asOf: YMD): HrTable {
  const idx = buildIndex(state)
  const types = listOf(state.leaveTypes ?? {}).filter((t) => t.active && t.paid).sort((a, b) => a.name.localeCompare(b.name))
  const start = hrSettings(state).leaveYearStartMonth
  const rows: CsvCell[][] = employedIn(state, asOf, asOf).map((e) => {
    const bal = balancesFor(state, idx, e, asOf, start)
    return [e.code, e.name, ...types.map((t) => bal.find((b) => b.type.id === t.id)?.balance.balance ?? 0)]
  })
  return { title: `Leave balances at ${labelYMD(asOf)}`, columns: [L('Code'), L('Name'), ...types.map((t) => R(t.name))], rows }
}

export function claimsTable(state: DataState): HrTable {
  const rows: CsvCell[][] = claimRows(state).map((r) => [r.claim.no, r.claim.date, state.employees?.[r.claim.employeeId]?.name ?? '—', r.claim.category, r.claim.amount, r.approved || '', CLAIM_LABEL[r.status]])
  return { title: 'Expense claims', columns: [L('No.'), L('Date'), L('Employee'), L('Category'), R('Claimed'), R('Approved'), L('Status')], rows }
}

export function advancesTable(state: DataState): HrTable {
  const list = advanceStandings(state)
  const rows: CsvCell[][] = list.map((s) => [s.advance.no, state.employees?.[s.advance.employeeId]?.name ?? '—', s.advance.kind === 'loan' ? 'Loan' : 'Advance', s.advance.amount, s.advance.installments, s.recovered, s.repaid, s.balance])
  if (list.length) rows.push(['Total', '', '', round2(list.reduce((t, s) => t + s.advance.amount, 0)), '', round2(list.reduce((t, s) => t + s.recovered, 0)), round2(list.reduce((t, s) => t + s.repaid, 0)), round2(list.reduce((t, s) => t + s.balance, 0))])
  return { title: 'Advances and loans', columns: [L('No.'), L('Employee'), L('Kind'), R('Given'), R('Instalments'), R('Taken from pay'), R('Paid back'), R('Still to come')], rows, bold: list.length ? [rows.length - 1] : [] }
}

export function scorecardTable(cards: ScorecardRow[], month: YM): HrTable {
  const rows: CsvCell[][] = cards.map((c) => [c.employee.name, c.sales, c.bills, c.target || '', c.achievementPct ?? '', c.incentive.amount, c.attendancePct ?? '', c.lateCount])
  return { title: `Scorecards ${labelYM(month)}`, columns: [L('Name'), R('Sales (excl. GST)'), R('Bills'), R('Target'), R('Achieved %'), R('Incentive'), R('Attendance %'), R('Late')], rows }
}
export const scorecardTableFor = (state: DataState, month: YM, now: number) => scorecardTable(scorecards(state, month, now), month)

export const tableCsvRows = (t: HrTable): CsvCell[][] => [t.columns.map((c) => c.label), ...t.rows]
