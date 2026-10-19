/**
 * How an item is sold: the unit its quantity is counted in, and whether fractions are allowed. Every product carries
 * these (copied from its category when it is created), and they flow through the cart, bills, returns, stock and labels.
 * This is what lets one engine sell shirts by the piece, rice by the kilo and fabric by the metre.
 */
export interface SellRules {
  /** Unit code: 'pc', 'm', 'kg'… or any custom label. Missing = pieces. */
  unit?: string
  /** Quantities may be fractions (2.5 m, 0.75 kg). Defaults from the unit. */
  fractional?: boolean
  /** How far the − / + buttons move a fractional quantity. */
  step?: number
  /** Smallest quantity that can be sold in one go. */
  minQty?: number
}

export interface UnitPreset { code: string; label: string; short: string; fractional: boolean; step: number }

export const UNIT_PRESETS: UnitPreset[] = [
  { code: 'pc', label: 'Piece', short: 'pc', fractional: false, step: 1 },
  { code: 'm', label: 'Metre', short: 'm', fractional: true, step: 0.5 },
  { code: 'kg', label: 'Kilogram', short: 'kg', fractional: true, step: 0.25 },
  { code: 'g', label: 'Gram', short: 'g', fractional: true, step: 50 },
  { code: 'l', label: 'Litre', short: 'L', fractional: true, step: 0.25 },
  { code: 'ml', label: 'Millilitre', short: 'ml', fractional: true, step: 50 },
  { code: 'pair', label: 'Pair', short: 'pair', fractional: false, step: 1 },
  { code: 'set', label: 'Set', short: 'set', fractional: false, step: 1 },
  { code: 'dozen', label: 'Dozen', short: 'doz', fractional: false, step: 1 },
  { code: 'pack', label: 'Pack', short: 'pack', fractional: false, step: 1 },
  { code: 'box', label: 'Box', short: 'box', fractional: false, step: 1 },
  { code: 'strip', label: 'Strip', short: 'strip', fractional: false, step: 1 },
  { code: 'bottle', label: 'Bottle', short: 'btl', fractional: false, step: 1 },
  { code: 'roll', label: 'Roll', short: 'roll', fractional: false, step: 1 },
  { code: 'plate', label: 'Plate', short: 'plate', fractional: false, step: 1 },
  { code: 'hr', label: 'Hour', short: 'hr', fractional: true, step: 0.5 },
  { code: 'svc', label: 'Service', short: 'svc', fractional: false, step: 1 },
]

export const unitPreset = (code?: string) => UNIT_PRESETS.find((u) => u.code === code)

/** Quantities are whole numbers or fractions to 3 decimals. Float drift (0.1 + 0.2) never leaks into stock. */
export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000

export const isFrac = (x?: SellRules | null): boolean => (x ? (x.fractional ?? unitPreset(x.unit)?.fractional ?? false) : false)
export const unitShort = (x?: SellRules | null): string => unitPreset(x?.unit)?.short ?? (x?.unit || 'pc')
export const unitName = (x?: SellRules | null): string => unitPreset(x?.unit)?.label ?? (x?.unit || 'Piece')
/** " m", " kg" … or empty for plain pieces — appended to a number. */
export const unitSuffix = (x?: SellRules | null): string => (unitShort(x) === 'pc' ? '' : ` ${unitShort(x)}`)
/** "per m" / "each" for a price line. */
export const unitPer = (x?: SellRules | null): string => (unitShort(x) === 'pc' ? ' each' : ` per ${unitShort(x)}`)

export const qtyStep = (x?: SellRules | null): number => (isFrac(x) ? (x?.step ?? unitPreset(x?.unit)?.step ?? 0.5) : 1)
export const minQtyOf = (x?: SellRules | null): number => x?.minQty ?? (isFrac(x) ? 0.1 : 1)

/** "2.5", "3" — no trailing zeros. */
export const fmtQty = (n: number) => String(round3(n))
/** "2.5 m", "3 pair", or plain "3" for pieces. */
export const fmtQtyUnit = (n: number, x?: SellRules | null) => fmtQty(n) + unitSuffix(x)

/** Quick quantities offered for items sold in fractions (lengths for fabric, weights for loose goods). */
export function quickQuantities(x?: SellRules | null): number[] {
  const u = unitShort(x)
  if (u === 'm') return [0.5, 1, 1.5, 2, 2.5, 3, 5, 10]
  if (u === 'kg') return [0.25, 0.5, 1, 2, 5]
  if (u === 'g') return [100, 250, 500, 1000]
  if (u === 'L') return [0.25, 0.5, 1, 2, 5]
  const st = qtyStep(x)
  return [st, st * 2, 1, 2, 5].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)
}

/** Reads what a person typed as a quantity: decimals only where fractions are allowed. */
export function parseQty(raw: string, x?: SellRules | null): number {
  const n = Number(raw.replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n)) return 0
  return isFrac(x) ? round3(n) : Math.floor(n)
}

/** A bill line only remembers its unit; if the quantity sold was fractional, returns may be fractional too. */
export const rulesOfBillItem = (it: { unit?: string; qty: number }): SellRules => ({
  unit: it.unit, fractional: isFrac({ unit: it.unit }) || !Number.isInteger(it.qty) || undefined,
})
