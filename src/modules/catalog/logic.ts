/**
 * Catalog rules — all pure. Sales history comes from bills (a credit note subtracts), stock history from the stock ledger.
 *   forecast     moving average of recent sales, adjusted for weekday and month-of-year patterns
 *   min / max    reorder level and order-up-to level that follow from the forecast
 *   reorder plan what to order, from whom, grouped by supplier — skipping what is already on an open purchase order
 *   reports      valuation, stock ageing, dead stock, ABC analysis
 */
import { DAY, startOfDay } from '@/domain/dates'
import { variantLabel } from '@/domain/codes'
import { round2 } from '@/domain/money'
import { costFor } from '@/domain/pricing'
import { round3 } from '@/domain/qty'
import type { Bill, Product, Variant } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import type { PurchaseOrder } from '@/modules/purchasing/types'
import { DEFAULT_CATALOG_SETTINGS, type CatalogSettings, type ReorderRule } from './types'

// ───────────────────────────── settings & small helpers ─────────────────────────────

export const catalogSettings = (s: Pick<DataState, 'catalogSettings'>): CatalogSettings => ({ ...DEFAULT_CATALOG_SETTINGS, ...(s.catalogSettings?.catalog ?? {}) })

const tracked = (p: Product | undefined) => !!p && p.trackStock !== false && p.active !== false

/** A variant's name for a list: "Oxford Shirt · M / Navy". */
export const variantName = (state: Pick<DataState, 'products' | 'variants'>, v: Variant) => {
  const p = state.products[v.productId]
  const o = variantLabel(v.size, v.color)
  return `${p?.name ?? 'Item'}${o ? ` · ${o}` : ''}`
}

/** Rounds a quantity up: whole pieces, or a tenth for goods sold by measure. */
const ceilQty = (n: number, fractional: boolean) => (fractional ? Math.ceil(n * 10 - 1e-9) / 10 : Math.ceil(n - 1e-9))

// ───────────────────────────── sales history ─────────────────────────────

export interface SalesAgg { qty: number; revenue: number; cost: number; first: number; last: number }

/** Net units, sales value (before GST) and cost per variant between two moments; returns count against. `last` is the latest real sale. */
export function salesByVariant(bills: Bill[], from = 0, to = Infinity, costOf: (variantId: string) => number = () => 0): Map<string, SalesAgg> {
  const out = new Map<string, SalesAgg>()
  for (const b of bills) {
    if (b.status === 'held' || b.date < from || b.date > to) continue
    const sign = b.total < 0 || b.refundOfBillId ? -1 : 1
    for (const i of b.items) {
      const a = out.get(i.variantId) ?? { qty: 0, revenue: 0, cost: 0, first: Infinity, last: 0 }
      a.qty = round3(a.qty + i.qty * sign)
      a.revenue += i.taxable * sign
      a.cost += (i.cost ?? costOf(i.variantId)) * i.qty * sign
      if (sign === 1) { a.first = Math.min(a.first, b.date); a.last = Math.max(a.last, b.date) }
      out.set(i.variantId, a)
    }
  }
  return out
}

/** Net units per variant per day (day start → units). */
function dailyUnits(bills: Bill[], from: number): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>()
  for (const b of bills) {
    if (b.status === 'held' || b.date < from) continue
    const sign = b.total < 0 || b.refundOfBillId ? -1 : 1
    const day = startOfDay(b.date)
    for (const i of b.items) {
      let m = out.get(i.variantId)
      if (!m) { m = new Map(); out.set(i.variantId, m) }
      m.set(day, (m.get(day) ?? 0) + i.qty * sign)
    }
  }
  return out
}

// ───────────────────────────── seasonality ─────────────────────────────

export interface Seasonality {
  /** Sunday = 0. 1 = an average day; 1.4 = a day that sells 40% more. */
  weekday: number[]
  /** January = 0. Null until there is more than a year of history. */
  month: number[] | null
}

