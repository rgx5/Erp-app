import { listOf } from '@/data/state'
import { endOfDay } from '@/domain/dates'
import { isBalanced, postingsFor, type Posting } from '../../postings'
import { resolveAccount } from '../chart'
import {
  accountLedger, balanceSheet, buildLedger, cashBook, closingSigned, dayBook, needsAttention, partyBalances, partyLedger, profitAndLoss, trialBalance,
} from '../ledger'
import { createVoucher } from '../ops'
import { billPosting, expensePosting, purchasePosting, sessionPosting, stockAdjustPosting } from '../postings'
import { baseState, billInput, commit, ctx, DAY, line, NOW, trading, withOpeningStock } from './helpers'

const sum = (p: Posting, k: 'debit' | 'credit') => Math.round(p.lines.reduce((s, l) => s + (l[k] ?? 0), 0) * 100) / 100
const balanceOf = (s: ReturnType<typeof trading>, key: string, to?: number) => {
  const l = buildLedger(s, to ? { to } : {})
  return closingSigned(l, resolveAccount(l.chart, key)!.id)
}

describe('posting rules for the core documents', () => {
  test('every posting the trading data implies is balanced to the paisa', () => {
    const s = trading()
    const all = postingsFor(s)
    expect(all.length).toBeGreaterThan(8)
    for (const p of all) {
      expect(isBalanced(p)).toBe(true)
      expect(sum(p, 'debit')).toBe(sum(p, 'credit'))
    }
    expect(buildLedger(s).unbalanced).toBe(0)
  })

  test('a cash sale: cash in; sales and GST out; stock leaves at cost', () => {
    const s = baseState()
    const b = billInput(s, [line(s.variants.v1, 2)])
    const p = billPosting({ ...b, id: 'b', no: 'INV-1' })!
    const by = (acc: string) => p.lines.filter((l) => l.account === acc)
    expect(by('cash')[0].debit).toBe(b.total)
    expect(by('sales')[0].credit).toBeCloseTo(b.total - b.cgstTotal - b.sgstTotal - b.roundOff, 2)
    expect(by('gst_output_cgst')[0].credit).toBe(b.cgstTotal)
    expect(by('gst_output_sgst')[0].credit).toBe(b.sgstTotal)
    expect(by('cogs')[0].debit).toBe(800)
    expect(by('inventory')[0].credit).toBe(800)
    expect(isBalanced(p)).toBe(true)
  })

  test('an inter-state sale books IGST, not CGST / SGST', () => {
    const s = baseState()
    const b = billInput(s, [line(s.variants.v1, 1)])
    const p = billPosting({ ...b, id: 'b', no: 'INV-1', cgstTotal: 0, sgstTotal: 0, igstTotal: b.cgstTotal + b.sgstTotal } as typeof b & { id: string; no: string })!
    expect(p.lines.find((l) => l.account === 'gst_output_igst')?.credit).toBeCloseTo(b.cgstTotal + b.sgstTotal, 2)
    expect(p.lines.some((l) => l.account === 'gst_output_cgst')).toBe(false)
    expect(isBalanced(p)).toBe(true)
  })

  test('a held bill books nothing; change given back is not revenue', () => {
    const s = baseState()
    const b = billInput(s, [line(s.variants.v1, 1)])
    expect(billPosting({ ...b, id: 'b', no: 'H', status: 'held' })).toBeNull()
    const tendered = Math.ceil(b.total / 500) * 500
    const p = billPosting({ ...b, id: 'b', no: 'INV-1', payments: [{ mode: 'cash', amount: tendered }], changeDue: tendered - b.total })!
    expect(p.lines.find((l) => l.account === 'cash')?.debit).toBe(b.total)
    expect(isBalanced(p)).toBe(true)
  })

  test('a credit sale puts the balance on the customer', () => {
    const s = baseState()
    const b = billInput(s, [line(s.variants.v1, 1)], { customerId: 'c1', payments: [{ mode: 'due', amount: 999 }], paid: 0 })
    const p = billPosting({ ...b, id: 'b', no: 'INV-1' })!
    expect(p.lines.find((l) => l.account === 'receivables')).toMatchObject({ debit: 999, party: { type: 'customer', id: 'c1' } })
  })

  test('purchase, expense, GST payment, day-close variance and stock counts', () => {
    const s = withOpeningStock(baseState())
    const pur = purchasePosting({ id: 'p', no: 'GRN-1', supplierId: 's1', date: NOW, invoiceRef: '', items: [], total: 1000, paid: 400, notes: '', userId: 'u' })!
    expect(pur.lines).toEqual([
      { account: 'inventory', debit: 1000 }, { account: 'payables', credit: 1000, party: { type: 'supplier', id: 's1' } },
      { account: 'payables', debit: 400, party: { type: 'supplier', id: 's1' } }, { account: 'cash', credit: 400 },
    ])
    const exp = expensePosting({ id: 'e', date: NOW, category: 'Rent', amount: 100, mode: 'upi', vendor: '', note: '', recurring: false, userId: 'u' })!
    expect(exp.lines).toEqual([{ account: 'expense:Rent', debit: 100 }, { account: 'upi', credit: 100 }])
    expect(expensePosting({ id: 'e', date: NOW, category: 'GST / Taxes', amount: 100, mode: 'bank', vendor: '', note: '', recurring: false, userId: 'u' })!.lines[0].account).toBe('gst_paid')
    expect(sessionPosting({ id: 's', openedAt: NOW, openedBy: 'u', openingCash: 0, closedAt: NOW, variance: -50 })!.lines).toEqual([{ account: 'cash_over_short', debit: 50 }, { account: 'cash', credit: 50 }])
    expect(sessionPosting({ id: 's', openedAt: NOW, openedBy: 'u', openingCash: 0 })).toBeNull()
    const count = (qty: number, type: 'audit' | 'adjust' = 'audit', ref = 'AUDIT') => stockAdjustPosting({ id: 'm', variantId: 'v1', qty, type, ref, reason: '', at: NOW, userId: 'u' }, s)!
    expect(count(-2).lines).toEqual([{ account: 'stock_adjustments', debit: 800 }, { account: 'inventory', credit: 800 }])
    expect(count(1).lines).toEqual([{ account: 'inventory', debit: 400 }, { account: 'stock_adjustments', credit: 400 }])
    expect(stockAdjustPosting({ id: 'm', variantId: 'v1', qty: -1, type: 'adjust', ref: 'WO-0001', reason: '', at: NOW, userId: 'u' }, s)).toBeNull()
    expect(count(-1, 'adjust', 'MANUAL')).toBeTruthy()
  })
})

