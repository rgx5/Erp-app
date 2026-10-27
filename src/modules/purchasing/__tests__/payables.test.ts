import { ctx, NOW } from '@/data/__tests__/helpers'
import { OpError, receivePurchase } from '@/data/ops'
import { applyChanges } from '@/data/state'
import { isBalanced, postingsFor } from '@/modules/postings'
import '@/modules/accounting/postings'
import { rig } from '@/replication/testkit'
import { agingReport, allocateOldestFirst, creditDaysFor, dueList, dueSummary, payables, supplierStatement } from '../payables'
import { savePurchaseSettings, paySupplier, reversePayment, saveSupplierTerms } from '../ops-payables'
import { paymentAdviceText, agingCsv, statementCsv } from '../reports'
import { purchasingState, withReceipt, DAY } from './helpers'

describe('what we owe suppliers', () => {
  test('receipts raise it, what was paid at the time and payments bring it down', () => {
    const { state, purchase } = withReceipt(purchasingState(), { paid: 1000 })
    let p = payables(state)
    expect(p.bySupplier.s1.net).toBe(5050)
    expect(p.total).toBe(5050)
    const r = paySupplier(state, { supplierId: 's1', amount: 2000, mode: 'upi', ref: 'UTR1' }, ctx({ now: NOW + 1 }))
    expect(r.payment.no).toBe('SP-0001')
    expect(r.payment.allocations).toEqual([{ ref: `purchases:${purchase.id}`, amount: 2000 }])
    p = payables(applyChanges(state, r.changes))
    expect(p.bySupplier.s1.net).toBe(3050)
  })

  test('the opening balance counts, and a payment settles the oldest first with the rest kept as an advance', () => {
    let s = purchasingState({ supplier: { openingBalance: 3000 } })
    s = withReceipt(s, { at: NOW - 10 * DAY }).state
    expect(payables(s).bySupplier.s1.net).toBe(9050)
    const r = paySupplier(s, { supplierId: 's1', amount: 10_000, mode: 'bank' }, ctx())
    expect(r.payment.allocations.map((a) => a.amount)).toEqual([3000, 6050])
    expect(r.payment.advance).toBe(950)
    const after = payables(applyChanges(s, r.changes))
    expect(after.bySupplier.s1).toMatchObject({ outstanding: 0, advance: 950, net: -950 })
    expect(after.total).toBe(0)
  })

  test('explicit allocations are checked', () => {
    const { state, purchase } = withReceipt(purchasingState())
    const ref = `purchases:${purchase.id}`
    expect(() => paySupplier(state, { supplierId: 's1', amount: 100, mode: 'cash', allocations: [{ ref: 'purchases:nope', amount: 100 }] }, ctx())).toThrow('not owed')
    expect(() => paySupplier(state, { supplierId: 's1', amount: 100, mode: 'cash', allocations: [{ ref, amount: 9999 }] }, ctx())).toThrow('outstanding')
    expect(() => paySupplier(state, { supplierId: 's1', amount: 100, mode: 'cash', allocations: [{ ref, amount: 500 }] }, ctx())).toThrow('more than was paid')
    expect(paySupplier(state, { supplierId: 's1', amount: 600, mode: 'cash', allocations: [{ ref, amount: 500 }] }, ctx()).payment.advance).toBe(100)
  })

  test('refusals', () => {
    const s = purchasingState()
    expect(() => paySupplier(s, { supplierId: 'x', amount: 5, mode: 'cash' }, ctx())).toThrow(OpError)
    expect(() => paySupplier(s, { supplierId: 's1', amount: 0, mode: 'cash' }, ctx())).toThrow('amount')
    expect(() => paySupplier(s, { supplierId: 's1', amount: 5, mode: 'crypto' as never }, ctx())).toThrow('how the money')
  })

  test('allocateOldestFirst', () => {
    const open = [{ ref: 'b', outstanding: 50, date: 2 }, { ref: 'a', outstanding: 100, date: 1 }]
    expect(allocateOldestFirst(open, 120)).toEqual({ allocations: [{ ref: 'a', amount: 100 }, { ref: 'b', amount: 20 }], advance: 0 })
    expect(allocateOldestFirst(open, 200).advance).toBe(50)
  })

  test('cancelling a payment makes it owed again, once', () => {
    const { state } = withReceipt(purchasingState())
    const paid = applyChanges(state, paySupplier(state, { supplierId: 's1', amount: 6050, mode: 'cheque', ref: '000123' }, ctx()).changes)
    expect(payables(paid).total).toBe(0)
    const payment = Object.values(paid.supplierPayments)[0]
    const rev = reversePayment(paid, payment.id, 'bounced', ctx({ now: NOW + 5 }))
    expect(rev.payment).toMatchObject({ reverses: payment.id, no: 'SP-0001-R', note: 'bounced' })
    const back = applyChanges(paid, rev.changes)
    expect(payables(back).total).toBe(6050)
    expect(() => reversePayment(back, payment.id, '', ctx())).toThrow('already been cancelled')
    expect(() => reversePayment(back, rev.payment.id, '', ctx())).toThrow('reversal')
    expect(Object.values(back.supplierPayments)).toHaveLength(2)
  })
})

