import { describe, expect, it } from 'vitest'
import { fromMicro, isPositiveQty, showQty, subQty, toMicro } from '@/domain/quantity'

describe('quantities (6 decimal places)', () => {
  it('subtracts exactly and reads naturally', () => {
    expect(subQty('10.000000', '2.500000')).toBe('7.500000')
    expect(subQty('0.000001', '0.000002')).toBe('-0.000001')
    expect(showQty('10.000000')).toBe('10')
    expect(showQty('2.500000')).toBe('2.5')
    expect(showQty('0.000001')).toBe('0.000001')
    expect(showQty('7')).toBe('7')
  })
  it('knows what is positive and refuses what is not a quantity', () => {
    expect(isPositiveQty('0.5')).toBe(true)
    expect(isPositiveQty('0.000000')).toBe(false)
    expect(isPositiveQty('abc')).toBe(false)
    expect(() => toMicro('1.1234567')).toThrow(TypeError)
    expect(fromMicro(toMicro('12.34'))).toBe('12.340000')
  })
})