const FLAT: Seasonality = { weekday: [1, 1, 1, 1, 1, 1, 1], month: null }
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** The shop's weekly rhythm (from the last 12 weeks) and yearly rhythm (once a year of bills exists), over all items together. */
export function seasonality(bills: Bill[], now: number): Seasonality {
  const today = startOfDay(now)
  let first = Infinity
  const perDay = new Map<number, number>()
  for (const b of bills) {
    if (b.status === 'held') continue
    const sign = b.total < 0 || b.refundOfBillId ? -1 : 1
    const day = startOfDay(b.date)
    if (day >= today) continue
    first = Math.min(first, day)
    perDay.set(day, (perDay.get(day) ?? 0) + b.items.reduce((s, i) => s + i.qty, 0) * sign)
  }
  if (!Number.isFinite(first)) return FLAT

  // Weekday: whole weeks only, so every weekday is seen equally often.
  const weeks = Math.min(12, Math.floor((today - first) / DAY / 7))
  let weekday = FLAT.weekday
  if (weeks >= 4) {
    const sums = [0, 0, 0, 0, 0, 0, 0]
    for (let d = today - weeks * 7 * DAY; d < today; d += DAY) sums[new Date(d).getDay()] += perDay.get(d) ?? 0
    const mean = sums.reduce((a, b) => a + b, 0) / 7
    if (mean > 0 && sums.reduce((a, b) => a + b, 0) >= 30) weekday = sums.map((x) => round2(clamp(x / mean, 0.3, 3)))
  }

  // Month of the year: needs a year and a bit; compares each calendar month's average with the average month.
  let month: number[] | null = null
  if (today - first >= 395 * DAY) {
    const cur = new Date(today)
    const monthTotals = new Map<string, number>()
    for (const [d, q] of perDay) {
      const dt = new Date(d)
      if (dt.getFullYear() === cur.getFullYear() && dt.getMonth() === cur.getMonth()) continue // a month that is not over
      const key = `${dt.getFullYear()}-${dt.getMonth()}`
      monthTotals.set(key, (monthTotals.get(key) ?? 0) + q)
    }
    const byMonth: number[][] = Array.from({ length: 12 }, () => [])
    for (const [k, q] of monthTotals) byMonth[Number(k.split('-')[1])].push(q)
    const avgs = byMonth.map((l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null))
    const seen = avgs.filter((x): x is number => x !== null)
    const mean = seen.length ? seen.reduce((a, b) => a + b, 0) / seen.length : 0
    if (seen.length >= 6 && mean > 0) month = avgs.map((a) => (a === null ? 1 : round2(clamp(a / mean, 0.4, 2.5))))
  }
  return { weekday, month }
}

const factorAt = (s: Seasonality, day: number) => {
  const d = new Date(day)
  return s.weekday[d.getDay()] * (s.month ? s.month[d.getMonth()] : 1)
}

// ───────────────────────────── forecast ─────────────────────────────

export interface Forecast {
  variantId: string
  /** Units sold per day over the history looked at. */
  perDay: number
  /** Units expected over the horizon, weekday and month patterns included. */
  expected: number
  /** Expected units per day over the horizon. */
  expectedPerDay: number
  /** Units sold in the history looked at. */
  sold: number
  /** Days of history the average is over. */
  days: number
  /** How the second half of the history compares with the first, in %. Null when there is not enough to say. */
  trendPct: number | null
  /** Days the stock lasts at the expected pace. Null when nothing is expected to sell. */
  daysOfCover: number | null
  confidence: 'low' | 'ok' | 'good'
}

export interface ForecastOpts { windowDays?: number; horizonDays?: number }

