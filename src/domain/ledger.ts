import type { MoveType, StockMove } from './types'

export type LedgerFilter = '' | 'sale' | 'purchase' | 'return' | 'adjust'

export const LEDGER_FILTERS: Array<{ value: LedgerFilter; label: string }> = [
  { value: '', label: 'All' },
  { value: 'sale', label: 'Sales' },
  { value: 'purchase', label: 'Received' },
  { value: 'return', label: 'Returns' },
  { value: 'adjust', label: 'Corrections' },
]

export const MOVE_LABEL: Record<MoveType, string> = {
  opening: 'Opening stock', purchase: 'Received', sale: 'Sold', return: 'Returned', adjust: 'Adjusted', audit: 'Counted', transfer: 'Transferred',
}

/** Which movements belong under a filter chip. Corrections cover manual adjustments and physical-count fixes. */
export const matchesFilter = (type: MoveType, f: LedgerFilter) =>
  !f || type === f || (f === 'adjust' && (type === 'audit' || type === 'opening' || type === 'transfer'))

export function filterMoves(moves: StockMove[], f: LedgerFilter, needle: string, label: (variantId: string) => string): StockMove[] {
  const n = needle.trim().toLowerCase()
  return moves
    .filter((m) => matchesFilter(m.type, f) && (!n || label(m.variantId).toLowerCase().includes(n) || m.ref.toLowerCase().includes(n) || m.reason.toLowerCase().includes(n)))
    .sort((a, b) => b.at - a.at)
}

/** Net change and the number of movements — the summary line under the filter chips. */
export function ledgerTotals(moves: StockMove[]) {
  let inQty = 0, outQty = 0
  for (const m of moves) { if (m.qty > 0) inQty += m.qty; else outQty += -m.qty }
  return { inQty: Math.round(inQty * 1000) / 1000, outQty: Math.round(outQty * 1000) / 1000, count: moves.length }
}
