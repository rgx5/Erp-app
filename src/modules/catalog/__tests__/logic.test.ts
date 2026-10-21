import { applyChanges, listOf } from '@/data/state'
import { receivePurchase } from '@/data/ops'
import { toCsv } from '@/domain/csv'
import { abcAnalysis, catalogSettings, deadStock, forecastAll, lowCount, minMaxFor, minMaxSuggestions, onOrderQty, reorderPlan, seasonality, stockAgeing, valuation } from '../logic'
import { abcCsv, ageingCsv, deadStockCsv, forecastCsv, minMaxCsv, reorderCsv, valuationCsv } from '../reports'
import { createDraftOrders, saveCatalogSettings, saveReorderRule } from '../ops'
import { baseState, ctx, DAY, NOW, sell, tradingState } from './helpers'

describe('forecast', () => {
  test('a steady 2 a day forecasts 2 a day, and says it is confident', () => {
    const s = tradingState()
    const f = forecastAll(s, NOW, { horizonDays: 14 }).get('v1')!
    expect(f.perDay).toBeCloseTo(2, 1)
    expect(f.expected).toBeCloseTo(28, 0)
    expect(f.confidence).toBe('good')
    expect(f.daysOfCover).toBe(50)
    expect(forecastAll(s, NOW).get('v2')!.sold).toBe(0)
  })

  test('returns count against sales, a young item is not diluted over the whole window', () => {
    let s = baseState()
    s.products = { p1: { ...s.products.p1, createdAt: NOW - 10 * DAY } }
    for (let d = 1; d <= 10; d++) s = sell(s, 'v1', 3, d)
    const f = forecastAll(s, NOW).get('v1')!
    expect(f.days).toBe(10)
    expect(f.perDay).toBeCloseTo(3, 1)
    expect(f.confidence).toBe('low') // ten days of history is too little to trust
  })

  test('weekday pattern: a shop that sells on Saturdays expects more over a horizon with more Saturdays', () => {
    let s = baseState()
    s.products = { p1: { ...s.products.p1, createdAt: NOW - 100 * DAY } }
    s.variants = { ...s.variants, v1: { ...s.variants.v1, stock: 500 } }
    for (let d = 1; d <= 84; d++) if (new Date(NOW - d * DAY).getDay() === 6) s = sell(s, 'v1', 14, d)
    const seas = seasonality(Object.values(s.bills), NOW)
    expect(seas.weekday[6]).toBe(3) // capped
    expect(seas.weekday[1]).toBe(0.3)
    const week = forecastAll(s, NOW, { horizonDays: 7 }).get('v1')!.expected
    expect(week).toBeCloseTo(14, 0) // one Saturday in any 7 days
    const days = forecastAll(s, NOW, { horizonDays: 1 }).get('v1')!.expected
    expect(days).toBeLessThan(14)
  })

  test('min / max follows lead time, safety and cover', () => {
    expect(minMaxFor({ expectedPerDay: 2 }, { leadDays: 7, safetyDays: 3, coverDays: 14 })).toEqual({ min: 20, max: 48 })
    expect(minMaxFor({ expectedPerDay: 0.04 }, { leadDays: 7, safetyDays: 3, coverDays: 14 }, true)).toEqual({ min: 0.4, max: 1 })
  })

  test('suggestions skip items with too little history and say raise / lower', () => {
    const s = tradingState()
    const rows = minMaxSuggestions(s, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ variantId: 'v1', currentMin: 3, move: 'raise' })
    expect(rows[0].min).toBe(20)
    expect(rows[0].max).toBe(48)
  })
})

