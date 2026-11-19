import { fromUnits, toUnits, unitsOrZero } from '@/domain/money'
import type { CartLine } from './totals'

/** What the cashier has chosen from the customer's wallet for this sale. */
export interface WalletChoice { customerId: string; useCredit: boolean; points: string; code: string; coupon: { code: string; discount: string } | null }
export const noWallet = (): WalletChoice => ({ customerId: '', useCredit: false, points: '', code: '', coupon: null })
export const walletInUse = (w: WalletChoice): boolean => w.useCredit || Number(w.points) > 0 || w.coupon !== null

const qtyOf = (q: string): bigint => { const n = Number(q); return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1_000_000)) : 0n }
const lineGross = (l: CartLine): bigint => (unitsOrZero(l.unitPrice) * qtyOf(l.quantity)) / 1_000_000n
/** Price x quantity of every line, before any discount (what a coupon's minimum bill is measured on). */
export const grossOf = (lines: CartLine[]): string => fromUnits(lines.reduce((s, l) => s + lineGross(l), 0n))
/** What may still be discounted: lines that allow discounts, after their own discount. */
export function eligibleOf(lines: CartLine[]): bigint {
  return lines.reduce((s, l) => (l.noDiscount ? s : s + lineGross(l) - (lineGross(l) * unitsOrZero(l.discountPercent)) / 1_000_000n), 0n)
}
/** The rupee value of a number of points (2 decimals of a point). */
export function pointsValue(points: string, rupeesPerPoint: string): bigint {
  const [i = '0', f = ''] = points.split('.')
  return ((BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2) || '0')) * toUnits(rupeesPerPoint)) / 100n
}
/**
 * The coupon and points discount is taken off the lines that allow discounts, as an extra percentage on each. The server then works the
 * invoice out from those lines, so the till and the invoice always agree; the server only checks the customer's right to the discount.
 */
export function withWalletDiscount(lines: CartLine[], discount: bigint): CartLine[] {
  const base = eligibleOf(lines)
  if (discount <= 0n || base <= 0n) return lines
  const d = discount > base ? base : discount
  const extra = Number((d * 1_000_000n) / base) / 10_000 // percent, 4 decimals
  return lines.map((l) => {
    if (l.noDiscount) return l
    const own = Number(l.discountPercent) || 0 // a half-typed discount counts as none
    return { ...l, discountPercent: Math.min(100, own + extra - (own * extra) / 100).toFixed(4) }
  })
}
