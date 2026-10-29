import { listOf, type DataState } from '@/data/state'
import { round2 } from '@/domain/money'
import { expenseAccount, type PostingLine } from '../../postings'
import type { Loan, Pdc } from '../types'

/** Loans / EMI and post-dated cheques: a register with due dates, a reducing-balance schedule, and (for loans) a
 *  posting rule for each instalment paid. A PDC is tracking only — clearing one is recorded as an ordinary voucher. */

/** The standard EMI formula on a reducing balance. */
export function emiAmount(principal: number, annualRatePct: number, tenureMonths: number): number {
  if (!(principal > 0) || !(tenureMonths > 0)) return 0
  const r = annualRatePct / 1200
  if (r <= 0) return round2(principal / tenureMonths)
  const f = Math.pow(1 + r, tenureMonths)
  return round2((principal * r * f) / (f - 1))
}

export interface AmortizationRow { period: number; dueDate: number; opening: number; interest: number; principal: number; emi: number; closing: number }

/** A forward schedule from today's outstanding balance, splitting each instalment into interest and principal. */
export function amortizationSchedule(loan: Loan, outstanding: number, monthsLeft: number): AmortizationRow[] {
  const rows: AmortizationRow[] = []
  let balance = outstanding
  const r = loan.interestRatePct / 1200
  const start = new Date(loan.startDate)
  for (let i = 1; i <= monthsLeft && balance > 0.01; i++) {
    const interest = round2(balance * r)
    const principal = Math.max(0, Math.min(round2(loan.emiAmount - interest), balance))
    const emi = round2(interest + principal)
    const closing = round2(balance - principal)
    const dueDate = new Date(start.getFullYear(), start.getMonth() + i, Math.min(loan.emiDay, 28), 12).getTime()
    rows.push({ period: i, dueDate, opening: balance, interest, principal, emi, closing })
    balance = closing
  }
  return rows
}

/** Principal repaid so far (reversals net off), and so the balance still owed. */
export function loanOutstanding(state: DataState, loanId: string): number {
  const loan = state.loans[loanId]
  if (!loan) return 0
  const paid = round2(listOf(state.loanRepayments).filter((r) => r.loanId === loanId).reduce((s, r) => s + r.principalPart, 0))
  return round2(Math.max(0, loan.principal - paid))
}

export function loanRepaymentProblem(d: { amount: number; principalPart: number; interestPart: number }): string | null {
  if (!(d.amount > 0)) return 'Enter the amount paid.'
  if (d.principalPart < 0 || d.interestPart < 0) return 'The principal and interest parts cannot be negative.'
  if (round2(d.principalPart + d.interestPart) !== round2(d.amount)) return 'The principal and interest parts must add up to the amount paid.'
  return null
}

export const LOAN_INTEREST_CATEGORY = 'Loan interest'

/** Dr the loan liability (what is still owed goes down) and the interest expense, Cr the account money was paid from. */
export function loanRepaymentLines(loan: Pick<Loan, 'accountKey'>, r: { amount: number; principalPart: number; interestPart: number; mode: string }): PostingLine[] {
  const lines: PostingLine[] = []
  if (r.principalPart > 0) lines.push({ account: loan.accountKey, debit: round2(r.principalPart) })
  if (r.interestPart > 0) lines.push({ account: expenseAccount(LOAN_INTEREST_CATEGORY), debit: round2(r.interestPart) })
  if (r.amount > 0) lines.push({ account: r.mode, credit: round2(r.amount) })
  return lines
}

export const LOAN_ACCOUNT_KEY = 'tax_loans_payable'

// ───────────────────────────── post-dated cheques ─────────────────────────────

/** Pending PDCs due within `days` of `now` — the reminder a Home notice shows. */
export function pdcsDueSoon(state: DataState, now: number, days = 7): Pdc[] {
  const until = now + days * 86_400_000
  return listOf(state.pdcs).filter((p) => p.status === 'pending' && p.dueDate <= until).sort((a, b) => a.dueDate - b.dueDate)
}
