import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import type { FoodLooseRule } from '../types'

/**
 * Selling loose from a packed unit (a 1 kg bag sold in 250 g portions): nothing new is tracked — the loose sale is simply
 * a fraction of the same packed variant, priced and deducted from stock in proportion. `domain/scale.ts` only reads a
 * scale's barcode; the quantity system (`domain/qty.ts`) already allows a fractional sale of any unit, but has no idea
 * how many grams a "pack" is — that is all this rule adds.
 */

export function looseRuleProblem(packSizeG: number, minG: number): string | null {
  if (!(packSizeG > 0)) return 'Enter how many grams (or ml) the packed unit holds.'
  if (!(minG > 0)) return 'Enter the smallest amount that may be sold loose.'
  if (minG > packSizeG) return 'The smallest loose amount cannot be more than the pack itself.'
  return null
}

/** Why the requested amount cannot be sold loose against this rule, or null. */
export function looseAmountProblem(rule: Pick<FoodLooseRule, 'packSizeG' | 'minG' | 'unitLabel'>, amount: number): string | null {
  if (!(amount > 0)) return 'Enter how much to sell.'
  if (amount < rule.minG) return `At least ${rule.minG} ${rule.unitLabel}.`
  if (amount > rule.packSizeG) return 'That is more than one pack holds — sell it as a whole pack instead.'
  return null
}

export interface LooseQuote { grams: number; fraction: number; price: number }

/** What `grams` costs (proportional to the pack's own selling price) and what fraction of the packed variant it consumes. */
export function quoteLoose(rule: Pick<FoodLooseRule, 'packSizeG'>, packPrice: number, grams: number): LooseQuote {
  const fraction = round3(grams / rule.packSizeG)
  return { grams, fraction, price: round2(packPrice * fraction) }
}
