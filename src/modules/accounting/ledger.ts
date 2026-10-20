import { listOf, type DataState } from '@/data/state'
import { startOfDay } from '@/domain/dates'
import { round2 } from '@/domain/money'
import { isBalanced, postingsFor, type PartyType } from '../postings'
import { defaultChart, isDebitNormal, resolveAccount } from './chart'
import './postings'
import type { Account } from './types'

/**
 * The books, computed from the documents. Nothing is stored: every figure here is a pure function of `DataState`, so the phone
 * and the server always agree and a report can never be out of date.
 */

export interface LedgerLine { accountId: string; debit: number; credit: number; party?: { type: PartyType; id: string } }
export interface LedgerPosting {
  index: number
  date: number
  memo: string
  sourceColl?: string
  sourceId?: string
  /** A year-end closing entry: counted in balances, left out of the profit & loss. */
  closing: boolean
  branchId?: string
  lines: LedgerLine[]
}
export interface LedgerEntry extends LedgerLine {
  posting: number
  date: number
  memo: string
  sourceColl?: string
  sourceId?: string
  closing: boolean
}

export interface Ledger {
  chart: Account[]
  byId: Map<string, Account>
  /** The chart is saved in the data (false = the default chart, built on the fly until it is set up). */
  persisted: boolean
  from?: number
  to?: number
  branchId?: string
  /** Postings inside the period (balanced ones only). */
  postings: LedgerPosting[]
  entries: LedgerEntry[]
  /** Signed balance (debit − credit) of each account at the start of the period. */
  opening: Map<string, number>
  /** Signed balance of each party (debit − credit) at the start of the period. */
  partyOpening: Map<string, number>
  /** Posting lines whose account key the chart has no home for; they sit in suspense. */
  unmapped: Array<{ key: string; count: number; amount: number }>
  /** Postings dropped because their debits and credits differ (a bug in a module's rule — shown, never silently booked). */
  unbalanced: number
  /** Opening balances that do not net to zero: the difference the books carry until it is fixed. */
  openingDifference: number
}

export interface LedgerOptions { from?: number; to?: number; branchId?: string }

const signedOpening = (a: Account) => (isDebitNormal(a.type) ? a.openingBalance : -a.openingBalance)
export const partyKey = (type: PartyType, id: string) => `${type}:${id}`

/** The saved chart, or the default one (with an account for every expense category in use) until the chart is set up. */
export function chartOf(state: DataState): { chart: Account[]; persisted: boolean } {
  const saved = listOf(state.accounts)
  if (saved.length) return { chart: saved, persisted: true }
  return { chart: defaultChart(listOf(state.expenses).map((e) => e.category || 'Other')), persisted: false }
}

export function buildLedger(state: DataState, o: LedgerOptions = {}): Ledger {
  const { chart, persisted } = chartOf(state)
  const byId = new Map(chart.map((a) => [a.id, a]))
  const suspense = resolveAccount(chart, 'suspense') ?? { id: 'acc_suspense', code: '1900', name: 'Suspense (needs an account)', type: 'asset' as const, system: true, key: 'suspense', openingBalance: 0, active: true, createdAt: 0 }
  if (!byId.has(suspense.id)) byId.set(suspense.id, suspense)
  const closingIds = new Set(listOf(state.vouchers).filter((v) => v.type === 'closing').map((v) => v.id))

  const opening = new Map<string, number>()
  const partyOpening = new Map<string, number>()
  if (!o.branchId) for (const a of chart) if (a.openingBalance) opening.set(a.id, signedOpening(a))

  const unmapped = new Map<string, { key: string; count: number; amount: number }>()
  let unbalanced = 0
  const postings: LedgerPosting[] = []
  const entries: LedgerEntry[] = []

  for (const p of postingsFor(state)) {
    if (o.branchId && p.branchId !== o.branchId) continue
    if (!isBalanced(p)) { unbalanced++; continue }
    const before = o.from !== undefined && p.date < o.from
    if (!before && o.to !== undefined && p.date > o.to) continue
    const closing = p.sourceColl === 'vouchers' && closingIds.has(String(p.sourceId))
    const lines: LedgerLine[] = p.lines.map((l) => {
      let acc = resolveAccount(chart, String(l.account))
      if (!acc) {
        acc = suspense
        const u = unmapped.get(String(l.account)) ?? { key: String(l.account), count: 0, amount: 0 }
        u.count++; u.amount = round2(u.amount + (l.debit ?? 0) + (l.credit ?? 0))
        unmapped.set(String(l.account), u)
      }
      return { accountId: acc.id, debit: l.debit ?? 0, credit: l.credit ?? 0, ...(l.party ? { party: l.party } : {}) }
    })
    if (before) {
      for (const l of lines) {
        opening.set(l.accountId, round2((opening.get(l.accountId) ?? 0) + l.debit - l.credit))
        if (l.party) { const k = partyKey(l.party.type, l.party.id); partyOpening.set(k, round2((partyOpening.get(k) ?? 0) + l.debit - l.credit)) }
      }
      continue
    }
    const index = postings.length
    postings.push({ index, date: p.date, memo: p.memo, sourceColl: p.sourceColl, sourceId: p.sourceId, closing, branchId: p.branchId, lines })
    for (const l of lines) entries.push({ ...l, posting: index, date: p.date, memo: p.memo, sourceColl: p.sourceColl, sourceId: p.sourceId, closing })
  }

  // Postings net to nothing, so only the accounts' own opening balances can leave a difference.
  const openingDifference = o.branchId ? 0 : round2(chart.reduce((s, a) => s + signedOpening(a), 0))
  return { chart, byId, persisted, ...(o.from !== undefined ? { from: o.from } : {}), ...(o.to !== undefined ? { to: o.to } : {}), ...(o.branchId ? { branchId: o.branchId } : {}), postings, entries, opening, partyOpening, unmapped: [...unmapped.values()], unbalanced, openingDifference }
}

