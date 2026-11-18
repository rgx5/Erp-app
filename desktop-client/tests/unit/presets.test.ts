import { describe, expect, it } from 'vitest'
import { PRESETS, categoriesOf } from '@/features/retail/presets'

describe('industry presets', () => {
  it('give every category a valid, unique code with its parent first', () => {
    for (const p of PRESETS) {
      const list = categoriesOf(p)
      const codes = list.map((c) => c.code)
      expect(new Set(codes).size, p.name).toBe(codes.length)
      for (const [i, c] of list.entries()) {
        expect(c.code, `${p.name}: ${c.name}`).toMatch(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,29}$/)
        if (c.parentCode) expect(codes.indexOf(c.parentCode)).toBeLessThan(i)
      }
    }
  })
})
