import { listOf, type DataState } from '@/data/state'
import type { Employee, EmployeePay, HrSettings, Payslip, PayAdjustment, SlipLine, YM } from '../types'
import { advanceStandings, planRecoveries, type AdvanceStanding, type PlannedRecovery } from './advances'
import type { MonthSummary } from './attendance'
import { buildIndex, employeeMonth, employedIn } from './select'
import { hrSettings } from './settings'
import { consumedAdjustmentIds, liveSlipFor, paidOf } from './slips'
import { firstOf, lastOf } from './ymd'

const r2 = (n: number) => Math.round(n * 100) / 100

// ───────────────────────────── statutory pieces ─────────────────────────────

/** PF on a wage, to the nearest rupee, capped at the ceiling when the cap is on. Returns the employee's and employer's share. */
export function providentFund(wage: number, s: Pick<HrSettings, 'pfEmployeePct' | 'pfEmployerPct' | 'pfWageCeiling' | 'pfCap'>) {
  const base = s.pfCap ? Math.min(wage, s.pfWageCeiling) : wage
  if (!(base > 0)) return { wage: 0, employee: 0, employer: 0 }
  return { wage: r2(base), employee: Math.round((base * s.pfEmployeePct) / 100), employer: Math.round((base * s.pfEmployerPct) / 100) }
}

/** ESI is rounded up to the next rupee. Applies only while the contractual wage is within the ceiling. */
export function stateInsurance(contractWage: number, wage: number, s: Pick<HrSettings, 'esiEmployeePct' | 'esiEmployerPct' | 'esiWageCeiling'>) {
  if (!(wage > 0) || contractWage > s.esiWageCeiling) return { employee: 0, employer: 0, covered: false }
  const up = (n: number) => Math.ceil(Math.round(n * 1000) / 1000)
  return { employee: up((wage * s.esiEmployeePct) / 100), employer: up((wage * s.esiEmployerPct) / 100), covered: true }
}

/** Professional tax for a month's gross: the first slab it fits under. */
export function professionalTax(gross: number, slabs: HrSettings['ptSlabs']): number {
  for (const sl of slabs) if (sl.upTo === null || gross <= sl.upTo) return sl.amount
  return 0
}

/** Yearly income tax on a taxable income by slabs, less the rebate, plus cess. */
export function annualTax(taxable: number, s: Pick<HrSettings, 'tdsSlabs' | 'tdsRebateLimit' | 'tdsCessPct'>): number {
  if (!(taxable > 0) || taxable <= s.tdsRebateLimit) return 0
  let tax = 0
  let from = 0
  for (const sl of s.tdsSlabs) {
    const to = sl.upTo ?? Infinity
    if (taxable > from) tax += (Math.min(taxable, to) - from) * (sl.ratePct / 100)
    from = to
    if (taxable <= to) break
  }
  return r2(tax * (1 + s.tdsCessPct / 100))
}

/** An estimate of the monthly TDS on salary from the yearly pay, on the assumption the pay stays the same all year. */
export function estimateMonthlyTds(annualGross: number, s: Pick<HrSettings, 'tdsSlabs' | 'tdsRebateLimit' | 'tdsCessPct' | 'tdsStandardDeduction'>): number {
  return Math.round(annualTax(Math.max(0, annualGross - s.tdsStandardDeduction), s) / 12)
}

// ───────────────────────────── one payslip ─────────────────────────────

export interface PayrollInput {
  employee: Pick<Employee, 'id'>
  pay: EmployeePay
  month: YM
  settings: HrSettings
  summary: MonthSummary
  /** Adjustments for this person and month that no payslip has used yet. */
  adjustments: PayAdjustment[]
  /** This person's advances and loans. */
  advances: AdvanceStanding[]
}

export interface PayrollResult {
  basisDays: number
  daysInMonth: number
  presentDays: number
  paidLeaveDays: number
  holidayDays: number
  weekoffDays: number
  lopDays: number
  overtimeHours: number
  earnings: SlipLine[]
  deductions: SlipLine[]
  employerPf: number
  employerEsi: number
  gross: number
  totalDeductions: number
  roundOff: number
  net: number
  recoveries: PlannedRecovery[]
  adjustmentIds: string[]
  warnings: string[]
}

