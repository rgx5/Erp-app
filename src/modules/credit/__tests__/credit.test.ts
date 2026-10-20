import { baseState, billInput, ctx, customer, line, NOW } from '@/data/__tests__/helpers'
import { OpError, saveBill, processReturn } from '@/data/ops'
import { applyChanges, listOf, type DataState } from '@/data/state'
import { actorWith, rig } from '@/replication/testkit'
import { applyMutations, mutationsFromChanges, MemoryDocStore } from '@/replication'
import { creditBillHook } from '../hooks'
import { registerBillHook } from '../../registry'
import { cardProblem, checkGiftCard, giftCardBalance, makeCode } from '../giftcards'
import { agingReport, allocateOldestFirst, cashCollected, customerStatement, DAY, dueDateOf, overdueSummary, receivables } from '../logic'
import {
  cancelGiftCard, issueGiftCard, rechargeGiftCard, recordCollection, refundToGiftCard, returnOnAccount, saveCreditSettings, saveCustomerTerms, topUpStoreCredit,
} from '../ops'
import { dueEffects } from '../replication'

registerBillHook(creditBillHook)

/** Sell on account: the whole bill (or all but `paidNow`) goes on the customer's tab. */
function dueSale(s: DataState, qty = 2, at = NOW, over: { paidNow?: number; customerId?: string; ext?: Record<string, unknown> } = {}) {
  const lines = [line(s.variants.v1, qty)]
  const b = billInput(s, lines, { customerId: over.customerId ?? 'c1' })
  const paidNow = over.paidNow ?? 0
  const payments = [...(paidNow ? [{ mode: 'cash' as const, amount: paidNow }] : []), { mode: 'due' as const, amount: Math.round((b.total - paidNow) * 100) / 100 }]
  return saveBill(s, { ...b, payments, paid: paidNow, date: at, ...(over.ext ? { ext: over.ext } : {}) }, ctx({ now: at }))
}
const apply = (s: DataState, c: { changes: Parameters<typeof applyChanges>[1] }) => applyChanges(s, c.changes)

describe('receivables', () => {
  test('what was put on account is owed; part paid at the counter is not', () => {
    let s = baseState()
    const sale = dueSale(s, 2, NOW, { paidNow: 500 })
    s = apply(s, sale)
    const r = receivables(s)
    expect(sale.bill.total).toBe(1998)
    expect(r.byCustomer.c1.outstanding).toBe(1498)
    expect(r.byCustomer.c1.net).toBe(1498)
    expect(r.total).toBe(1498)
    expect(r.byCustomer.c1.bills[0]).toMatchObject({ amount: 1498, collected: 0, returned: 0, outstanding: 1498 })
  })

  test('a walk-in or an ordinary bill creates no receivable', () => {
    let s = baseState()
    s = apply(s, saveBill(s, billInput(s, [line(s.variants.v1, 1)], { customerId: 'c1' }), ctx()))
    expect(receivables(s).total).toBe(0)
    expect(receivables(s).byCustomer.c1).toBeUndefined()
  })

  test('the due date is the sale date plus the customer’s credit days, unless the till wrote one', () => {
    let s = baseState()
    const sale = dueSale(s)
    s = apply(s, sale)
    expect(dueDateOf(s, sale.bill)).toBe(NOW + 30 * DAY) // default
    s = apply(s, saveCustomerTerms(s, 'c1', { creditLimit: 0, creditDays: 10, blocked: false, notes: '' }, ctx()))
    expect(dueDateOf(s, sale.bill)).toBe(NOW + 10 * DAY)
    expect(dueDateOf(s, { ...sale.bill, ext: { credit: { dueDate: NOW + 3 * DAY } } })).toBe(NOW + 3 * DAY)
  })

  test('oldest bills are settled first and any excess becomes an advance', () => {
    const open = [{ billId: 'b2', outstanding: 300, date: 2 }, { billId: 'b1', outstanding: 500, date: 1 }, { billId: 'b3', outstanding: 0, date: 0 }]
    expect(allocateOldestFirst(open, 600)).toEqual({ allocations: [{ billId: 'b1', amount: 500 }, { billId: 'b2', amount: 100 }], advance: 0 })
    expect(allocateOldestFirst(open, 1000)).toEqual({ allocations: [{ billId: 'b1', amount: 500 }, { billId: 'b2', amount: 300 }], advance: 200 })
  })
})

