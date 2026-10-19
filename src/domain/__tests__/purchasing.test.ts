import { boughtSince, buildGrn, grnTotal, invoiceCheck, lastSupplierByVariant, readPrices, suggestPrice, totalPayable } from '../purchasing'
import { filterMoves, ledgerTotals, matchesFilter } from '../ledger'
import type { Purchase, StockMove, Supplier } from '../types'

const purchase = (over: Partial<Purchase>): Purchase => ({ id: 'p', no: 'GRN-0001', supplierId: 's1', date: 1000, invoiceRef: '', items: [], total: 0, paid: 0, notes: '', userId: 'u', ...over })
const supplier = (over: Partial<Supplier> = {}): Supplier => ({ id: 's1', name: 'Mehta Textiles', phone: '', gstin: '', address: '', openingBalance: 0, ...over })
const move = (over: Partial<StockMove>): StockMove => ({ id: 'm', variantId: 'v1', qty: 1, type: 'sale', ref: 'INV-1', reason: '', at: 1, userId: 'u', ...over })

describe('goods receipt', () => {
  test('total is exact to the paisa and skips lines without a quantity', () => {
    const r = buildGrn([
      { variantId: 'a', qty: '12', cost: '199.99' },
      { variantId: 'b', qty: '2.5', cost: '40' },
      { variantId: 'c', qty: '', cost: '10' },
      { variantId: 'd', qty: '0', cost: '10' },
    ])
    expect(r.items).toHaveLength(2)
    expect(r.skipped).toBe(2)
    expect(r.total).toBe(2499.88)
  })

  test('a blank cost is received at zero rather than rejected', () => {
    expect(buildGrn([{ variantId: 'a', qty: '3', cost: '' }]).items[0].cost).toBe(0)
  })

  test('grnTotal rounds float drift away', () => {
    expect(grnTotal([{ qty: 3, cost: 0.1 }, { qty: 3, cost: 0.2 }])).toBe(0.9)
  })

  test('invoice check tolerates a rupee of rounding, flags more, ignores a missing total', () => {
    expect(invoiceCheck(1000, undefined)).toBeNull()
    expect(invoiceCheck(1000, 0)).toBeNull()
    expect(invoiceCheck(1000.4, 1000)).toEqual({ diff: 0.4, ok: true })
    expect(invoiceCheck(1000, 1150)).toEqual({ diff: -150, ok: false })
    expect(invoiceCheck(1200, 1150)).toEqual({ diff: 50, ok: false })
  })
})

describe('suggested prices', () => {
  test('rounds up to a tag-friendly figure', () => {
    expect(suggestPrice(0, 50)).toBe(0)
    expect(suggestPrice(12, 50)).toBe(18)
    expect(suggestPrice(7.3, 40)).toBe(11)
    expect(suggestPrice(200, 50)).toBe(300)
    expect(suggestPrice(201, 50)).toBe(305)
  })
})

describe('price later form', () => {
  test('blank rows wait, a missing MRP follows the price, a low MRP is refused', () => {
    const r = readPrices({ a: { price: '499', mrp: '' }, b: { price: '', mrp: '' }, c: { price: '300', mrp: '250' }, d: { price: '', mrp: '90' }, e: { price: '120.5', mrp: '150' } })
    expect(r.rows).toEqual([{ id: 'a', price: 499, mrp: 499 }, { id: 'e', price: 120.5, mrp: 150 }])
    expect(r.errors).toEqual({ c: 'MRP can’t be below the price', d: 'Enter a selling price' })
  })
})

describe('supplier figures', () => {
  test('payable sums only what is owed, per supplier', () => {
    const s = [supplier({ id: 's1', openingBalance: 500 }), supplier({ id: 's2', name: 'B', openingBalance: 0 })]
    const p = [purchase({ supplierId: 's1', total: 1000, paid: 400 }), purchase({ supplierId: 's2', total: 300, paid: 400 })]
    // s1 owes 500 + 600, s2 is overpaid (-100) and counts as nothing
    expect(totalPayable(s, p)).toBe(1100)
  })

  test('boughtSince counts from the cut-off', () => {
    expect(boughtSince([purchase({ date: 5, total: 100 }), purchase({ date: 50, total: 40 })], 10)).toBe(40)
  })

  test('last supplier per variant follows receipt dates, not list order', () => {
    const m = lastSupplierByVariant([
      purchase({ date: 200, supplierId: 's2', items: [{ variantId: 'v1', qty: 1, cost: 1 }] }),
      purchase({ date: 100, supplierId: 's1', items: [{ variantId: 'v1', qty: 1, cost: 1 }, { variantId: 'v2', qty: 1, cost: 1 }] }),
    ])
    expect(m.get('v1')).toBe('s2')
    expect(m.get('v2')).toBe('s1')
  })
})

describe('stock ledger', () => {
  test('filters group corrections together and sort newest first', () => {
    expect(matchesFilter('audit', 'adjust')).toBe(true)
    expect(matchesFilter('sale', 'adjust')).toBe(false)
    expect(matchesFilter('sale', '')).toBe(true)
    const rows = filterMoves([move({ id: '1', at: 1 }), move({ id: '2', at: 9, type: 'adjust' }), move({ id: '3', at: 5, type: 'purchase', ref: 'GRN-9' })], '', '', () => 'Shirt')
    expect(rows.map((r) => r.id)).toEqual(['2', '3', '1'])
    expect(filterMoves(rows, '', 'grn', () => 'Shirt').map((r) => r.id)).toEqual(['3'])
  })

  test('totals split in and out', () => {
    expect(ledgerTotals([move({ qty: 5 }), move({ qty: -2 }), move({ qty: -0.5 })])).toEqual({ inQty: 5, outQty: 2.5, count: 3 })
  })
})
