/**
 * Parity with the Krishna Collection billing app. Every expected value in `fixtures/krishna-golden.json` was produced by
 * the billing app's own source (see scripts/gen-golden.ts). If any of these fail, the mobile app would total a bill
 * differently from the counter — treat that as a release blocker, not a test to "fix".
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { priceCart, type CartLine } from '../cart'
import { planReturn } from '../returns'
import { computeLineTax, hsnSummary, rateFor } from '../tax'
import { amountInWords, roundOff, round2 } from '../money'
import { fmtQty, isFrac, minQtyOf, parseQty, qtyStep, quickQuantities, rulesOfBillItem, unitPer, unitSuffix } from '../qty'
import { costFor, needsPricing, weightedAvg } from '../pricing'
import { billFigures } from '../figures'
import type { Bill } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const golden: any = JSON.parse(gunzipSync(readFileSync(join(__dirname, 'fixtures', 'krishna-golden.json.gz'))).toString())

// The fixture is JSON, so assertions are on the exact same values the reference produced (JSON drops `undefined`).
const j = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

describe('priceCart matches the billing app', () => {
  test.each((golden.carts as any[]).map((c, i) => [i, c]))('cart #%i', (_i, c) => {
    const { input, out } = c
    const got = priceCart(input.lines as CartLine[], input.billDiscountType, input.billDiscountValue, input.slabs, input.inclusive)
    expect(j(got)).toEqual(out)
  })
})

describe('planReturn matches the billing app (partial → final returns)', () => {
  test.each((golden.returnScenarios as any[]).map((s, i) => [i, s]))('scenario #%i', (_i, s) => {
    for (const step of s.steps) {
      const cur = { ...s.original, items: s.original.items.map((it: any) => ({ ...it, returnedQty: step.returnedBefore[it.variantId] ?? 0 })) } as Bill
      expect(j(planReturn(cur, step.prior as Bill[], step.wants))).toEqual(step.plan)
    }
  })
})

describe('tax maths', () => {
  test('computeLineTax', () => {
    for (const v of golden.lineTax as any[]) expect(j(computeLineTax(v.net, v.qty, v.slabs, v.inclusive, v.fixed))).toEqual(v.out)
  })
  test('rateFor', () => {
    for (const v of golden.rates as any[]) expect(rateFor(v.p, v.s)).toBe(v.out)
  })
  test('hsnSummary', () => {
    for (const v of golden.hsn as any[]) expect(j(hsnSummary(v.lines))).toEqual(v.out)
  })
})

describe('money helpers', () => {
  test('amountInWords (Indian numbering)', () => {
    for (const v of golden.words as any[]) expect(amountInWords(v.a)).toBe(v.out)
  })
  test('roundOff / round2', () => {
    for (const v of golden.roundOffs as any[]) {
      expect(roundOff(v.a)).toEqual(v.out)
      expect(round2(v.a)).toBe(v.r2)
    }
  })
  test('weightedAvg cost', () => {
    for (const v of golden.weighted as any[]) expect(weightedAvg(v.onHand, v.oldAvg, v.qty, v.cost)).toBe(v.out)
  })
})

describe('quantity rules (units shared with the billing app)', () => {
  test('every unit preset the billing app has', () => {
    for (const v of golden.qtyVectors as any[]) {
      const r = v.rules
      expect(isFrac(r)).toBe(v.isFrac)
      expect(qtyStep(r)).toBe(v.step)
      expect(minQtyOf(r)).toBe(v.min)
      expect(unitSuffix(r)).toBe(v.suffix)
      expect(unitPer(r)).toBe(v.per)
      expect(quickQuantities(r)).toEqual(v.quick)
      for (const p of v.parsed) expect(parseQty(p.s, r)).toBe(p.out)
      for (const f of v.fmt) expect(fmtQty(f.n)).toBe(f.out)
    }
  })
})

describe('bill figures (what a return does to a report)', () => {
  test('sign, net, gst, cost and discount agree', () => {
    for (const v of golden.figures as any[]) {
      const cost = (vid: string) => (vid.length * 7) % 90
      expect(j(billFigures(v.bill, cost))).toEqual(v.out)
    }
  })
})

describe('pricing helpers', () => {
  test('costFor / needsPricing / rulesOfBillItem', () => {
    for (const c of golden.misc.costFor as any[]) expect(costFor(c.v, c.basis)).toBe(c.out)
    for (const c of golden.misc.needsPricing as any[]) expect(needsPricing({ price: c.p })).toBe(c.out)
    for (const c of golden.misc.rulesOfBillItem as any[]) expect(j(rulesOfBillItem(c.x))).toEqual(c.out)
  })
})