describe('collections', () => {
  test('a collection settles the oldest bill first, then the next, and keeps the excess as an advance', () => {
    let s = baseState()
    s = apply(s, dueSale(s, 1, NOW))
    s = apply(s, dueSale(s, 2, NOW + DAY))
    const total = receivables(s).byCustomer.c1.outstanding
    expect(total).toBe(999 + 1998)
    const r1 = recordCollection(s, { customerId: 'c1', amount: 1500, mode: 'upi', ref: 'UTR1' }, ctx({ now: NOW + 2 * DAY }))
    expect(r1.collection.no).toBe('RC-0001')
    expect(r1.collection.allocations).toEqual([{ billId: expect.any(String), amount: 999 }, { billId: expect.any(String), amount: 501 }])
    s = apply(s, r1)
    expect(receivables(s).byCustomer.c1.outstanding).toBe(total - 1500)
    // pay more than is owed
    const r2 = recordCollection(s, { customerId: 'c1', amount: 2000, mode: 'cash' }, ctx({ now: NOW + 3 * DAY }))
    expect(r2.collection.advance).toBe(2000 - (total - 1500))
    s = apply(s, r2)
    const c = receivables(s).byCustomer.c1
    expect(c.outstanding).toBe(0)
    expect(c.advance).toBe(r2.collection.advance)
    expect(c.net).toBe(-r2.collection.advance)
  })

  test('the local copy of the customer follows (balance negative when paid ahead)', () => {
    let s = baseState()
    s = apply(s, dueSale(s, 1))
    expect(s.customers.c1.dueBalance).toBe(999)
    s = apply(s, recordCollection(s, { customerId: 'c1', amount: 400, mode: 'cash' }, ctx({ now: NOW + 1 })))
    expect(s.customers.c1.dueBalance).toBe(599)
    s = apply(s, recordCollection(s, { customerId: 'c1', amount: 700, mode: 'cash' }, ctx({ now: NOW + 2 })))
    expect(s.customers.c1.dueBalance).toBe(-101)
    expect(receivables(s).byCustomer.c1.net).toBe(-101)
  })

  test('chosen allocations are checked', () => {
    let s = baseState()
    const sale = dueSale(s, 1)
    s = apply(s, sale)
    const id = sale.bill.id
    expect(() => recordCollection(s, { customerId: 'c1', amount: 100, mode: 'cash', allocations: [{ billId: id, amount: 2000 }] }, ctx())).toThrow('outstanding')
    expect(() => recordCollection(s, { customerId: 'c1', amount: 100, mode: 'cash', allocations: [{ billId: id, amount: 300 }] }, ctx())).toThrow('allocated more')
    expect(() => recordCollection(s, { customerId: 'c1', amount: 100, mode: 'cash', allocations: [{ billId: 'nope', amount: 10 }] }, ctx())).toThrow('not owed')
    const ok = recordCollection(s, { customerId: 'c1', amount: 500, mode: 'cheque', ref: '000123', allocations: [{ billId: id, amount: 300 }] }, ctx())
    expect(ok.collection).toMatchObject({ advance: 200, mode: 'cheque', ref: '000123' })
  })

  test('refuses nonsense', () => {
    const s = baseState()
    expect(() => recordCollection(s, { customerId: 'zz', amount: 10, mode: 'cash' }, ctx())).toThrow(OpError)
    expect(() => recordCollection(s, { customerId: 'c1', amount: 0, mode: 'cash' }, ctx())).toThrow('amount')
    expect(() => recordCollection(s, { customerId: 'c1', amount: 10, mode: 'barter' as never }, ctx())).toThrow('how the money')
  })

  test('a connected phone numbers from its own series; cash collected over a period is summed', () => {
    let s = baseState()
    s = apply(s, dueSale(s, 3))
    const a = recordCollection(s, { customerId: 'c1', amount: 100, mode: 'cash' }, ctx({ series: 'M4X', now: NOW + 5 }))
    expect(a.collection.no).toBe('RC-M4X-0001')
    s = apply(s, a)
    s = apply(s, recordCollection(s, { customerId: 'c1', amount: 50, mode: 'upi' }, ctx({ now: NOW + 6 })))
    expect(cashCollected(s, NOW, NOW + 100)).toBe(100)
  })
})

