import { round3 } from '@/domain/qty'

/** Units that convert into each other: the factor is how many of the family's smallest unit one of it holds. */
const FAMILIES: Array<{ family: string; units: Record<string, number> }> = [
  { family: 'mass', units: { mg: 0.001, g: 1, kg: 1000 } },
  { family: 'volume', units: { ml: 1, l: 1000 } },
  { family: 'length', units: { mm: 1, cm: 10, m: 1000 } },
  { family: 'count', units: { pc: 1, pair: 2, dozen: 12 } },
]

const norm = (u?: string) => (u ?? 'pc').trim().toLowerCase() || 'pc'
const find = (u: string) => FAMILIES.find((f) => u in f.units)

/** `qty` of `from` expressed in `to`, or `null` when the two cannot be converted (kg → m). */
export function convertQty(qty: number, from: string | undefined, to: string | undefined): number | null {
  const a = norm(from), b = norm(to)
  if (a === b) return qty
  const fa = find(a), fb = find(b)
  if (!fa || !fb || fa !== fb) return null
  return round3((qty * fa.units[a]) / fb.units[b])
}

/** The units a recipe may use for an item counted in `stockUnit`: its own, plus those it converts to. */
export function unitChoices(stockUnit: string | undefined): string[] {
  const u = norm(stockUnit)
  const f = find(u)
  return f ? Object.keys(f.units) : [u]
}
