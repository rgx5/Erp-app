import { saveBill } from '@/data/ops'
import { billInput, line } from '@/data/__tests__/helpers'
import { orderBook, quotePipeline } from '../logic/pipeline'
import { saveQuotation, saveSalesOrder, setOrderReady, setQuoteStatus, takeOrderPayment, type QuoteDraft } from '../ops'
import { baseState, commit, ctx, dl, installBillHook, NOW } from './helpers'

const DAY = 86_400_000
const quote = (s: ReturnType<typeof baseState>, validUntil: number, qty = 1): QuoteDraft => ({
  customerId: 'c1', partyName: '', partyPhone: '', items: [dl(s, 'v1', qty)], billDiscountType: 'amt', billDiscountValue: 0, validUntil, notes: '', terms: '',
})

describe('quotation pipeline', () => {
  test('open, lapsed, rejected and billed quotations are counted by value; the win rate comes from the decided ones', () => {
    installBillHook()
    let s = baseState()
    const make = (validUntil: number, qty: number, at: number) => { const q = saveQuotation(s, quote(s, validUntil, qty), undefined, ctx({ now: at })).quotation; s = commit(s, { put: { quotations: [q] } }); return q }
    const open = make(NOW + 10 * DAY, 1, NOW)
    const soon = make(NOW + 1 * DAY, 2, NOW + 1)
    const lapsed = { ...make(NOW + DAY, 1, NOW + 2), validUntil: NOW - 3 * DAY }
    s = commit(s, { put: { quotations: [lapsed] } })
    const no = make(NOW + 10 * DAY, 1, NOW + 3)
    s = commit(s, setQuoteStatus(s, no.id, 'rejected', ctx()))
    const won = make(NOW + 10 * DAY, 3, NOW + 4)
    s = commit(s, saveBill(s, billInput(s, [line(s.variants.v1, 3)], { customerId: 'c1', ext: { 'sales-docs': { quotationId: won.id } } }), ctx({ now: NOW + 5 })))
    const p = quotePipeline(s, NOW + 6)
    expect(p.open).toEqual({ count: 2, value: 999 + 1998 })
    expect(p.expiringSoon).toBe(1)
    expect(p.expired.count).toBe(1)
    expect(p.rejected.count).toBe(1)
    expect(p.converted).toEqual({ count: 1, value: 2997 })
    expect(p.winRatePct).toBe(33)
    expect([open.id, soon.id]).toHaveLength(2)
    expect(quotePipeline(baseState(), NOW).winRatePct).toBeNull()
  })
})

describe('order book', () => {
  test('open orders, advance held, balance, ready and late ones', () => {
    let s = baseState()
    const a = saveSalesOrder(s, { customerId: 'c1', items: [dl(s, 'v1', 2)], billDiscountType: 'amt', billDiscountValue: 0, notes: '', expectedDate: NOW - 2 * DAY }, undefined, ctx()).order
    s = commit(s, { put: { salesOrders: [a] } })
    const b = saveSalesOrder(s, { customerId: 'c1', items: [dl(s, 'v2', 1)], billDiscountType: 'amt', billDiscountValue: 0, notes: '', instalments: [{ dueDate: NOW - DAY, amount: 500 }, { dueDate: NOW + 9 * DAY, amount: 499 }] }, undefined, ctx({ now: NOW + 1 })).order
    s = commit(s, { put: { salesOrders: [b] } })
    s = commit(s, takeOrderPayment(s, a.id, { amount: 1000, mode: 'cash' }, ctx({ now: NOW + 2 })))
    s = commit(s, setOrderReady(s, a.id, true, ctx()))
    const book = orderBook(s, NOW + 3)
    expect(book).toMatchObject({ open: { count: 2, value: 1998 + 999 }, ready: 1, advanceHeld: 1000, balanceDue: 998 + 999, pastDue: 1, layawayOverdue: { count: 1, amount: 500 } })
  })
})