// ───────────────────────────── per-account figures ─────────────────────────────

const movement = (l: Ledger, accountId: string, pick: (e: LedgerEntry) => boolean = () => true) => {
  let debit = 0, credit = 0
  for (const e of l.entries) if (e.accountId === accountId && pick(e)) { debit += e.debit; credit += e.credit }
  return { debit: round2(debit), credit: round2(credit) }
}

/** The balance of an account at the end of the period, as debit − credit (positive = debit balance). */
export function closingSigned(l: Ledger, accountId: string): number {
  const m = movement(l, accountId)
  return round2((l.opening.get(accountId) ?? 0) + m.debit - m.credit)
}

/** A balance on the account's own side: a bank account's debit balance reads positive; so does a loan's credit balance. */
export const onNormalSide = (a: Account, signed: number) => (isDebitNormal(a.type) ? signed : -signed)

// ───────────────────────────── trial balance ─────────────────────────────

export interface TrialRow { account: Account; opening: number; debit: number; credit: number; closing: number }
export interface TrialBalance {
  rows: TrialRow[]
  /** Closing balances shown in the debit / credit columns. */
  totalDebit: number
  totalCredit: number
  /** A row added when the opening balances do not net to zero (shown so the trial balance still balances). */
  openingDifference: number
  balanced: boolean
}

export function trialBalance(l: Ledger): TrialBalance {
  const rows: TrialRow[] = []
  for (const account of l.chart) {
    const opening = l.opening.get(account.id) ?? 0
    const { debit, credit } = movement(l, account.id)
    const closing = round2(opening + debit - credit)
    if (!opening && !debit && !credit && !closing) continue
    rows.push({ account, opening, debit, credit, closing })
  }
  // Suspense may hold lines even when the chart lacks it.
  rows.sort((a, b) => a.account.code.localeCompare(b.account.code))
  let totalDebit = 0, totalCredit = 0
  for (const r of rows) { if (r.closing > 0) totalDebit += r.closing; else totalCredit -= r.closing }
  const diff = round2(totalDebit - totalCredit)
  const openingDifference = diff === 0 ? 0 : -diff
  if (openingDifference > 0) totalDebit += openingDifference; else totalCredit -= openingDifference
  totalDebit = round2(totalDebit); totalCredit = round2(totalCredit)
  return { rows, totalDebit, totalCredit, openingDifference, balanced: totalDebit === totalCredit }
}

// ───────────────────────────── profit & loss ─────────────────────────────

export interface PlLine { account: Account; amount: number }
export interface ProfitAndLoss {
  income: PlLine[]
  /** Sales less returns, round-off and other income. */
  totalIncome: number
  costOfSales: PlLine[]
  totalCostOfSales: number
  grossProfit: number
  expenses: PlLine[]
  totalExpenses: number
  netProfit: number
  /** What is left before the cost of goods is taken off — the "without COGS" view. */
  profitBeforeCogs: number
}

