import type { DataState } from '@/data/state'
import { expenseAccount, registerPostingRule, type Posting, type PostingLine } from '../postings'
import { ACCUM_DEPRECIATION_KEY, DEPRECIATION_EXPENSE_CATEGORY } from './logic/assets'
import { loanRepaymentLines } from './logic/loans'
import { taxDeductionLines } from './logic/tds'
import type { DepreciationRun, Loan, LoanRepayment, TaxDeduction } from './types'
import './types'

/**
 * What this module's own documents mean to the books (see docs/MODULES.md "The books: postings"). Everything else a
 * bank account, GST export or budget needs is read straight from the accounting module's ledger — only these three
 * create money movements of their own.
 */

const withBranch = (b?: string) => (b ? { branchId: b } : {})

/** A month's depreciation: Dr the expense, Cr accumulated depreciation (a contra-asset). A reversing run undoes it. */
export function depreciationRunPosting(r: DepreciationRun): Posting | null {
  if (!(r.amount > 0)) return null
  const lines: PostingLine[] = r.reversesId
    ? [{ account: ACCUM_DEPRECIATION_KEY, debit: r.amount }, { account: expenseAccount(DEPRECIATION_EXPENSE_CATEGORY), credit: r.amount }]
    : [{ account: expenseAccount(DEPRECIATION_EXPENSE_CATEGORY), debit: r.amount }, { account: ACCUM_DEPRECIATION_KEY, credit: r.amount }]
  return { date: r.periodEnd, memo: `Depreciation ${new Date(r.periodStart).toISOString().slice(0, 7)}`, lines, ...withBranch(r.branchId) }
}

/** A TDS deduction (pay the party net of tax, withhold the tax) or a TCS collection (the extra amount is a liability). */
export function taxDeductionPosting(d: TaxDeduction): Posting | null {
  const lines = taxDeductionLines(d)
  if (lines.length < 2) return null
  return { date: d.date, memo: `${d.kind.toUpperCase()} ${d.no} · ${d.partyName}`, lines, ...withBranch(d.branchId) }
}

/** A loan instalment: the liability and the interest expense, against the account it was paid from. */
export function loanRepaymentPosting(r: LoanRepayment, state: DataState): Posting | null {
  const loan: Loan | undefined = state.loans[r.loanId]
  if (!loan) return null
  const lines = loanRepaymentLines(loan, r)
  if (lines.length < 2) return null
  return { date: r.date, memo: `EMI · ${loan.name}${r.ref ? ` · ${r.ref}` : ''}`, lines, ...withBranch(r.branchId) }
}

registerPostingRule<DepreciationRun>('depreciationRuns', (r) => depreciationRunPosting(r))
registerPostingRule<TaxDeduction>('taxDeductions', (d) => taxDeductionPosting(d))
registerPostingRule<LoanRepayment>('loanRepayments', (r, s) => loanRepaymentPosting(r, s))
