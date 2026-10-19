import type { StoreSettings, Variant } from './types'

/** An item received without a selling price: it holds stock but can't be sold until someone prices it. */
export const needsPricing = (v: Pick<Variant, 'price'>) => !(v.price > 0)

/** Unpriced items older than this many days are flagged on the dashboard. */
export const UNPRICED_WARN_DAYS = 2
const DAY = 86_400_000

export const unpricedDays = (v: Pick<Variant, 'unpricedSince'>, now = Date.now()) =>
  v.unpricedSince ? Math.floor((now - v.unpricedSince) / DAY) : 0
export const isOverdue = (v: Pick<Variant, 'unpricedSince'>, now = Date.now()) =>
  !!v.unpricedSince && now - v.unpricedSince > UNPRICED_WARN_DAYS * DAY

/** Purchase cost of one unit under the store's chosen basis (default: weighted average over all receipts). */
export const costFor = (v: Pick<Variant, 'cost' | 'avgCost'>, basis?: StoreSettings['costBasis']) =>
  basis === 'latest' ? v.cost : (v.avgCost ?? v.cost)

/** New weighted-average cost after receiving `qty` at `cost` on top of `onHand` units that averaged `oldAvg`. */
export function weightedAvg(onHand: number, oldAvg: number, qty: number, cost: number): number {
  const have = Math.max(0, onHand)
  if (cost <= 0) return oldAvg
  if (oldAvg <= 0 || have <= 0) return Math.round(cost * 100) / 100
  const total = have + qty
  return total > 0 ? Math.round(((have * oldAvg + qty * cost) / total) * 100) / 100 : cost
}

/** Margin of a selling price over cost, as a percentage of the selling price (excl. nothing — a quick shop-floor figure). */
export const marginPct = (price: number, cost: number) => (price > 0 ? ((price - cost) / price) * 100 : 0)
