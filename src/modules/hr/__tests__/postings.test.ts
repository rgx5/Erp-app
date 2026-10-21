import { isBalanced, postingsFor, type Posting } from '@/modules/postings'
import { claimPayoutPosting, payslipPosting, repaymentPosting } from '../postings'
import { issueAdvance, paySalary, reimburseClaim, repayAdvance, runPayroll, saveAdjustment, submitClaim, voidPayslip, writeOffAdvance, decideClaim } from '../payrollOps'
import { AFTER, ctx, hrState, presentAllMonth, run } from './helpers'
import type { DataState } from '@/data/state'

const late = () => ctx({ now: AFTER })
const net = (ps: Posting[], account: string) => Math.round(ps.flatMap((p) => p.lines).filter((l) => l.account === account).reduce((t, l) => t + (l.debit ?? 0) - (l.credit ?? 0), 0) * 100) / 100

/** Ravi with PF, PT, a loan instalment, a fine and a rounded net; Meera on daily wages. */
function paidMonth(): { s: DataState; ravi: string } {
  let { s, ravi, meera } = hrState()
  s = presentAllMonth(s, '2026-10', [ravi.id, meera.id], ['2026-10-05', '2026-10-06', '2026-10-07'])
  s = run(s, issueAdvance(s, { employeeId: ravi.id, kind: 'loan', amount: 6000, mode: 'bank', installments: 3, startMonth: '2026-10' }, ctx()))
  s = run(s, saveAdjustment(s, { employeeId: ravi.id, month: '2026-10', kind: 'deduction', label: 'Cash short', amount: 250, note: '' }, undefined, late()))
  s = run(s, saveAdjustment(s, { employeeId: ravi.id, month: '2026-10', kind: 'incentive', label: 'Incentive', amount: 1000, note: '' }, undefined, late()))
  s = run(s, runPayroll(s, '2026-10', undefined, late()))
  return { s, ravi: ravi.id }
}

describe('what payroll means to the books', () => {
  test('a payslip balances: expense = what is owed to staff, the taxman, the PF office and the loan account', () => {
    const { s, ravi } = paidMonth()
    const slip = Object.values(s.payslips).find((p) => p.employeeId === ravi)!
    expect(slip.roundOff).not.toBe(0)
    const p = payslipPosting(slip)!
    expect(isBalanced(p)).toBe(true)
    expect(net([p], 'salaries')).toBe(Math.round((slip.gross + slip.employerPf + slip.employerEsi - 250) * 100) / 100)
    expect(net([p], 'pf_payable')).toBe(-(1800 + slip.employerPf))
    expect(net([p], 'professional_tax_payable')).toBe(-200)
    expect(net([p], 'employee_advances')).toBe(-2000)
    expect(net([p], 'salary_payable')).toBe(-slip.net)
    expect(p.lines.find((l) => l.account === 'salary_payable')!.party).toEqual({ type: 'employee', id: ravi })
  })

  test('every document in a full month balances, and a paid-up month leaves nothing owed', () => {
    let { s, ravi } = paidMonth()
    const slips = Object.values(s.payslips)
    for (const p of slips) s = run(s, paySalary(s, p.id, { mode: 'bank', ref: 'N1' }, late()))
    const all = postingsFor(s)
    expect(all.length).toBeGreaterThanOrEqual(5)
    expect(all.every(isBalanced)).toBe(true)
    expect(net(all, 'salary_payable')).toBe(0)
    // the loan: 6,000 lent, 2,000 taken back by payroll
    expect(net(all, 'employee_advances')).toBe(4000)
    expect(all.filter((p) => p.sourceColl === 'salaryPayouts')).toHaveLength(2)
    void ravi
  })

  test('voiding a payslip reverses it exactly', () => {
    let { s } = paidMonth()
    const before = postingsFor(s)
    for (const p of Object.values(s.payslips)) s = run(s, voidPayslip(s, p.id, 'redo', late()))
    const all = postingsFor(s)
    expect(all.every(isBalanced)).toBe(true)
    expect(net(all, 'salaries')).toBe(0)
    expect(net(all, 'salary_payable')).toBe(0)
    expect(net(all, 'employee_advances')).toBe(6000) // only the loan itself
    expect(all.length).toBe(before.length + Object.keys(s.payslips).length)
  })

  test('advances, repayments, write-offs and reimbursed claims', () => {
    let { s, ravi } = hrState()
    const a = issueAdvance(s, { employeeId: ravi.id, kind: 'advance', amount: 3000, mode: 'cash', installments: 1, startMonth: '2026-10' }, ctx())
    s = run(s, a)
    s = run(s, repayAdvance(s, a.advance.id, { amount: 1000, mode: 'upi' }, ctx()))
    const w = writeOffAdvance(s, a.advance.id, 'Left', ctx())
    s = run(s, w)
    expect(repaymentPosting(w.repayment)!.lines[0].account).toBe('expense:Staff advances written off')
    const c = submitClaim(s, { employeeId: ravi.id, date: '2026-10-15', category: 'Travel', amount: 800, description: 'Auto' }, ctx())
    s = run(s, c)
    s = run(s, decideClaim(s, c.claim.id, 'approved', 700, '', ctx()))
    const p = reimburseClaim(s, c.claim.id, { mode: 'bank' }, ctx())
    s = run(s, p)
    expect(claimPayoutPosting(p.payout)!.lines).toEqual([{ account: 'expense:Travel', debit: 700 }, { account: 'bank', credit: 700 }])
    const all = postingsFor(s)
    expect(all.every(isBalanced)).toBe(true)
    expect(net(all, 'employee_advances')).toBe(0) // lent 3,000; 1,000 back; 2,000 written off
    expect(net(all, 'cash')).toBe(-3000)
    expect(net(all, 'upi')).toBe(1000)
    expect(net(all, 'expense:Staff advances written off')).toBe(2000)
  })
})
