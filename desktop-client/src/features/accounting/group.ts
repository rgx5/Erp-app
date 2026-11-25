import type { TrialBalance } from '@/api/schemas'

export interface GroupRow { key: string; code: string; name: string; type: string; perCompany: number[]; total: number }
export interface GroupResult { rows: GroupRow[]; companies: string[] }
const n = (v: string): number => Number(v)
/** One signed closing balance for an account in one company: debit positive, credit negative. */
const signed = (r: TrialBalance['rows'][number]): number => Math.round((n(r.closingDebit) - n(r.closingCredit)) * 100) / 100

/** The companies' trial balances side by side, accounts matched by code (and by name when a code is used for a different account). */
export function groupTrialBalance(names: string[], tbs: TrialBalance[]): GroupResult {
  const map = new Map<string, GroupRow>()
  tbs.forEach((tb, ci) => {
    for (const r of tb.rows) {
      const key = r.code
      const row = map.get(key) ?? { key, code: r.code, name: r.name, type: r.type, perCompany: names.map(() => 0), total: 0 }
      row.perCompany[ci] = Math.round(((row.perCompany[ci] ?? 0) + signed(r)) * 100) / 100
      map.set(key, row)
    }
  })
  const rows = [...map.values()].map((r) => ({ ...r, total: Math.round(r.perCompany.reduce((s, x) => s + x, 0) * 100) / 100 })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
  return { rows, companies: names }
}

const INCOME = new Set(['income', 'revenue', 'other_income']); const EXPENSE = new Set(['expense', 'cost_of_goods_sold', 'cogs', 'direct_expense', 'indirect_expense', 'other_expense'])
export interface GroupSummary { income: number; expense: number; profit: number; debits: number; credits: number; balanced: boolean }
/** The group's totals once the accounts in `eliminated` (inter-company balances) are taken out. Income is credit, so it is negative in the signed total. */
export function groupSummary(rows: GroupRow[], eliminated: ReadonlySet<string>): GroupSummary {
  let income = 0; let expense = 0; let debits = 0; let credits = 0
  for (const r of rows) {
    if (eliminated.has(r.key)) continue
    if (r.total > 0) debits += r.total; else credits -= r.total
    if (INCOME.has(r.type)) income += -r.total; else if (EXPENSE.has(r.type)) expense += r.total
  }
  const round = (x: number): number => Math.round(x * 100) / 100
  return { income: round(income), expense: round(expense), profit: round(income - expense), debits: round(debits), credits: round(credits), balanced: Math.abs(debits - credits) < 0.01 }
}
