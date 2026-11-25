import { describe, expect, it } from 'vitest'
import type { Invoice, Party, Item } from '@/api/schemas'
import { emptyLine, type Line } from '@/features/sales/LineGrid'
import { buildInvoiceBody } from '@/features/sales/InvoiceEditorPage'
import { invoiceHtml } from '@/features/sales/invoiceHtml'

const customer = { id: 'c1', code: 'C1', legalName: 'Asha', gstTreatment: 'registered_regular' } as Party
const sez = { ...customer, id: 'c2', gstTreatment: 'sez' } as Party
const item = { id: 'i1', code: 'W', name: 'Widget', isStocked: true } as Item
const header = { companyId: 'co', registrationId: 'r1', locationId: '', date: '2026-05-10', documentType: 'tax_invoice', customer, reverseCharge: false, taxPayment: '', placeOfSupply: '' }
const line = (o: Partial<Line> = {}): Line => ({ ...emptyLine('w1'), item, description: 'Widget', quantity: '2', unitPrice: '1000', ...o })

describe('invoice request from the screen', () => {
  it('is not sent until a customer and one complete line exist; blank rows are ignored', () => {
    expect(buildInvoiceBody({ ...header, customer: null }, [line()])).toBeNull()
    expect(buildInvoiceBody(header, [emptyLine('w1')])).toBeNull()
    const body = buildInvoiceBody(header, [line(), emptyLine('w1')])
    expect(body).toMatchObject({ companyId: 'co', gstRegistrationId: 'r1', customerId: 'c1', invoiceDate: '2026-05-10', lines: [{ itemId: 'i1', quantity: '2', unitPrice: '1000', warehouseId: 'w1' }] })
    expect(body?.lines).toHaveLength(1)
  })
  it('holds back half-typed lines instead of sending them', () => {
    expect(buildInvoiceBody(header, [line({ quantity: '' })])).toBeNull()
    expect(buildInvoiceBody(header, [line({ quantity: '0' })])).toBeNull()
    expect(buildInvoiceBody(header, [line({ unitPrice: '12.' })])).toBeNull()
    expect(buildInvoiceBody(header, [line({ discountPercent: '101' })])).toBeNull()
    expect(buildInvoiceBody(header, [line({ item: null, unitPrice: '5' })])).toBeNull()
  })
  it('sends tax payment only for SEZ and export customers, and no warehouse for services', () => {
    expect(buildInvoiceBody({ ...header, taxPayment: 'without_payment' }, [line()])).not.toHaveProperty('taxPayment')
    expect(buildInvoiceBody({ ...header, customer: sez, taxPayment: 'without_payment' }, [line()])).toMatchObject({ taxPayment: 'without_payment' })
    const service = { ...item, id: 'i2', isStocked: false } as Item
    expect(buildInvoiceBody(header, [line({ item: service })])?.lines[0]).not.toHaveProperty('warehouseId')
  })
})

const base: Invoice = {
  id: 'x', companyId: 'co', gstRegistrationId: 'r1', documentType: 'tax_invoice', invoiceNo: 'INV/2627/00001', invoiceDate: '2026-05-10', customerId: 'c1', customerName: 'Asha <script>alert(1)</script> & Sons', customerGstin: '27FGHIJ5678K1Z1',
  customerGstTreatment: 'registered_regular', placeOfSupply: '27', supplyType: 'b2b', taxPayment: null, reverseCharge: false, taxRegime: 'intra', taxableTotal: '2000.0000', cgstTotal: '180.0000', sgstTotal: '180.0000', igstTotal: '0.0000',
  cessTotal: '0.0000', roundOff: '0.0000', grandTotal: '2360.0000', originalInvoiceId: null, reason: null, status: 'posted', cancelledAt: null, cancelDate: null, cancelReason: null, dueDate: '2026-05-10', createdAt: '2026-05-10T00:00:00Z',
  lines: [{ id: 'l1', lineNo: 1, itemId: 'i1', originalLineId: null, description: 'Steel "widget"', hsnSacCode: '8479', quantity: '2.000000', unitPrice: '1000.0000', discountPercent: '0.0000', taxInclusive: false, taxableValue: '2000.0000', taxCodeId: null, igstRate: '0.0000', cgstRate: '9.0000', sgstRate: '9.0000', cessRate: '0.0000', cgstAmount: '180.0000', sgstAmount: '180.0000', igstAmount: '0.0000', cessAmount: '0.0000', lineTotal: '2360.0000', warehouseId: null }],
}
const seller = { name: 'Sunrise Traders', gstin: '27ABCDE1234F1Z5', address: ['12 Mill Road', 'Mumbai'], stateCode: '27' }

describe('A4 invoice HTML', () => {
  it('shows the server figures, in Indian format and in words, with no scripts', () => {
    const html = invoiceHtml(base, seller, undefined)
    expect(html).toContain('Tax Invoice')
    expect(html).toContain('INV/2627/00001')
    expect(html).toContain('2,360.00')
    expect(html).toContain('Two Thousand Three Hundred Sixty Rupees Only')
    expect(html).toContain('CGST')
    expect(html).not.toContain('IGST<')
    expect(html).toContain('10/05/2026')
    expect(html).not.toMatch(/<script/i)
  })
  it('escapes everything that came from data', () => {
    const html = invoiceHtml(base, seller, undefined)
    expect(html).toContain('Asha &lt;script&gt;alert(1)&lt;/script&gt; &amp; Sons')
    expect(html).toContain('Steel &quot;widget&quot;')
  })
  it('uses IGST for inter-state supplies and marks a cancelled document', () => {
    const inter = invoiceHtml({ ...base, taxRegime: 'inter', placeOfSupply: '29', igstTotal: '360.0000', cgstTotal: '0.0000', sgstTotal: '0.0000', status: 'cancelled' }, seller, undefined)
    expect(inter).toContain('IGST')
    expect(inter).toContain('Karnataka (29)')
    expect(inter).toContain('CANCELLED')
  })
})

describe('document layout', () => {
  it('shows the title, the notice, extra facts and the e-invoice block without boxes or scripts', () => {
    const html = invoiceHtml(base, seller, undefined, { title: 'Delivery Challan', numberLabel: 'Challan no.', note: 'Not a tax invoice.', extraMeta: [['Vehicle no.', 'MH12AB1234']], einvoice: { irn: 'a'.repeat(64), ackNo: '99', ackDate: '2026-04-15T05:00:00.000Z', signedQr: 'eyJ.qr.text' }, ewayBillNo: '271012345678' })
    expect(html).toContain('Delivery Challan'); expect(html).toContain('Not a tax invoice.'); expect(html).toContain('MH12AB1234')
    expect(html).toContain('IRN ' + 'a'.repeat(64)); expect(html).toContain('271012345678')
    expect(html).not.toMatch(/border:\s*1px solid #444/); expect(html).not.toMatch(/<script/i)
  })
  it('puts the HSN code under the description and the rate with its tax in one column', () => {
    const html = invoiceHtml(base, seller, undefined)
    expect(html).toContain('HSN/SAC 8479'); expect(html).toContain('18%')
  })
})