/** Forecast for every stocked variant: a moving average of recent daily sales, lifted or lowered by the weekday and month patterns. */
export function forecastAll(state: DataState, now: number, opts: ForecastOpts = {}): Map<string, Forecast> {
  const s = catalogSettings(state)
  const W = Math.max(14, opts.windowDays ?? s.windowDays)
  const H = Math.max(1, opts.horizonDays ?? s.leadDays + s.safetyDays + s.coverDays)
  const today = startOfDay(now)
  const bills = listOf(state.bills)
  const seas = seasonality(bills, now)
  const daily = dailyUnits(bills, today - 400 * DAY)
  const out = new Map<string, Forecast>()

  for (const v of listOf(state.variants)) {
    const p = state.products[v.productId]
    if (!tracked(p)) continue
    const days = daily.get(v.id)
    let firstSale = Infinity
    if (days) for (const d of days.keys()) firstSale = Math.min(firstSale, d)
    const begin = startOfDay(Math.min(p!.createdAt, Number.isFinite(firstSale) ? firstSale : p!.createdAt))
    // An item that is only a few days old is averaged over the days it has existed, not diluted over the whole window.
    const eff = clamp(Math.round((today - begin) / DAY), 7, W)
    let sold = 0, early = 0, late = 0
    let factorSum = 0
    for (let i = 1; i <= eff; i++) {
      const d = today - i * DAY
      const q = days?.get(d) ?? 0
      sold += q
      if (i > eff / 2) early += q; else late += q
      factorSum += factorAt(seas, d)
    }
    sold = Math.max(0, round3(sold))
    const perDay = sold / eff
    const base = perDay / (factorSum / eff || 1)
    let expected = 0
    for (let i = 0; i < H; i++) expected += base * factorAt(seas, today + i * DAY)
    expected = round2(Math.max(0, expected))
    const half = Math.floor(eff / 2)
    const trendPct = eff >= 28 && early > 0 ? Math.round(((late / half - early / (eff - half)) / (early / (eff - half))) * 100) : null
    const pace = expected / H
    out.set(v.id, {
      variantId: v.id, perDay: round2(perDay), expected, expectedPerDay: round2(pace), sold, days: eff, trendPct,
      daysOfCover: pace > 0 && v.stock > 0 ? Math.round(v.stock / pace) : null,
      confidence: eff < 14 || sold < 5 ? 'low' : eff >= 42 && sold >= 20 ? 'good' : 'ok',
    })
  }
  return out
}

// ───────────────────────────── min / max ─────────────────────────────

export interface MinMax { min: number; max: number }

/** Reorder level = what sells while an order is on its way (plus a safety margin); order-up-to level = that plus the cover wanted. */
export function minMaxFor(f: Pick<Forecast, 'expectedPerDay'>, s: Pick<CatalogSettings, 'leadDays' | 'safetyDays' | 'coverDays'>, fractional = false): MinMax {
  const min = ceilQty(f.expectedPerDay * (s.leadDays + s.safetyDays), fractional)
  const max = Math.max(min + (fractional ? 0.1 : 1), ceilQty(f.expectedPerDay * (s.leadDays + s.safetyDays + s.coverDays), fractional))
  return { min, max: round3(max) }
}

export interface MinMaxRow {
  variantId: string
  name: string
  sku: string
  stock: number
  currentMin: number
  currentMax?: number
  min: number
  max: number
  perDay: number
  confidence: Forecast['confidence']
  /** The suggested reorder level is above / below / the same as today's. */
  move: 'raise' | 'lower' | 'same'
}

/** Min–max suggestions for items that have sold. Items the forecast knows too little about (a few days old, a unit or two sold) are left out. */
export function minMaxSuggestions(state: DataState, now: number): MinMaxRow[] {
  const s = catalogSettings(state)
  const fc = forecastAll(state, now, { windowDays: s.windowDays, horizonDays: s.leadDays + s.safetyDays + s.coverDays })
  const rows: MinMaxRow[] = []
  for (const v of listOf(state.variants)) {
    const f = fc.get(v.id)
    if (!f || f.sold <= 0 || f.confidence === 'low') continue
    const p = state.products[v.productId]
    const mm = minMaxFor(f, s, !!p?.fractional)
    const rule = state.reorderRules?.[v.id]
    const currentMin = rule?.min ?? v.reorderLevel
    rows.push({
      variantId: v.id, name: variantName(state, v), sku: v.sku, stock: v.stock, currentMin, currentMax: rule?.max, ...mm, perDay: f.perDay, confidence: f.confidence,
      move: mm.min > currentMin ? 'raise' : mm.min < currentMin ? 'lower' : 'same',
    })
  }
  return rows.sort((a, b) => Math.abs(b.min - b.currentMin) - Math.abs(a.min - a.currentMin) || a.name.localeCompare(b.name))
}

