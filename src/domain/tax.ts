import { round2 } from './money'

export interface TaxSlab {
  /** Rate applies when the per-piece taxable value is <= threshold. Use Infinity / MAX_SAFE_INTEGER for the top slab. */
  upto: number
  rate: number
}

/**
 * Default Indian apparel slabs since 22 September 2025: 5% up to ₹2,500 per piece, 18% above (the old 12% band was
 * removed). Editable in Settings — a store's own slabs always win, so confirm them with the shop's accountant.
 */
export const DEFAULT_SLABS: TaxSlab[] = [
  { upto: 2500, rate: 5 },
  { upto: Number.MAX_SAFE_INTEGER, rate: 18 },
]

export function rateFor(perPieceTaxable: number, slabs: TaxSlab[]): number {
  const sorted = [...slabs].sort((a, b) => a.upto - b.upto)
  for (const s of sorted) if (perPieceTaxable <= s.upto) return s.rate
  return sorted[sorted.length - 1]?.rate ?? 0
}

export interface LineTaxResult {
  taxable: number
  rate: number
  cgst: number
  sgst: number
  /** Only on an inter-state line, where it carries the whole tax and `cgst` / `sgst` are 0. */
  igst?: number
  tax: number
  gross: number
}

/** How a sale is taxed beyond the ordinary local CGST + SGST: across state lines (IGST) or not at all (a bill of supply). */
export interface LineTaxOptions {
  interState?: boolean
  noTax?: boolean
}

/**
 * Splits a line's net amount into taxable value + CGST/SGST.
 * In Indian retail the tag price is tax-inclusive, so `inclusive` back-calculates;
 * set it false for exclusive pricing (B2B style).
 *
 * The slab is chosen on the per-piece amount the customer actually pays after
 * discount. Deciding it on the back-calculated ex-tax value instead leaves a dead
 * band around the threshold where neither rate is self-consistent, and "tag price
 * per piece" is the rule shops and their accountants work to anyway.
 *
 * `fixedRate` (a flat GST % on the item or its category) bypasses the slabs — that is how groceries, medicines,
 * restaurant food and services each carry their own rate.
 */
export function computeLineTax(
  netAmount: number,
  qty: number,
  slabs: TaxSlab[],
  inclusive: boolean,
  fixedRate?: number,
  opts?: LineTaxOptions,
): LineTaxResult {
  // A composition or unregistered dealer collects no tax: the price is the whole amount, shown at 0%.
  if (opts?.noTax) return { taxable: round2(netAmount), rate: 0, cgst: 0, sgst: 0, tax: 0, gross: round2(netAmount) }
  const perPiece = qty > 0 ? netAmount / qty : netAmount
  const rate = fixedRate !== undefined && fixedRate >= 0 ? fixedRate : rateFor(perPiece, slabs)

  const taxable = inclusive ? round2(netAmount / (1 + rate / 100)) : round2(netAmount)
  const tax = round2(inclusive ? netAmount - taxable : (netAmount * rate) / 100)
  // Across state lines the same tax is one IGST amount instead of two halves — totals are identical.
  if (opts?.interState) return { taxable, rate, cgst: 0, sgst: 0, igst: tax, tax, gross: round2(taxable + tax) }
  const cgst = round2(tax / 2)
  const sgst = round2(tax - cgst)
  return { taxable, rate, cgst, sgst, tax: round2(cgst + sgst), gross: round2(taxable + cgst + sgst) }
}

/** Groups lines into an HSN-wise summary block for the tax invoice and the GST report. */
export function hsnSummary<T extends { hsn: string; taxable: number; cgst: number; sgst: number; igst?: number; taxRate: number; qty: number }>(
  lines: T[],
) {
  const map = new Map<string, { hsn: string; rate: number; qty: number; taxable: number; cgst: number; sgst: number; igst?: number }>()
  for (const l of lines) {
    const key = `${l.hsn}|${l.taxRate}`
    const row = map.get(key) ?? { hsn: l.hsn || '—', rate: l.taxRate, qty: 0, taxable: 0, cgst: 0, sgst: 0 }
    row.qty += l.qty
    row.taxable = round2(row.taxable + l.taxable)
    row.cgst = round2(row.cgst + l.cgst)
    row.sgst = round2(row.sgst + l.sgst)
    // `igst` appears on a row only once an inter-state line has been seen, so a local-only summary is exactly what it was.
    if (l.igst !== undefined) row.igst = round2((row.igst ?? 0) + l.igst)
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate)
}

/** Rate-wise summary (5% / 12% / 18%…) — the other view accountants ask for. */
export function rateSummary<T extends { taxable: number; cgst: number; sgst: number; igst?: number; taxRate: number }>(lines: T[]) {
  const map = new Map<number, { rate: number; taxable: number; cgst: number; sgst: number; igst?: number }>()
  for (const l of lines) {
    const row = map.get(l.taxRate) ?? { rate: l.taxRate, taxable: 0, cgst: 0, sgst: 0 }
    row.taxable = round2(row.taxable + l.taxable)
    row.cgst = round2(row.cgst + l.cgst)
    row.sgst = round2(row.sgst + l.sgst)
    if (l.igst !== undefined) row.igst = round2((row.igst ?? 0) + l.igst)
    map.set(l.taxRate, row)
  }
  return [...map.values()].sort((a, b) => a.rate - b.rate)
}