describe('the books computed from the documents', () => {
  const s = trading()

  test('the trial balance equals zero', () => {
    const tb = trialBalance(buildLedger(s))
    expect(tb.balanced).toBe(true)
    expect(tb.totalDebit).toBe(tb.totalCredit)
    expect(tb.totalDebit).toBeGreaterThan(0)
    expect(tb.openingDifference).toBe(0)
    const net = tb.rows.reduce((t, r) => t + r.closing, 0)
    expect(Math.round(net * 100)).toBe(0)
  })

  test('it holds for any period, and with period opening balances', () => {
    for (const [from, to] of [[NOW - 5 * DAY, NOW], [NOW - 3 * DAY, NOW - 1 * DAY], [NOW + DAY, NOW + 2 * DAY]]) {
      const tb = trialBalance(buildLedger(s, { from, to }))
      expect(tb.balanced).toBe(true)
    }
  })

  test('profit & loss reconciles with the balance sheet', () => {
    const l = buildLedger(s)
    const pl = profitAndLoss(l)
    const bs = balanceSheet(l)
    expect(bs.balanced).toBe(true)
    expect(bs.currentEarnings).toBe(pl.netProfit)
    expect(bs.totalAssets).toBe(Math.round((bs.totalLiabilities + bs.totalEquity) * 100) / 100)
    expect(pl.netProfit).toBe(Math.round((pl.totalIncome - pl.totalCostOfSales - pl.totalExpenses) * 100) / 100)
    expect(pl.expenses.map((e) => e.account.name)).toEqual(expect.arrayContaining(['Rent', 'Electricity']))
    // GST paid to the government settles a liability: it is not an expense.
    expect(pl.expenses.some((e) => e.account.key === 'gst_paid')).toBe(false)
    expect(balanceOf(s, 'gst_paid')).toBe(100)
  })

  test('the P&L of a sub-period matches what happened then', () => {
    const early = profitAndLoss(buildLedger(s, { from: NOW - 9 * DAY, to: NOW - 8 * DAY }))
    expect(early.totalExpenses).toBe(0)
    expect(early.totalIncome).toBeGreaterThan(0)
    const rent = profitAndLoss(buildLedger(s, { from: NOW - 4 * DAY, to: NOW - 4 * DAY + DAY - 1 }))
    expect(rent.totalExpenses).toBe(1200)
  })

  test('the balance sheet at an earlier date is balanced too', () => {
    const bs = balanceSheet(buildLedger(s, { to: endOfDay(NOW - 5 * DAY) }))
    expect(bs.balanced).toBe(true)
  })

  test('cash book follows every rupee of cash', () => {
    const cb = cashBook(buildLedger(s))!
    expect(cb.rows.length).toBeGreaterThan(4)
    expect(cb.closing).toBe(balanceOf(s, 'cash'))
    expect(cb.rows.at(-1)!.balance).toBe(cb.closing)
    // Rent 1200 out, supplier part-payment 1500 out, a refund out, day close short 50 out.
    expect(cb.rows.some((r) => r.credit === 1200)).toBe(true)
    expect(cb.rows.some((r) => r.credit === 50)).toBe(true)
  })

  test('customer and supplier ledgers', () => {
    const l = buildLedger(s)
    const meera = partyLedger(l, s, 'customer', 'c1')
    expect(meera.rows).toHaveLength(1)
    expect(meera.closing).toBeGreaterThan(0)
    expect(meera.closing).toBe(meera.rows[0].debit)
    const fab = partyLedger(l, s, 'supplier', 's1')
    expect(fab.closing).toBe(2500)
    expect(partyBalances(l, s, 'supplier')).toEqual([{ id: 's1', balance: 2500 }])
    expect(partyBalances(l, s, 'customer').map((x) => x.id)).toEqual(['c1'])
    // The sum of the people equals the control account.
    expect(balanceOf(s, 'receivables')).toBe(meera.closing)
    expect(-balanceOf(s, 'payables')).toBe(fab.closing)
  })

  test('a supplier’s opening balance is part of what we owe', () => {
    const s2 = commit(s, { put: { suppliers: [{ ...s.suppliers.s1, openingBalance: 700 }] } })
    expect(partyLedger(buildLedger(s2), s2, 'supplier', 's1').closing).toBe(3200)
    expect(partyLedger(buildLedger(s2, { from: NOW - 3 * DAY }), s2, 'supplier', 's1').opening).toBeGreaterThan(700)
  })

  test('day book lists each day, newest first, with debit totals', () => {
    const days = dayBook(buildLedger(s))
    expect(days.length).toBeGreaterThan(5)
    expect(days[0].day).toBeGreaterThan(days[1].day)
    for (const d of days) expect(d.total).toBe(Math.round(d.postings.reduce((t, p) => t + p.lines.reduce((u, x) => u + x.debit, 0), 0) * 100) / 100)
  })

  test('account ledger runs a balance and names the other side', () => {
    const l = buildLedger(s)
    const sales = accountLedger(l, resolveAccount(l.chart, 'sales')!.id)!
    expect(sales.rows[0].particulars).toMatch(/Cash in hand/)
    expect(sales.closing).toBe(balanceOf(s, 'sales'))
    expect(accountLedger(l, 'nope')).toBeNull()
  })

  test('opening balances enter the trial balance and balance sheet', () => {
    let s2 = commit(baseState(), { put: { accounts: [] } })
    const l0 = buildLedger(s2)
    const chart = l0.chart.map((a) => (a.key === 'cash' ? { ...a, openingBalance: 5000 } : a.key === 'owner_capital' ? { ...a, openingBalance: 5000 } : a))
    s2 = commit(s2, { put: { accounts: chart } })
    const l = buildLedger(s2)
    expect(l.persisted).toBe(true)
    expect(l.openingDifference).toBe(0)
    expect(balanceSheet(l)).toMatchObject({ totalAssets: 5000, totalEquity: 5000, balanced: true })
    // A lopsided opening is shown, never hidden.
    const skew = chart.map((a) => (a.key === 'owner_capital' ? { ...a, openingBalance: 4000 } : a))
    const lSkew = buildLedger(commit(s2, { put: { accounts: skew } }))
    expect(lSkew.openingDifference).toBe(1000)
    expect(trialBalance(lSkew).balanced).toBe(true)
    expect(balanceSheet(lSkew).balanced).toBe(true)
  })

  test('lines with no home in the chart land in suspense and are flagged', () => {
    const base = buildLedger(s)
    expect(needsAttention(base).any).toBe(false)
    const chart = base.chart.filter((a) => a.key !== 'expense:Rent')
    const s2 = commit(s, { put: { accounts: chart } })
    const l = buildLedger(s2)
    expect(l.unmapped).toEqual([{ key: 'expense:Rent', count: 1, amount: 1200 }])
    expect(needsAttention(l).suspense).toBe(1200)
    expect(trialBalance(l).balanced).toBe(true)
  })

  test('a voucher is part of the books; a branch ledger holds only its own', () => {
    const r = createVoucher(s, { type: 'journal', date: NOW, narration: 'Owner puts money in', lines: [{ account: 'bank', debit: 10000 }, { account: 'owner_capital', credit: 10000 }] }, ctx({ branchId: 'b2' }))
    const s2 = commit(s, r)
    expect(trialBalance(buildLedger(s2)).balanced).toBe(true)
    const branch = buildLedger(s2, { branchId: 'b2' })
    expect(branch.postings).toHaveLength(1)
    expect(trialBalance(branch).balanced).toBe(true)
    expect(listOf(s2.vouchers)).toHaveLength(1)
  })
})