// ───────────────────────────── auto-reorder ─────────────────────────────

/** Units still to arrive per variant on purchase orders that are not finished (drafts count: they are already asked for). */
export function onOrderQty(state: Pick<DataState, 'purchaseOrders'>): Map<string, number> {
  const out = new Map<string, number>()
  for (const o of listOf(state.purchaseOrders ?? {}) as PurchaseOrder[]) {
    if (o.status === 'cancelled' || o.status === 'received') continue
    for (const l of o.items) out.set(l.variantId, round3((out.get(l.variantId) ?? 0) + Math.max(0, l.qty - l.receivedQty)))
  }
  return out
}

/** Who last sold us each variant, and at what cost. */
export function lastPurchases(state: Pick<DataState, 'purchases'>): Map<string, { supplierId: string; cost: number; date: number }> {
  const out = new Map<string, { supplierId: string; cost: number; date: number }>()
  for (const p of listOf(state.purchases)) {
    for (const i of p.items) {
      const cur = out.get(i.variantId)
      if (!cur || p.date > cur.date) out.set(i.variantId, { supplierId: p.supplierId, cost: i.cost, date: p.date })
    }
  }
  return out
}

export type ReorderReason = 'below-min' | 'runs-out'

export interface ReorderLine {
  variantId: string
  productId: string
  name: string
  sku: string
  unit: string
  fractional: boolean
  stock: number
  onOrder: number
  min: number
  /** The level the order brings stock up to. */
  target: number
  qty: number
  cost: number
  supplierId: string
  perDay: number
  reason: ReorderReason
}

export interface ReorderGroup { supplierId: string; supplierName: string; lines: ReorderLine[]; total: number }
export interface ReorderPlan { groups: ReorderGroup[]; unassigned: ReorderLine[]; lines: number }

const roundUpTo = (qty: number, step: number | undefined) => (step && step > 1 ? Math.ceil(qty / step - 1e-9) * step : qty)

/**
 * What to order now. A variant is ordered when stock plus what is already coming has fallen to its reorder level, or when the
 * forecast says it will run out before an order placed today could arrive. The order brings it up to its max level (the rule's, or the
 * forecast's, or twice the reorder level), in multiples of the rule's pack size.
 */
export function reorderPlan(state: DataState, now: number): ReorderPlan {
  const s = catalogSettings(state)
  const fc = forecastAll(state, now)
  const coming = onOrderQty(state)
  const last = lastPurchases(state)
  const lines: ReorderLine[] = []

  for (const v of listOf(state.variants)) {
    const p = state.products[v.productId]
    if (!tracked(p)) continue
    const rule: ReorderRule | undefined = state.reorderRules?.[v.id]
    const f = fc.get(v.id)
    const frac = !!p!.fractional
    const min = rule?.min ?? v.reorderLevel
    const pace = f?.expectedPerDay ?? 0
    const onOrder = coming.get(v.id) ?? 0
    const position = round3(v.stock + onOrder)
    const below = position <= min && (min > 0 || pace > 0)
    const runsOut = f !== undefined && f.confidence !== 'low' && pace > 0 && position < pace * s.leadDays
    if (!below && !runsOut) continue
    const forecastMax = f && f.sold > 0 && f.confidence !== 'low' ? minMaxFor(f, s, frac).max : 0
    const target = rule?.max ?? (forecastMax > 0 ? Math.max(forecastMax, min + 1) : Math.max(min * 2, 1))
    const need = round3(target - position)
    if (need <= 0) continue
    const qty = round3(roundUpTo(frac ? ceilQty(need, true) : Math.ceil(need - 1e-9), rule?.moq))
    const lp = last.get(v.id)
    const supplierId = [rule?.supplierId, lp?.supplierId, s.defaultSupplierId].find((x) => x && state.suppliers[x]) ?? ''
    lines.push({
      variantId: v.id, productId: v.productId, name: variantName(state, v), sku: v.sku, unit: p!.unit ?? 'pc', fractional: frac,
      stock: v.stock, onOrder, min, target, qty, cost: lp && (!rule?.supplierId || rule.supplierId === lp.supplierId) ? lp.cost : v.cost, supplierId, perDay: pace,
      reason: below ? 'below-min' : 'runs-out',
    })
  }

  const by = new Map<string, ReorderLine[]>()
  const unassigned: ReorderLine[] = []
  for (const l of lines) {
    if (!l.supplierId) { unassigned.push(l); continue }
    const list = by.get(l.supplierId)
    if (list) list.push(l); else by.set(l.supplierId, [l])
  }
  const groups = [...by.entries()].map(([supplierId, ls]) => ({
    supplierId, supplierName: state.suppliers[supplierId]?.name ?? 'Supplier', lines: ls.sort((a, b) => a.name.localeCompare(b.name)),
    total: round2(ls.reduce((t, l) => t + l.qty * l.cost, 0)),
  })).sort((a, b) => a.supplierName.localeCompare(b.supplierName))
  return { groups, unassigned: unassigned.sort((a, b) => a.name.localeCompare(b.name)), lines: lines.length }
}

