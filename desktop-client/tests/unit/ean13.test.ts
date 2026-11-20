import { describe, expect, it } from 'vitest'
import { generateEan13, isEan13 } from '@/features/retail/labels'

describe('in-store barcodes', () => {
  it('makes valid EAN-13 numbers in the shop-use range', () => {
    for (let i = 0; i < 200; i++) { const b = generateEan13(); expect(b).toHaveLength(13); expect(b.startsWith('2')).toBe(true); expect(isEan13(b)).toBe(true) }
  })
  it('checks known codes', () => {
    expect(isEan13('4006381333931')).toBe(true)
    expect(isEan13('4006381333932')).toBe(false)
    expect(isEan13('ABC-123')).toBe(false)
  })
})