/** A month's pay for one person from their pay terms, attendance, adjustments and advances. Pure; the same inputs always give the same slip. */
export function computePayslip(inp: PayrollInput): PayrollResult {
  const { pay, settings: st, summary: s } = inp
  const warnings: string[] = []
  const basis = st.daysBasis === 'fixed30' ? 30 : s.days
  const payable = Math.min(basis, Math.max(0, basis - s.lopDays - s.notEmployedDays))
  const allowSum = pay.allowances.reduce((t, a) => t + a.amount, 0)

  const earnings: SlipLine[] = []
  let units = 0
  if (pay.payType === 'monthly') {
    const f = payable / basis
    earnings.push({ key: 'basic', label: 'Basic', amount: r2(pay.basic * f), full: pay.basic })
    for (const a of pay.allowances) earnings.push({ key: 'allowance', label: a.name, amount: r2(a.amount * f), full: a.amount })
  } else {
    units = pay.payType === 'daily'
      ? r2(s.presentDays + s.paidLeaveDays + s.holidayDays + (st.payWeekoffForDaily ? s.weekoffDays : 0))
      : r2(s.workedMins / 60)
    const unit = pay.payType === 'daily' ? 'days' : 'hours'
    earnings.push({ key: 'basic', label: `Wages (${units} ${unit} × ₹${pay.basic})`, amount: r2(pay.basic * units) })
    for (const a of pay.allowances) earnings.push({ key: 'allowance', label: `${a.name} (${units} × ₹${a.amount})`, amount: r2(a.amount * units) })
  }
  const basicEarned = earnings[0].amount
  const allowEarned = r2(earnings.slice(1).reduce((t, l) => t + l.amount, 0))

  // Overtime: beyond the shift, at the normal hourly rate times the multiplier.
  let overtimeHours = 0
  if (pay.overtimeEligible && pay.payType !== 'hourly' && s.overtimeMins > 0) {
    overtimeHours = r2(s.overtimeMins / 60)
    const dayHours = st.workDayMins / 60
    const hourly = pay.payType === 'monthly' ? (pay.basic + allowSum) / basis / dayHours : (pay.basic + allowSum) / dayHours
    earnings.push({ key: 'overtime', label: `Overtime (${overtimeHours} h × ${st.overtimeMultiplier})`, amount: r2(overtimeHours * hourly * st.overtimeMultiplier) })
  }

  const deductions: SlipLine[] = []
  const adjustmentIds: string[] = []
  for (const a of inp.adjustments) {
    adjustmentIds.push(a.id)
    if (a.kind === 'deduction') deductions.push({ key: 'other', label: a.label, amount: r2(a.amount) })
    else earnings.push({ key: a.kind, label: a.label, amount: r2(a.amount) })
  }
  const gross = r2(earnings.reduce((t, l) => t + l.amount, 0))

  // PF
  let employerPf = 0
  if (pay.pf) {
    const pf = providentFund(st.pfBasis === 'basic' ? basicEarned : basicEarned + allowEarned, st)
    employerPf = pf.employer
    if (pf.employee) deductions.push({ key: 'pf', label: 'Provident fund', amount: pf.employee })
  }
  // ESI
  let employerEsi = 0
  if (pay.esi) {
    const contract = pay.payType === 'monthly' ? pay.basic + allowSum : gross
    const e = stateInsurance(contract, gross, st)
    employerEsi = e.employer
    if (e.employee) deductions.push({ key: 'esi', label: 'ESI', amount: e.employee })
    if (!e.covered && gross > 0) warnings.push('ESI does not apply: the wage is above the ESI limit.')
  }
  // Professional tax
  if (pay.pt) { const pt = professionalTax(gross, st.ptSlabs); if (pt) deductions.push({ key: 'pt', label: 'Professional tax', amount: pt }) }
  // Income tax
  if (pay.tds) {
    const annual = (pay.payType === 'monthly' ? pay.basic + allowSum : gross) * 12
    const tds = pay.tdsMonthly !== undefined && pay.tdsMonthly !== null ? Math.max(0, r2(pay.tdsMonthly)) : estimateMonthlyTds(annual, st)
    if (tds) deductions.push({ key: 'tds', label: pay.tdsMonthly !== undefined && pay.tdsMonthly !== null ? 'TDS' : 'TDS (estimate)', amount: Math.min(tds, gross) })
  }

  // Advances and loans: only what the pay can bear.
  const before = r2(deductions.reduce((t, l) => t + l.amount, 0))
  const recoveries = planRecoveries(inp.advances, inp.month, gross - before)
  for (const r of recoveries) deductions.push({ key: 'advance', label: r.label, amount: r.amount })

  const totalDeductions = r2(deductions.reduce((t, l) => t + l.amount, 0))
  const exact = r2(gross - totalDeductions)
  const net = st.roundNet ? Math.round(exact) : exact
  if (exact < 0) warnings.push('Deductions are more than the pay for this month.')
  if (s.unmarkedDays > 0) warnings.push(`${s.unmarkedDays} ${s.unmarkedDays === 1 ? 'day is' : 'days are'} not marked and counted as absent.`)
  if (s.incompleteCount > 0) warnings.push(`${s.incompleteCount} ${s.incompleteCount === 1 ? 'day has' : 'days have'} a punch-in with no punch-out.`)
  if (pay.payType === 'monthly' && payable === 0) warnings.push('No paid days this month.')

  return {
    basisDays: basis, daysInMonth: s.days, presentDays: s.presentDays, paidLeaveDays: s.paidLeaveDays, holidayDays: s.holidayDays, weekoffDays: s.weekoffDays, lopDays: s.lopDays,
    overtimeHours, earnings, deductions, employerPf, employerEsi, gross, totalDeductions, roundOff: r2(net - exact), net, recoveries, adjustmentIds, warnings,
  }
}

