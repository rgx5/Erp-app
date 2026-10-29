import { round2 } from '@/domain/money'

/**
 * Multi-currency, kept deliberately simple: a document keeps its own foreign amount and the rate used, converted to
 * rupees. The books stay in ₹ only — there is no separate foreign-currency ledger.
 */

export function convert(foreignAmount: number, rate: number): number {
  return round2(Math.max(0, foreignAmount) * Math.max(0, rate))
}

export function fxTagProblem(d: { currency: string; rate: number; foreignAmount: number }): string | null {
  if (!d.currency?.trim()) return 'Choose the currency.'
  if (!(d.rate > 0)) return 'Enter the exchange rate.'
  if (!(d.foreignAmount > 0)) return 'Enter the foreign-currency amount.'
  return null
}

/** Common currencies a small Indian business deals with; free text is fine too. */
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'CNY']
