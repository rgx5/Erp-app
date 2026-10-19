/**
 * Generates `src/domain/__tests__/fixtures/krishna-golden.json.gz` by running the *reference* implementation from the
 * Krishna Collection billing app over thousands of randomised carts, returns and edge cases. The ERP's own domain tests
 * replay the same inputs and require byte-identical results, so the phone and the counter can never disagree by a paisa.
 *
 *   KRISHNA_SRC=../krishna-collection-billing/src npx --yes tsx scripts/gen-golden.ts
 *
 * Deterministic (seeded PRNG): re-running produces the same file unless the reference logic changed.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const SRC = resolve(process.env.KRISHNA_SRC ?? '../krishna-collection-billing/src')
const load = (p: string) => import(pathToFileURL(resolve(SRC, p)).href)

// mulberry32 — tiny seeded PRNG
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function main() {
  const [cartM, retM, gstM, moneyM, qtyM, pricingM, figM] = await Promise.all([
    load('lib/cart.ts'), load('lib/returns.ts'), load('lib/gst.ts'), load('lib/money.ts'),
    load('lib/qty.ts'), load('lib/pricing.ts'), load('lib/billFigures.ts'),
  ])
  const { priceCart } = cartM
  const { planReturn } = retM
  const { computeLineTax, hsnSummary, rateFor } = gstM
  const { amountInWords, roundOff, round2 } = moneyM
  const { fmtQty, quickQuantities, parseQty, qtyStep, minQtyOf, isFrac, unitSuffix, unitPer, rulesOfBillItem } = qtyM
  const { weightedAvg, costFor, needsPricing } = pricingM
  const { billFigures } = figM

  const r = rng(20261019)
  const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))

  const slabSets = [
    [{ upto: 2500, rate: 5 }, { upto: Number.MAX_SAFE_INTEGER, rate: 18 }],
    [{ upto: 1000, rate: 5 }, { upto: Number.MAX_SAFE_INTEGER, rate: 12 }],
    [{ upto: Number.MAX_SAFE_INTEGER, rate: 0 }],
    [{ upto: 500, rate: 5 }, { upto: 1500, rate: 12 }, { upto: Number.MAX_SAFE_INTEGER, rate: 18 }],
  ]

  const carts: unknown[] = []
  for (let n = 0; n < 1500; n++) {
    const lineCount = int(1, 6)
    const lines = Array.from({ length: lineCount }, (_, i) => {
      const frac = r() < 0.2
      const price = pick([int(5, 400), int(401, 3000), int(3001, 9000) + (r() < 0.3 ? 0.5 : 0), int(10, 999) + 0.25 * int(0, 3)])
      return {
        variantId: `v${i}`, sku: `SKU-${i}`, barcode: `21000000000${i}`, name: `Item ${i}`, size: pick(['', 'M', 'L']), color: pick(['', 'Navy']),
        hsn: pick(['', '6205', '5208', '3004']), mrp: price + int(0, 300), price,
        qty: frac ? 0.5 * int(1, 12) : int(1, 6), stock: 99,
        discountType: pick(['pct', 'amt']) as 'pct' | 'amt',
        discountValue: pick([0, 0, 0, int(1, 30), int(1, 500)]),
        noDiscount: r() < 0.1 ? true : undefined,
        fixedRate: pick([undefined, undefined, 0, 5, 12, 18, 28]),
        unit: frac ? 'm' : undefined,
        cost: r() < 0.7 ? int(1, price) : undefined,
        priceOverridden: r() < 0.1 ? true : undefined,
      }
    })
    const input = {
      lines,
      billDiscountType: pick(['pct', 'amt']) as 'pct' | 'amt',
      billDiscountValue: pick([0, 0, 0, int(1, 40), int(1, 2000), 100, 99.9]),
      slabs: pick(slabSets),
      inclusive: r() < 0.8,
    }
    const out = priceCart(input.lines, input.billDiscountType, input.billDiscountValue, input.slabs, input.inclusive)
    carts.push({ input, out })
  }

  // Returns: price a cart, make it a Bill, then issue a random sequence of partial returns ending (sometimes) in a full one.
  const returnScenarios: unknown[] = []
  for (let n = 0; n < 600; n++) {
    const lines = Array.from({ length: int(1, 4) }, (_, i) => {
      const frac = r() < 0.25
      const price = pick([int(20, 400), int(401, 3000), int(3001, 7000)])
      return {
        variantId: `v${i}`, sku: `S${i}`, barcode: `b${i}`, name: `Item ${i}`, size: '', color: '', hsn: '6205',
        mrp: price, price, qty: frac ? 0.5 * int(2, 14) : int(1, 7), stock: 50,
        discountType: 'pct' as const, discountValue: pick([0, 0, 10, 12.5]), unit: frac ? 'm' : undefined,
      }
    })
    const slabs = pick(slabSets)
    const billDiscountValue = pick([0, 0, int(1, 30)])
    const inclusive = r() < 0.85
    const t = priceCart(lines, 'pct', billDiscountValue, slabs, inclusive)
    const earned = Math.floor(t.total / 100)
    const original = {
      id: 'orig', no: 'INV-1', date: 1, customerId: null, items: t.items, grossMrp: t.grossMrp, itemDiscount: t.itemDiscount,
      billDiscountType: 'pct', billDiscountValue, billDiscount: t.billDiscount, coupon: '', subtotal: t.subtotal,
      taxableTotal: t.taxableTotal, cgstTotal: t.cgstTotal, sgstTotal: t.sgstTotal, taxTotal: t.taxTotal, roundOff: t.roundOff,
      total: t.total, payments: [{ mode: 'cash', amount: t.total }], paid: t.total, changeDue: 0, loyaltyEarned: earned,
      loyaltyRedeemed: 0, creditUsed: 0, cashierId: 'u1', status: 'paid', notes: '',
    }
    const steps: unknown[] = []
    const prior: any[] = []
    const returned = new Map<string, number>()
    for (let step = 0; step < int(1, 4); step++) {
      const wants = original.items.map((it: any) => {
        const left = Math.round((it.qty - (returned.get(it.variantId) ?? 0)) * 1000) / 1000
        const frac = !Number.isInteger(it.qty)
        const want = r() < 0.4 ? left : frac ? Math.round(r() * left * 2) / 2 : int(0, Math.ceil(left))
        return { variantId: it.variantId, qty: want }
      })
      // The bill's own returnedQty progresses exactly as processReturn() does.
      const cur = { ...original, items: original.items.map((it: any) => ({ ...it, returnedQty: returned.get(it.variantId) ?? 0 })) }
      const plan = planReturn(cur as any, prior, wants)
      steps.push({ prior: JSON.parse(JSON.stringify(prior)), returnedBefore: Object.fromEntries(returned), wants, plan })
      if (!plan) continue
      for (const it of plan.items) returned.set(it.variantId, Math.round(((returned.get(it.variantId) ?? 0) + it.qty) * 1000) / 1000)
      prior.push({
        ...original, id: `cn${prior.length}`, no: `CN-${prior.length + 1}`, items: plan.items, subtotal: plan.subtotal,
        total: -plan.total, loyaltyEarned: -plan.loyaltyReverse, refundOfBillId: 'orig', status: 'returned',
      })
      if (plan.complete) break
    }
    returnScenarios.push({ original, steps })
  }

  // Direct function vectors.
  const lineTax: unknown[] = []
  for (let n = 0; n < 800; n++) {
    const net = pick([int(1, 500), int(501, 5000), int(5001, 90000)]) + pick([0, 0.25, 0.5, 0.75, 0.99])
    const qty = pick([1, 1, 2, 3, 0.5, 2.5, 0])
    const slabs = pick(slabSets)
    const inclusive = r() < 0.5
    const fixed = pick([undefined, undefined, 0, 5, 18])
    lineTax.push({ net, qty, slabs, inclusive, fixed, out: computeLineTax(net, qty, slabs, inclusive, fixed) })
  }
  const rates: unknown[] = []
  for (let n = 0; n < 300; n++) { const p = int(0, 6000) + pick([0, 0.5]); const s = pick(slabSets); rates.push({ p, s, out: rateFor(p, s) }) }

  const words: unknown[] = []
  for (const a of [0, 0.01, 1, 7, 10, 11, 19, 20, 99, 100, 101, 119, 120, 999, 1000, 1001, 12345, 99999, 100000, 100001, 123456.78, 9999999, 10000000, 12345678.9, 5.5, 0.5, 1e9 + 0.5]) {
    words.push({ a, out: amountInWords(a) })
  }
  const roundOffs: unknown[] = []
  for (let n = 0; n < 400; n++) { const a = int(0, 100000) / 100 + 0.004 * int(0, 3); roundOffs.push({ a, out: roundOff(a), r2: round2(a) }) }

  const weighted: unknown[] = []
  for (let n = 0; n < 300; n++) {
    const onHand = pick([-3, 0, 1, 5, 40, 120.5]); const oldAvg = pick([0, 50, 99.99, 250]); const qty = int(1, 50); const cost = pick([0, 40, 100, 333.33])
    weighted.push({ onHand, oldAvg, qty, cost, out: weightedAvg(onHand, oldAvg, qty, cost) })
  }

  const qtyVectors: unknown[] = []
  const unitRules = [{}, { unit: 'pc' }, { unit: 'm' }, { unit: 'kg' }, { unit: 'pair' }, { unit: 'set' }, { unit: 'dozen' }, { unit: 'pack' }, { unit: 'roll' },
    { unit: 'm', step: 0.25 }, { unit: 'pc', fractional: true }, { unit: 'kg', minQty: 0.25 }, { unit: 'custom' }]
  for (const rules of unitRules) {
    qtyVectors.push({
      rules, isFrac: isFrac(rules), step: qtyStep(rules), min: minQtyOf(rules), suffix: unitSuffix(rules), per: unitPer(rules),
      quick: quickQuantities(rules), parsed: ['2', '2.5', '0.75', 'abc', '3.999', '', '10x'].map((s) => ({ s, out: parseQty(s, rules) })),
      fmt: [0, 1, 2.5, 0.1 + 0.2, 3.0004, 1234.5678].map((n) => ({ n, out: fmtQty(n) })),
    })
  }

  const hsn: unknown[] = []
  for (let n = 0; n < 100; n++) {
    const lines = Array.from({ length: int(1, 8) }, () => ({ hsn: pick(['', '6205', '5208', '3004']), taxRate: pick([0, 5, 12, 18]), qty: int(1, 9), taxable: int(10, 5000) + 0.37, cgst: int(1, 400) + 0.13, sgst: int(1, 400) + 0.11 }))
    hsn.push({ lines, out: hsnSummary(lines) })
  }

  const figures: unknown[] = []
  for (const c of (carts as any[]).slice(0, 300)) {
    const t = c.out
    const sale = { total: t.total, items: t.items, refundOfBillId: undefined }
    const credit = { total: -t.total, items: t.items, refundOfBillId: 'x' }
    const zeroCredit = { total: 0, items: [], refundOfBillId: 'x' }
    const cost = (vid: string) => (vid.length * 7) % 90
    figures.push({ bill: sale, out: billFigures(sale as any, cost) }, { bill: credit, out: billFigures(credit as any, cost) }, { bill: zeroCredit, out: billFigures(zeroCredit as any, cost) })
  }

  const misc = {
    costFor: [
      { v: { cost: 100, avgCost: 90 }, basis: undefined, out: costFor({ cost: 100, avgCost: 90 }, undefined) },
      { v: { cost: 100, avgCost: 90 }, basis: 'latest', out: costFor({ cost: 100, avgCost: 90 }, 'latest') },
      { v: { cost: 100 }, basis: 'average', out: costFor({ cost: 100 }, 'average') },
    ],
    needsPricing: [0, -1, 0.01, 5].map((p) => ({ p, out: needsPricing({ price: p }) })),
    rulesOfBillItem: [{ unit: 'm', qty: 2.5 }, { unit: 'pc', qty: 3 }, { qty: 1.5 }].map((x) => ({ x, out: rulesOfBillItem(x) })),
  }

  const dir = resolve(process.cwd(), 'src/domain/__tests__/fixtures')
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, 'krishna-golden.json.gz')
  // Infinity is not JSON; the only Infinity-like value in play is MAX_SAFE_INTEGER, which is.
  writeFileSync(file, gzipSync(JSON.stringify({ generatedFrom: 'krishna-collection-billing src/lib', seed: 20261019, carts, returnScenarios, lineTax, rates, words, roundOffs, weighted, qtyVectors, hsn, figures, misc })))
  console.log(`wrote ${file}: ${carts.length} carts, ${returnScenarios.length} return scenarios, ${lineTax.length} tax lines`)
}

void main()
