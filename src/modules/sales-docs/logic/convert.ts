import type { CartLine } from '@/domain/cart'
import { fmtQtyUnit } from '@/domain/qty'
import type { DataState } from '@/data/state'
import type { DocLine } from '../types'
import { toCartLine } from './lines'

/**
 * The cart a document becomes at the counter. Items that no longer exist or are archived are left out; items short of stock are kept
 * (the person decides) but flagged. Prices are the ones on the document — a quotation honours what was quoted.
 */
export function cartLinesFor(state: DataState, items: DocLine[]): { lines: CartLine[]; warnings: string[] } {
  const lines: CartLine[] = []
  const warnings: string[] = []
  for (const l of items) {
    const v = state.variants[l.variantId]
    const p = v ? state.products[v.productId] : undefined
    if (!v || p?.active === false) { warnings.push(`${l.name} is no longer sold and was left out.`); continue }
    if (p?.trackStock !== false && l.qty > v.stock) warnings.push(`Only ${fmtQtyUnit(Math.max(0, v.stock), l)} of ${l.name} in stock.`)
    lines.push(toCartLine(l, v.stock))
  }
  return { lines, warnings }
}
