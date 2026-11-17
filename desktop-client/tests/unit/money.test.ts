import { describe, expect, it } from 'vitest'
import { formatDate, formatInr, groupIndian, parseDate } from '@/domain/format'
import { add, compare, fromUnits, isValid, isZero, sub, sum, toUnits } from '@/domain/money'

describe('money', () => {
  it('adds exactly where floating point cannot', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(add('0.1', '0.2')).toBe('0.3000')
    expect(sum(['0.1', '0.2', '0.3', '99999999999999.9999'])).toBe('100000000000000.5999')
    expect(sub('1', '1.0001')).toBe('-0.0001')
  })
  it('round-trips and compares', () => {
    expect(fromUnits(toUnits('-12.5'))).toBe('-12.5000')
    expect(compare('2', '10')).toBe(-1)
    expect(compare('10.0000', '10')).toBe(0)
    expect(isZero('0.0000')).toBe(true)
  })
  it('rejects anything that is not a decimal string with at most 4 places', () => {
    for (const bad of ['', '1e3', '1,000', '1.23456', 'abc', '1.']) expect(isValid(bad), bad).toBe(false)
    expect(() => toUnits('1.23456')).toThrow(TypeError)
  })
})

describe('Indian formats', () => {
  it('groups digits as lakhs and crores', () => {
    expect(groupIndian('123')).toBe('123')
    expect(groupIndian('1234')).toBe('1,234')
    expect(groupIndian('1234567')).toBe('12,34,567')
    expect(groupIndian('123456789')).toBe('12,34,56,789')
  })
  it('formats rupees, rounding half away from zero', () => {
    expect(formatInr('1234567.5')).toBe('₹ 12,34,567.50')
    expect(formatInr('-1234.005')).toBe('-₹ 1,234.01')
    expect(formatInr('0.005')).toBe('₹ 0.01')
    expect(formatInr('1999.5', { places: 0 })).toBe('₹ 2,000')
    expect(formatInr('100', { symbol: false })).toBe('100.00')
  })
  it('converts dates both ways and refuses impossible ones', () => {
    expect(formatDate('2025-04-01')).toBe('01/04/2025')
    expect(formatDate(null)).toBe('')
    expect(parseDate('01/04/2025')).toBe('2025-04-01')
    expect(parseDate('31/02/2025')).toBeNull()
    expect(parseDate('2025-04-01')).toBeNull()
  })
})
