import type { Bill } from '@/domain/types'
import { billToSale, itemToProduct, money, retotal, saleToBill, serverTotalFrom } from '../mapping'
import { normalizePlatformUrl } from '../api'

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: 'b_1', no: 'INV-1', date: Date.UTC(2026, 10, 25), customerId: null, grossMrp: 236, itemDiscount: 0, billDiscountType: 'amt', billDiscountValue: 0, billDiscount: 0, coupon: '', subtotal: 236, taxableTotal: 200, cgstTotal: 18, sgstTotal: 18,
  taxTotal: 36, roundOff: 0, total: 236, payments: [{ mode: 'cash', amount: 300 }], paid: 300, changeDue: 64, loyaltyEarned: 0, loyaltyRedeemed: 0, creditUsed: 0, cashierId: 'u', status: 'paid', notes: '',
  items: [{ variantId: 'item-1', sku: 'W', barcode: '', name: 'Widget', size: '', color: '', hsn: '', qty: 2, mrp: 118, price: 118, discountType: 'pct', discountValue: 0, discountAmount: 0, net: 236, taxable: 200, taxRate: 18, cgst: 18, sgst: 18, lineTotal: 236, returnedQty: 0 }],
  ...over,
})

describe('platform mapping', () => {
  it('turns an item into a product with one variant that shares its id, priced at the MRP and taxed at its tax code', () => {
    const { product, variant } = itemToProduct({ id: 'i1', code: 'WID', name: 'Widget', taxCodeId: 't18', mrp: '118.00', isStocked: true }, { t18: 18 }, () => '')
    expect(product).toMatchObject({ id: 'i1', gstRate: 18, trackStock: true, active: true })
    expect(variant).toMatchObject({ id: 'i1', productId: 'i1', sku: 'WID', price: 118, mrp: 118 })
    expect(variant.unpricedSince).toBeUndefined()
  })
  it('marks an item with no MRP as awaiting a price', () => {
    expect(itemToProduct({ id: 'i2', code: 'X', name: 'X', mrp: null }, {}, () => '').variant.unpricedSince).toBeDefined()
  })
  it('builds the till sale: price-inclusive lines, cash capped at what is owed (the rest was change)', () => {
    const s = billToSale(bill(), { shiftId: 'sh', walkInId: null, priceIncludesTax: true })
    expect(s.lines).toEqual([expect.objectContaining({ itemId: 'item-1', quantity: '2', unitPrice: '118', discountPercent: '0', taxInclusive: true })])
    expect(s.payments).toEqual([{ method: 'cash', amount: '236' }])
    expect(s.customerId).toBeUndefined()
    expect(s.date).toBe('2026-11-25')
  })
  it('turns a rupee discount into the equivalent percentage and keeps the walk-in customer off the sale', () => {
    const s = billToSale(bill({ customerId: 'walk', items: [{ ...bill().items[0]!, discountAmount: 23.6 }] }), { shiftId: 'sh', walkInId: 'walk', priceIncludesTax: true })
    expect(s.lines[0]!['discountPercent']).toBe('10')
    expect(s.customerId).toBeUndefined()
  })
  it('spreads a bill discount over the lines', () => {
    const s = billToSale(bill({ billDiscount: 23.6, subtotal: 212.4, total: 212.4 }), { shiftId: 'sh', walkInId: null, priceIncludesTax: true })
    expect(Number(s.lines[0]!['discountPercent'])).toBeCloseTo(10, 3)
  })
  it('puts a credit (due) payment aside and maps other modes', () => {
    const s = billToSale(bill({ payments: [{ mode: 'upi', amount: 100 }, { mode: 'credit', amount: 136 }] }), { shiftId: 'sh', walkInId: null, priceIncludesTax: true })
    expect(s.payments).toEqual([{ method: 'upi', amount: '100' }])
  })
  it('reads the platform total out of a payment error and puts the difference on the largest payment', () => {
    expect(serverTotalFrom('The payments (235.5) must equal the sale total (236)')).toBe(236)
    expect(serverTotalFrom('something else')).toBeNull()
    expect(retotal([{ method: 'upi', amount: '100' }, { method: 'cash', amount: '135.5' }], 236)).toEqual([{ method: 'upi', amount: '100' }, { method: 'cash', amount: '136' }])
  })
  it('reads a platform sale back as a bill', () => {
    const b = saleToBill({
      id: 's1', kind: 'sale', createdAt: '2026-11-25T10:00:00Z',
      document: { invoiceNo: 'INV/2627/00001', invoiceDate: '2026-11-25', customerId: 'walk', grandTotal: '236.0000', taxableTotal: '200.0000', cgstTotal: '18.0000', sgstTotal: '18.0000', igstTotal: '0', roundOff: '0', status: 'posted' },
      lines: [{ id: 'l1', lineNo: 1, itemId: 'item-1', quantity: '2.000000', unitPrice: '118.0000', discountPercent: '0', taxInclusive: true, taxableValue: '200.0000', igstRate: '0', cgstRate: '9', sgstRate: '9', cgstAmount: '18', sgstAmount: '18', igstAmount: '0', lineTotal: '236.0000' }],
      payments: [{ method: 'cash', amount: '236.0000' }],
    }, () => ({ name: 'Widget', sku: 'W', barcode: '', size: '', color: '', mrp: 118 }), 'walk')
    expect(b).toMatchObject({ id: 's1', no: 'INV/2627/00001', total: 236, customerId: null, taxTotal: 36, paid: 236 })
    expect(b.items[0]).toMatchObject({ qty: 2, price: 118, taxRate: 18, lineTotal: 236 })
  })
  it('keeps money strings plain', () => { expect(money(236)).toBe('236'); expect(money(10.5)).toBe('10.5'); expect(money(0)).toBe('0') })
  it('accepts a server address as people type it', () => {
    expect(normalizePlatformUrl('erp.shop.in/')).toBe('https://erp.shop.in')
    expect(normalizePlatformUrl('https://erp.shop.in/api')).toBe('https://erp.shop.in')
    expect(normalizePlatformUrl('192.168.1.5:3000')).toBe('http://192.168.1.5:3000')
  })
})
