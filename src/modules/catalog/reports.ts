import type { CsvCell } from '@/domain/csv'
import { fmtDate } from '@/domain/dates'
import type { DataState } from '@/data/state'
import {
  AGE_BUCKETS, abcAnalysis, deadStock, forecastAll, minMaxSuggestions, stockAgeing, valuation, variantName,
  type AbcBasis, type ReorderPlan, type ValuationGroup,
} from './logic'
import { listOf } from '@/data/state'

/** Rows for `toCsv`, one function per report; each mirrors its screen figure for figure. */

export function valuationCsv(state: DataState, by: ValuationGroup): CsvCell[][] {
  const v = valuation(state, by)
  const word = by === 'item' ? 'Item' : by === 'category' ? 'Category' : 'Brand'
  return [
    [word, 'Variants', 'Quantity', 'Value at cost (₹)', 'Value at selling price (₹)', 'Margin (₹)', 'Margin %'],
    ...v.rows.map((r) => [r.label, r.variants, r.qty, r.cost, r.retail, r.margin, r.marginPct] as CsvCell[]),
    ['Total', '', v.qty, v.cost, v.retail, v.margin, v.retail > 0 ? Math.round((v.margin / v.retail) * 10000) / 100 : 0],
  ]
}

export function ageingCsv(state: DataState, now: number): CsvCell[][] {
  const a = stockAgeing(state, now)
  return [
    ['Item', 'SKU', 'Stock', 'Unit cost (₹)', ...AGE_BUCKETS.map((b) => `${b.label} (₹)`), 'Total (₹)', 'Oldest (days)'],
    ...a.rows.map((r) => [r.name, r.sku, r.stock, r.unitCost, ...AGE_BUCKETS.map((b) => r.value[b.key]), r.totalValue, r.oldest] as CsvCell[]),
    ['Total', '', '', '', ...AGE_BUCKETS.map((b) => a.value[b.key]), a.total, ''],
  ]
}

export function deadStockCsv(state: DataState, now: number, days: number): CsvCell[][] {
  const d = deadStock(state, now, days)
  return [
    ['Item', 'SKU', 'Stock', 'Unit cost (₹)', 'Value (₹)', 'Last sold', 'Days without a sale'],
    ...d.rows.map((r) => [r.name, r.sku, r.stock, r.unitCost, r.value, r.lastSold ? fmtDate(r.lastSold) : 'Never', r.idleDays] as CsvCell[]),
    ['Total', '', d.qty, '', d.value, '', ''],
  ]
}

export function abcCsv(state: DataState, from: number, to: number, basis: AbcBasis): CsvCell[][] {
  const a = abcAnalysis(state, from, to, basis)
  return [
    ['Class', 'Item', 'SKU', 'Units sold', 'Sales before GST (₹)', 'Profit (₹)', 'Share %', 'Running share %', 'In stock'],
    ...a.rows.map((r) => [r.cls, r.name, r.sku, r.qty, r.revenue, r.profit, r.share, r.cumulative, r.stock] as CsvCell[]),
  ]
}

export function forecastCsv(state: DataState, now: number, horizonDays: number): CsvCell[][] {
  const fc = forecastAll(state, now, { horizonDays })
  const rows: CsvCell[][] = []
  for (const v of listOf(state.variants)) {
    const f = fc.get(v.id)
    if (!f || f.sold <= 0) continue
    rows.push([variantName(state, v), v.sku, v.stock, f.perDay, f.expected, f.daysOfCover ?? '', f.trendPct ?? '', f.confidence])
  }
  rows.sort((a, b) => Number(b[4]) - Number(a[4]))
  return [['Item', 'SKU', 'In stock', 'Sold per day', `Expected in ${horizonDays} days`, 'Days of stock left', 'Trend %', 'Confidence'], ...rows]
}

export function minMaxCsv(state: DataState, now: number): CsvCell[][] {
  return [
    ['Item', 'SKU', 'In stock', 'Sold per day', 'Reorder level now', 'Suggested reorder level', 'Suggested order-up-to', 'Confidence'],
    ...minMaxSuggestions(state, now).map((r) => [r.name, r.sku, r.stock, r.perDay, r.currentMin, r.min, r.max, r.confidence] as CsvCell[]),
  ]
}

export function reorderCsv(plan: ReorderPlan): CsvCell[][] {
  const line = (supplier: string, l: ReorderPlan['unassigned'][number]): CsvCell[] => [supplier, l.name, l.sku, l.stock, l.onOrder, l.min, l.qty, l.cost, Math.round(l.qty * l.cost * 100) / 100, l.reason === 'below-min' ? 'At or below reorder level' : 'Will run out before an order arrives']
  return [
    ['Supplier', 'Item', 'SKU', 'In stock', 'On order', 'Reorder level', 'Order quantity', 'Cost (₹)', 'Line total (₹)', 'Why'],
    ...plan.groups.flatMap((g) => g.lines.map((l) => line(g.supplierName, l))),
    ...plan.unassigned.map((l) => line('(no supplier)', l)),
  ]
}
