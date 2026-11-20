import { describe, expect, it } from 'vitest'
import { planVariants } from '@/features/masterdata/variantPlan'

describe('variant plan', () => {
  it('makes every size and colour combination with clean codes', () => {
    const { plan } = planVariants('polo', 'Polo shirt', 'S, M', 'Red, Navy blue')
    expect(plan.map((p) => p.code)).toEqual(['POLO-S-RED', 'POLO-S-NAVYBLUE', 'POLO-M-RED', 'POLO-M-NAVYBLUE'])
    expect(plan[1]).toMatchObject({ name: 'Polo shirt - S / Navy blue', size: 'S', colour: 'Navy blue' })
  })
  it('works with sizes only, ignores duplicates and blanks, and caps the count', () => {
    expect(planVariants('SOCK', 'Sock', '38, 38, ,40', '').plan.map((p) => p.code)).toEqual(['SOCK-38', 'SOCK-40'])
    const big = planVariants('X', 'X', Array.from({ length: 20 }, (_, i) => `s${i}`).join(','), Array.from({ length: 10 }, (_, i) => `c${i}`).join(','))
    expect(big.tooMany).toBe(true); expect(big.plan).toHaveLength(150)
  })
})
