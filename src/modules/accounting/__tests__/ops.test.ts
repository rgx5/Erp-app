import { OpError } from '@/data/ops'
import { listOf } from '@/data/state'
import { endOfDay } from '@/domain/dates'
import { buildLedger, profitAndLoss, trialBalance } from '../ledger'
import {
  contraLines, defaultFinancialYear, isLocked, lockedThrough, paymentLines, periodBounds, receiptLines, reversedLines, voucherDebit, voucherProblem,
} from '../logic'
import { addPeriodLock, closeYear, createVoucher, deleteAccount, deleteFinancialYear, removeLatestLock, reverseVoucher, saveAccount, saveFinancialYear, seedChart, syncExpenseAccounts } from '../ops'
import { baseState, commit, ctx, DAY, NOW, trading } from './helpers'

describe('chart of accounts', () => {
  test('seeding saves the default chart with an account per expense category', () => {
    const s = trading()
    const { accounts, changes } = seedChart(s, ctx())
    expect(accounts.find((a) => a.key === 'cash')).toMatchObject({ code: '1001', system: true })
    expect(accounts.map((a) => a.name)).toEqual(expect.arrayContaining(['Rent', 'Electricity']))
    expect(accounts.some((a) => a.key === 'expense:GST / Taxes')).toBe(false)
    expect(new Set(accounts.map((a) => a.code)).size).toBe(accounts.length)
    const s2 = commit(s, changes)
    expect(() => seedChart(s2, ctx())).toThrow('already set up')
    // The saved chart gives the same books as the built-in one.
    expect(trialBalance(buildLedger(s2)).totalDebit).toBe(trialBalance(buildLedger(s)).totalDebit)
  })

  test('a new expense category gets an account when synced', () => {
    let s = commit(trading(), seedChart(trading(), ctx()).changes)
    expect(syncExpenseAccounts(s, ctx()).added).toEqual([])
    s = commit(s, { put: { expenses: [{ id: 'e9', date: NOW, category: 'Repairs', amount: 90, mode: 'cash', vendor: '', note: '', recurring: false, userId: 'u' }] } })
    const { added, changes } = syncExpenseAccounts(s, ctx())
    expect(added.map((a) => a.key)).toEqual(['expense:Repairs'])
    expect(buildLedger(commit(s, changes)).unmapped).toEqual([])
    expect(buildLedger(s).unmapped).toEqual([{ key: 'expense:Repairs', count: 1, amount: 90 }])
  })

  test('add, edit and protect accounts', () => {
    let s = commit(baseState(), seedChart(baseState(), ctx()).changes)
    const draft = { code: '6500', name: 'Travel', type: 'expense' as const, openingBalance: 0, active: true }
    const { account, changes } = saveAccount(s, draft, undefined, ctx())
    s = commit(s, changes)
    expect(account).toMatchObject({ system: false, code: '6500' })
    expect(() => saveAccount(s, { ...draft, name: 'Other' }, undefined, ctx())).toThrow('already used')
    expect(() => saveAccount(s, { ...draft, code: '' }, undefined, ctx())).toThrow('number')
    expect(() => saveAccount(s, { ...draft, code: '6501', parent: 'nope' }, undefined, ctx())).toThrow(OpError)
    const cash = listOf(s.accounts).find((a) => a.key === 'cash')!
    expect(() => saveAccount(s, { code: cash.code, name: 'Cash', type: 'liability', openingBalance: 0, active: true }, cash.id, ctx())).toThrow('cannot change')
    expect(saveAccount(s, { code: cash.code, name: 'Till', type: 'asset', openingBalance: 100, active: true }, cash.id, ctx()).account).toMatchObject({ name: 'Till', key: 'cash', openingBalance: 100 })
    expect(() => deleteAccount(s, cash.id, ctx())).toThrow('Built-in')
    s = commit(s, deleteAccount(s, account.id, ctx()))
    expect(s.accounts[account.id]).toBeUndefined()
  })

  test('an account with entries or a balance cannot be switched off or deleted', () => {
    let s = commit(trading(), seedChart(trading(), ctx()).changes)
    const cash = listOf(s.accounts).find((a) => a.key === 'cash')!
    expect(() => saveAccount(s, { code: cash.code, name: cash.name, type: 'asset', openingBalance: 0, active: false }, cash.id, ctx())).toThrow('still has a balance')
    const custom = saveAccount(s, { code: '6500', name: 'Travel', type: 'expense', openingBalance: 0, active: true }, undefined, ctx())
    s = commit(s, custom.changes)
    s = commit(s, createVoucher(s, { type: 'payment', date: NOW, narration: '', lines: paymentLines({ mode: 'cash', amount: 40, account: '6500' }) }, ctx()))
    expect(() => deleteAccount(s, custom.account.id, ctx())).toThrow('can only be switched off')
  })
})

