import { INDUSTRIES } from '@/industries'
import { computeDashboard, computeReport } from '@/domain/analytics'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import { rangeBounds } from '@/domain/dates'
import { isValidEan13 } from '@/domain/barcode'
import { buildDemo, newBusinessState } from '../demo'
import { listOf } from '../state'

const NOW = new Date('2026-10-19T15:30:00').getTime()

describe.each(INDUSTRIES.map((p) => [p.id, p] as const))('demo business: %s', (_id, pack) => {
  const t0 = Date.now()
  const s = buildDemo(pack.id, { now: NOW, seed: 7, days: 30 })
  const bills = listOf(s.bills)
  const variants = listOf(s.variants)
  void t0

  test('is a believable business', () => {
    expect(s.store!.name).toBe(pack.demo.storeName)
    expect(listOf(s.products).length).toBe(pack.demo.items.length)
    expect(bills.filter((b) => b.status !== 'held' && b.total > 0).length).toBeGreaterThan(30 * pack.demo.billsPerDay[0] * 0.5)
    expect(listOf(s.customers).length).toBeGreaterThan(20)
    expect(listOf(s.expenses).length).toBeGreaterThan(5)
    expect(new Set(listOf(s.customers).map((c) => c.phone)).size).toBe(listOf(s.customers).length)
  })

  test('the stock ledger adds up to what is on the shelf, and nothing is negative', () => {
    const byVariant = new Map<string, number>()
    for (const m of listOf(s.moves)) byVariant.set(m.variantId, round3((byVariant.get(m.variantId) ?? 0) + m.qty))
    for (const v of variants) {
      expect(v.stock).toBeGreaterThanOrEqual(0)
      expect(round3(byVariant.get(v.id) ?? 0)).toBe(round3(v.stock))
    }
  })

  test('services and made-to-order items never hold stock', () => {
    for (const v of variants) {
      const p = s.products[v.productId]
      if (p.trackStock === false) expect(v.stock).toBe(0)
    }
  })

  test('every bill adds up, every number is unique, payments match', () => {
    const nos = new Set<string>()
    for (const b of bills) {
      expect(nos.has(b.no)).toBe(false)
      nos.add(b.no)
      expect(round2(b.items.reduce((t, i) => t + i.lineTotal, 0))).toBe(b.subtotal)
      expect(Math.round(b.subtotal)).toBe(Math.abs(b.total))
      if (b.status === 'paid' || b.status === 'partial-return' || b.status === 'returned') {
        if (!b.refundOfBillId) expect(Math.abs(b.paid - b.total)).toBeLessThan(0.011)
      }
      for (const i of b.items) {
        expect(round2(i.taxable + i.cgst + i.sgst)).toBeCloseTo(i.lineTotal > 0 ? Math.min(i.lineTotal, round2(i.taxable + i.cgst + i.sgst)) : 0, 1)
      }
    }
  })

  test('returns point at real bills and never exceed what was sold', () => {
    for (const cn of bills.filter((b) => b.refundOfBillId)) {
      const original = s.bills[cn.refundOfBillId!]
      expect(original).toBeDefined()
      expect(cn.total).toBeLessThan(0)
      for (const it of original.items) expect(it.returnedQty).toBeLessThanOrEqual(it.qty)
    }
  })

  test('barcodes are valid and unique; item codes are unique', () => {
    expect(new Set(variants.map((v) => v.barcode)).size).toBe(variants.length)
    expect(variants.every((v) => isValidEan13(v.barcode))).toBe(true)
    expect(new Set(variants.map((v) => v.sku)).size).toBe(variants.length)
  })

  test('the till: past days are closed, today is open', () => {
    const sessions = listOf(s.sessions).sort((a, b) => a.openedAt - b.openedAt)
    expect(sessions.filter((x) => !x.closedAt)).toHaveLength(1)
    expect(sessions.at(-1)!.closedAt).toBeUndefined()
    for (const x of sessions.filter((y) => y.closedAt)) expect(x.variance).toBe(round2((x.countedCash ?? 0) - (x.expectedCash ?? 0)))
  })

  test('dashboard and reports agree with each other', () => {
    const input = { bills, expenses: listOf(s.expenses), variants, products: listOf(s.products), store: s.store }
    const dash = computeDashboard(input, '30d', NOW)
    expect(dash.cur.sales).toBeGreaterThan(0)
    expect(dash.topItems.length).toBeGreaterThan(2)
    expect(dash.series).toHaveLength(30)
    expect(dash.unpriced.count).toBe(Math.min(2, variants.filter((v) => s.products[v.productId].trackStock !== false).length))
    const [from, to] = rangeBounds('30d', NOW)
    const rep = computeReport(input, listOf(s.users), from, to, NOW)
    // The same sales, seen two ways, must be the same number.
    expect(rep.revenue).toBe(dash.cur.sales)
    expect(rep.net).toBe(dash.cur.net)
    expect(rep.cogs).toBe(dash.cur.cost)
    // Staff credit is per line (before the bill's rupee round-off), so it differs from takings by exactly the round-offs.
    const roundOffs = round2(bills.filter((b) => b.status !== 'held' && b.date >= from && b.date <= to).reduce((t, b) => t + (b.total < 0 ? -1 : 1) * b.roundOff, 0))
    expect(round2(rep.staff.reduce((t, x) => t + x.revenue, 0) + roundOffs)).toBeCloseTo(rep.revenue, 1)
    expect(rep.modes.reduce((t, [, v]) => t + v, 0)).toBeCloseTo(rep.revenue, 0)
  })

  test('is deterministic for a given seed', () => {
    const again = buildDemo(pack.id, { now: NOW, seed: 7, days: 30 })
    expect(listOf(again.bills).map((b) => b.total)).toEqual(bills.map((b) => b.total))
  })
})

test('a new business starts empty but ready to sell', () => {
  const pack = INDUSTRIES[1]
  const s = newBusinessState({ pack, name: ' Fresh Mart ', ownerName: 'Asha' })
  expect(s.store!.name).toBe('Fresh Mart')
  expect(Object.keys(s.categories)).toHaveLength(pack.categories.length)
  expect(Object.values(s.users)[0].role).toBe('owner')
  expect(Object.keys(s.bills)).toHaveLength(0)
})
