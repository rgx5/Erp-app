import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { GST_PAYMENT_CATEGORY } from '@/domain/analytics'
import { nextNo } from '../numbering'
import { defaultChart, EXPENSE_PREFIX, expenseAccountFor, nextExpenseCode, resolveAccount } from './chart'
import { buildLedger, chartOf, closingSigned, profitAndLoss } from './ledger'
import { isLocked, lockedThrough, reversedLines, VOUCHER_PREFIX, voucherProblem } from './logic'
import type { Account, AccountType, FinancialYear, PeriodLock, Voucher, VoucherLine, VoucherType } from './types'
import './postings'
import './replication'

const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense']
const LOCKED = 'That date is in a locked period — nothing can be posted there. Ask the owner to unlock it.'

// ───────────────────────────── chart of accounts ─────────────────────────────

/** Saves the default chart (and an account for each expense category in use) the first time the books are opened. */
export function seedChart(state: DataState, ctx: OpCtx): { changes: Changes; accounts: Account[] } {
  if (listOf(state.accounts).length) throw new OpError('The chart of accounts is already set up.')
  const accounts = defaultChart(listOf(state.expenses).filter((e) => e.category !== GST_PAYMENT_CATEGORY).map((e) => e.category || 'Other'), ctx.now)
  return { accounts, changes: { put: { accounts, audit: [audit(ctx, 'CHART_SEED', `${accounts.length} accounts`)] } } }
}

/** Adds an account for every expense category that has none (a new category appears as you record expenses). */
export function syncExpenseAccounts(state: DataState, ctx: OpCtx): { changes: Changes; added: Account[] } {
  const { chart, persisted } = chartOf(state)
  if (!persisted) throw new OpError('Set up the chart of accounts first.')
  const keys = new Set(listOf(state.expenses).filter((e) => e.category !== GST_PAYMENT_CATEGORY).map((e) => `${EXPENSE_PREFIX}${e.category || 'Other'}`))
  const added: Account[] = []
  let n = nextExpenseCode(chart)
  for (const key of [...keys].sort()) {
    if (resolveAccount([...chart, ...added], key)) continue
    added.push(expenseAccountFor(key.slice(EXPENSE_PREFIX.length), n, ctx.now))
    n = nextExpenseCode([...chart, ...added])
  }
  return { added, changes: added.length ? { put: { accounts: added, audit: [audit(ctx, 'CHART_SYNC', added.map((a) => a.name).join(', '))] } } : {} }
}

export interface AccountDraft {
  code: string
  name: string
  type: AccountType
  parent?: string
  group?: string
  openingBalance: number
  openingDate?: number
  active: boolean
}

export function saveAccount(state: DataState, d: AccountDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; account: Account } {
  const { chart, persisted } = chartOf(state)
  if (!persisted) throw new OpError('Set up the chart of accounts first.')
  const code = d.code.trim(), name = d.name.trim()
  if (!code) throw new OpError('Give the account a number.')
  if (!name) throw new OpError('Give the account a name.')
  if (!TYPES.includes(d.type)) throw new OpError('Choose what kind of account this is.')
  if (chart.some((a) => a.code === code && a.id !== existingId)) throw new OpError(`Account number ${code} is already used.`)
  if (!Number.isFinite(d.openingBalance)) throw new OpError('The opening balance must be a number.')
  if (d.parent && (!chart.some((a) => a.id === d.parent) || d.parent === existingId)) throw new OpError('Choose a different parent account.')

  if (existingId) {
    const cur = state.accounts[existingId]
    if (!cur) throw new OpError('That account no longer exists.')
    if (cur.system && (cur.type !== d.type || cur.code !== code)) throw new OpError('The number and kind of a built-in account cannot change — rename it instead.')
    if (cur.active && !d.active) {
      const balance = closingSigned(buildLedger(state), cur.id)
      if (balance !== 0) throw new OpError(`It still has a balance of ₹${Math.abs(balance).toFixed(2)} — move it first.`)
    }
    const account: Account = { ...cur, code, name, type: d.type, parent: d.parent, ...(d.group !== undefined ? { group: d.group } : {}), openingBalance: round2(d.openingBalance), openingDate: d.openingDate, active: d.active }
    return { account, changes: { put: { accounts: [account], audit: [audit(ctx, 'ACCOUNT_EDIT', `${code} ${name}`)] } } }
  }
  const account: Account = { id: id('acc', ctx.now), code, name, type: d.type, parent: d.parent, system: false, ...(d.group ? { group: d.group } : {}), openingBalance: round2(d.openingBalance), openingDate: d.openingDate, active: d.active, createdAt: ctx.now }
  return { account, changes: { put: { accounts: [account], audit: [audit(ctx, 'ACCOUNT_ADD', `${code} ${name}`)] } } }
}

