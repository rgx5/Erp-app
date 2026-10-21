import { registerPostingRule, type AccountKey, type Posting, type PostingLine } from '@/modules/postings'
import { expenseAccount } from '@/modules/postings'
import type { ClaimPayout, Payslip, PayslipVoid, SalaryPayout, StaffAdvance, StaffRepayment } from './types'
import { monthBounds } from './logic/ymd'

/**
 * What this module's documents mean to the books.
 *
 *   • A payslip (accrual): Dr Salaries & wages for the gross pay and the employer's PF / ESI, Cr PF payable, ESI payable,
 *     professional tax payable, TDS payable, Employee advances (recovered from the pay) and Salaries payable for the net
 *     pay owed to the person. Other deductions (a fine) reduce the salary cost.
 *   • A voided payslip: the same lines, reversed.
 *   • A salary payout: Dr Salaries payable (the person), Cr cash / bank / UPI.
 *   • An advance or loan given: Dr Employee advances (the person), Cr cash / bank / UPI. Paid back by hand: the reverse.
 *     Written off: Dr an expense account, Cr Employee advances.
 *   • An expense claim reimbursed: Dr the expense category, Cr cash / bank / UPI.
 */
const MONEY: Record<'cash' | 'bank' | 'upi', AccountKey> = { cash: 'cash', bank: 'bank', upi: 'upi' }
export const WRITE_OFF_CATEGORY = 'Staff advances written off'

const r2 = (n: number) => Math.round(n * 100) / 100
const sumOf = (p: Payslip, key: string) => r2(p.deductions.filter((d) => d.key === key).reduce((t, d) => t + d.amount, 0))
const nonZero = (lines: PostingLine[]) => lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)
const withBranch = (b?: string) => (b ? { branchId: b } : {})

export function payslipPosting(p: Payslip): Posting | null {
  const party = { type: 'employee' as const, id: p.employeeId }
  const pf = sumOf(p, 'pf'), esi = sumOf(p, 'esi'), pt = sumOf(p, 'pt'), tds = sumOf(p, 'tds'), adv = sumOf(p, 'advance'), other = sumOf(p, 'other')
  const lines = nonZero([
    { account: 'salaries', debit: r2(p.gross + p.employerPf + p.employerEsi) },
    { account: 'round_off', debit: p.roundOff > 0 ? p.roundOff : 0, credit: p.roundOff < 0 ? -p.roundOff : 0 },
    { account: 'pf_payable', credit: r2(pf + p.employerPf) },
    { account: 'esi_payable', credit: r2(esi + p.employerEsi) },
    { account: 'professional_tax_payable', credit: pt },
    { account: 'tds_payable', credit: tds },
    { account: 'employee_advances', credit: adv, party },
    { account: 'salaries', credit: other },
    { account: 'salary_payable', credit: p.net, party },
  ])
  if (lines.length < 2) return null
  return { date: monthBounds(p.month)[1], memo: `Salary ${p.month} · ${p.employeeName}`, lines, ...withBranch(p.branchId) }
}

export function voidPosting(v: PayslipVoid, p: Payslip | undefined): Posting | null {
  const original = p ? payslipPosting(p) : null
  if (!original || !p) return null
  return { date: v.at, memo: `Reversal of payslip ${p.no} · ${p.employeeName}`, lines: original.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })), ...withBranch(v.branchId ?? p.branchId) }
}

export function payoutPosting(p: SalaryPayout, name = ''): Posting | null {
  if (!(p.amount > 0)) return null
  return {
    date: p.date, memo: `Salary paid ${p.month}${name ? ` · ${name}` : ''}${p.ref ? ` · ${p.ref}` : ''}`,
    lines: [{ account: 'salary_payable', debit: p.amount, party: { type: 'employee', id: p.employeeId } }, { account: MONEY[p.mode] ?? 'cash', credit: p.amount }], ...withBranch(p.branchId),
  }
}

export function advancePosting(a: StaffAdvance): Posting | null {
  if (!(a.amount > 0)) return null
  return {
    date: a.date, memo: `${a.kind === 'loan' ? 'Loan' : 'Advance'} ${a.no}`,
    lines: [{ account: 'employee_advances', debit: a.amount, party: { type: 'employee', id: a.employeeId } }, { account: MONEY[a.mode] ?? 'cash', credit: a.amount }], ...withBranch(a.branchId),
  }
}

export function repaymentPosting(r: StaffRepayment): Posting | null {
  if (!(r.amount > 0)) return null
  const debit: AccountKey = r.mode === 'writeoff' ? expenseAccount(WRITE_OFF_CATEGORY) : MONEY[r.mode] ?? 'cash'
  return {
    date: r.date, memo: r.mode === 'writeoff' ? 'Advance written off' : 'Advance paid back',
    lines: [{ account: debit, debit: r.amount }, { account: 'employee_advances', credit: r.amount, party: { type: 'employee', id: r.employeeId } }], ...withBranch(r.branchId),
  }
}

export function claimPayoutPosting(c: ClaimPayout): Posting | null {
  if (!(c.amount > 0)) return null
  return {
    date: c.date, memo: `Expense claim reimbursed${c.ref ? ` · ${c.ref}` : ''}`,
    lines: [{ account: expenseAccount(c.category || 'Staff expenses'), debit: c.amount }, { account: MONEY[c.mode] ?? 'cash', credit: c.amount }], ...withBranch(c.branchId),
  }
}

registerPostingRule<Payslip>('payslips', (p) => payslipPosting(p))
registerPostingRule<PayslipVoid>('payslipVoids', (v, s) => voidPosting(v, (s as unknown as { payslips?: Record<string, Payslip> }).payslips?.[v.payslipId]))
registerPostingRule<SalaryPayout>('salaryPayouts', (p, s) => payoutPosting(p, (s as unknown as { employees?: Record<string, { name: string }> }).employees?.[p.employeeId]?.name))
registerPostingRule<StaffAdvance>('staffAdvances', (a) => advancePosting(a))
registerPostingRule<StaffRepayment>('staffRepayments', (r) => repaymentPosting(r))
registerPostingRule<ClaimPayout>('claimPayouts', (c) => claimPayoutPosting(c))
