import { baseState, billInput, ctx, line, NOW } from '@/data/__tests__/helpers'
import { saveBill } from '@/data/ops'
import { applyChanges, type DataState } from '@/data/state'
import { DAY } from '@/domain/dates'
import '@/modules/purchasing/replication'
import '../replication'

export { baseState, ctx, NOW, DAY }

/** Sells `qty` of a variant on the day `daysAgo` days before NOW. */
export function sell(s: DataState, variantId: string, qty: number, daysAgo: number): DataState {
  const at = NOW - daysAgo * DAY
  const r = saveBill(s, billInput(s, [line(s.variants[variantId], qty)], { date: at }), ctx({ now: at }))
  return applyChanges(s, r.changes)
}

/** The sample business with some trading history on v1 (a steady seller) and none on v2. */
export function tradingState(): DataState {
  let s = baseState()
  s.products = { ...s.products, p1: { ...s.products.p1, createdAt: NOW - 120 * DAY } }
  s.variants = { ...s.variants, v1: { ...s.variants.v1, stock: 300 } }
  for (let d = 1; d <= 56; d++) s = sell(s, 'v1', 2, d)
  s.variants = { ...s.variants, v1: { ...s.variants.v1, stock: 100 } }
  return s
}
