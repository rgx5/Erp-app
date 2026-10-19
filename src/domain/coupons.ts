import type { Bill, Coupon } from './types'
import { inr } from './money'

export const normalizeCouponCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '')

/** How many bills have used a code so far (parked bills and credit notes don't count). */
export function couponUses(bills: Bill[], code: string): number {
  let n = 0
  for (const b of bills) if (b.coupon === code && b.status !== 'held' && b.total > 0) n++
  return n
}

export const describeCoupon = (c: Pick<Coupon, 'type' | 'value'>) => (c.type === 'pct' ? `${c.value}% off` : `${inr(c.value, 0)} off`)

/** Why a coupon can't be used on this bill, or null when it can. `billValue` is the bill before the coupon. */
export function couponProblem(c: Coupon | undefined, billValue: number, uses: number, now = Date.now()): string | null {
  if (!c) return 'No such coupon'
  if (!c.active) return 'This coupon is switched off'
  if (c.expiresAt && now > c.expiresAt) return 'This coupon has expired'
  if (c.minBill > 0 && billValue < c.minBill) return `Needs a bill of at least ${inr(c.minBill, 0)}`
  if (c.maxUses > 0 && uses >= c.maxUses) return 'This coupon has been used up'
  return null
}
