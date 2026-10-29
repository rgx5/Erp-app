import { listOf, type DataState } from '@/data/state'
import { round2 } from '@/domain/money'
import { toCsv, type CsvCell } from '@/domain/csv'
import { buildLedger, type Ledger } from '@/modules/accounting/ledger'
import { resolveAccount } from '@/modules/accounting/chart'
import type { Budget } from '../types'

/** A budget against the same chart of accounts the ledger already has — the actual is just that account's movement
 *  over the budget's own period, so a budget can never drift from the books it is compared against. */

export interface BudgetLine { budget: Budget; accountName: string; actual: number; variance: number; variancePct: number | null }

function actualFor(l: Ledger, accountKey: string): number {
  const account = resolveAccount(l.chart, accountKey)
  if (!account) return 0
  let debit = 0, credit = 0
  for (const e of l.entries) if (e.accountId === account.id) { debit += e.debit; credit += e.credit }
  // Expenses and cost of sales read naturally as a debit movement; income (a revenue target) as credit.
  return round2(account.type === 'income' ? credit - debit : debit - credit)
}

export function budgetLines(state: DataState, budgets: Budget[] = listOf(state.budgets)): BudgetLine[] {
  return budgets.map((b) => {
    const l = buildLedger(state, { from: b.periodStart, to: b.periodEnd })
    const account = resolveAccount(l.chart, b.accountKey)
    const actual = actualFor(l, b.accountKey)
    const variance = round2(actual - b.amount)
    return { budget: b, accountName: account?.name ?? b.accountKey, actual, variance, variancePct: b.amount ? round2((variance / b.amount) * 100) : null }
  }).sort((a, b) => a.budget.periodStart - b.budget.periodStart || a.accountName.localeCompare(b.accountName))
}

export function budgetCsv(lines: BudgetLine[]) {
  const head: CsvCell[] = ['Budget', 'Account', 'Budgeted', 'Actual', 'Variance', 'Variance %']
  return toCsv([head, ...lines.map((r): CsvCell[] => [r.budget.label, r.accountName, r.budget.amount, r.actual, r.variance, r.variancePct ?? ''])])
}
