import { lineDiscount, priceCart } from '@/domain/cart'
import { adjustLines } from '../../registry'
import { applyPromotions, describePromotion, describeSchedule, promoResults, promoStatus, promotionProblem, runsAt } from '../promotions'
import { metaOf } from '../prices'
import type { BuyXGetY, Bundle, Markdown, Promotion } from '../types'
import { cartLine, shop, withPromos } from './helpers'

const base = { active: true, priority: 0 }
const bogo: BuyXGetY = { ...base, id: 'bogo', name: 'Buy 2 get 1', kind: 'buy_x_get_y', scope: { categoryIds: ['cat_mshirt'] }, buyQty: 2, getQty: 1, getPct: 100 }
const bundle: Bundle = { ...base, id: 'bd', name: 'Outfit', kind: 'bundle', items: [{ variantId: 'v1', qty: 1 }, { variantId: 'v3', qty: 1 }], price: 2000 }
const sale: Markdown = { ...base, id: 'sale', name: 'Jeans sale', kind: 'category_sale', scope: { categoryIds: ['cat_jeans'] }, off: { type: 'pct', value: 20 } }
// 2026-10-19 is a Monday; 17:00 local
const at = (h: number, m = 0, day = 19) => new Date(2026, 9, day, h, m).getTime()
const NOON = at(12)

describe('schedules', () => {
  test('dates, weekdays and a time window (also past midnight)', () => {
    const hh: Markdown = { ...sale, kind: 'happy_hour', startTime: '16:00', endTime: '18:00', days: [1, 2] }
    expect(runsAt(hh, at(17))).toBe(true)
    expect(runsAt(hh, at(18))).toBe(false)
    expect(runsAt(hh, at(17, 0, 21))).toBe(false) // Wednesday
    expect(runsAt({ ...hh, days: [], startTime: '22:00', endTime: '02:00' }, at(23))).toBe(true)
    expect(runsAt({ ...hh, days: [], startTime: '22:00', endTime: '02:00' }, at(1))).toBe(true)
    expect(runsAt({ ...hh, days: [], startTime: '22:00', endTime: '02:00' }, at(12))).toBe(false)
    expect(runsAt({ ...sale, validFrom: at(0, 0, 20) }, NOON)).toBe(false)
    expect(runsAt({ ...sale, validTo: at(0, 0, 18) }, NOON)).toBe(false)
    expect(runsAt({ ...sale, active: false }, NOON)).toBe(false)
  })
  test('status and words', () => {
    expect(promoStatus(sale, NOON)).toBe('running')
    expect(promoStatus({ ...sale, validTo: at(0, 0, 18) }, NOON)).toBe('ended')
    expect(promoStatus({ ...sale, validFrom: at(0, 0, 25) }, NOON)).toBe('scheduled')
    expect(describePromotion(bogo)).toBe('Buy 2 get 1 free')
    expect(describePromotion(sale)).toBe('20% off')
    expect(describeSchedule({ ...sale, days: [1, 2], startTime: '16:00', endTime: '18:00' })).toBe('Mon, Tue · 16:00–18:00')
    expect(describeSchedule(sale)).toBe('Always')
  })
  test('problems in words', () => {
    expect(promotionProblem(bogo)).toBeNull()
    expect(promotionProblem({ ...bogo, name: ' ' })).toMatch(/name/)
    expect(promotionProblem({ ...bogo, scope: {} })).toMatch(/items/)
    expect(promotionProblem({ ...bogo, getPct: 0 })).toMatch(/1% and 100%/)
    expect(promotionProblem({ ...sale, kind: 'happy_hour' })).toMatch(/start and an end/)
    expect(promotionProblem({ ...sale, startTime: '9am', endTime: '10:00' })).toMatch(/HH:MM/)
    expect(promotionProblem({ ...bundle, items: [bundle.items[0]] })).toMatch(/two different/)
    expect(promotionProblem({ ...sale, off: { type: 'pct', value: 120 } })).toMatch(/100/)
  })
})

describe('buy X get Y', () => {
  test('buy 2 get 1 free: with 3 shirts the cheapest is free', () => {
    const s = withPromos(shop(), bogo)
    s.variants = { ...s.variants, v2: { ...s.variants.v2, price: 800 } }
    const out = applyPromotions([cartLine(s, 'v1', 2), cartLine(s, 'v2', 1)], s, NOON)
    expect(out.map((l) => lineDiscount(l))).toEqual([0, 800])
    expect(metaOf(out[1]).promos).toEqual([{ id: 'bogo', name: 'Buy 2 get 1', amount: 800 }])
  })
  test('the free pieces are the cheapest of those in play; leftovers are not discounted', () => {
    const s = withPromos(shop(), bogo)
    const lines = [cartLine(s, 'v1', 4, { price: 1000 }), cartLine(s, 'v2', 2, { price: 600 })] // 6 units → 2 groups of 3
    const out = applyPromotions(lines, s, NOON)
    expect(out.map(lineDiscount)).toEqual([0, 1200])
    const five = applyPromotions([cartLine(s, 'v1', 5)], s, NOON)
    expect(lineDiscount(five[0])).toBe(999) // 5 pieces: one group of 3, so one free
  })
  test('half price on the second, and items outside the scope are untouched', () => {
    const s = withPromos(shop(), { ...bogo, buyQty: 1, getQty: 1, getPct: 50 })
    const out = applyPromotions([cartLine(s, 'v1', 2), cartLine(s, 'v3', 2)], s, NOON)
    expect(out.map(lineDiscount)).toEqual([499.5, 0])
  })
  test('same item only', () => {
    const s = withPromos(shop(), { ...bogo, sameItem: true })
    const mixed = applyPromotions([cartLine(s, 'v1', 2), cartLine(s, 'v2', 1)], s, NOON)
    expect(mixed.map(lineDiscount)).toEqual([0, 0])
    expect(lineDiscount(applyPromotions([cartLine(s, 'v1', 3)], s, NOON)[0])).toBe(999)
  })
})