/** How many variants are at or below their reorder level with nothing on order — cheap enough for the Home notice. */
export function lowCount(state: DataState): number {
  const variants = listOf(state.variants)
  if (!variants.length) return 0
  const coming = onOrderQty(state)
  let n = 0
  for (const v of variants) {
    if (!tracked(state.products[v.productId])) continue
    const min = state.reorderRules?.[v.id]?.min ?? v.reorderLevel
    if (min > 0 && v.stock + (coming.get(v.id) ?? 0) <= min) n++
  }
  return n
}

// ───────────────────────────── stock reports ─────────────────────────────

const unitCost = (state: DataState, v: Variant) => costFor(v, state.store?.costBasis)

export type ValuationGroup = 'item' | 'category' | 'brand'

export interface ValuationRow { key: string; label: string; variants: number; qty: number; cost: number; retail: number; margin: number; marginPct: number }
export interface Valuation { rows: ValuationRow[]; qty: number; cost: number; retail: number; margin: number }

/** What the stock on hand is worth: at cost (the business's costing basis) and at selling price, grouped by item, category or brand. */
export function valuation(state: DataState, by: ValuationGroup = 'item'): Valuation {
  const groups = new Map<string, ValuationRow>()
  for (const v of listOf(state.variants)) {
    const p = state.products[v.productId]
    if (!p || p.trackStock === false || v.stock <= 0) continue
    const [key, label] = by === 'category' ? [p.categoryId || '-', state.categories[p.categoryId]?.name ?? 'Uncategorised']
      : by === 'brand' ? [p.brand.toLowerCase() || '-', p.brand || 'No brand'] : [p.id, `${p.name}${p.styleCode ? ` (${p.styleCode})` : ''}`]
    const g = groups.get(key) ?? { key, label, variants: 0, qty: 0, cost: 0, retail: 0, margin: 0, marginPct: 0 }
    g.variants++
    g.qty = round3(g.qty + v.stock)
    g.cost += v.stock * unitCost(state, v)
    g.retail += v.stock * v.price
    groups.set(key, g)
  }
  const rows = [...groups.values()].map((g) => {
    const cost = round2(g.cost), retail = round2(g.retail)
    return { ...g, cost, retail, margin: round2(retail - cost), marginPct: retail > 0 ? round2(((retail - cost) / retail) * 100) : 0 }
  }).sort((a, b) => b.cost - a.cost || a.label.localeCompare(b.label))
  const cost = round2(rows.reduce((s, r) => s + r.cost, 0)), retail = round2(rows.reduce((s, r) => s + r.retail, 0))
  return { rows, qty: round3(rows.reduce((s, r) => s + r.qty, 0)), cost, retail, margin: round2(retail - cost) }
}