describe('returns on account', () => {
  test('a return on a fully unpaid bill reduces what is owed and pays no cash', () => {
    let s = baseState()
    const sale = dueSale(s, 3)
    s = apply(s, sale)
    const r = returnOnAccount(s, sale.bill.id, [{ variantId: 'v1', qty: 1 }], ctx({ now: NOW + 1 }))
    expect(r).toMatchObject({ reducedDue: 999, cashRefund: 0 })
    expect(r.creditNote.payments).toEqual([{ mode: 'due', amount: -999 }])
    expect(r.creditNote.paid).toBe(-0)
    s = apply(s, r)
    expect(receivables(s).byCustomer.c1.outstanding).toBe(2997 - 999)
    expect(s.customers.c1.dueBalance).toBe(2997 - 999)
    expect(s.bills[sale.bill.id].status).toBe('partial-return')
    expect(s.variants.v1.stock).toBe(10 - 3 + 1)
  })

  test('only what was really paid is refunded in cash', () => {
    let s = baseState()
    const sale = dueSale(s, 2, NOW, { paidNow: 1500 }) // 1998 total: 1500 paid, 498 on account
    s = apply(s, sale)
    const r = returnOnAccount(s, sale.bill.id, [{ variantId: 'v1', qty: 2 }], ctx({ now: NOW + 1 }))
    expect(r).toMatchObject({ reducedDue: 498, cashRefund: 1500 })
    expect(r.creditNote.payments).toEqual([{ mode: 'cash', amount: -1500 }, { mode: 'due', amount: -498 }])
    s = apply(s, r)
    expect(receivables(s).byCustomer.c1?.outstanding ?? 0).toBe(0)
    expect(s.bills[sale.bill.id].status).toBe('returned')
  })

  test('refuses when nothing is owed on the bill', () => {
    let s = baseState()
    const plain = saveBill(s, billInput(s, [line(s.variants.v1, 1)], { customerId: 'c1' }), ctx())
    s = apply(s, plain)
    expect(() => returnOnAccount(s, plain.bill.id, [{ variantId: 'v1', qty: 1 }], ctx())).toThrow('Nothing is owed')
  })

  test('an ordinary return of a due bill leaves the debt (so the app steers to returnOnAccount)', () => {
    let s = baseState()
    const sale = dueSale(s, 2)
    s = apply(s, sale)
    s = apply(s, processReturn(s, sale.bill.id, [{ variantId: 'v1', qty: 1 }], 'cash', ctx({ now: NOW + 1 })))
    expect(receivables(s).byCustomer.c1.outstanding).toBe(1998)
  })
})