describe('auto-reorder', () => {
  test('a low variant is ordered from the last supplier at the last cost, up to the forecast max', () => {
    let s = tradingState()
    s = applyChanges(s, receivePurchase(s, { supplierId: 's1', date: NOW - 30 * DAY, invoiceRef: 'B1', items: [{ variantId: 'v1', qty: 1, cost: 410 }, { variantId: 'v2', qty: 1, cost: 420 }], total: 830, paid: 0, notes: '' }, ctx({ now: NOW - 30 * DAY })).changes)
    s.variants = { ...s.variants, v1: { ...s.variants.v1, stock: 10 } }
    const plan = reorderPlan(s, NOW)
    const l1 = plan.groups[0].lines.find((l) => l.variantId === 'v1')!
    expect(plan.groups[0]).toMatchObject({ supplierId: 's1', supplierName: 'Fab Mills' })
    expect(l1).toMatchObject({ qty: 38, cost: 410, reason: 'runs-out' }) // 10 left, 2 a day, 7 days to arrive
    // v2 has stock 5 after the receipt, reorder level 3: fine
    expect(plan.groups[0].lines.find((l) => l.variantId === 'v2')).toBeUndefined()
  })

  test('forecast catches a seller that will run out before an order arrives even above its level', () => {
    const s = tradingState()
    s.variants = { ...s.variants, v1: { ...s.variants.v1, stock: 12, reorderLevel: 3 } } // 6 days left, lead time 7
    const plan = reorderPlan({ ...s, suppliers: s.suppliers }, NOW)
    const all = [...plan.groups.flatMap((g) => g.lines), ...plan.unassigned]
    expect(all.find((l) => l.variantId === 'v1')).toMatchObject({ reason: 'runs-out' })
    expect(plan.unassigned.some((l) => l.variantId === 'v1')).toBe(true) // never bought: no supplier known
  })

  test('what is already on an open order is not ordered again; rules and the default supplier apply', () => {
    let s = tradingState()
    s.variants = { ...s.variants, v1: { ...s.variants.v1, stock: 2 } }
    s = applyChanges(s, saveCatalogSettings(s, { defaultSupplierId: 's1' }, ctx()).changes)
    s = applyChanges(s, saveReorderRule(s, 'v1', { max: 50, moq: 12 }, ctx()).changes)
    let plan = reorderPlan(s, NOW)
    expect(plan.groups[0].lines.find((l) => l.variantId === 'v1')!.qty).toBe(48) // 48 needed, a multiple of 12
    expect(lowCount(s)).toBeGreaterThan(0)
    const made = createDraftOrders(s, [{ supplierId: 's1', items: [{ variantId: 'v1', qty: 48, cost: 400 }] }], ctx())
    s = applyChanges(s, made.changes)
    expect(onOrderQty(s).get('v1')).toBe(48)
    plan = reorderPlan(s, NOW)
    expect([...plan.groups.flatMap((g) => g.lines), ...plan.unassigned].find((l) => l.variantId === 'v1')).toBeUndefined()
  })

  test('draft orders: numbered, drafts, totalled, refusals', () => {
    const s = baseState()
    const r = createDraftOrders(s, [{ supplierId: 's1', items: [{ variantId: 'v1', qty: 10, cost: 400 }, { variantId: 'v1', qty: 2, cost: 400 }] }, { supplierId: 's1', items: [{ variantId: 'v2', qty: 3, cost: 410.5 }] }], ctx())
    expect(r.orders.map((o) => [o.no, o.status, o.total])).toEqual([['PO-0001', 'draft', 4800], ['PO-0002', 'draft', 1231.5]])
    expect(r.orders[0].items).toEqual([{ variantId: 'v1', qty: 12, cost: 400, receivedQty: 0 }])
    expect(() => createDraftOrders(s, [{ supplierId: 'x', items: [] }], ctx())).toThrow('supplier')
    expect(() => createDraftOrders(s, [{ supplierId: 's1', items: [{ variantId: 'v1', qty: 0, cost: 1 }] }], ctx())).toThrow('quantity')
    expect(() => createDraftOrders(s, [], ctx())).toThrow('Choose')
  })

  test('settings are validated', () => {
    const s = baseState()
    expect(() => saveCatalogSettings(s, { leadDays: -1 }, ctx())).toThrow('Delivery time')
    expect(catalogSettings(applyChanges(s, saveCatalogSettings(s, { leadDays: 5 }, ctx()).changes)).leadDays).toBe(5)
    expect(() => saveReorderRule(s, 'v1', { min: 5, max: 5 }, ctx())).toThrow('higher')
  })
})

