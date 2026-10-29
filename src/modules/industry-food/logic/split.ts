import { round2 } from '@/domain/money'
import type { FoodOrder, FoodOrderLine } from '../types'
import { activeLines, lineTotal } from './orders'

/** `n` paisa-accurate shares of `total` that add up to it exactly (the last share takes the rounding remainder). */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return []
  const each = round2(total / n)
  const shares = Array(n).fill(each)
  shares[n - 1] = round2(total - each * (n - 1))
  return shares
}

export interface SplitGroup { label: string; lineIds: string[] }

/** Active line ids an item-split leaves unassigned (every line must go to exactly one person's share). */
export function unassigned(order: Pick<FoodOrder, 'lines'>, groups: SplitGroup[]): string[] {
  const used = new Set(groups.flatMap((g) => g.lineIds))
  return activeLines(order).map((l) => l.id).filter((id) => !used.has(id))
}

/** One person's lines and what they add up to, for a split by item. */
export function sharesByItem(order: Pick<FoodOrder, 'lines'>, groups: SplitGroup[]): Array<{ label: string; lines: FoodOrderLine[]; subtotal: number }> {
  const byId = new Map(activeLines(order).map((l) => [l.id, l]))
  return groups.map((g) => {
    const lines = g.lineIds.map((id) => byId.get(id)).filter((l): l is FoodOrderLine => !!l)
    return { label: g.label, lines, subtotal: round2(lines.reduce((s, l) => s + lineTotal(l), 0)) }
  })
}
