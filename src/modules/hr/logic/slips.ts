import { listOf, type DataState } from '@/data/state'
import type { Payslip, SalaryPayout, YM } from '../types'

const r2 = (n: number) => Math.round(n * 100) / 100

export const voidedIds = (state: Pick<DataState, 'payslipVoids'>): Set<string> => new Set(listOf(state.payslipVoids ?? {}).map((v) => v.payslipId))

/** Payslips that stand (not voided), newest month first. */
export function livePayslips(state: Pick<DataState, 'payslips' | 'payslipVoids'>): Payslip[] {
  const gone = voidedIds(state)
  return listOf(state.payslips ?? {}).filter((p) => !gone.has(p.id)).sort((a, b) => b.month.localeCompare(a.month) || a.employeeName.localeCompare(b.employeeName))
}

export const liveSlipFor = (state: Pick<DataState, 'payslips' | 'payslipVoids'>, employeeId: string, month: YM): Payslip | undefined =>
  livePayslips(state).find((p) => p.employeeId === employeeId && p.month === month)

/** The revision a new payslip for this person and month takes (a voided one is run again as revision 2…). */
export const nextRev = (state: Pick<DataState, 'payslips'>, employeeId: string, month: YM): number =>
  listOf(state.payslips ?? {}).filter((p) => p.employeeId === employeeId && p.month === month).reduce((m, p) => Math.max(m, p.rev), 0) + 1

export const payslipId = (month: YM, employeeId: string, rev: number) => `ps_${month}_${employeeId}_${rev}`
export const payoutId = (slipId: string) => `pay_${slipId}`
export const voidId = (slipId: string) => `void_${slipId}`

export const payoutsOf = (state: Pick<DataState, 'salaryPayouts'>, slipId: string): SalaryPayout[] => listOf(state.salaryPayouts ?? {}).filter((p) => p.payslipId === slipId)
export const paidOf = (state: Pick<DataState, 'salaryPayouts'>, slipId: string): number => r2(payoutsOf(state, slipId).reduce((s, p) => s + p.amount, 0))

/** One-off adjustments that a live payslip has already used. */
export function consumedAdjustmentIds(state: Pick<DataState, 'payslips' | 'payslipVoids'>): Set<string> {
  const out = new Set<string>()
  for (const p of livePayslips(state)) for (const a of p.adjustmentIds) out.add(a)
  return out
}

/** Advance recoveries that live payslips have taken, per advance. */
export function recoveredByAdvance(state: Pick<DataState, 'payslips' | 'payslipVoids'>): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of livePayslips(state)) for (const r of p.recoveries) out.set(r.advanceId, r2((out.get(r.advanceId) ?? 0) + r.amount))
  return out
}
