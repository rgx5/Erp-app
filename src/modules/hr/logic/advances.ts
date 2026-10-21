import { listOf, type DataState } from '@/data/state'
import type { StaffAdvance, YM } from '../types'
import { recoveredByAdvance } from './slips'

const r2 = (n: number) => Math.round(n * 100) / 100

export interface AdvanceStanding {
  advance: StaffAdvance
  /** Paid back by hand (or written off). */
  repaid: number
  /** Taken from salary by payslips that stand. */
  recovered: number
  balance: number
  /** What a payroll takes each month. */
  emi: number
}

/** The monthly instalment of an advance or loan. */
export const emiOf = (a: Pick<StaffAdvance, 'amount' | 'installments'>): number => r2(a.amount / Math.max(1, a.installments))

/** Every advance with how much is still to come back. The balance is never stored — it is worked out from the documents. */
export function advanceStandings(state: Pick<DataState, 'staffAdvances' | 'staffRepayments' | 'payslips' | 'payslipVoids'>): AdvanceStanding[] {
  const recovered = recoveredByAdvance(state)
  const repaid = new Map<string, number>()
  for (const r of listOf(state.staffRepayments ?? {})) repaid.set(r.advanceId, r2((repaid.get(r.advanceId) ?? 0) + r.amount))
  return listOf(state.staffAdvances ?? {}).map((advance) => {
    const rep = repaid.get(advance.id) ?? 0
    const rec = recovered.get(advance.id) ?? 0
    return { advance, repaid: rep, recovered: rec, balance: r2(Math.max(0, advance.amount - rep - rec)), emi: emiOf(advance) }
  }).sort((a, b) => b.advance.date - a.advance.date)
}

export const outstandingFor = (standings: AdvanceStanding[], employeeId: string): number =>
  r2(standings.filter((s) => s.advance.employeeId === employeeId).reduce((t, s) => t + s.balance, 0))

export interface PlannedRecovery { advanceId: string; amount: number; label: string }

/**
 * What a payroll takes back this month: each open advance's instalment (or what is left of it), oldest first, from
 * `startMonth` on, never more than `available` (a person's pay is not taken below nothing).
 */
export function planRecoveries(standings: AdvanceStanding[], month: YM, available: number): PlannedRecovery[] {
  let left = Math.max(0, r2(available))
  const out: PlannedRecovery[] = []
  for (const s of [...standings].sort((a, b) => a.advance.date - b.advance.date)) {
    if (s.balance <= 0 || s.advance.startMonth > month || left <= 0) continue
    const take = r2(Math.min(s.balance, s.emi, left))
    if (take <= 0) continue
    left = r2(left - take)
    out.push({ advanceId: s.advance.id, amount: take, label: `${s.advance.kind === 'loan' ? 'Loan' : 'Advance'} ${s.advance.no}` })
  }
  return out
}
