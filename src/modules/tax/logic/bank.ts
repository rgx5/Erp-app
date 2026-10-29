import { listOf, type DataState } from '@/data/state'
import { round2 } from '@/domain/money'
import { accountLedger, buildLedger, type AccountLedger, type Ledger } from '@/modules/accounting/ledger'
import { resolveAccount } from '@/modules/accounting/chart'
import type { Account } from '@/modules/accounting/types'
import type { BankAccount, BankAccountKind } from '../types'

/**
 * Bank & cash accounts extend the chart of accounts rather than reinventing it: each one is a child account of the
 * well-known `bank` or `cash` account, and its "bank book" is simply that account's ledger (from the accounting
 * module) filtered to its own account id. Nothing about the books is duplicated here.
 */

const PARENT_KEY: Record<BankAccountKind, 'bank' | 'cash'> = { bank: 'bank', cash: 'cash' }

/** The chart account a new bank account should be created under, or null until the chart itself is set up. */
export function parentAccount(chart: Account[], kind: BankAccountKind): Account | null {
  return resolveAccount(chart, PARENT_KEY[kind])
}

/** The next free sub-code under a parent (1002 → 1002-01, 1002-02…), so every bank account gets its own account number. */
export function nextSubCode(chart: Account[], parent: Account): string {
  const used = new Set(chart.filter((a) => a.parent === parent.id).map((a) => a.code))
  let n = 1
  while (used.has(`${parent.code}-${String(n).padStart(2, '0')}`)) n++
  return `${parent.code}-${String(n).padStart(2, '0')}`
}

export function activeBankAccounts(state: DataState): BankAccount[] {
  return listOf(state.bankAccounts).filter((b) => b.active).sort((a, b) => a.name.localeCompare(b.name))
}

/** The bank book: the chosen account's ledger, exactly as `accountLedger` reports any other account. */
export function bankBook(l: Ledger, b: BankAccount): AccountLedger | null {
  return accountLedger(l, b.accountId)
}

/** Every bank/cash account with its current balance (on its own side — a positive number is money in hand). */
export function bankAccountBalances(state: DataState, l: Ledger = buildLedger(state)): Array<{ account: BankAccount; balance: number }> {
  return activeBankAccounts(state).map((account) => {
    const book = bankBook(l, account)
    return { account, balance: round2(book?.closing ?? account.openingBalance) }
  })
}
