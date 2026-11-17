import { fromUnits, toUnits } from './money'

/**
 * Quantity x price less the line discount, before any tax, from decimal strings with exact integer arithmetic. Used only to show an
 * order value while typing (the same measure approval policies use for purchase orders); the server's figures are what is stored.
 */
export function netValue(quantity: string, unitPrice: string, discountPercent: string): string {
  const q = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(quantity.trim())
  if (!q) return '0.0000'
  const qty = BigInt(q[1] as string) * 1_000_000n + BigInt((q[2] ?? '').padEnd(6, '0') || '0')
  const gross = div(qty * toUnits(unitPrice || '0'), 1_000_000n)
  const pct = toUnits(discountPercent || '0') // 100% = 1_000_000
  return fromUnits(div(gross * (1_000_000n - pct), 1_000_000n))
}
const div = (n: bigint, d: bigint): bigint => (2n * n + d) / (2n * d) // half up (values here are never negative)
