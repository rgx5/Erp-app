import { priceCart } from '@/domain/cart'
import { adjustLines } from '../../registry'
import { adjustBreaks, adjustListPrices, breakFor, breakRuleProblem, listForCart, listPrice, metaOf, roundPrice } from '../prices'
import type { QtyBreakRule } from '../types'
import { cartLine, dealer, shop, withBreaks, withListPrice, wholesale } from './helpers'

describe('price lists', () => {
  test('a rule works on the price, the MRP or the cost, and rounds', () => {
    const l = { price: 999, mrp: 1299, cost: 400 }
    expect(listPrice(wholesale, l)).toBe(899.1)
    expect(listPrice({ ...wholesale, basis: 'mrp', pct: -20 }, l)).toBe(1039.2)
    expect(listPrice(dealer, l)).toBe(480)
    expect(listPrice({ ...dealer, roundTo: 0 }, { ...l, cost: 401 })).toBe(481.2)
    expect(roundPrice(483, 5)).toBe(485)
  })
  test('an item with no cost keeps its selling price under a cost-plus list', () => {
    expect(listPrice(dealer, { price: 999, mrp: 1299, cost: undefined })).toBe(999)
  })
  test('an item’s own price on the list beats the rule', () => {
    const own = { id: 'pl_ws:v1', listId: 'pl_ws', variantId: 'v1', price: 850 }
    expect(listPrice(wholesale, { price: 999, mrp: 1299, cost: 400 }, own)).toBe(850)
  })
  test('the bill’s list: picked at checkout, else the customer’s, else the shop’s default; inactive lists do not count', () => {
    const s = shop()
    expect(listForCart(s, 'c1', {})?.id).toBe('pl_ws')
    expect(listForCart(s, 'c2', {})).toBeNull()
    expect(listForCart(s, 'c1', { pricing: { priceListId: 'pl_dl' } })?.id).toBe('pl_dl')
    const withDefault = { ...s, pricingSettings: { settings: { id: 'settings' as const, defaultListId: 'pl_dl' } } }
    expect(listForCart(withDefault, 'c2', {})?.id).toBe('pl_dl')
    expect(listForCart({ ...s, priceLists: { pl_ws: { ...wholesale, active: false } } }, 'c1', {})).toBeNull()
  })
  test('the cart adjuster prices lines on the list and remembers the original price', () => {
    const s = withListPrice(shop(), 'pl_ws', 'v3', 1200)
    const out = adjustLines([cartLine(s, 'v1', 2), cartLine(s, 'v3')], { state: s, customerId: 'c1', extras: {} })
    expect(out.map((l) => l.price)).toEqual([899.1, 1200])
    expect(metaOf(out[0])).toMatchObject({ basePrice: 999, listId: 'pl_ws' })
    expect(out.map((l) => l.qty)).toEqual([2, 1])
  })
  test('a hand-priced line and an unpriced sale are left alone', () => {
    const s = shop()
    const lines = [cartLine(s, 'v1', 1, { priceOverridden: true, price: 500 }), cartLine(s, 'v3', 1, { unpricedSale: true, price: 0 })]
    expect(adjustListPrices(lines, s, wholesale)).toEqual(lines)
  })
  test('no list: the lines come back untouched (same objects)', () => {
    const s = shop()
    const lines = [cartLine(s, 'v1')]
    expect(adjustLines(lines, { state: s, customerId: 'c2', extras: {} })).toBe(lines)
  })
  test('the priced cart totals on the list price', () => {
    const s = shop()
    const lines = adjustLines([cartLine(s, 'v1', 10)], { state: s, customerId: 'c1', extras: {} })
    const t = priceCart(lines, 'amt', 0, s.store!.slabs, true)
    expect(t.subtotal).toBe(8991)
  })
})

const rule = (over: Partial<QtyBreakRule> = {}): QtyBreakRule => ({
  id: 'qb1', name: 'Shirts bulk', target: 'product', targetId: 'p1', listId: '', active: true, breaks: [{ minQty: 6, kind: 'pct', value: 5 }, { minQty: 12, kind: 'pct', value: 10 }], ...over,
})