describe('the credit limit and the bill hook', () => {
  const withTerms = (limit: number, over: Partial<Parameters<typeof saveCustomerTerms>[2]> = {}) => {
    const s = baseState()
    return apply(s, saveCustomerTerms(s, 'c1', { creditLimit: limit, creditDays: 30, blocked: false, notes: '', ...over }, ctx()))
  }

  test('a sale within the limit goes through; one over it is refused and says by how much', () => {
    let s = withTerms(2500)
    s = apply(s, dueSale(s, 2)) // 1998
    expect(() => dueSale(s, 1)).toThrow(/over the ₹2,500 limit/)
    try { dueSale(s, 1) } catch (e) { expect((e as Error).message).toMatch(/₹497 over/) }
    // pay some of it off and there is room again
    s = apply(s, recordCollection(s, { customerId: 'c1', amount: 600, mode: 'cash' }, ctx({ now: NOW + 1 })))
    expect(() => dueSale(s, 1)).not.toThrow()
  })

  test('only a manager can let a bill past the limit', () => {
    const s = withTerms(500)
    expect(() => dueSale(s, 1, NOW, { ext: { credit: { override: true } } })).not.toThrow() // ctx() is the owner
    const asCashier = () => saveBill(s, { ...billInput(s, [line(s.variants.v1, 1)], { customerId: 'c1' }), payments: [{ mode: 'due', amount: 999 }], paid: 0, ext: { credit: { override: true } } }, ctx({ userId: 'u_cash' }))
    expect(asCashier).toThrow(/Ask a manager/)
  })

  test('a customer who is blocked, or no customer, cannot buy on account', () => {
    expect(() => dueSale(withTerms(0, { blocked: true }), 1)).toThrow('not allowed')
    const s = baseState()
    expect(() => saveBill(s, { ...billInput(s, [line(s.variants.v1, 1)]), payments: [{ mode: 'due', amount: 999 }], paid: 0 }, ctx())).toThrow('Choose a customer')
  })

  test('terms are validated', () => {
    const s = baseState()
    expect(() => saveCustomerTerms(s, 'c1', { creditLimit: -1, creditDays: 30, blocked: false, notes: '' }, ctx())).toThrow('negative')
    expect(() => saveCustomerTerms(s, 'c1', { creditLimit: 0, creditDays: 400, blocked: false, notes: '' }, ctx())).toThrow('0 to 365')
    expect(() => saveCustomerTerms(s, 'zz', { creditLimit: 0, creditDays: 1, blocked: false, notes: '' }, ctx())).toThrow('no longer exists')
  })
})

describe('ageing and statements', () => {
  const build = () => {
    let s = baseState()
    s = apply(s, saveCustomerTerms(s, 'c1', { creditLimit: 0, creditDays: 30, blocked: false, notes: '' }, ctx()))
    s = apply(s, dueSale(s, 1, NOW)) // 999, due NOW+30d
    s = apply(s, dueSale(s, 1, NOW + 40 * DAY)) // 999, due NOW+70d
    return s
  }

  test('buckets follow how late each bill is', () => {
    const s = build()
    // 45 days after the first sale: first is 15 days late, second is not due yet
    let rep = agingReport(s, NOW + 45 * DAY)
    expect(rep.rows).toHaveLength(1)
    expect(rep.rows[0].buckets).toMatchObject({ notDue: 999, d1_30: 999, d31_60: 0, d61_90: 0, d90: 0 })
    expect(rep.total).toBe(1998)
    // 130 days on: the first is 100 days late, the second 60 days
    rep = agingReport(s, NOW + 130 * DAY)
    expect(rep.rows[0].buckets).toMatchObject({ d90: 999, d31_60: 999 })
    expect(rep.rows[0].oldestDaysOverdue).toBe(100)
    expect(overdueSummary(s, NOW + 130 * DAY)).toEqual({ customers: 1, amount: 1998 })
    expect(overdueSummary(s, NOW + 5 * DAY)).toEqual({ customers: 0, amount: 0 })
  })

  test('an advance is applied to the oldest bill before it is bucketed', () => {
    let s = build()
    s = apply(s, recordCollection(s, { customerId: 'c1', amount: 999, mode: 'cash', allocations: [] }, ctx({ now: NOW + 41 * DAY }))) // all advance
    expect(receivables(s).byCustomer.c1.advance).toBe(999)
    const rep = agingReport(s, NOW + 130 * DAY)
    expect(rep.rows[0].buckets.d90).toBe(0)
    expect(rep.rows[0].buckets.d31_60).toBe(999)
    expect(rep.total).toBe(999)
  })

  test('a statement shows the opening balance, each movement and the closing balance', () => {
    let s = build()
    s = apply(s, recordCollection(s, { customerId: 'c1', amount: 500, mode: 'upi', ref: 'U9' }, ctx({ now: NOW + 10 * DAY })))
    const st = customerStatement(s, 'c1', NOW + 5 * DAY, NOW + 50 * DAY)
    expect(st.opening).toBe(999)
    expect(st.entries.map((e) => [e.kind, e.debit, e.credit, e.balance])).toEqual([['collection', 0, 500, 499], ['sale', 999, 0, 1498]])
    expect(st.closing).toBe(1498)
    expect(st.totalDebit).toBe(999)
    expect(st.totalCredit).toBe(500)
    const all = customerStatement(s, 'c1', 0, NOW + 999 * DAY)
    expect(all.opening).toBe(0)
    expect(all.closing).toBe(1498)
  })

  test('a statement lists returns that reduced what was owed', () => {
    let s = baseState()
    const sale = dueSale(s, 2)
    s = apply(s, sale)
    s = apply(s, returnOnAccount(s, sale.bill.id, [{ variantId: 'v1', qty: 1 }], ctx({ now: NOW + 1 })))
    const st = customerStatement(s, 'c1', 0, NOW + DAY)
    expect(st.entries.map((e) => e.kind)).toEqual(['sale', 'return'])
    expect(st.closing).toBe(999)
  })
})

