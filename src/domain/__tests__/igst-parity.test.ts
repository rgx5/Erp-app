/**
 * IGST and bill-of-supply, held to the same standard as the rest: no golden file exists for them (the billing app this was
 * ported from is intra-state only), so the golden carts and returns are replayed under the new treatments and the results
 * must agree with the originals to the paisa — an inter-state bill is the same sale with its tax in one column, and a bill of
 * supply is the same sale with no tax.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { billFigures } from '../figures'
import { priceCart, type CartLine } from '../cart'
import { planReturn } from '../returns'
import { computeLineTax, hsnSummary, rateSummary } from '../tax'
import { round2 } from '../money'
import type { Bill, BillItem } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const golden: any = JSON.parse(gunzipSync(readFileSync(join(__dirname, 'fixtures', 'krishna-golden.json.gz'))).toString())
const carts = (golden.carts as Array<{ input: { lines: CartLine[]; billDiscountType: 'pct' | 'amt'; billDiscountValue: number; slabs: never; inclusive: boolean } }>).map((c, i) => [i, c.input] as const)

describe('an inter-state sale is the same sale with IGST', () => {
  test.each(carts)('cart #%i', (_i, input) => {
    const local = priceCart(input.lines, input.billDiscountType, input.billDiscountValue, input.slabs, input.inclusive)
    const inter = priceCart(input.lines, input.billDiscountType, input.billDiscountValue, input.slabs, input.inclusive, { interState: true })
    for (const k of ['subtotal', 'taxableTotal', 'taxTotal', 'total', 'roundOff', 'grossMrp', 'itemDiscount', 'billDiscount'] as const) expect(inter[k]).toBe(local[k])
    expect(inter.cgstTotal).toBe(0)
    expect(inter.sgstTotal).toBe(0)
    expect(inter.igstTotal).toBe(local.taxTotal)
    inter.items.forEach((it, i) => {
      const l = local.items[i]
      expect(it.cgst).toBe(0)
      expect(it.sgst).toBe(0)
      expect(it.igst).toBe(round2(l.cgst + l.sgst))
      for (const k of ['taxable', 'taxRate', 'net', 'lineTotal', 'discountAmount'] as const) expect(it[k]).toBe(l[k])
    })
  })

  test('an ordinary local sale carries no IGST fields at all (the golden output is untouched)', () => {
    const c = carts[0][1]
    const t = priceCart(c.lines, c.billDiscountType, c.billDiscountValue, c.slabs, c.inclusive)
    expect('igstTotal' in t).toBe(false)
    expect(t.items.every((i) => !('igst' in i))).toBe(true)
  })

  test('computeLineTax: one IGST amount, the same total tax', () => {
    const a = computeLineTax(1050, 1, [{ upto: 1e9, rate: 5 }], true)
    const b = computeLineTax(1050, 1, [{ upto: 1e9, rate: 5 }], true, undefined, { interState: true })
    expect(b).toEqual({ taxable: a.taxable, rate: 5, cgst: 0, sgst: 0, igst: a.tax, tax: a.tax, gross: a.gross })
    expect('igst' in a).toBe(false)
  })

  test('a one-paisa tax stays one paisa (no half-and-half rounding)', () => {
    const t = computeLineTax(1.05, 1, [{ upto: 1e9, rate: 5 }], true, undefined, { interState: true })
    expect(t.igst).toBe(0.05)
    expect(t.cgst + t.sgst).toBe(0)
  })

  test('the HSN and rate summaries add up IGST, and stay as they were for local lines', () => {
    const lines = [
      { hsn: '6205', taxable: 100, cgst: 0, sgst: 0, igst: 5, taxRate: 5, qty: 1 },
      { hsn: '6205', taxable: 200, cgst: 0, sgst: 0, igst: 10, taxRate: 5, qty: 2 },
      { hsn: '6109', taxable: 50, cgst: 4.5, sgst: 4.5, taxRate: 18, qty: 1 },
    ]
    expect(hsnSummary(lines)).toEqual([
      { hsn: '6109', rate: 18, qty: 1, taxable: 50, cgst: 4.5, sgst: 4.5 },
      { hsn: '6205', rate: 5, qty: 3, taxable: 300, cgst: 0, sgst: 0, igst: 15 },
    ])
    expect(rateSummary(lines).find((r) => r.rate === 5)).toEqual({ rate: 5, taxable: 300, cgst: 0, sgst: 0, igst: 15 })
  })
})

describe('a bill of supply is the same sale with no tax', () => {
  test.each(carts)('cart #%i', (_i, input) => {
    const t = priceCart(input.lines, input.billDiscountType, input.billDiscountValue, input.slabs, input.inclusive, { noTax: true })
    expect(t.taxTotal).toBe(0)
    expect(t.cgstTotal + t.sgstTotal).toBe(0)
    t.items.forEach((it) => { expect(it.taxRate).toBe(0); expect(it.taxable).toBe(it.net); expect(it.cgst + it.sgst).toBe(0) })
    expect(t.subtotal).toBe(round2(t.items.reduce((s, i) => s + i.net, 0)))
  })
})

describe('returns keep IGST consistent', () => {
  const scenarios = (golden.returnScenarios as Array<{ original: Bill; steps: Array<{ returnedBefore: Record<string, number>; prior: Bill[]; wants: Array<{ variantId: string; qty: number }> }> }>).slice(0, 12)
  const toIgst = (b: Bill): Bill => ({ ...b, items: b.items.map((i): BillItem => ({ ...i, igst: round2(i.cgst + i.sgst), cgst: 0, sgst: 0 })) })

  test.each(scenarios.map((s, i) => [i, s] as const))('scenario #%i: returns carry the tax, and the pieces add up to the original', (_i, s) => {
    // Replay the steps twice from scratch — as a local bill and as an inter-state one — each against its own earlier credit notes.
    const run = (orig: Bill) => {
      const prior: Bill[] = []
      const back: Record<string, number> = {}
      const plans: NonNullable<ReturnType<typeof planReturn>>[] = []
      for (const step of s.steps) {
        const cur = { ...orig, items: orig.items.map((it) => ({ ...it, returnedQty: back[it.variantId] ?? 0 })) } as Bill
        const plan = planReturn(cur, prior, step.wants)
        if (!plan) continue
        plans.push(plan)
        prior.push({ ...orig, items: plan.items, total: -plan.total, subtotal: plan.subtotal, loyaltyEarned: -plan.loyaltyReverse } as Bill)
        for (const it of plan.items) back[it.variantId] = (back[it.variantId] ?? 0) + it.qty
      }
      return plans
    }
    const local = run(s.original)
    const inter = run(toIgst(s.original))
    expect(inter).toHaveLength(local.length)
    const given: Record<string, number> = {}
    inter.forEach((plan, k) => {
      expect(plan.total).toBe(local[k].total)
      plan.items.forEach((it, i) => {
        // One IGST amount is split once; CGST and SGST are split separately — a piece may differ from the local pair by a paisa.
        expect(Math.abs((it.igst ?? 0) - round2(local[k].items[i].cgst + local[k].items[i].sgst))).toBeLessThanOrEqual(0.011)
        expect(it.cgst + it.sgst).toBe(0)
        expect(it.lineTotal).toBe(local[k].items[i].lineTotal)
        given[it.variantId] = round2((given[it.variantId] ?? 0) + (it.igst ?? 0))
      })
    })
    // …but a line that has come back in full has returned exactly the tax it was charged.
    const fullyBack = s.original.items.filter((it) => inter.reduce((n, p) => n + (p.items.find((x) => x.variantId === it.variantId)?.qty ?? 0), 0) >= it.qty)
    for (const it of fullyBack) expect(given[it.variantId]).toBe(round2(it.cgst + it.sgst))
  })
})

describe('figures count IGST as the GST collected', () => {
  test('billFigures.gst', () => {
    const bill = {
      total: 105, refundOfBillId: undefined,
      items: [{ taxable: 100, cgst: 0, sgst: 0, igst: 5, qty: 1, cost: 40, discountAmount: 0, variantId: 'v' }],
    } as unknown as Bill
    expect(billFigures(bill, () => 0).gst).toBe(5)
  })
})