/** The period's income and expenses. Year-end closing entries are left out, or a closed year would show nothing. */
export function profitAndLoss(l: Ledger): ProfitAndLoss {
  const income: PlLine[] = [], costOfSales: PlLine[] = [], expenses: PlLine[] = []
  for (const account of l.chart) {
    if (account.type !== 'income' && account.type !== 'expense') continue
    const m = movement(l, account.id, (e) => !e.closing)
    const amount = round2(account.type === 'income' ? m.credit - m.debit : m.debit - m.credit)
    if (!amount) continue
    if (account.type === 'income') income.push({ account, amount })
    else (account.group === 'Cost of sales' ? costOfSales : expenses).push({ account, amount })
  }
  const sum = (x: PlLine[]) => round2(x.reduce((s, r) => s + r.amount, 0))
  const byCode = (a: PlLine, b: PlLine) => a.account.code.localeCompare(b.account.code)
  income.sort(byCode); costOfSales.sort(byCode); expenses.sort(byCode)
  const totalIncome = sum(income), totalCostOfSales = sum(costOfSales), totalExpenses = sum(expenses)
  return {
    income, totalIncome, costOfSales, totalCostOfSales, grossProfit: round2(totalIncome - totalCostOfSales), expenses, totalExpenses,
    netProfit: round2(totalIncome - totalCostOfSales - totalExpenses), profitBeforeCogs: round2(totalIncome - totalExpenses),
  }
}

// ───────────────────────────── balance sheet ─────────────────────────────

export interface BsLine { account: Account; amount: number }
export interface BalanceSheet {
  assets: BsLine[]
  totalAssets: number
  liabilities: BsLine[]
  totalLiabilities: number
  equity: BsLine[]
  /** Profit not yet closed into equity (this year's, and any year not closed). */
  currentEarnings: number
  /** Opening balances that did not net to zero. */
  openingDifference: number
  totalEquity: number
  balanced: boolean
}

/** Assets = liabilities + equity (+ profit so far). Build the ledger without `from` so every balance is cumulative. */
export function balanceSheet(l: Ledger): BalanceSheet {
  const assets: BsLine[] = [], liabilities: BsLine[] = [], equity: BsLine[] = []
  let earnings = 0
  for (const account of l.chart) {
    const signed = closingSigned(l, account.id)
    if (!signed) continue
    if (account.type === 'income' || account.type === 'expense') { earnings -= signed; continue }
    const amount = onNormalSide(account, signed)
    ;(account.type === 'asset' ? assets : account.type === 'liability' ? liabilities : equity).push({ account, amount })
  }
  const byCode = (a: BsLine, b: BsLine) => a.account.code.localeCompare(b.account.code)
  assets.sort(byCode); liabilities.sort(byCode); equity.sort(byCode)
  const sum = (x: BsLine[]) => round2(x.reduce((s, r) => s + r.amount, 0))
  const totalAssets = sum(assets), totalLiabilities = sum(liabilities)
  // Balances that sit on the "wrong" side (suspense with a credit, say) still net out because every line is signed.
  const diff = round2(totalAssets - totalLiabilities - sum(equity) - earnings)
  const currentEarnings = round2(earnings)
  const totalEquity = round2(sum(equity) + currentEarnings + diff)
  return { assets, totalAssets, liabilities, totalLiabilities, equity, currentEarnings, openingDifference: diff, totalEquity, balanced: round2(totalAssets - totalLiabilities - totalEquity) === 0 }
}

// ───────────────────────────── account & party ledgers, books ─────────────────────────────

export interface LedgerRow {
  date: number
  memo: string
  /** The other accounts in the same entry ("Sales, GST payable — CGST"). */
  particulars: string
  debit: number
  credit: number
  /** Running balance, debit − credit. */
  balance: number
  sourceColl?: string
  sourceId?: string
}
export interface AccountLedger { account: Account; opening: number; rows: LedgerRow[]; closing: number }

export function accountLedger(l: Ledger, accountId: string): AccountLedger | null {
  const account = l.byId.get(accountId)
  if (!account) return null
  const opening = l.opening.get(accountId) ?? 0
  let balance = opening
  const rows: LedgerRow[] = []
  for (const e of l.entries) {
    if (e.accountId !== accountId) continue
    balance = round2(balance + e.debit - e.credit)
    const others = l.postings[e.posting].lines.filter((x) => x.accountId !== accountId).map((x) => l.byId.get(x.accountId)?.name ?? '').filter(Boolean)
    rows.push({ date: e.date, memo: e.memo, particulars: [...new Set(others)].join(', '), debit: e.debit, credit: e.credit, balance, sourceColl: e.sourceColl, sourceId: e.sourceId })
  }
  return { account, opening, rows, closing: balance }
}