export function deleteAccount(state: DataState, accountId: string, ctx: OpCtx): { changes: Changes } {
  const a = state.accounts[accountId]
  if (!a) throw new OpError('That account no longer exists.')
  if (a.system) throw new OpError('Built-in accounts cannot be deleted — switch them off instead.')
  if (a.openingBalance) throw new OpError('It has an opening balance — clear that first.')
  if (listOf(state.accounts).some((x) => x.parent === a.id)) throw new OpError('Other accounts are grouped under it.')
  if (buildLedger(state).entries.some((e) => e.accountId === a.id)) throw new OpError('Entries have been posted to it, so it can only be switched off.')
  return { changes: { del: { accounts: [accountId] }, put: { audit: [audit(ctx, 'ACCOUNT_DELETE', `${a.code} ${a.name}`)] } } }
}

// ───────────────────────────── vouchers ─────────────────────────────

export interface VoucherDraft {
  type: Exclude<VoucherType, 'closing'>
  date: number
  narration: string
  lines: VoucherLine[]
  attachments?: string[]
}

function checkAccounts(state: DataState, lines: VoucherLine[]) {
  const { chart } = chartOf(state)
  for (const l of lines) if (!resolveAccount(chart, l.account)) throw new OpError(`There is no account “${l.account}”. Choose one from the chart.`)
}

const tidy = (lines: VoucherLine[]): VoucherLine[] => lines
  .filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0)
  .map((l) => ({ account: l.account, ...(l.debit ? { debit: round2(l.debit) } : {}), ...(l.credit ? { credit: round2(l.credit) } : {}), ...(l.party ? { party: l.party } : {}) }))