export const AGE_BUCKETS = [
  { key: 'd30', label: 'Up to 30 days', max: 30 },
  { key: 'd60', label: '31–60 days', max: 60 },
  { key: 'd90', label: '61–90 days', max: 90 },
  { key: 'd180', label: '91–180 days', max: 180 },
  { key: 'older', label: 'Over 180 days', max: Infinity },
] as const
export type AgeKey = (typeof AGE_BUCKETS)[number]['key']
const bucketOf = (days: number): AgeKey => AGE_BUCKETS.find((b) => days <= b.max)!.key

export interface AgeRow {
  variantId: string
  name: string
  sku: string
  stock: number
  unitCost: number
  qty: Record<AgeKey, number>
  value: Record<AgeKey, number>
  totalValue: number
  /** Age of the oldest unit still here, in days. */
  oldest: number
}
export interface Ageing { rows: AgeRow[]; qty: Record<AgeKey, number>; value: Record<AgeKey, number>; total: number }

const zero = (): Record<AgeKey, number> => ({ d30: 0, d60: 0, d90: 0, d180: 0, older: 0 })

/**
 * How long the stock on hand has been here. The units on the shelf are taken to be the most recent ones that came in (first in, first
 * out), so a shelf that has been topped up often is mostly young; units with no arrival on record count from the day the item was created.
 */
export function stockAgeing(state: DataState, now: number): Ageing {
  const today = startOfDay(now)
  const inbound = new Map<string, Array<{ at: number; qty: number }>>()
  for (const m of listOf(state.moves)) {
    if (m.qty <= 0) continue
    const l = inbound.get(m.variantId)
    if (l) l.push({ at: m.at, qty: m.qty }); else inbound.set(m.variantId, [{ at: m.at, qty: m.qty }])
  }
  const rows: AgeRow[] = []
  const totals = { qty: zero(), value: zero() }
  for (const v of listOf(state.variants)) {
    const p = state.products[v.productId]
    if (!p || p.trackStock === false || v.stock <= 0) continue
    const cost = unitCost(state, v)
    const qty = zero(), value = zero()
    let left = v.stock
    let oldest = 0
    const age = (at: number) => Math.max(0, Math.round((today - startOfDay(at)) / DAY))
    for (const m of (inbound.get(v.id) ?? []).sort((a, b) => b.at - a.at)) {
      if (left <= 0) break
      const take = Math.min(left, m.qty)
      const days = age(m.at)
      qty[bucketOf(days)] = round3(qty[bucketOf(days)] + take)
      oldest = Math.max(oldest, days)
      left = round3(left - take)
    }
    if (left > 0) {
      const days = age(p.createdAt)
      qty[bucketOf(days)] = round3(qty[bucketOf(days)] + left)
      oldest = Math.max(oldest, days)
    }
    for (const b of AGE_BUCKETS) {
      value[b.key] = round2(qty[b.key] * cost)
      totals.qty[b.key] = round3(totals.qty[b.key] + qty[b.key])
      totals.value[b.key] = round2(totals.value[b.key] + value[b.key])
    }
    rows.push({ variantId: v.id, name: variantName(state, v), sku: v.sku, stock: v.stock, unitCost: cost, qty, value, totalValue: round2(v.stock * cost), oldest })
  }
  rows.sort((a, b) => b.oldest - a.oldest || b.totalValue - a.totalValue)
  return { rows, qty: totals.qty, value: totals.value, total: round2(rows.reduce((s, r) => s + r.totalValue, 0)) }
}

export interface DeadRow { variantId: string; name: string; sku: string; stock: number; unitCost: number; value: number; lastSold: number | null; idleDays: number }
export interface DeadStock { rows: DeadRow[]; value: number; qty: number }

