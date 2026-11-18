import { describe, expect, it } from 'vitest'
import { localTotal, trackingReady, type CartLine } from '@/features/pos/totals'
import { parseStatementCsv } from '@/features/accounting/statementCsv'

const line = (quantity: string, unitPrice: string, discountPercent = '0'): CartLine => ({ key: quantity + unitPrice, itemId: 'i', code: 'C', name: 'N', quantity, unitPrice, discountPercent, taxInclusive: true, taxCodeId: null, tracking: 'none', batchId: '', serials: '' })

describe('counter total worked out offline', () => {
  it('matches the server: lines to the paisa, the sale to the nearest rupee, half up', () => {
    expect(localTotal([line('2', '1180'), line('1', '105', '10')])).toEqual({ payable: '2454.5000', roundOff: '0.5000', grandTotal: '2455.0000' })
    expect(localTotal([line('1', '100.49')])).toMatchObject({ grandTotal: '100.0000', roundOff: '-0.4900' })
    expect(localTotal([line('3', '33.33')])).toMatchObject({ payable: '99.9900', grandTotal: '100.0000' })
  })
  it('handles fractional quantities', () => {
    expect(localTotal([line('0.5', '99')])).toMatchObject({ payable: '49.5000', grandTotal: '50.0000' })
  })
  it('keeps the statement parser honest too', () => { expect(parseStatementCsv('x\n').errors).toHaveLength(1) })
})

describe('tracked items at the counter', () => {
  const serial = (serials: string, quantity: string): CartLine => ({ ...line(quantity, '9000'), tracking: 'serial', serials })
  it('needs one distinct serial number per unit, or a chosen batch', () => {
    expect(trackingReady(serial('SN1 SN2', '2'))).toBe(true)
    expect(trackingReady(serial('SN1', '2'))).toBe(false)
    expect(trackingReady(serial('SN1\nSN1', '2'))).toBe(false)
    expect(trackingReady({ ...line('1', '30'), tracking: 'batch', batchId: '' })).toBe(false)
    expect(trackingReady({ ...line('1', '30'), tracking: 'batch', batchId: 'b' })).toBe(true)
    expect(trackingReady(line('1', '30'))).toBe(true)
  })
})