/** Posts a voucher. It is final: a mistake is put right with `reverseVoucher`, not by editing. */
export function createVoucher(state: DataState, d: VoucherDraft, ctx: OpCtx): { changes: Changes; voucher: Voucher } {
  const lines = tidy(d.lines)
  const problem = voucherProblem(lines)
  if (problem) throw new OpError(problem)
  if (!Number.isFinite(d.date)) throw new OpError('Choose the date.')
  if (isLocked(state, d.date)) throw new OpError(LOCKED)
  checkAccounts(state, lines)
  const voucher: Voucher = {
    id: id('vch', ctx.now), no: nextNo(VOUCHER_PREFIX[d.type], listOf(state.vouchers).filter((v) => v.type === d.type).map((v) => v.no), ctx), type: d.type, date: d.date,
    narration: d.narration.trim(), lines, ...(d.attachments?.length ? { attachments: d.attachments } : {}), createdBy: ctx.userId, createdAt: ctx.now, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  return { voucher, changes: { put: { vouchers: [voucher], audit: [audit(ctx, 'VOUCHER', `${voucher.no} ₹${lines.reduce((s, l) => s + (l.debit ?? 0), 0)}`)] } } }
}

/** Cancels a voucher's effect with a new voucher dated today that mirrors it. Each voucher can be reversed once. */
export function reverseVoucher(state: DataState, voucherId: string, ctx: OpCtx): { changes: Changes; voucher: Voucher } {
  const v = state.vouchers[voucherId]
  if (!v) throw new OpError('That voucher no longer exists.')
  if (v.type === 'closing') throw new OpError('A year-end closing cannot be reversed — reopen the year by removing its lock instead.')
  if (v.reversesId) throw new OpError('This voucher is itself a reversal.')
  if (listOf(state.vouchers).some((x) => x.reversesId === v.id)) throw new OpError('This voucher has already been reversed.')
  if (isLocked(state, ctx.now)) throw new OpError(LOCKED)
  const voucher: Voucher = {
    id: id('vch', ctx.now), no: nextNo(VOUCHER_PREFIX.journal, listOf(state.vouchers).filter((x) => x.type === 'journal').map((x) => x.no), ctx), type: 'journal', date: ctx.now,
    narration: `Reversal of ${v.no}`, lines: reversedLines(v.lines), reversesId: v.id, createdBy: ctx.userId, createdAt: ctx.now, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  return { voucher, changes: { put: { vouchers: [voucher], audit: [audit(ctx, 'VOUCHER_REVERSE', `${v.no} → ${voucher.no}`)] } } }
}

// ───────────────────────────── financial years and locks ─────────────────────────────

export function saveFinancialYear(state: DataState, d: { label: string; start: number; end: number }, existingId: string | undefined, ctx: OpCtx): { changes: Changes; year: FinancialYear } {
  const label = d.label.trim()
  if (!label) throw new OpError('Give the year a name, like FY 2026-27.')
  if (!(d.end > d.start)) throw new OpError('The year must end after it starts.')
  const others = listOf(state.financialYears).filter((y) => y.id !== existingId)
  if (others.some((y) => d.start <= y.end && d.end >= y.start)) throw new OpError('That overlaps another financial year.')
  if (existingId) {
    const cur = state.financialYears[existingId]
    if (!cur) throw new OpError('That year no longer exists.')
    if (cur.status === 'closed') throw new OpError('A closed year cannot be changed.')
    const year = { ...cur, label, start: d.start, end: d.end }
    return { year, changes: { put: { financialYears: [year], audit: [audit(ctx, 'FY_EDIT', label)] } } }
  }
  const year: FinancialYear = { id: id('fy', ctx.now), label, start: d.start, end: d.end, status: 'open' }
  return { year, changes: { put: { financialYears: [year], audit: [audit(ctx, 'FY_ADD', label)] } } }
}

export function deleteFinancialYear(state: DataState, yearId: string, ctx: OpCtx): { changes: Changes } {
  const y = state.financialYears[yearId]
  if (!y) throw new OpError('That year no longer exists.')
  if (y.status === 'closed') throw new OpError('A closed year cannot be deleted.')
  return { changes: { del: { financialYears: [yearId] }, put: { audit: [audit(ctx, 'FY_DELETE', y.label)] } } }
}

/** Nothing on or before `throughDate` may be posted or changed. */
export function addPeriodLock(state: DataState, throughDate: number, note: string, ctx: OpCtx): { changes: Changes; lock: PeriodLock } {
  if (!Number.isFinite(throughDate)) throw new OpError('Choose the last day to lock.')
  const cur = lockedThrough(state)
  if (cur !== null && throughDate <= cur) throw new OpError('That period is already locked.')
  const lock: PeriodLock = { id: id('lock', ctx.now), throughDate, note: note.trim(), createdBy: ctx.userId, createdAt: ctx.now }
  return { lock, changes: { put: { periodLocks: [lock], audit: [audit(ctx, 'PERIOD_LOCK', new Date(throughDate).toDateString())] } } }
}

/** Unlocks the most recent lock (and so reopens its period). */
export function removeLatestLock(state: DataState, ctx: OpCtx): { changes: Changes } {
  const locks = listOf(state.periodLocks)
  if (!locks.length) throw new OpError('Nothing is locked.')
  const latest = locks.reduce((m, l) => (l.throughDate > m.throughDate ? l : m))
  const closed = listOf(state.financialYears).find((y) => y.status === 'closed' && y.end === latest.throughDate)
  if (closed) throw new OpError(`${closed.label} is closed. Closed years stay locked.`)
  return { changes: { del: { periodLocks: [latest.id] }, put: { audit: [audit(ctx, 'PERIOD_UNLOCK', new Date(latest.throughDate).toDateString())] } } }
}

/**
 * Closes a year: the year's profit (or loss) is moved into retained earnings by a closing voucher, the year is marked closed,
 * and its dates are locked.
 */
export function closeYear(state: DataState, yearId: string, ctx: OpCtx): { changes: Changes; year: FinancialYear; voucher?: Voucher } {
  const y = state.financialYears[yearId]
  if (!y) throw new OpError('That year no longer exists.')
  if (y.status === 'closed') throw new OpError(`${y.label} is already closed.`)
  if (ctx.now <= y.end) throw new OpError(`${y.label} has not ended yet.`)
  if (listOf(state.financialYears).some((o) => o.status === 'open' && o.end < y.start)) throw new OpError('Close the earlier years first.')
  const locked = lockedThrough(state)
  if (locked !== null && locked >= y.end) throw new OpError('This period is already locked.')
  const { chart, persisted } = chartOf(state)
  if (!persisted) throw new OpError('Set up the chart of accounts before closing a year.')
  const retained = resolveAccount(chart, 'retained_earnings')
  if (!retained) throw new OpError('The chart has no retained-earnings account.')

  const pl = profitAndLoss(buildLedger(state, { from: y.start, to: y.end }))
  const lines: VoucherLine[] = []
  const zero = (account: Account, amount: number, incomeSide: boolean) => {
    // Income is credit-normal: a positive amount is cleared with a debit. Expenses the other way round.
    const debit = incomeSide ? amount > 0 : amount < 0
    lines.push({ account: account.id, [debit ? 'debit' : 'credit']: round2(Math.abs(amount)) })
  }
  for (const r of pl.income) zero(r.account, r.amount, true)
  for (const r of [...pl.costOfSales, ...pl.expenses]) zero(r.account, r.amount, false)
  let voucher: Voucher | undefined
  const put: Changes['put'] = { audit: [audit(ctx, 'FY_CLOSE', `${y.label} — profit ₹${pl.netProfit}`)] }
  if (lines.length) {
    const d = round2(lines.reduce((s, l) => s + (l.debit ?? 0), 0)), c = round2(lines.reduce((s, l) => s + (l.credit ?? 0), 0))
    const net = round2(c - d)
    lines.push(net >= 0 ? { account: retained.id, debit: net } : { account: retained.id, credit: -net })
    voucher = {
      id: id('vch', ctx.now), no: nextNo(VOUCHER_PREFIX.closing, listOf(state.vouchers).filter((v) => v.type === 'closing').map((v) => v.no), ctx), type: 'closing', date: y.end,
      narration: `Closing of ${y.label}`, lines, yearId: y.id, createdBy: ctx.userId, createdAt: ctx.now, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    }
    put.vouchers = [voucher]
  }
  const year: FinancialYear = { ...y, status: 'closed', closedAt: ctx.now, closedBy: ctx.userId, ...(voucher ? { closingVoucherId: voucher.id } : {}) }
  const lock: PeriodLock = { id: `lock_${y.id}`, throughDate: y.end, note: `${y.label} closed`, createdBy: ctx.userId, createdAt: ctx.now }
  put.financialYears = [year]
  put.periodLocks = [lock]
  return { year, voucher, changes: { put } }
}
