import { describe, expect, it } from 'vitest'
import { eligibleOf, grossOf, pointsValue, withWalletDiscount } from '@/features/pos/wallet'
import type { CartLine } from '@/features/pos/totals'

const line = (o: Partial<CartLine>): CartLine => ({ key: 'k', itemId: 'i', code: 'A', name: 'A', quantity: '1', unitPrice: '100', discountPercent: '0', taxInclusive: true, taxCodeId: null, tracking: 'none', batchId: '', serials: '', ...o })

describe('wallet discount', () => {
  it('measures gross before discount and eligibility after it', () => {
    const lines = [line({ quantity: '2', unitPrice: '100', discountPercent: '10' }), line({ unitPrice: '50', noDiscount: true })]
    expect(grossOf(lines)).toBe('250.0000')
    expect(eligibleOf(lines)).toBe(1_800_000n)
  })
  it('spreads the discount over lines that allow it and leaves the others alone', () => {
    const out = withWalletDiscount([line({ unitPrice: '100' }), line({ unitPrice: '100', noDiscount: true }), line({ unitPrice: '100', discountPercent: '10' })], 19n * 10_000n)
    expect(out[0]?.discountPercent).toBe('10.0000') // 19 off an eligible 190
    expect(out[1]?.discountPercent).toBe('0')
    expect(out[2]?.discountPercent).toBe('19.0000') // 10% then a further 10%
  })
  it('never discounts more than the eligible total', () => {
    expect(withWalletDiscount([line({ unitPrice: '100' })], 5_000_000n)[0]?.discountPercent).toBe('100.0000')
  })
  it('values points', () => { expect(pointsValue('4', '0.5')).toBe(20_000n); expect(pointsValue('5.90', '0.5')).toBe(29_500n) })
})
