import { cashSuggestions, finalPayments, pointsEarned, settle, type SettleInput } from '../checkout'

const base: SettleInput = { total: 1000, customer: null, loyaltyValue: 1, redeemPts: 0, useCredit: false, split: [], mode: 'cash', tendered: '' }

describe('settle', () => {
  test('a plain cash sale: exact amount, no change', () => {
    const s = settle(base)
    expect(s).toMatchObject({ remaining: 1000, amount: 1000, covers: true, change: 0, shortBy: 0, creditUsed: 0, pts: 0 })
    expect(finalPayments(base, s)).toEqual([{ mode: 'cash', amount: 1000 }])
  })

  test('cash handed over in excess gives change; the bill records only what was owed', () => {
    const i = { ...base, tendered: '1500' }
    const s = settle(i)
    expect(s.change).toBe(500)
    expect(finalPayments(i, s)).toEqual([{ mode: 'cash', amount: 1000 }])
  })

  test('card or UPI can never produce change, and being short blocks completion', () => {
    expect(settle({ ...base, mode: 'upi', tendered: '1500' }).change).toBe(0)
    const s = settle({ ...base, tendered: '400' })
    expect(s).toMatchObject({ covers: false, shortBy: 600 })
  })

  test('store credit is tender, capped at the bill', () => {
    const c = { storeCredit: 350, loyaltyPoints: 0 }
    expect(settle({ ...base, customer: c, useCredit: true }).payable).toBe(650)
    expect(settle({ ...base, customer: { storeCredit: 5000, loyaltyPoints: 0 }, useCredit: true })).toMatchObject({ creditUsed: 1000, payable: 0, remaining: 0 })
  })

  test('points redeem after credit and never exceed what is owed', () => {
    const cust = { storeCredit: 400, loyaltyPoints: 900 }
    const s = settle({ ...base, customer: cust, useCredit: true, redeemPts: 900 })
    expect(s.maxPts).toBe(600) // 1000 − 400 credit = 600 still owed
    expect(s.pts).toBe(600)
    expect(s.payable).toBe(0)
  })

  test('points are worth what the shop says', () => {
    const s = settle({ ...base, customer: { storeCredit: 0, loyaltyPoints: 100 }, loyaltyValue: 0.5, redeemPts: 100 })
    expect(s).toMatchObject({ pts: 100, loyaltyRupees: 50, payable: 950 })
    expect(settle({ ...base, customer: { storeCredit: 0, loyaltyPoints: 100 }, loyaltyValue: 0, redeemPts: 100 }).pts).toBe(0)
  })

  test('split payment: part on UPI, the rest in cash', () => {
    const split = [{ mode: 'upi' as const, amount: 600, ref: 'UPI123' }]
    const i = { ...base, split, mode: 'cash' as const, tendered: '500' }
    const s = settle(i)
    expect(s).toMatchObject({ splitPaid: 600, remaining: 400, change: 100 })
    expect(finalPayments(i, s)).toEqual([...split, { mode: 'cash', amount: 400 }])
  })

  test('credit and points appear as their own tender lines', () => {
    const i = { ...base, customer: { storeCredit: 100, loyaltyPoints: 50 }, useCredit: true, redeemPts: 50, mode: 'upi' as const }
    const s = settle(i)
    expect(finalPayments(i, s, ' T55 ')).toEqual([
      { mode: 'upi', amount: 850, ref: 'T55' },
      { mode: 'credit', amount: 100 },
      { mode: 'credit', amount: 50, ref: '50 loyalty points' },
    ])
    // everything adds up to the bill
    expect(finalPayments(i, s).reduce((t, p) => t + p.amount, 0)).toBe(1000)
  })

  test('nothing left to pay when credit and points cover it all', () => {
    const i = { ...base, total: 100, customer: { storeCredit: 100, loyaltyPoints: 0 }, useCredit: true }
    const s = settle(i)
    expect(s.remaining).toBe(0)
    expect(finalPayments(i, s)).toEqual([{ mode: 'credit', amount: 100 }])
  })
})

describe('helpers', () => {
  test('cash suggestions are the next round figures above what is due', () => {
    expect(cashSuggestions(2999)).toEqual([3000, 4000, 5000])
    expect(cashSuggestions(1000)).toEqual([2000, 5000])
    expect(cashSuggestions(37)).toEqual([40, 50, 100, 500])
  })
  test('points earned per 100 rupees, rounded down', () => {
    expect(pointsEarned(1099, 1)).toBe(10)
    expect(pointsEarned(99, 1)).toBe(0)
    expect(pointsEarned(5000, 0)).toBe(0)
  })
})