// ───────────────────────────── a month for everyone ─────────────────────────────

export interface PayrollRow {
  employee: Employee
  pay?: EmployeePay
  summary: MonthSummary
  result?: PayrollResult
  /** The payslip that already stands for this month. */
  existing?: Payslip
  paid: number
  /** Why this person cannot be run. */
  problem?: string
  warnings: string[]
}

/** Everyone employed in the month, with the payslip they would get (or the one they already have). */
export function payrollPreview(state: DataState, month: YM, now: number): PayrollRow[] {
  const settings = hrSettings(state)
  const idx = buildIndex(state)
  const used = consumedAdjustmentIds(state)
  const adjustments = listOf(state.payAdjustments ?? {}).filter((a) => a.month === month && !used.has(a.id))
  const standings = advanceStandings(state)
  return employedIn(state, firstOf(month), lastOf(month)).map((employee) => {
    const { summary } = employeeMonth(state, idx, employee, month, now)
    const pay = state.employeePay?.[employee.id]
    const existing = liveSlipFor(state, employee.id, month)
    const base = { employee, pay, summary, existing, paid: existing ? paidOf(state, existing.id) : 0 }
    if (existing) return { ...base, warnings: [] }
    if (!pay) return { ...base, problem: 'No pay terms set yet.', warnings: [] }
    const result = computePayslip({
      employee, pay, month, settings, summary,
      adjustments: adjustments.filter((a) => a.employeeId === employee.id),
      advances: standings.filter((x) => x.advance.employeeId === employee.id),
    })
    return { ...base, result, warnings: result.warnings, problem: result.net < 0 ? 'Deductions are more than the pay.' : undefined }
  })
}

export function payrollTotals(rows: PayrollRow[]) {
  let gross = 0, deductions = 0, net = 0, employer = 0, people = 0
  for (const r of rows) {
    const x = r.existing ?? r.result
    if (!x) continue
    people++
    gross += x.gross; deductions += x.totalDeductions; net += x.net
    employer += ('employerPf' in x ? x.employerPf + x.employerEsi : 0)
  }
  return { people, gross: r2(gross), deductions: r2(deductions), net: r2(net), employer: r2(employer), cost: r2(gross + employer) }
}