describe('stock reports', () => {
  test('valuation at cost and at selling price, by item / category / brand', () => {
    const s = baseState() // v1: 10 × 400, v2: 4 × 400; price 999
    const v = valuation(s, 'item')
    expect(v).toMatchObject({ qty: 14, cost: 5600, retail: 13986, margin: 8386 })
    expect(v.rows[0]).toMatchObject({ label: 'Oxford Shirt (MS-101)', variants: 2 })
    expect(valuation(s, 'category').rows[0].label).toBe('Shirts')
    expect(valuation(s, 'brand').rows[0].label).toBe('Acme')
    s.store = { ...s.store!, costBasis: 'latest' }
    s.variants = { ...s.variants, v1: { ...s.variants.v1, cost: 500 } }
    expect(valuation(s).cost).toBe(10 * 500 + 4 * 400)
    s.products = { p1: { ...s.products.p1, trackStock: false } }
    expect(valuation(s).rows).toEqual([])
  })

  test('ageing takes the newest arrivals first', () => {
    let s = baseState()
    s.products = { p1: { ...s.products.p1, createdAt: NOW - 400 * DAY } }
    s.variants = { v1: { ...s.variants.v1, stock: 10 } }
    s.moves = {
      a: { id: 'a', variantId: 'v1', qty: 8, type: 'purchase', ref: '', reason: '', at: NOW - 200 * DAY, userId: 'u' },
      b: { id: 'b', variantId: 'v1', qty: 6, type: 'purchase', ref: '', reason: '', at: NOW - 10 * DAY, userId: 'u' },
      c: { id: 'c', variantId: 'v1', qty: -9, type: 'sale', ref: '', reason: '', at: NOW - 5 * DAY, userId: 'u' },
    }
    const a = stockAgeing(s, NOW)
    expect(a.rows[0].qty).toMatchObject({ d30: 6, older: 4 })
    expect(a.value).toMatchObject({ d30: 2400, older: 1600 })
    expect(a.total).toBe(4000)
    expect(a.rows[0].oldest).toBe(200)
    // no arrivals on record: counts from the day the item was created
    s.moves = {}
    expect(stockAgeing(s, NOW).rows[0].qty.older).toBe(10)
  })

  test('dead stock: nothing sold within the window, never-sold items old enough, not new ones', () => {
    let s = tradingState() // v1 sold daily; v2 never sold, item created 120 days ago
    s.variants = { ...s.variants, v3: { ...s.variants.v1, id: 'v3', sku: 'X', barcode: '2100000000039', stock: 5 } }
    s.products = { ...s.products, p2: { ...s.products.p1, id: 'p2', createdAt: NOW - 5 * DAY, styleCode: 'N-1' } }
    s.variants = { ...s.variants, v4: { ...s.variants.v1, id: 'v4', productId: 'p2', sku: 'Y', barcode: '2100000000046', stock: 5 } }
    const d = deadStock(s, NOW, 90)
    expect(d.rows.map((r) => r.variantId).sort()).toEqual(['v2', 'v3'])
    expect(d.rows.find((r) => r.variantId === 'v2')).toMatchObject({ lastSold: null, value: 1600 })
    expect(deadStock(s, NOW, 30).rows.map((r) => r.variantId)).not.toContain('v1')
    // v1 stopped selling 60 days ago
    s = tradingState()
    expect(deadStock(s, NOW + 70 * DAY, 60).rows.map((r) => r.variantId)).toContain('v1')
  })

  test('ABC: the biggest earners are A, the tail is C, items that sold nothing are counted apart', () => {
    let s = baseState()
    s.variants = { ...s.variants, v3: { ...s.variants.v1, id: 'v3', sku: 'S3', barcode: '2100000000039', stock: 9 }, v4: { ...s.variants.v1, id: 'v4', sku: 'S4', barcode: '2100000000046', stock: 9 } }
    s.variants = { ...s.variants, v1: { ...s.variants.v1, stock: 100 } }
    s = sell(s, 'v1', 20, 3)
    s = sell(s, 'v2', 1, 3)
    s = sell(s, 'v3', 1, 3)
    const a = abcAnalysis(s, NOW - 30 * DAY, NOW)
    expect(a.rows.map((r) => r.cls)).toEqual(['A', 'B', 'C'])
    expect(a.rows[0]).toMatchObject({ variantId: 'v1', cls: 'A' })
    expect(a.rows[a.rows.length - 1].cls).toBe('C')
    expect(a.rows[a.rows.length - 1].cumulative).toBe(100)
    expect(a.classes.A.items + a.classes.B.items + a.classes.C.items).toBe(3)
    expect(a.unsold).toBe(1)
    expect(abcAnalysis(s, NOW - 30 * DAY, NOW, 'qty').rows[0].metric).toBe(20)
    expect(abcAnalysis(s, NOW + DAY, NOW + 2 * DAY).rows).toEqual([])
  })
})

describe('CSV exports match the screens', () => {
  test('every report makes a heading row and its data', () => {
    const s = tradingState()
    s.variants = { ...s.variants, v1: { ...s.variants.v1, stock: 10 } }
    for (const rows of [valuationCsv(s, 'item'), ageingCsv(s, NOW), deadStockCsv(s, NOW, 90), abcCsv(s, NOW - 60 * DAY, NOW, 'revenue'), forecastCsv(s, NOW, 14), minMaxCsv(s, NOW), reorderCsv(reorderPlan(s, NOW))]) {
      expect(rows.length).toBeGreaterThan(1)
      expect(toCsv(rows).split('\r\n')[0]).toBe(rows[0].join(','))
    }
    expect(listOf(s.bills).length).toBeGreaterThan(50)
  })
})
