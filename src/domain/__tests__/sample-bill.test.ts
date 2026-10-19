import { sampleBill } from '../sampleBill'
import { DEFAULT_SLABS } from '../tax'

const base = { invoicePrefix: 'INV-', slabs: DEFAULT_SLABS, loyaltyEarnPct: 1 }

describe('sampleBill', () => {
  it.each([true, false])('adds up whether prices include tax (%s)', (priceIncludesTax) => {
    const b = sampleBill({ ...base, priceIncludesTax }, 0)
    const lines = b.items.reduce((s, i) => s + i.lineTotal, 0)
    expect(Math.abs(b.total - lines)).toBeLessThan(1)
    expect(b.total + 0).toBe(Math.round(b.total))
    expect(Math.abs(b.taxTotal - (b.cgstTotal + b.sgstTotal))).toBeLessThan(0.005)
    expect(b.no).toBe('INV-0001')
    expect(b.payments[0].amount).toBe(b.total)
  })
})
