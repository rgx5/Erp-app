import { listOf, type DataState } from '@/data/state'
import { endOfDay, startOfDay } from '@/domain/dates'
import { round2 } from '@/domain/money'
import type { PartyType } from '../postings'
import type { FinancialYear, Voucher, VoucherLine, VoucherType } from './types'
import './types'

// ───────────────────────────── period locks (other modules use these) ─────────────────────────────

/** The last day that is locked, or null when nothing is. The latest lock wins. */
export function lockedThrough(state: DataState): number | null {
  let max: number | null = null
  for (const l of listOf(state.periodLocks)) if (max === null || l.throughDate > max) max = l.throughDate
  return max
}

/** Whether a date falls in a locked period. Documents dated then must not be created or changed. */
export function isLocked(state: DataState, date: number): boolean {
  const t = lockedThrough(state)
  return t !== null && date <= t
}

// ───────────────────────────── periods ─────────────────────────────

export type PeriodKey = 'month' | 'last-month' | 'quarter' | 'fy' | 'last-fy' | 'custom'
export const PERIOD_OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: 'month', label: 'This month' }, { value: 'last-month', label: 'Last month' }, { value: 'quarter', label: 'This quarter' },
  { value: 'fy', label: 'This year' }, { value: 'last-fy', label: 'Last year' }, { value: 'custom', label: 'Custom' },
]

/** The Indian financial year (1 April – 31 March) that contains `now`. */
export function defaultFinancialYear(now: number): { start: number; end: number; label: string } {
  const d = new Date(now)
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return { start: new Date(startYear, 3, 1).getTime(), end: endOfDay(new Date(startYear + 1, 2, 31)), label: `FY ${startYear}-${String(startYear + 1).slice(2)}` }
}

/** The financial year containing `now`: a saved one if there is, otherwise the default April–March year. */
export function financialYearAt(years: FinancialYear[], now: number): { start: number; end: number; label: string } {
  const saved = years.find((y) => y.start <= now && now <= y.end)
  return saved ? { start: saved.start, end: saved.end, label: saved.label } : defaultFinancialYear(now)
}

export function periodBounds(key: PeriodKey, now: number, years: FinancialYear[] = []): [number, number] {
  const d = new Date(now)
  switch (key) {
    case 'month': return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), endOfDay(now)]
    case 'last-month': return [new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), endOfDay(new Date(d.getFullYear(), d.getMonth(), 0))]
    case 'quarter': {
      const fy = financialYearAt(years, now)
      const q = Math.floor(((d.getFullYear() - new Date(fy.start).getFullYear()) * 12 + d.getMonth() - new Date(fy.start).getMonth()) / 3)
      const s = new Date(new Date(fy.start).getFullYear(), new Date(fy.start).getMonth() + q * 3, 1)
      return [s.getTime(), Math.min(endOfDay(new Date(s.getFullYear(), s.getMonth() + 3, 0)), fy.end)]
    }
    case 'fy': { const f = financialYearAt(years, now); return [f.start, Math.min(f.end, endOfDay(now))] }
    case 'last-fy': { const f = financialYearAt(years, financialYearAt(years, now).start - 1); return [f.start, f.end] }
    default: return [startOfDay(now), endOfDay(now)]
  }
}

// ───────────────────────────── vouchers ─────────────────────────────

export const VOUCHER_PREFIX: Record<VoucherType, string> = { receipt: 'RV-', payment: 'PV-', journal: 'JV-', contra: 'CV-', closing: 'CL-' }
export const VOUCHER_LABEL: Record<VoucherType, string> = { receipt: 'Receipt', payment: 'Payment', journal: 'Journal', contra: 'Contra', closing: 'Year-end closing' }

export const voucherDebit = (lines: VoucherLine[]) => round2(lines.reduce((s, l) => s + (l.debit ?? 0), 0))
export const voucherCredit = (lines: VoucherLine[]) => round2(lines.reduce((s, l) => s + (l.credit ?? 0), 0))

/** Sound when it has at least two lines, each on one side with a positive amount, and debits equal credits. */
export function voucherProblem(lines: VoucherLine[]): string | null {
  const used = lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0)
  if (used.length < 2) return 'A voucher needs at least two lines.'
  for (const l of used) {
    if ((l.debit ?? 0) < 0 || (l.credit ?? 0) < 0) return 'Amounts cannot be negative.'
    if ((l.debit ?? 0) > 0 && (l.credit ?? 0) > 0) return 'A line is either a debit or a credit, not both.'
    if (!l.account) return 'Every line needs an account.'
  }
  const d = voucherDebit(used), c = voucherCredit(used)
  if (d !== c) return `Debits ₹${d.toFixed(2)} and credits ₹${c.toFixed(2)} are not equal.`
  return null
}

export type MoneyMode = 'cash' | 'bank' | 'upi' | 'card'

/**
 * A receipt: money comes in, from a person (their account is credited) or from another account. `party` makes it a customer's
 * payment against what they owe (receivables); a supplier refund / other income names an account instead.
 */
export function receiptLines(o: { mode: MoneyMode; amount: number; party?: { type: PartyType; id: string }; account?: string }): VoucherLine[] {
  const a = round2(o.amount)
  const from = o.party ? (o.party.type === 'supplier' ? 'payables' : o.party.type === 'employee' ? 'employee_advances' : 'receivables') : o.account ?? 'suspense'
  return [{ account: o.mode, debit: a }, { account: from, credit: a, ...(o.party ? { party: o.party } : {}) }]
}

/** A payment: money goes out, to a person (what we owe them) or an account (an expense, a drawing). */
export function paymentLines(o: { mode: MoneyMode; amount: number; party?: { type: PartyType; id: string }; account?: string }): VoucherLine[] {
  const a = round2(o.amount)
  const to = o.party ? (o.party.type === 'customer' ? 'receivables' : o.party.type === 'employee' ? 'employee_advances' : 'payables') : o.account ?? 'suspense'
  return [{ account: to, debit: a, ...(o.party ? { party: o.party } : {}) }, { account: o.mode, credit: a }]
}

/** A contra: money moves between cash and bank (or between bank accounts). */
export const contraLines = (from: string, to: string, amount: number): VoucherLine[] => [{ account: to, debit: round2(amount) }, { account: from, credit: round2(amount) }]

/** The mirror image of a voucher's lines. */
export const reversedLines = (lines: VoucherLine[]): VoucherLine[] => lines.map((l) => ({ account: l.account, ...(l.credit ? { debit: l.credit } : {}), ...(l.debit ? { credit: l.debit } : {}), ...(l.party ? { party: l.party } : {}) }))

export const isReversed = (state: DataState, v: Voucher) => listOf(state.vouchers).some((x) => x.reversesId === v.id)

// ───────────────────────────── where a ledger line came from ─────────────────────────────

const routes = new Map<string, (id: string) => string | null>()
/** Tells the books where to open the document behind a ledger line. Modules register their own collections. */
export const registerSourceRoute = (coll: string, fn: (id: string) => string | null) => { routes.set(coll, fn) }
export function sourceRoute(coll: string | undefined, id: string | undefined): string | null {
  return coll && id ? routes.get(coll)?.(id) ?? null : null
}
registerSourceRoute('bills', (id) => `/bills/${id}`)
registerSourceRoute('purchases', (id) => `/purchases/${id}`)
registerSourceRoute('vouchers', (id) => `/m/accounting/vouchers/${id}`)
registerSourceRoute('sessions', () => '/dayclose')
registerSourceRoute('expenses', () => '/expenses')