describe('gift cards', () => {
  test('issue, spend, recharge, refund: the balance is the sum of the ledger', () => {
    let s = baseState()
    const issued = issueGiftCard(s, { value: 1000, mode: 'cash', code: 'gc-test 1' }, ctx(), undefined)
    expect(issued.card.code).toBe('GC-TEST1')
    s = apply(s, issued)
    expect(giftCardBalance(s, issued.card.id)).toBe(1000)
    // spend ₹999 on a bill
    const lines = [line(s.variants.v1, 1)]
    const b = billInput(s, lines)
    const sale = saveBill(s, { ...b, payments: [{ mode: 'giftcard', amount: 999, ref: 'GC-TEST1' }], paid: 999 }, ctx({ now: NOW + 1 }))
    s = apply(s, sale)
    expect(giftCardBalance(s, issued.card.id)).toBe(1)
    expect(listOf(s.giftCardTxns).find((t) => t.type === 'redeem')).toMatchObject({ amount: 999, billId: sale.bill.id })
    s = apply(s, rechargeGiftCard(s, issued.card.id, 500, 'upi', ctx({ now: NOW + 2 })))
    s = apply(s, refundToGiftCard(s, issued.card.id, 100, sale.bill.id, ctx({ now: NOW + 3 })))
    expect(giftCardBalance(s, issued.card.id)).toBe(601)
  })

  test('a card that cannot pay stops the bill', () => {
    let s = baseState()
    const c = issueGiftCard(s, { value: 100, mode: 'cash', code: 'GC-SMALL' }, ctx())
    s = apply(s, c)
    const sale = (code: string, amount: number, now = NOW) => saveBill(s, { ...billInput(s, [line(s.variants.v1, 1)]), payments: [{ mode: 'giftcard', amount, ref: code }], paid: amount }, ctx({ now }))
    expect(() => sale('GC-SMALL', 999)).toThrow('Only ₹100 is left')
    expect(() => sale('NOPE', 999)).toThrow('No gift card')
    s = apply(s, cancelGiftCard(s, c.card.id, ctx()))
    expect(() => sale('GC-SMALL', 50)).toThrow('cancelled')
  })

  test('an expired card, an empty card, and the same code twice', () => {
    let s = baseState()
    const c = issueGiftCard(s, { value: 100, mode: 'cash', code: 'GC-OLD', expiresAt: NOW + DAY }, ctx())
    s = apply(s, c)
    expect(checkGiftCard(s, 'gc-old', NOW).problem).toBeNull()
    expect(checkGiftCard(s, 'gc-old', NOW + 2 * DAY).problem).toMatch(/expired/)
    expect(cardProblem(s, 'GC-OLD', 500, NOW)).toMatch(/Only ₹100/)
    expect(() => issueGiftCard(s, { value: 10, mode: 'cash', code: 'GC-OLD' }, ctx())).toThrow('already used')
    expect(() => issueGiftCard(s, { value: 0, mode: 'cash' }, ctx())).toThrow('value')
    expect(() => issueGiftCard(s, { value: 10, mode: 'cash', code: '!' }, ctx())).toThrow('4–24')
    expect(() => issueGiftCard(s, { value: 10, mode: 'cash', expiresAt: NOW - 1 }, ctx())).toThrow('past')
  })

  test('generated codes are readable and never repeat', () => {
    let seed = 12345 // mulberry32
    const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const taken = new Set<string>()
    for (let i = 0; i < 200; i++) { const c = makeCode(taken, rnd); expect(c).toMatch(/^GC-[A-Z2-9]{4}-[A-Z2-9]{4}$/); expect(taken.has(c)).toBe(false); taken.add(c) }
  })
})