describe('bundle, sale and happy hour', () => {
  test('a bundle takes the difference for every complete set', () => {
    const s = withPromos(shop(), bundle) // 999 + 1500 = 2499 → 2000, saving 499
    const one = applyPromotions([cartLine(s, 'v1'), cartLine(s, 'v3')], s, NOON)
    expect(one.reduce((t, l) => t + lineDiscount(l), 0)).toBe(499)
    const two = applyPromotions([cartLine(s, 'v1', 3), cartLine(s, 'v3', 2)], s, NOON)
    expect(two.reduce((t, l) => t + lineDiscount(l), 0)).toBe(998)
    expect(applyPromotions([cartLine(s, 'v1'), cartLine(s, 'v4')], s, NOON).every((l) => lineDiscount(l) === 0)).toBe(true)
    const t = priceCart(one, 'amt', 0, s.store!.slabs, true)
    expect(t.subtotal).toBe(2000)
  })
  test('a category sale, by percentage or rupees', () => {
    const s = withPromos(shop(), sale)
    expect(lineDiscount(applyPromotions([cartLine(s, 'v3', 2)], s, NOON)[0])).toBe(600)
    const amt = withPromos(shop(), { ...sale, off: { type: 'amt' as const, value: 100 } })
    expect(lineDiscount(applyPromotions([cartLine(amt, 'v3', 2)], amt, NOON)[0])).toBe(200)
  })
  test('a happy hour runs only in its window', () => {
    const hh: Markdown = { ...sale, id: 'hh', kind: 'happy_hour', scope: { all: true }, startTime: '16:00', endTime: '18:00', off: { type: 'pct', value: 10 } }
    const s = withPromos(shop(), hh)
    expect(lineDiscount(applyPromotions([cartLine(s, 'v3')], s, at(17))[0])).toBe(150)
    expect(lineDiscount(applyPromotions([cartLine(s, 'v3')], s, at(12))[0])).toBe(0)
  })
  test('an item that takes no discount, and a hand-priced line, are never discounted', () => {
    const s = withPromos(shop(), { ...sale, scope: { all: true } })
    const out = applyPromotions([cartLine(s, 'v4', 2), cartLine(s, 'v3', 1, { priceOverridden: true })], s, NOON)
    expect(out.map(lineDiscount)).toEqual([0, 0])
  })
  test('retail-only offers skip a wholesale customer', () => {
    const s = withPromos(shop(), { ...sale, retailOnly: true })
    expect(lineDiscount(applyPromotions([cartLine(s, 'v3')], s, NOON, { retail: false })[0])).toBe(0)
    expect(lineDiscount(applyPromotions([cartLine(s, 'v3')], s, NOON, { retail: true })[0])).toBe(300)
  })
})

describe('several promotions', () => {
  test('each piece is used by one offer; priority picks who goes first', () => {
    const sale2: Markdown = { ...sale, id: 's2', name: 'Shirts 10%', scope: { categoryIds: ['cat_mshirt'] }, off: { type: 'pct', value: 10 }, priority: 5 }
    const s = withPromos(shop(), bogo, sale2)
    const out = applyPromotions([cartLine(s, 'v1', 3)], s, NOON)
    expect(lineDiscount(out[0])).toBe(999) // bogo claimed the pieces first
    const swapped = withPromos(shop(), { ...bogo, priority: 9 }, sale2)
    expect(lineDiscount(applyPromotions([cartLine(swapped, 'v1', 3)], swapped, NOON)[0])).toBe(299.7)
  })
  test('it adds to a discount the cashier already gave, never beyond the line', () => {
    const s = withPromos(shop(), sale)
    const out = applyPromotions([cartLine(s, 'v3', 1, { discountType: 'pct', discountValue: 10 })], s, NOON)
    expect(lineDiscount(out[0])).toBe(450)
    const big = applyPromotions([cartLine(s, 'v3', 1, { discountType: 'pct', discountValue: 90 })], s, NOON)
    expect(lineDiscount(big[0])).toBeLessThanOrEqual(1500)
  })
  test('never adds or removes a line, and does nothing with no promotions', () => {
    const s = shop()
    const lines = [cartLine(s, 'v1', 3)]
    expect(applyPromotions(lines, s, NOON)).toBe(lines)
    const p = withPromos(s, bogo)
    expect(applyPromotions(lines, p, NOON)).toHaveLength(1)
  })
  test('the registered adjuster applies promotions with the real clock', () => {
    const s = withPromos(shop(), { ...sale, validFrom: 1 } as Promotion)
    const out = adjustLines([cartLine(s, 'v3')], { state: s, customerId: null, extras: {} })
    expect(lineDiscount(out[0])).toBe(300)
  })
})

describe('what the offers did', () => {
  test('totals per promotion from the bill lines; returns and parked bills are left out', () => {
    const s = withPromos(shop(), sale)
    const lines = applyPromotions([cartLine(s, 'v3', 2)], s, NOON)
    const t = priceCart(lines, 'amt', 0, s.store!.slabs, true)
    const bill = { id: 'b1', status: 'paid', total: t.total, items: t.items } as never
    expect(promoResults([bill, bill, { id: 'b2', status: 'held', total: 1, items: t.items } as never, { id: 'b3', status: 'returned', total: -5, refundOfBillId: 'b1', items: t.items } as never]))
      .toEqual([{ id: 'sale', name: 'Jeans sale', bills: 1, discount: 1200 }])
  })
})