describe('ageing, due dates and reminders', () => {
  test('terms: the supplier’s own days, else the shop default', () => {
    let s = purchasingState()
    expect(creditDaysFor(s, 's1')).toBe(30)
    s = applyChanges(s, savePurchaseSettings(s, { defaultDays: 45 }, ctx()).changes)
    expect(creditDaysFor(s, 's1')).toBe(45)
    s = applyChanges(s, saveSupplierTerms(s, 's1', { creditDays: 15, notes: '' }, ctx()).changes)
    expect(creditDaysFor(s, 's1')).toBe(15)
    expect(() => saveSupplierTerms(s, 's1', { creditDays: -1, notes: '' }, ctx())).toThrow('whole number')
  })

  test('buckets by how late, with an advance applied to the oldest bill first', () => {
    let s = purchasingState()
    for (const [age, price] of [[100, 100], [50, 200], [5, 300]] as const) {
      const r = receivePurchase(s, { supplierId: 's1', date: NOW - age * DAY, invoiceRef: 'x', items: [{ variantId: 'v1', qty: 1, cost: price }], total: price, paid: 0, notes: '' }, ctx({ now: NOW - age * DAY }))
      s = applyChanges(s, r.changes)
    }
    // due 30 days after receipt: 70 days late, 20 days late, not due
    const rep = agingReport(s, NOW)
    expect(rep.totals).toMatchObject({ d61_90: 100, d1_30: 200, notDue: 300 })
    expect(rep.total).toBe(600)
    expect(rep.rows[0].oldestDaysOverdue).toBe(70)
    s = applyChanges(s, paySupplier(s, { supplierId: 's1', amount: 150, mode: 'cash', allocations: [] }, ctx()).changes)
    // 150 is an advance: it wipes the 100 bill and part of the next
    const after = agingReport(s, NOW)
    expect(after.totals).toMatchObject({ d61_90: 0, d1_30: 150, notDue: 300 })
    expect(agingCsv(s, NOW)).toContain('Fab Mills')
  })

  test('the due list and summary: late, soon, later', () => {
    let s = purchasingState()
    for (const age of [40, 25, 0]) {
      s = applyChanges(s, receivePurchase(s, { supplierId: 's1', date: NOW - age * DAY, invoiceRef: 'x', items: [{ variantId: 'v1', qty: 1, cost: 100 }], total: 100, paid: 0, notes: '' }, ctx({ now: NOW - age * DAY })).changes)
    }
    const list = dueList(s, NOW)
    expect(list.map((d) => d.when)).toEqual(['overdue', 'soon', 'later'])
    expect(dueSummary(s, NOW)).toEqual({ overdue: { suppliers: 1, docs: 1, amount: 100 }, soon: { suppliers: 1, docs: 1, amount: 100 } })
    expect(dueSummary(s, NOW, 60).soon.docs).toBe(2)
  })
})