/** Stock that has not sold for `days` days (or has never sold and has been here that long): money sitting on a shelf. */
export function deadStock(state: DataState, now: number, days: number): DeadStock {
  const cutoff = now - days * DAY
  const sold = salesByVariant(listOf(state.bills))
  const arrival = new Map<string, number>()
  for (const m of listOf(state.moves)) if (m.qty > 0) arrival.set(m.variantId, Math.min(arrival.get(m.variantId) ?? Infinity, m.at))
  const rows: DeadRow[] = []
  for (const v of listOf(state.variants)) {
    const p = state.products[v.productId]
    if (!tracked(p) || v.stock <= 0) continue
    const lastSold = sold.get(v.id)?.last || null
    const since = lastSold ?? Math.min(arrival.get(v.id) ?? p!.createdAt, p!.createdAt)
    if (since > cutoff) continue
    const cost = unitCost(state, v)
    rows.push({ variantId: v.id, name: variantName(state, v), sku: v.sku, stock: v.stock, unitCost: cost, value: round2(v.stock * cost), lastSold, idleDays: Math.floor((now - since) / DAY) })
  }
  rows.sort((a, b) => b.value - a.value || b.idleDays - a.idleDays)
  return { rows, value: round2(rows.reduce((s, r) => s + r.value, 0)), qty: round3(rows.reduce((s, r) => s + r.stock, 0)) }
}

export type AbcBasis = 'revenue' | 'profit' | 'qty'
export type AbcClass = 'A' | 'B' | 'C'

export interface AbcRow { variantId: string; name: string; sku: string; qty: number; revenue: number; profit: number; metric: number; share: number; cumulative: number; cls: AbcClass; stock: number }
export interface Abc {
  rows: AbcRow[]
  total: number
  classes: Record<AbcClass, { items: number; metric: number; share: number }>
  /** Stocked items that sold nothing in the period. */
  unsold: number
}

/**
 * ABC analysis: rank items by what they bring in (sales, profit or units) and split them where the running total passes 80% and 95%.
 * A is the few items that make most of the business; C is the long tail.
 */
export function abcAnalysis(state: DataState, from: number, to: number, basis: AbcBasis = 'revenue', cuts: { a: number; b: number } = { a: 80, b: 95 }): Abc {
  const sales = salesByVariant(listOf(state.bills), from, to, (id) => (state.variants[id] ? unitCost(state, state.variants[id]) : 0))
  const base: Omit<AbcRow, 'share' | 'cumulative' | 'cls'>[] = []
  for (const [id, a] of sales) {
    const v = state.variants[id]
    const profit = round2(a.revenue - a.cost)
    const metric = basis === 'qty' ? a.qty : basis === 'profit' ? profit : round2(a.revenue)
    if (!(metric > 0)) continue
    base.push({ variantId: id, name: v ? variantName(state, v) : 'Deleted item', sku: v?.sku ?? '', qty: a.qty, revenue: round2(a.revenue), profit, metric, stock: v?.stock ?? 0 })
  }
  base.sort((x, y) => y.metric - x.metric || x.name.localeCompare(y.name))
  const total = base.reduce((s, r) => s + r.metric, 0)
  let run = 0
  const classes: Abc['classes'] = { A: { items: 0, metric: 0, share: 0 }, B: { items: 0, metric: 0, share: 0 }, C: { items: 0, metric: 0, share: 0 } }
  const rows = base.map((r) => {
    const before = total > 0 ? (run / total) * 100 : 0
    run += r.metric
    const cls: AbcClass = before < cuts.a ? 'A' : before < cuts.b ? 'B' : 'C'
    classes[cls].items++
    classes[cls].metric = round2(classes[cls].metric + r.metric)
    return { ...r, share: total > 0 ? round2((r.metric / total) * 100) : 0, cumulative: total > 0 ? round2((run / total) * 100) : 0, cls }
  })
  for (const c of ['A', 'B', 'C'] as const) classes[c].share = total > 0 ? round2((classes[c].metric / total) * 100) : 0
  const soldIds = new Set(rows.map((r) => r.variantId))
  const unsold = listOf(state.variants).filter((v) => tracked(state.products[v.productId]) && v.stock > 0 && !soldIds.has(v.id)).length
  return { rows, total: round2(total), classes, unsold }
}