/** The cash book: the ledger of the cash-in-hand account. */
export function cashBook(l: Ledger): AccountLedger | null {
  const a = resolveAccount(l.chart, 'cash')
  return a ? accountLedger(l, a.id) : null
}

export interface PartyRow extends Omit<LedgerRow, 'particulars'> { particulars: string }
export interface PartyLedger {
  type: PartyType
  id: string
  /** Positive = they owe us (customer / employee) or we owe them (supplier). */
  opening: number
  rows: PartyRow[]
  closing: number
}

/**
 * Everything booked against one person. For a customer or employee a debit balance is what they owe; for a supplier a credit
 * balance is what we owe — shown positive either way. A supplier's opening balance on their record is included.
 */
export function partyLedger(l: Ledger, state: DataState, type: PartyType, id: string): PartyLedger {
  const sign = type === 'supplier' ? -1 : 1
  const recorded = type === 'supplier' && !l.branchId ? state.suppliers[id]?.openingBalance ?? 0 : 0
  const opening = round2(sign * (l.partyOpening.get(partyKey(type, id)) ?? 0) + recorded)
  let balance = opening
  const rows: PartyRow[] = []
  for (const e of l.entries) {
    if (e.party?.type !== type || e.party.id !== id) continue
    balance = round2(balance + sign * (e.debit - e.credit))
    const others = l.postings[e.posting].lines.filter((x) => !(x.party?.type === type && x.party.id === id)).map((x) => l.byId.get(x.accountId)?.name ?? '').filter(Boolean)
    rows.push({ date: e.date, memo: e.memo, particulars: [...new Set(others)].join(', '), debit: e.debit, credit: e.credit, balance, sourceColl: e.sourceColl, sourceId: e.sourceId })
  }
  return { type, id, opening, rows, closing: balance }
}

/** Every person of a type with a balance, largest first. Balance as in `partyLedger`. */
export function partyBalances(l: Ledger, state: DataState, type: PartyType): Array<{ id: string; balance: number }> {
  const sign = type === 'supplier' ? -1 : 1
  const totals = new Map<string, number>()
  for (const [k, v] of l.partyOpening) if (k.startsWith(`${type}:`)) totals.set(k.slice(type.length + 1), sign * v)
  for (const e of l.entries) if (e.party?.type === type) totals.set(e.party.id, (totals.get(e.party.id) ?? 0) + sign * (e.debit - e.credit))
  if (type === 'supplier' && !l.branchId) for (const s of listOf(state.suppliers)) if (s.openingBalance) totals.set(s.id, (totals.get(s.id) ?? 0) + s.openingBalance)
  return [...totals.entries()].map(([id, v]) => ({ id, balance: round2(v) })).filter((x) => x.balance !== 0).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
}

export interface DayBookDay { day: number; postings: LedgerPosting[]; total: number }

/** Every entry of the period, a day at a time (newest day first). `total` is the day's debit total. */
export function dayBook(l: Ledger): DayBookDay[] {
  const days = new Map<number, LedgerPosting[]>()
  for (const p of l.postings) { const d = startOfDay(p.date); days.set(d, [...(days.get(d) ?? []), p]) }
  return [...days.entries()].sort((a, b) => b[0] - a[0]).map(([day, postings]) => ({ day, postings, total: round2(postings.reduce((s, p) => s + p.lines.reduce((t, x) => t + x.debit, 0), 0)) }))
}

export interface Attention { unmapped: Ledger['unmapped']; unbalanced: number; suspense: number; openingDifference: number; any: boolean }

/** What needs a person's eye: lines with no account, entries that do not balance, money parked in suspense. */
export function needsAttention(l: Ledger): Attention {
  const s = resolveAccount(l.chart, 'suspense')
  const suspense = s ? closingSigned(l, s.id) : 0
  return { unmapped: l.unmapped, unbalanced: l.unbalanced, suspense, openingDifference: l.openingDifference, any: !!(l.unmapped.length || l.unbalanced || suspense || l.openingDifference) }
}