describe('store-credit top-up and settings', () => {
  test('paying in adds the same amount to the customer’s store credit', () => {
    let s = baseState()
    const t = topUpStoreCredit(s, { customerId: 'c1', amount: 750, mode: 'upi', ref: 'U1' }, ctx())
    expect(t.topup.no).toBe('TU-0001')
    s = apply(s, t)
    expect(s.customers.c1.storeCredit).toBe(750)
    expect(() => topUpStoreCredit(s, { customerId: 'c1', amount: -1, mode: 'cash' }, ctx())).toThrow('amount')
  })

  test('the UPI id is validated', () => {
    const s = baseState()
    expect(saveCreditSettings(s, { upiId: ' asha@okbank ', payeeName: ' Asha Stores ' }, ctx()).settings).toMatchObject({ upiId: 'asha@okbank', payeeName: 'Asha Stores', defaultDays: 30 })
    expect(() => saveCreditSettings(s, { upiId: 'not a upi' }, ctx())).toThrow('shop@bank')
    expect(() => saveCreditSettings(s, { defaultDays: -3 }, ctx())).toThrow('0 to 365')
  })
})

describe('the server agrees with the phone', () => {
  const store = (s: DataState) => s.customers.c1

  test('sales on account, collections, a return on account, a top-up: every balance matches', async () => {
    const r = rig(baseState())
    await r.seed()
    const sale1 = await r.run((s) => dueSale(s, 2, NOW + 1))
    await r.run((s) => dueSale(s, 1, NOW + 2, { paidNow: 300 }))
    let server = await r.serverView()
    expect(store(server).dueBalance).toBe(1998 + 699)
    expect(store(server).dueBalance).toBe(receivables(r.phone).byCustomer.c1.net)

    await r.run((s) => recordCollection(s, { customerId: 'c1', amount: 1000, mode: 'cash' }, ctx({ now: NOW + 3 })))
    await r.run((s) => returnOnAccount(s, sale1.bill.id, [{ variantId: 'v1', qty: 1 }], ctx({ now: NOW + 4 })))
    await r.run((s) => topUpStoreCredit(s, { customerId: 'c1', amount: 200, mode: 'upi' }, ctx({ now: NOW + 5 })))
    await r.run((s) => recordCollection(s, { customerId: 'c1', amount: 5000, mode: 'bank', ref: 'NEFT' }, ctx({ now: NOW + 6 }))) // pays ahead

    server = await r.serverView()
    const phone = r.phone
    expect(store(server).dueBalance).toBe(receivables(phone).byCustomer.c1.net)
    expect(store(server)).toEqual(store(phone))
    expect(server.collections).toEqual(phone.collections)
    expect(server.creditTopups).toEqual(phone.creditTopups)
    expect(server.bills).toEqual(phone.bills)
    expect(store(server).storeCredit).toBe(200)
    expect(store(server).loyaltyPoints).toBe(store(phone).loyaltyPoints)
  })

  test('gift cards, terms and settings replicate; the server refuses edits to posted entries', async () => {
    const r = rig(baseState())
    await r.seed()
    const card = await r.run((s) => issueGiftCard(s, { value: 500, mode: 'cash', code: 'GC-SYNC' }, ctx({ now: NOW + 1 })))
    await r.run((s) => saveBill(s, { ...billInput(s, [line(s.variants.v1, 1)]), payments: [{ mode: 'giftcard', amount: 500, ref: 'GC-SYNC' }, { mode: 'cash', amount: 499 }], paid: 999 }, ctx({ now: NOW + 2 })))
    await r.run((s) => saveCustomerTerms(s, 'c1', { creditLimit: 5000, creditDays: 15, blocked: false, notes: 'trusted' }, ctx()))
    await r.run((s) => ({ changes: saveCreditSettings(s, { upiId: 'shop@okbank', payeeName: 'Shop' }, ctx()).changes }))
    const server = await r.serverView()
    for (const coll of ['giftCards', 'giftCardTxns', 'customerTerms', 'creditSettings'] as const) expect(server[coll]).toEqual(r.phone[coll])
    expect(giftCardBalance(server, card.card.id)).toBe(0)
    // a posted collection cannot be edited or deleted
    const rc = await r.run((s) => recordCollection(s, { customerId: 'c1', amount: 10, mode: 'cash' }, ctx({ now: NOW + 3 })))
    const db = new MemoryDocStore()
    const owner = actorWith()
    await applyMutations(db, mutationsFromChanges(baseState(), { put: { collections: [rc.collection] } }, { deviceId: 'd', nextSeq: () => 1 }), owner)
    const res = await applyMutations(db, [{ mid: 'd:2', coll: 'collections', id: rc.collection.id, op: 'patch', data: { amount: 1 }, at: 1 }, { mid: 'd:3', coll: 'collections', id: rc.collection.id, op: 'delete', at: 1 }], owner)
    expect(res.map((x) => x.code)).toEqual(['immutable', 'immutable'])
  })

  test('roles: a cashier may take payments and sell cards but not set terms or settings; a collection needs a customer', async () => {
    const db = new MemoryDocStore()
    const cashier = actorWith(['pos', 'customers', 'collections'], 'u_cash')
    const s = baseState()
    const rc = recordCollection(s, { customerId: 'c1', amount: 10, mode: 'cash' }, ctx()).collection
    const m = (coll: string, doc: { id: string }, n: number) => ({ mid: `c:${n}`, coll, id: doc.id, op: 'create' as const, data: doc as Record<string, unknown>, at: 1 })
    expect((await applyMutations(db, [m('collections', rc, 1)], cashier))[0].status).toBe('ok')
    const terms = saveCustomerTerms(s, 'c1', { creditLimit: 1, creditDays: 1, blocked: false, notes: '' }, ctx()).terms
    expect((await applyMutations(db, [m('customerTerms', terms, 2)], cashier))[0]).toMatchObject({ status: 'rejected', code: 'forbidden' })
    expect((await applyMutations(db, [m('collections', { ...rc, id: 'x', customerId: undefined as never } as { id: string }, 3)], cashier))[0]).toMatchObject({ code: 'invalid' })
  })

  test('the effect functions agree with the documents', () => {
    const s = baseState()
    const sale = dueSale(s, 1, NOW, { paidNow: 100 })
    expect(dueEffects(sale.bill)).toEqual([{ kind: 'inc', coll: 'customers', id: 'c1', field: 'dueBalance', by: 899 }])
    expect(dueEffects({ ...sale.bill, customerId: null })).toEqual([])
    expect(customer({ id: 'c1' }).loyaltyPoints).toBe(50)
  })
})
