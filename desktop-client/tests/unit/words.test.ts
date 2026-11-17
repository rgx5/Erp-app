import { describe, expect, it } from 'vitest'
import { numberInWords, rupeesInWords } from '@/domain/words'

describe('amount in words (Indian system)', () => {
  it('says whole numbers with lakh and crore', () => {
    expect(numberInWords(0n)).toBe('Zero')
    expect(numberInWords(19n)).toBe('Nineteen')
    expect(numberInWords(100n)).toBe('One Hundred')
    expect(numberInWords(2360n)).toBe('Two Thousand Three Hundred Sixty')
    expect(numberInWords(100000n)).toBe('One Lakh')
    expect(numberInWords(1234567n)).toBe('Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven')
    expect(numberInWords(25000000n)).toBe('Two Crore Fifty Lakh')
    expect(numberInWords(1000000000n)).toBe('One Hundred Crore')
  })
  it('adds paise from a decimal string', () => {
    expect(rupeesInWords('2360.0000')).toBe('Two Thousand Three Hundred Sixty Rupees Only')
    expect(rupeesInWords('1.5')).toBe('One Rupees and Fifty Paise Only')
    expect(rupeesInWords('0.05')).toBe('Zero Rupees and Five Paise Only')
    expect(rupeesInWords('-10')).toBe('Minus Ten Rupees Only')
    expect(rupeesInWords('abc')).toBe('')
  })
})
