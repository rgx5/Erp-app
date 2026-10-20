import type { WellKnownAccount } from '../postings'
import type { Account, AccountType } from './types'

/** Keys the books use that are not in the shared `WellKnownAccount` list (they belong to the accounting module itself). */
export type ExtraKey = 'gst_paid' | 'retained_earnings' | 'cash_over_short'
export type ChartKey = WellKnownAccount | ExtraKey

interface Row { code: string; name: string; type: AccountType; group?: string; parent?: ChartKey }

/**
 * The default chart for an Indian small business. A `Record` over every key means the compiler fails the build the day someone
 * adds a well-known key to `postings.ts` without giving it an account here.
 */
export const KEY_TABLE: Record<ChartKey, Row> = {
  cash: { code: '1001', name: 'Cash in hand', type: 'asset' },
  bank: { code: '1002', name: 'Bank accounts', type: 'asset' },
  upi: { code: '1003', name: 'UPI collections', type: 'asset' },
  card: { code: '1004', name: 'Card settlements due', type: 'asset' },
  wallet: { code: '1005', name: 'Wallets & payment apps', type: 'asset' },
  receivables: { code: '1100', name: 'Accounts receivable (customers)', type: 'asset' },
  advances_paid: { code: '1110', name: 'Advances paid to suppliers', type: 'asset' },
  employee_advances: { code: '1120', name: 'Employee advances', type: 'asset' },
  inventory: { code: '1200', name: 'Inventory (stock in hand)', type: 'asset' },
  gst_input_cgst: { code: '1301', name: 'GST input credit — CGST', type: 'asset' },
  gst_input_sgst: { code: '1302', name: 'GST input credit — SGST', type: 'asset' },
  gst_input_igst: { code: '1303', name: 'GST input credit — IGST', type: 'asset' },
  suspense: { code: '1900', name: 'Suspense (needs an account)', type: 'asset' },

  payables: { code: '2001', name: 'Accounts payable (suppliers)', type: 'liability' },
  advances_received: { code: '2010', name: 'Advances from customers', type: 'liability' },
  store_credit: { code: '2020', name: 'Store credit owed to customers', type: 'liability' },
  gift_cards: { code: '2030', name: 'Gift cards outstanding', type: 'liability' },
  loyalty_liability: { code: '2040', name: 'Loyalty points owed', type: 'liability' },
  gst_output_cgst: { code: '2101', name: 'GST payable — CGST', type: 'liability' },
  gst_output_sgst: { code: '2102', name: 'GST payable — SGST', type: 'liability' },
  gst_output_igst: { code: '2103', name: 'GST payable — IGST', type: 'liability' },
  gst_paid: { code: '2110', name: 'GST paid to government', type: 'liability' },
  salary_payable: { code: '2200', name: 'Salaries payable', type: 'liability' },
  pf_payable: { code: '2210', name: 'PF payable', type: 'liability' },
  esi_payable: { code: '2220', name: 'ESI payable', type: 'liability' },
  tds_payable: { code: '2230', name: 'TDS payable', type: 'liability' },
  professional_tax_payable: { code: '2240', name: 'Professional tax payable', type: 'liability' },

  owner_capital: { code: '3001', name: 'Owner’s capital', type: 'equity' },
  drawings: { code: '3002', name: 'Owner’s drawings', type: 'equity' },
  retained_earnings: { code: '3003', name: 'Retained earnings', type: 'equity' },

  sales: { code: '4001', name: 'Sales', type: 'income' },
  sales_returns: { code: '4002', name: 'Sales returns', type: 'income' },
  round_off: { code: '4900', name: 'Round off', type: 'income' },

  cogs: { code: '5001', name: 'Cost of goods sold', type: 'expense', group: 'Cost of sales' },
  purchases: { code: '5002', name: 'Purchases', type: 'expense', group: 'Cost of sales' },
  purchase_returns: { code: '5003', name: 'Purchase returns', type: 'expense', group: 'Cost of sales' },
  stock_adjustments: { code: '5004', name: 'Stock adjustments & write-offs', type: 'expense', group: 'Cost of sales' },
  freight_in: { code: '5005', name: 'Freight & carriage inward', type: 'expense', group: 'Cost of sales' },

  salaries: { code: '6001', name: 'Salaries & wages', type: 'expense' },
  discounts: { code: '6002', name: 'Discounts & points redeemed', type: 'expense' },
  cash_over_short: { code: '6003', name: 'Cash over / short', type: 'expense' },
}

export const WELL_KNOWN_KEYS = Object.keys(KEY_TABLE) as ChartKey[]

const accountId = (code: string) => `acc_${code}`
export const EXPENSE_PREFIX = 'expense:'
export const isExpenseKey = (k: string) => k.startsWith(EXPENSE_PREFIX)
const FIRST_EXPENSE_CODE = 6100

/** Account for one expense category, e.g. `expense:Rent`. Codes count up from 6100 in the order given. */
export function expenseAccountFor(category: string, nextCode: number, createdAt = 0): Account {
  const code = String(nextCode)
  return { id: accountId(code), code, name: category, type: 'expense', system: false, key: `${EXPENSE_PREFIX}${category}`, openingBalance: 0, active: true, createdAt }
}

/** The starting chart: every well-known key, plus an expense account for each category given (sorted, deduplicated). */
export function defaultChart(expenseCategories: string[] = [], createdAt = 0): Account[] {
  const out: Account[] = (Object.entries(KEY_TABLE) as Array<[ChartKey, Row]>).map(([key, r]) => ({
    id: accountId(r.code), code: r.code, name: r.name, type: r.type, system: true, key, ...(r.group ? { group: r.group } : {}), openingBalance: 0, active: true, createdAt,
  }))
  const cats = [...new Set(expenseCategories.map((c) => c.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  cats.forEach((c, i) => out.push(expenseAccountFor(c, FIRST_EXPENSE_CODE + i, createdAt)))
  return out.sort((a, b) => a.code.localeCompare(b.code))
}

/** The next free code for a new expense account (the first free number from 6100). */
export function nextExpenseCode(chart: Account[]): number {
  const used = new Set(chart.map((a) => a.code))
  let n = FIRST_EXPENSE_CODE
  while (used.has(String(n))) n++
  return n
}

/** Finds the account a document posted to: by code, by id, then by well-known key. `null` when the chart has no home for it. */
export function resolveAccount(chart: Account[], key: string): Account | null {
  return chart.find((a) => a.code === key) ?? chart.find((a) => a.id === key) ?? chart.find((a) => a.key === key) ?? null
}

/** Normal balance side: debit for assets and expenses, credit for liabilities, equity and income. */
export const isDebitNormal = (t: AccountType) => t === 'asset' || t === 'expense'
export const TYPE_LABEL: Record<AccountType, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' }
export const TYPE_ORDER: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense']