describe('the supplier’s ledger', () => {
  test('opening, every movement, closing — and it agrees with what is owed', () => {
    let s = purchasingState({ supplier: { openingBalance: 500 } })
    s = withReceipt(s, { at: NOW - 20 * DAY, paid: 1000 }).state
    s = applyChanges(s, paySupplier(s, { supplierId: 's1', amount: 2000, mode: 'bank', date: NOW - 5 * DAY }, ctx()).changes)
    const st = supplierStatement(s, 's1', NOW - 30 * DAY, NOW)
    expect(st.opening).toBe(500)
    expect(st.entries.map((e) => [e.kind, e.added, e.reduced, e.balance])).toEqual([['receipt', 6050, 0, 6550], ['paid-at-receipt', 0, 1000, 5550], ['payment', 0, 2000, 3550]])
    expect(st.closing).toBe(3550)
    expect(st.closing).toBe(payables(s).bySupplier.s1.net)
    // a window that starts after the receipt carries it into the opening balance
    const later = supplierStatement(s, 's1', NOW - 10 * DAY, NOW)
    expect(later.opening).toBe(5550)
    expect(later.entries).toHaveLength(1)
    expect(statementCsv(s, st)).toContain('Closing balance')
  })

  test('payment advice names what it settled', () => {
    const { state } = withReceipt(purchasingState())
    const r = paySupplier(state, { supplierId: 's1', amount: 1000, mode: 'upi', ref: 'UTR9' }, ctx())
    const text = paymentAdviceText(applyChanges(state, r.changes), r.payment)
    expect(text).toContain('₹1,000')
    expect(text).toContain('B-77')
    expect(text).toContain('UTR9')
  })
})

describe('postings for supplier payments', () => {
  test('balanced, to the supplier, and a reversal turns it round', () => {
    const { state } = withReceipt(purchasingState(), { paid: 1000 })
    const paid = applyChanges(state, paySupplier(state, { supplierId: 's1', amount: 2500.5, mode: 'cheque' }, ctx()).changes)
    const pay = Object.values(paid.supplierPayments)[0]
    const back = applyChanges(paid, reversePayment(paid, pay.id, '', ctx({ now: NOW + 9 })).changes)
    const ps = postingsFor(back).filter((p) => p.sourceColl === 'supplierPayments')
    expect(ps).toHaveLength(2)
    for (const p of ps) expect(isBalanced(p)).toBe(true)
    expect(ps[0].lines).toEqual([{ account: 'payables', debit: 2500.5, party: { type: 'supplier', id: 's1' } }, { account: 'bank', credit: 2500.5 }])
    expect(ps[1].lines).toEqual([{ account: 'payables', credit: 2500.5, party: { type: 'supplier', id: 's1' } }, { account: 'bank', debit: 2500.5 }])
    // the core receipt rule is the accounting module's: this module does not book receipts a second time
    expect(postingsFor(back).filter((p) => p.sourceColl === 'purchases')).toHaveLength(1)
  })
})

describe('supplier payments replicate', () => {
  test('server == phone: payments, a reversal, and the balance the server keeps', async () => {
    const r = rig(purchasingState({ supplier: { openingBalance: 100 } }))
    await r.seed()
    await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW, invoiceRef: 'B1', items: [{ variantId: 'v1', qty: 10, cost: 400 }], total: 4000, paid: 500, notes: '' }, ctx({ now: NOW })))
    const p1 = await r.run((s) => paySupplier(s, { supplierId: 's1', amount: 1200, mode: 'upi', ref: 'U1' }, ctx({ now: NOW + 1 })))
    await r.run((s) => paySupplier(s, { supplierId: 's1', amount: 300, mode: 'cash' }, ctx({ now: NOW + 2 })))
    await r.run((s) => reversePayment(s, p1.payment.id, 'wrong supplier', ctx({ now: NOW + 3 })))
    const server = await r.serverView()
    expect(server.supplierPayments).toEqual(r.phone.supplierPayments)
    expect(server.suppliers.s1.payableAdjust).toBe(-300)
    expect(server.suppliers).toEqual(r.phone.suppliers)
    // opening 100 + (4000 − 500 paid) − payments still standing 300
    expect(payables(r.phone).bySupplier.s1.net).toBe(100 + 3500 - 300)
  })
})