describe('quantity breaks', () => {
  test('the highest step reached applies', () => {
    const b = rule().breaks
    expect(breakFor(b, 5)).toBeNull()
    expect(breakFor(b, 6)?.value).toBe(5)
    expect(breakFor(b, 20)?.value).toBe(10)
  })
  test('a product rule counts every size together', () => {
    const s = withBreaks(shop(), rule())
    const out = adjustBreaks([cartLine(s, 'v1', 3), cartLine(s, 'v2', 3)], s, null)
    expect(out.map((l) => l.price)).toEqual([949.05, 949.05])
    expect(metaOf(out[0])).toMatchObject({ basePrice: 999, breakId: 'qb1', breakMinQty: 6 })
    expect(adjustBreaks([cartLine(s, 'v1', 3), cartLine(s, 'v2', 2)], s, null).map((l) => l.price)).toEqual([999, 999])
  })
  test('a fixed-price step never raises a price', () => {
    const s = withBreaks(shop(), rule({ target: 'variant', targetId: 'v1', breaks: [{ minQty: 2, kind: 'price', value: 900 }] }), rule({ id: 'qb2', target: 'variant', targetId: 'v3', breaks: [{ minQty: 2, kind: 'price', value: 2000 }] }))
    const out = adjustBreaks([cartLine(s, 'v1', 2), cartLine(s, 'v3', 2)], s, null)
    expect(out.map((l) => l.price)).toEqual([900, 1500])
  })
  test('the most specific rule wins, and a rule for the customer’s list beats one for everyone', () => {
    const s = withBreaks(shop(),
      rule({ id: 'all', target: 'all', targetId: '', breaks: [{ minQty: 1, kind: 'pct', value: 50 }] }),
      rule({ id: 'prod', breaks: [{ minQty: 1, kind: 'pct', value: 1 }] }),
      rule({ id: 'prod_ws', listId: 'pl_ws', breaks: [{ minQty: 1, kind: 'pct', value: 2 }] }))
    expect(metaOf(adjustBreaks([cartLine(s, 'v1')], s, wholesale)[0]).breakId).toBe('prod_ws')
    expect(metaOf(adjustBreaks([cartLine(s, 'v1')], s, null)[0]).breakId).toBe('prod')
    expect(metaOf(adjustBreaks([cartLine(s, 'v3')], s, null)[0]).breakId).toBe('all')
  })
  test('"no discount" items and inactive rules are skipped', () => {
    const s = withBreaks(shop(), rule({ id: 'all', target: 'all', targetId: '', breaks: [{ minQty: 1, kind: 'pct', value: 50 }] }), rule({ id: 'off', active: false }))
    const out = adjustBreaks([cartLine(s, 'v4', 3)], s, null)
    expect(out[0].price).toBe(200)
  })
  test('a rule is checked before it is saved', () => {
    expect(breakRuleProblem(rule())).toBeNull()
    expect(breakRuleProblem(rule({ breaks: [] }))).toMatch(/at least one step/)
    expect(breakRuleProblem(rule({ targetId: '' }))).toMatch(/Choose what/)
    expect(breakRuleProblem(rule({ breaks: [{ minQty: 5, kind: 'pct', value: 5 }, { minQty: 5, kind: 'pct', value: 9 }] }))).toMatch(/Two steps/)
    expect(breakRuleProblem(rule({ breaks: [{ minQty: 5, kind: 'pct', value: 150 }] }))).toMatch(/100/)
  })
  test('list prices then breaks stack on the wholesale price', () => {
    const s = withBreaks(shop(), rule())
    const out = adjustLines([cartLine(s, 'v1', 6)], { state: s, customerId: 'c1', extras: {} })
    expect(out[0].price).toBe(854.15) // 999 − 10% = 899.10, − 5% = 854.145 → 854.15
    expect(metaOf(out[0]).basePrice).toBe(999)
  })
})
