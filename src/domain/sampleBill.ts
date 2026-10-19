import { round2, roundOff } from './money'
import { computeLineTax } from './tax'
import type { Bill, BillItem, StoreSettings } from './types'

/** A made-up two-line bill worked out with the shop's own tax settings — for receipt previews and test prints. */
export function sampleBill(store: Pick<StoreSettings, 'invoicePrefix' | 'slabs' | 'priceIncludesTax' | 'loyaltyEarnPct'>, now = Date.now()): Bill {
  const lines = [
    { name: 'Sample item', size: 'M', color: 'Blue', qty: 2, mrp: 599, price: 499, hsn: '6205' },
    { name: 'Another item', size: '', color: '', qty: 1, mrp: 299, price: 249, hsn: '6109' },
  ]
  const items: BillItem[] = lines.map((l, i) => {
    const net = round2(l.price * l.qty)
    const t = computeLineTax(net, l.qty, store.slabs, store.priceIncludesTax)
    return {
      variantId: `sample-${i}`, sku: `SMP-${i + 1}`, barcode: '0000000000000', name: l.name, size: l.size, color: l.color, hsn: l.hsn, qty: l.qty, mrp: l.mrp, price: l.price,
      discountType: 'pct', discountValue: 0, discountAmount: 0, net, taxable: t.taxable, taxRate: t.rate, cgst: t.cgst, sgst: t.sgst, lineTotal: t.gross, returnedQty: 0,
    }
  })
  const sum = (f: (i: BillItem) => number) => round2(items.reduce((s, i) => s + f(i), 0))
  const [total, ro] = roundOff(sum((i) => i.lineTotal))
  return {
    id: 'sample', no: `${store.invoicePrefix}0001`, date: now, customerId: null, items,
    grossMrp: round2(lines.reduce((s, l) => s + l.mrp * l.qty, 0)), itemDiscount: 0, billDiscountType: 'pct', billDiscountValue: 0, billDiscount: 0, coupon: '',
    subtotal: sum((i) => i.net), taxableTotal: sum((i) => i.taxable), cgstTotal: sum((i) => i.cgst), sgstTotal: sum((i) => i.sgst), taxTotal: sum((i) => i.cgst + i.sgst),
    roundOff: ro, total, payments: [{ mode: 'upi', amount: total }], paid: total, changeDue: 0, loyaltyEarned: Math.floor((total / 100) * store.loyaltyEarnPct), loyaltyRedeemed: 0, creditUsed: 0,
    cashierId: 'sample', status: 'paid', notes: '',
  }
}
