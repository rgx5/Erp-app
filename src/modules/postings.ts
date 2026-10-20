import { listOf, type Coll, type DataState } from '@/data/state'

/**
 * Accounting without a dependency on the accounting module.
 *
 * Any module that creates a financial document (a collection receipt, a payroll run, a supplier payment, a debit note…)
 * says what it *means* in double-entry terms by registering a **posting rule**. The accounting module collects every rule,
 * maps account keys onto the chart of accounts, and builds the ledger, the books and the statements from the documents.
 * Nothing is stored twice: the ledger is always computed from the documents.
 *
 * Account keys are either well-known (below) or a chart-of-accounts code. Debits and credits are positive numbers.
 */
export type WellKnownAccount =
  | 'cash' | 'bank' | 'upi' | 'card' | 'wallet'
  | 'sales' | 'sales_returns' | 'discounts' | 'round_off'
  | 'gst_output_cgst' | 'gst_output_sgst' | 'gst_output_igst' | 'gst_input_cgst' | 'gst_input_sgst' | 'gst_input_igst'
  | 'receivables' | 'payables' | 'advances_received' | 'advances_paid' | 'store_credit' | 'gift_cards' | 'loyalty_liability'
  | 'inventory' | 'purchases' | 'purchase_returns' | 'cogs' | 'stock_adjustments' | 'freight_in'
  | 'salaries' | 'salary_payable' | 'employee_advances' | 'pf_payable' | 'esi_payable' | 'tds_payable' | 'professional_tax_payable'
  | 'owner_capital' | 'drawings' | 'suspense'
export type AccountKey = WellKnownAccount | (string & {})

/** An expense account for a category of the expenses screen: `expense('Rent')` → 'expense:Rent'. */
export const expenseAccount = (category: string): AccountKey => `expense:${category}`

export type PartyType = 'customer' | 'supplier' | 'employee'

export interface PostingLine {
  account: AccountKey
  debit?: number
  credit?: number
  /** The person this line is owed by / owed to; powers party ledgers, statements and ageing. */
  party?: { type: PartyType; id: string }
}

export interface Posting {
  /** Which document this came from (for drill-down). Filled in by `postingsFor` — rules need not set them. */
  sourceColl?: string
  sourceId?: string
  date: number
  memo: string
  lines: PostingLine[]
  /** A cost centre / branch the posting belongs to. */
  branchId?: string
}

export type PostingRule<D = Record<string, unknown>> = (doc: D, state: DataState) => Posting | Posting[] | null

const rules = new Map<string, Array<PostingRule>>()

/** Registers what documents of `coll` mean to the books. A collection may have several rules (from several modules). */
export function registerPostingRule<D = Record<string, unknown>>(coll: Coll, rule: PostingRule<D>) {
  const list = rules.get(coll) ?? []
  list.push(rule as PostingRule)
  rules.set(coll, list)
}
export const postingCollections = () => [...rules.keys()]

const sum = (lines: PostingLine[], k: 'debit' | 'credit') => Math.round(lines.reduce((s, l) => s + (l[k] ?? 0), 0) * 100) / 100

/** A posting is sound when debits equal credits (to the paisa) and no line has both. */
export function isBalanced(p: Posting): boolean {
  return p.lines.length >= 2 && sum(p.lines, 'debit') === sum(p.lines, 'credit') && p.lines.every((l) => !(l.debit && l.credit) && (l.debit ?? 0) >= 0 && (l.credit ?? 0) >= 0)
}

/** Every posting the data implies, oldest first. A rule that throws is skipped (a broken document must not break the books). */
export function postingsFor(state: DataState): Posting[] {
  const out: Posting[] = []
  for (const [coll, list] of rules) {
    for (const doc of listOf((state as unknown as Record<string, Record<string, Record<string, unknown>>>)[coll] ?? {}) as Array<Record<string, unknown>>) {
      for (const rule of list) {
        let r: Posting | Posting[] | null = null
        try { r = rule(doc, state) } catch { continue }
        for (const p of r ? (Array.isArray(r) ? r : [r]) : []) out.push({ ...p, sourceColl: coll, sourceId: String(doc.id) })
      }
    }
  }
  return out.sort((a, b) => a.date - b.date)
}
