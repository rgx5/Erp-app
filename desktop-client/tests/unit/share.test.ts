import { describe, expect, it } from 'vitest'
import { whatsappNumber, whatsappUrl } from '@/features/pos/share'

describe('whatsapp share', () => {
  it('adds the Indian country code to a ten-digit number and strips punctuation', () => {
    expect(whatsappNumber('98765 43210')).toBe('919876543210')
    expect(whatsappNumber('+91 98765-43210')).toBe('919876543210')
    expect(whatsappNumber('09876543210')).toBe('919876543210')
  })
  it('rejects numbers that cannot be right', () => { expect(whatsappNumber('12345')).toBeNull(); expect(whatsappUrl('abc', 'hi')).toBeNull() })
  it('encodes the message', () => { expect(whatsappUrl('9876543210', 'a b\nc')).toBe('https://wa.me/919876543210?text=a%20b%0Ac') })
})
