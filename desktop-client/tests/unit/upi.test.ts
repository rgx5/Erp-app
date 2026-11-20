import { describe, expect, it } from 'vitest'
import { qrSvg, upiLink } from '@/features/retail/upiQr'

describe('UPI QR', () => {
  it('builds the payment link with a fixed amount', () => {
    const l = upiLink('shop@okaxis', 'Sunrise Traders', '1180', 'INV/2627/00012')
    expect(l.startsWith('upi://pay?')).toBe(true)
    const q = new URLSearchParams(l.slice('upi://pay?'.length))
    expect(q.get('pa')).toBe('shop@okaxis'); expect(q.get('pn')).toBe('Sunrise Traders'); expect(q.get('am')).toBe('1180.00'); expect(q.get('cu')).toBe('INR'); expect(q.get('tn')).toBe('INV/2627/00012')
  })
  it('draws a QR as an SVG', () => {
    const svg = qrSvg('upi://pay?pa=shop@okaxis&am=1.00')
    expect(svg).toContain('<svg'); expect(svg).toContain('<path d="M')
  })
})
