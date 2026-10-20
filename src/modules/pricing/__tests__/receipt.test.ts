import { ctx } from '@/data/__tests__/helpers'
import { saveBill } from '@/data/ops'
import { applyChanges } from '@/data/state'
import { qrSvg } from '@/domain/qrSvg'
import { invoiceHtml, receiptText } from '@/domain/receipt'
import { receiptAddOns } from '../../registry'
import { recordEwayBill, recordIrn, saveEwayDetails } from '../ops'
import { cartLine, sale, shop } from './helpers'

describe('the printed invoice carries what the portals returned', () => {
  test('IRN, acknowledgement, e-way bill number and the signed QR; promotion and quantity notes under the item', () => {
    let s = shop()
    s.promotions = { sale: { id: 'sale', name: 'Jeans sale', kind: 'category_sale', active: true, priority: 0, scope: { categoryIds: ['cat_jeans'] }, off: { type: 'pct', value: 20 } } }
    const r = saveBill(s, sale(s, [cartLine(s, 'v3', 60)], { customerId: 'c1' }), ctx())
    s = applyChanges(s, r.changes)
    const before = receiptAddOns(r.bill, s)
    expect(before.qr).toBeNull()
    expect(before.footer).toEqual([])
    expect(before.item(r.bill.items[0])).toMatch(/Jeans sale −₹/)
    const qr = 'eyJhbGciOiJSUzI1NiJ9.' + 'x'.repeat(900)
    s = applyChanges(s, recordIrn(s, r.bill.id, { irn: 'ab'.repeat(32), ackNo: '112', ackDate: '2026-10-19 10:30:00', signedQr: qr }, ctx()).changes)
    s = applyChanges(s, saveEwayDetails(s, r.bill.id, { transport: { mode: 'road', distanceKm: 100, vehicleNo: 'MH12AB1234' } }, ctx()).changes)
    s = applyChanges(s, recordEwayBill(s, r.bill.id, { ewbNo: '271000123456', validUpto: '2026-10-21' }, ctx()).changes)
    const add = receiptAddOns(r.bill, s)
    expect(add.footer).toEqual([`IRN: ${'ab'.repeat(32)}`, 'Ack No: 112 · Ack Date: 2026-10-19 10:30:00', 'E-way bill: 271000123456 · valid till 2026-10-21'])
    expect(add.qr).toBe(qr)
    const html = invoiceHtml({ bill: r.bill, store: s.store!, customer: s.customers.c1, extras: add })
    expect(html).toContain('<svg')
    expect(html).toContain('IRN: ')
    expect(receiptText({ bill: r.bill, store: s.store!, extras: add })).toContain('E-way bill: 271000123456')
    expect(invoiceHtml({ bill: r.bill, store: s.store!, customer: s.customers.c1 })).not.toContain('<svg')
  })
  test('a QR of a long signed payload is drawn', () => {
    const svg = qrSvg('y'.repeat(1400))
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('<path')
  })
})
