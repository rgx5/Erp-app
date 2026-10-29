import type { FoodKotLine, FoodOrderLine } from '../types'
import { activeLines } from './orders'

/** Lines not yet printed for the kitchen. */
export const pendingLines = (lines: FoodOrderLine[]) => lines.filter((l) => l.status === 'new')

/** Groups lines by station ("Kitchen", "Bar"…), in first-seen order — one KOT is printed per group. */
export function groupByStation(lines: FoodOrderLine[]): Array<{ station: string; lines: FoodOrderLine[] }> {
  const order: string[] = []
  const map = new Map<string, FoodOrderLine[]>()
  for (const l of lines) {
    const st = l.station || 'Kitchen'
    if (!map.has(st)) { map.set(st, []); order.push(st) }
    map.get(st)!.push(l)
  }
  return order.map((station) => ({ station, lines: map.get(station)! }))
}

export const modifierText = (l: Pick<FoodOrderLine, 'modifiers'>) => l.modifiers.map((m) => m.name).join(', ')

export const kotLinesOf = (lines: FoodOrderLine[]): FoodKotLine[] =>
  lines.map((l) => ({ lineId: l.id, name: l.name, qty: l.qty, modifiers: modifierText(l), notes: l.notes }))

/** Nothing new to send to the kitchen right now. */
export const nothingToSend = (orderLines: FoodOrderLine[]) => pendingLines(activeLines({ lines: orderLines })).length === 0