describe('vouchers', () => {
  test('helpers build balanced lines', () => {
    expect(receiptLines({ mode: 'cash', amount: 100, party: { type: 'customer', id: 'c1' } })).toEqual([{ account: 'cash', debit: 100 }, { account: 'receivables', credit: 100, party: { type: 'customer', id: 'c1' } }])
    expect(paymentLines({ mode: 'bank', amount: 50, party: { type: 'supplier', id: 's1' } })).toEqual([{ account: 'payables', debit: 50, party: { type: 'supplier', id: 's1' } }, { account: 'bank', credit: 50 }])
    expect(contraLines('cash', 'bank', 20)).toEqual([{ account: 'bank', debit: 20 }, { account: 'cash', credit: 20 }])
    for (const l of [receiptLines({ mode: 'upi', amount: 10.5 }), paymentLines({ mode: 'card', amount: 3 }), contraLines('cash', 'bank', 1)]) expect(voucherProblem(l)).toBeNull()
    expect(reversedLines([{ account: 'cash', debit: 5 }, { account: 'sales', credit: 5 }])).toEqual([{ account: 'cash', credit: 5 }, { account: 'sales', debit: 5 }])
  })

  test('only sound vouchers are accepted', () => {
    expect(voucherProblem([{ account: 'cash', debit: 10 }])).toMatch('at least two')
    expect(voucherProblem([{ account: 'cash', debit: 10 }, { account: 'sales', credit: 9.99 }])).toMatch('not equal')
    expect(voucherProblem([{ account: 'cash', debit: 10, credit: 10 }, { account: 'sales', credit: 10 }])).toMatch('not both')
    expect(voucherProblem([{ account: 'cash', debit: -10 }, { account: 'sales', credit: -10 }])).toMatch('negative')
    expect(voucherProblem([{ account: '', debit: 10 }, { account: 'sales', credit: 10 }])).toMatch('account')
    expect(voucherDebit([{ account: 'a', debit: 0.1 }, { account: 'b', debit: 0.2 }])).toBe(0.3)
  })

  test('a receipt from a customer clears what they owe and is numbered per type', () => {
    let s = trading()
    const owed = buildLedger(s).entries.filter((e) => e.party?.id === 'c1').reduce((t, e) => t + e.debit - e.credit, 0)
    const r = createVoucher(s, { type: 'receipt', date: NOW, narration: ' Part payment ', lines: receiptLines({ mode: 'upi', amount: 100, party: { type: 'customer', id: 'c1' } }) }, ctx())
    expect(r.voucher).toMatchObject({ no: 'RV-0001', narration: 'Part payment', type: 'receipt' })
    s = commit(s, r)
    expect(createVoucher(s, { type: 'receipt', date: NOW, narration: '', lines: receiptLines({ mode: 'cash', amount: 1, account: 'sales' }) }, ctx()).voucher.no).toBe('RV-0002')
    expect(createVoucher(s, { type: 'journal', date: NOW, narration: '', lines: receiptLines({ mode: 'cash', amount: 1, account: 'sales' }) }, ctx({ series: 'M4X' })).voucher.no).toBe('JV-M4X-0001')
    const l = buildLedger(s)
    expect(l.entries.filter((e) => e.party?.id === 'c1').reduce((t, e) => t + e.debit - e.credit, 0)).toBeCloseTo(owed - 100, 2)
    expect(trialBalance(l).balanced).toBe(true)
  })

  test('refusals: unbalanced, unknown account, no date', () => {
    const s = baseState()
    const d = { type: 'journal' as const, date: NOW, narration: '', lines: [{ account: 'cash', debit: 5 }, { account: 'sales', credit: 4 }] }
    expect(() => createVoucher(s, d, ctx())).toThrow('not equal')
    expect(() => createVoucher(s, { ...d, lines: [{ account: 'cash', debit: 5 }, { account: 'ghost', credit: 5 }] }, ctx())).toThrow('no account')
    expect(() => createVoucher(s, { ...d, date: NaN, lines: [{ account: 'cash', debit: 5 }, { account: 'sales', credit: 5 }] }, ctx())).toThrow('date')
  })

  test('a mistake is reversed once, by a mirror voucher', () => {
    let s = baseState()
    const v = createVoucher(s, { type: 'payment', date: NOW - 2 * DAY, narration: 'oops', lines: paymentLines({ mode: 'cash', amount: 75, account: 'drawings' }) }, ctx())
    s = commit(s, v)
    const r = reverseVoucher(s, v.voucher.id, ctx())
    expect(r.voucher).toMatchObject({ type: 'journal', reversesId: v.voucher.id, date: NOW, narration: `Reversal of ${v.voucher.no}` })
    s = commit(s, r)
    expect(() => reverseVoucher(s, v.voucher.id, ctx())).toThrow('already been reversed')
    expect(() => reverseVoucher(s, r.voucher.id, ctx())).toThrow('itself a reversal')
    expect(() => reverseVoucher(s, 'nope', ctx())).toThrow('no longer exists')
    expect(trialBalance(buildLedger(s)).rows.every((x) => x.closing === 0)).toBe(true)
  })
})

