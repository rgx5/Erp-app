import { priceCart, type CartLine } from '../cart'
import { DEFAULT_SLABS } from '../tax'
import { invoiceHtml, isCreditNote, paymentSummary, receiptHtml, receiptOptions, receiptText, esc } from '../receipt'
import type { Bill, StoreSettings } from '../types'

const store: StoreSettings = {
  id: 's', name: 'Sharma & Sons <Traders>', tagline: 'Since 1990', address: '12 MG Road', city: 'Pune', phone: '9876500000', email: '', gstin: '27AAAAA0000A1Z5',
  invoicePrefix: 'INV-', nextInvoiceNo: 1, slabs: DEFAULT_SLABS, priceIncludesTax: true, receiptWidth: '80mm', returnPolicy: 'Exchange in 7 days.',
  footerNote: 'Thank you!', loyaltyEarnPct: 1, loyaltyRedeemValue: 1, maxCashierDiscountPct: 10, lowStockDefault: 3,
}

const line = (over: Partial<CartLine> = {}): CartLine => ({
  variantId: 'v1', sku: 'S-1', barcode: '1', name: 'Oxford Shirt', size: 'M', color: 'Navy', hsn: '6205', mrp: 1299, price: 1099, qty: 2, stock: 9, discountType: 'amt', discountValue: 0, ...over,
})

function bill(over: Partial<Bill> = {}): Bill {
  const t = priceCart([line()], 'amt', 100, store.slabs, true)
  return {
    id: 'b1', no: 'INV-0042', date: new Date('2026-10-19T18:42:00').getTime(), customerId: null, items: t.items, grossMrp: t.grossMrp, itemDiscount: t.itemDiscount,
    billDiscountType: 'amt', billDiscountValue: 100, billDiscount: t.billDiscount, coupon: '', subtotal: t.subtotal, taxableTotal: t.taxableTotal, cgstTotal: t.cgstTotal,
    sgstTotal: t.sgstTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total, payments: [{ mode: 'cash', amount: 1000 }, { mode: 'upi', amount: t.total - 1000 }],
    paid: t.total, changeDue: 0, loyaltyEarned: 20, loyaltyRedeemed: 0, creditUsed: 0, cashierId: 'u', status: 'paid', notes: '', ...over,
  }
}

describe('receipts', () => {
  test('text for WhatsApp carries the essentials', () => {
    const b = bill()
    const t = receiptText({ bill: b, store, customer: { id: 'c', name: 'Meera Rao', phone: '9', email: '', dob: '', anniversary: '', address: '', gstin: '', loyaltyPoints: 0, storeCredit: 0, createdAt: 0, notes: '' } })
    expect(t).toContain('INV-0042')
    expect(t).toContain('Hi Meera,')
    expect(t).toContain('Oxford Shirt (M / Navy) × 2')
    expect(t).toContain(`Total: ₹${b.total.toLocaleString('en-IN')}`)
    expect(t).toContain('Paid by Cash ₹1,000 · UPI')
    expect(t).toContain('20 loyalty points')
  })

  test('HTML escapes anything a shop owner can type', () => {
    expect(esc('<b>&"')).toBe('&lt;b&gt;&amp;&quot;')
    const h = receiptHtml({ bill: bill(), store })
    expect(h).toContain('Sharma &amp; Sons &lt;Traders&gt;')
    expect(h).not.toContain('<Traders>')
  })

  test('the thermal receipt shows tax and HSN only when asked', () => {
    const plain = receiptHtml({ bill: bill(), store })
    expect(plain).not.toContain('CGST')
    expect(plain).not.toContain('HSN')
    const taxed = receiptHtml({ bill: bill(), store }, { ...receiptOptions(store), showTax: true, showHsn: true })
    expect(taxed).toContain('CGST')
    expect(taxed).toContain('6205')
  })

  test('the A4 invoice always carries the GST breakup, HSN summary and amount in words', () => {
    const h = invoiceHtml({ bill: bill(), store })
    expect(h).toContain('TAX INVOICE')
    expect(h).toContain('27AAAAA0000A1Z5')
    expect(h).toContain('HSN')
    expect(h).toContain('Amount in words')
    expect(h).toContain('Rupees')
  })

  test('a credit note reads as a refund', () => {
    const b = bill()
    const cn: Bill = { ...b, no: 'CN-0001', total: -1099, refundOfBillId: 'b1', items: b.items.map((i) => ({ ...i, lineTotal: -i.lineTotal })) }
    expect(isCreditNote(cn)).toBe(true)
    expect(receiptText({ bill: cn, store })).toContain('Credit note CN-0001')
    expect(receiptHtml({ bill: cn, store })).toContain('CREDIT NOTE')
    expect(invoiceHtml({ bill: cn, store })).toContain('Refund')
  })

  test('payment lines name credit and points', () => {
    expect(paymentSummary(bill({ payments: [{ mode: 'credit', amount: 100 }, { mode: 'credit', amount: 50, ref: '50 loyalty points' }, { mode: 'card', amount: 10 }] }))).toBe('Store credit ₹100 · Points ₹50 · Card ₹10')
  })
})