describe('financial years and locks', () => {
  test('the Indian year runs April to March', () => {
    expect(defaultFinancialYear(NOW).label).toBe('FY 2026-27')
    expect(defaultFinancialYear(new Date('2027-02-10').getTime()).label).toBe('FY 2026-27')
    const [from, to] = periodBounds('fy', NOW)
    expect(new Date(from).getMonth()).toBe(3)
    expect(to).toBeLessThanOrEqual(endOfDay(NOW))
    expect(periodBounds('last-fy', NOW)[0]).toBe(new Date(2025, 3, 1).getTime())
    expect(new Date(periodBounds('quarter', NOW)[0]).getMonth()).toBe(9)
    expect(periodBounds('month', NOW)[0]).toBe(new Date(2026, 9, 1).getTime())
    expect(periodBounds('last-month', NOW)).toEqual([new Date(2026, 8, 1).getTime(), endOfDay(new Date(2026, 8, 30))])
  })

  test('years may not overlap and need a name', () => {
    let s = baseState()
    const fy = { label: 'FY 2025-26', start: new Date(2025, 3, 1).getTime(), end: endOfDay(new Date(2026, 2, 31)) }
    const r = saveFinancialYear(s, fy, undefined, ctx())
    s = commit(s, r)
    expect(() => saveFinancialYear(s, { ...fy, label: 'again' }, undefined, ctx())).toThrow('overlaps')
    expect(() => saveFinancialYear(s, { ...fy, label: ' ' }, undefined, ctx())).toThrow('name')
    expect(() => saveFinancialYear(s, { label: 'x', start: 10, end: 5 }, undefined, ctx())).toThrow('end after')
    expect(saveFinancialYear(s, { ...fy, label: 'FY 25-26' }, r.year.id, ctx()).year.label).toBe('FY 25-26')
    s = commit(s, deleteFinancialYear(s, r.year.id, ctx()))
    expect(listOf(s.financialYears)).toHaveLength(0)
  })

  test('a lock refuses vouchers on or before its date, here and for everyone', () => {
    let s = baseState()
    const through = endOfDay(NOW - 10 * DAY)
    const l = addPeriodLock(s, through, 'September done', ctx())
    s = commit(s, l)
    expect(lockedThrough(s)).toBe(through)
    expect(isLocked(s, through)).toBe(true)
    expect(isLocked(s, through + 1)).toBe(false)
    const v = (date: number) => ({ type: 'journal' as const, date, narration: '', lines: [{ account: 'cash', debit: 5 }, { account: 'sales', credit: 5 }] })
    expect(() => createVoucher(s, v(NOW - 12 * DAY), ctx())).toThrow('locked period')
    expect(createVoucher(s, v(NOW - 9 * DAY), ctx()).voucher.date).toBe(NOW - 9 * DAY)
    expect(() => addPeriodLock(s, through - DAY, '', ctx())).toThrow('already locked')
    // Reversal is dated today, so a lock never blocks fixing a mistake — until today is locked.
    const open = createVoucher(s, v(NOW), ctx())
    s = commit(s, open)
    s = commit(s, addPeriodLock(s, endOfDay(NOW), '', ctx()))
    expect(() => reverseVoucher(s, open.voucher.id, ctx())).toThrow('locked period')
    s = commit(s, removeLatestLock(s, ctx()))
    expect(lockedThrough(s)).toBe(through)
  })

  test('closing a year moves its profit to retained earnings, locks it, and leaves the P&L readable', () => {
    let s = commit(trading(), seedChart(trading(), ctx()).changes)
    const fy = { label: 'FY 2026-27', start: new Date(2026, 3, 1).getTime(), end: endOfDay(new Date(2027, 2, 31)) }
    const y = saveFinancialYear(s, fy, undefined, ctx())
    s = commit(s, y)
    expect(() => closeYear(s, y.year.id, ctx())).toThrow('not ended')
    const later = ctx({ now: fy.end + DAY })
    const profit = profitAndLoss(buildLedger(s, { from: fy.start, to: fy.end })).netProfit
    expect(profit).not.toBe(0)
    const closed = closeYear(s, y.year.id, later)
    s = commit(s, closed.changes)
    expect(closed.voucher).toMatchObject({ type: 'closing', date: fy.end, yearId: y.year.id })
    expect(closed.year).toMatchObject({ status: 'closed', closingVoucherId: closed.voucher!.id })
    expect(lockedThrough(s)).toBe(fy.end)
    const l = buildLedger(s)
    // Every income / expense account is back to nil, the profit sits in retained earnings, and the year's P&L is unchanged.
    const bs = Object.fromEntries(trialBalance(l).rows.map((r) => [r.account.key ?? r.account.code, r.closing]))
    expect(bs.sales).toBe(0)
    expect(bs.retained_earnings).toBe(-profit)
    expect(trialBalance(l).balanced).toBe(true)
    expect(profitAndLoss(buildLedger(s, { from: fy.start, to: fy.end })).netProfit).toBe(profit)
    expect(() => closeYear(s, y.year.id, later)).toThrow('already closed')
    expect(() => removeLatestLock(s, later)).toThrow('closed')
    expect(() => saveFinancialYear(s, fy, y.year.id, later)).toThrow('closed year')
    expect(() => deleteFinancialYear(s, y.year.id, later)).toThrow('closed year')
    expect(() => reverseVoucher(s, closed.voucher!.id, later)).toThrow('closing')
  })

  test('years close in order', () => {
    let s = commit(baseState(), seedChart(baseState(), ctx()).changes)
    const a = saveFinancialYear(s, { label: 'A', start: new Date(2024, 3, 1).getTime(), end: endOfDay(new Date(2025, 2, 31)) }, undefined, ctx())
    s = commit(s, a)
    const b = saveFinancialYear(s, { label: 'B', start: new Date(2025, 3, 1).getTime(), end: endOfDay(new Date(2026, 2, 31)) }, undefined, ctx())
    s = commit(s, b)
    expect(() => closeYear(s, b.year.id, ctx())).toThrow('earlier years first')
    s = commit(s, closeYear(s, a.year.id, ctx()))
    expect(closeYear(s, b.year.id, ctx()).year.status).toBe('closed')
  })
})
