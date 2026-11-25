import type { Bill, BillItem, Category, Customer, Payment, Product, Supplier, User, Variant } from '@/domain/types'

/**
 * The new platform speaks in companies, items, parties and tax invoices; the phone app keeps products with variants, customers and
 * bills. These pure functions translate between the two, so no screen has to know the difference. A platform item becomes one
 * product with one variant that shares its id, so a bill line's `variantId` is the platform's item id.
 */

export const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
/** A money string for the platform: four decimals at most, never exponent notation. */
export const money = (n: number): string => (Math.round(n * 10000) / 10000).toFixed(4).replace(/\.?0+$/, '') || '0'
const when = (iso: unknown): number => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? t : Date.now() }

export interface PItem { id: string; code: string; name: string; hsnSacCode?: string | null; hsn?: string | null; taxCodeId?: string | null; itemType?: string; isStocked?: boolean; stocked?: boolean; categoryId?: string | null; brand?: string | null; mrp?: string | null; styleCode?: string | null; size?: string | null; colour?: string | null; reorderLevel?: string | null; status?: string; createdAt?: string; description?: string | null; noDiscount?: boolean }
export interface PParty { id: string; code: string; legalName: string; tradeName?: string | null; isCustomer: boolean; isSupplier: boolean; gstin?: string | null; phone?: string | null; email?: string | null; status?: string; createdAt?: string }
export interface PCategory { id: string; name: string; parentId?: string | null }

/** GST rate by tax code id, from the till catalogue's rate table (the IGST rate is the whole rate). */
export type TaxRates = Record<string, number>

export function itemToProduct(i: PItem, rates: TaxRates, nameOfCategory: (id: string | null | undefined) => string): { product: Product; variant: Variant } {
  const stocked = i.isStocked ?? i.stocked ?? true
  const price = num(i.mrp)
  const gst = i.taxCodeId ? rates[i.taxCodeId] : undefined
  const product: Product = {
    id: i.id, styleCode: i.styleCode ?? i.code, name: i.name, categoryId: i.categoryId ?? '', brand: i.brand ?? '', fabric: '', season: '', hsn: i.hsnSacCode ?? i.hsn ?? '',
    active: (i.status ?? 'active') === 'active', createdAt: when(i.createdAt), trackStock: stocked, ...(gst !== undefined ? { gstRate: gst } : {}), ...(i.noDiscount ? { noDiscount: true } : {}),
  }
  void nameOfCategory
  const variant: Variant = {
    id: i.id, productId: i.id, sku: i.code, barcode: '', size: i.size ?? '', color: i.colour ?? '', cost: 0, mrp: price, price, stock: 0, reorderLevel: num(i.reorderLevel),
    ...(price === 0 ? { unpricedSince: when(i.createdAt) } : {}),
  }
  return { product, variant }
}

export const categoryToCategory = (c: PCategory, byId: Map<string, PCategory>): Category => ({ id: c.id, name: c.name, group: (c.parentId && byId.get(c.parentId)?.name) || 'General' })

export const partyToCustomer = (p: PParty): Customer => ({
  id: p.id, name: p.tradeName || p.legalName, phone: p.phone ?? '', email: p.email ?? '', dob: '', anniversary: '', address: '', gstin: p.gstin ?? '', loyaltyPoints: 0, storeCredit: 0, createdAt: when(p.createdAt), notes: '',
})
export const partyToSupplier = (p: PParty): Supplier => ({ id: p.id, name: p.tradeName || p.legalName, phone: p.phone ?? '', gstin: p.gstin ?? '', address: '', openingBalance: 0 })

export interface PLine { id: string; lineNo: number; itemId: string; description?: string | null; hsnSacCode?: string | null; quantity: string; unitPrice: string; discountPercent: string; taxInclusive: boolean; taxableValue: string; igstRate: string; cgstRate: string; sgstRate: string; cgstAmount: string; sgstAmount: string; igstAmount: string; lineTotal: string; unitCost?: string }
export interface PSaleDetail {
  id: string; kind: 'sale' | 'return'; createdBy?: string; createdAt: string
  document: { invoiceNo: string; invoiceDate: string; customerId?: string | null; grandTotal: string; taxableTotal: string; cgstTotal: string; sgstTotal: string; igstTotal: string; roundOff: string; status: string; originalInvoiceId?: string | null }
  lines?: PLine[]; payments: Array<{ method: string; amount: string; reference?: string | null; tendered?: string; changeGiven?: string }>
}

export function saleToBill(s: PSaleDetail, nameOf: (itemId: string) => { name: string; sku: string; barcode: string; size: string; color: string; mrp: number }, walkInId: string | null): Bill {
  const d = s.document
  const items: BillItem[] = (s.lines ?? (s.document as unknown as { lines?: PLine[] }).lines ?? []).map((l) => {
    const v = nameOf(l.itemId)
    const qty = num(l.quantity); const price = num(l.unitPrice); const disc = num(l.discountPercent)
    const gross = round2(price * qty); const discountAmount = round2(gross * disc / 100)
    const rate = num(l.igstRate) || num(l.cgstRate) + num(l.sgstRate)
    return {
      variantId: l.itemId, sku: v.sku, barcode: v.barcode, name: l.description || v.name, size: v.size, color: v.color, hsn: l.hsnSacCode ?? '', qty, mrp: v.mrp || price, price,
      discountType: 'pct', discountValue: disc, discountAmount, net: round2(gross - discountAmount), taxable: num(l.taxableValue), taxRate: rate, cgst: num(l.cgstAmount), sgst: num(l.sgstAmount),
      ...(num(l.igstAmount) ? { igst: num(l.igstAmount) } : {}), lineTotal: num(l.lineTotal), returnedQty: 0, cost: num(l.unitCost),
    }
  })
  const payments: Payment[] = s.payments.map((p) => ({ mode: p.method, amount: num(p.amount), ...(p.reference ? { ref: p.reference } : {}) }))
  const tax = num(d.cgstTotal) + num(d.sgstTotal) + num(d.igstTotal)
  const total = num(d.grandTotal)
  const customerId = d.customerId && d.customerId !== walkInId ? d.customerId : null
  const bill: Bill = {
    id: s.id, no: d.invoiceNo, date: when(s.createdAt), customerId, items, grossMrp: round2(items.reduce((t, i) => t + i.mrp * i.qty, 0)), itemDiscount: round2(items.reduce((t, i) => t + i.discountAmount, 0)),
    billDiscountType: 'amt', billDiscountValue: 0, billDiscount: 0, coupon: '', subtotal: round2(total - tax - num(d.roundOff)), taxableTotal: num(d.taxableTotal), cgstTotal: num(d.cgstTotal), sgstTotal: num(d.sgstTotal),
    ...(num(d.igstTotal) ? { igstTotal: num(d.igstTotal) } : {}), taxTotal: round2(tax), roundOff: num(d.roundOff), total, payments, paid: round2(payments.reduce((t, p) => t + p.amount, 0)), changeDue: 0,
    loyaltyEarned: 0, loyaltyRedeemed: 0, creditUsed: 0, cashierId: s.createdBy ?? '', status: d.status === 'cancelled' ? 'returned' : s.kind === 'return' ? 'returned' : 'paid', notes: '',
  }
  return bill
}

/** What the platform's till endpoint takes for one sale, from a bill the phone has rung up. */
export interface SaleBody { shiftId: string; date?: string; customerId?: string; lines: Array<Record<string, unknown>>; payments: Array<Record<string, unknown>>; couponCode?: string }
const METHODS = new Set(['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other'])

export function billToSale(b: Bill, o: { shiftId: string; walkInId: string | null; priceIncludesTax: boolean; staffId?: string }): SaleBody {
  const lines = b.items.map((i) => {
    const gross = i.price * i.qty
    // the platform takes a percentage; a rupee discount is turned into the equivalent percentage
    const pct = i.discountAmount > 0 && gross > 0 ? Math.min(100, (i.discountAmount / gross) * 100) : 0
    return { itemId: i.variantId, description: i.name.slice(0, 500), quantity: String(i.qty), unitPrice: money(i.price), discountPercent: money(pct), taxInclusive: o.priceIncludesTax }
  })
  // a bill-level discount is spread over the lines in proportion, so the invoice total matches what the customer was charged
  if (b.billDiscount > 0 && b.subtotal + b.billDiscount > 0) {
    const share = b.billDiscount / (b.subtotal + b.billDiscount)
    for (const l of lines) l['discountPercent'] = money(100 - (100 - num(l['discountPercent'])) * (1 - share))
  }
  const payments = b.payments.filter((p) => p.mode !== 'credit' && p.amount > 0).map((p) => {
    const method = METHODS.has(String(p.mode)) ? String(p.mode) : p.mode === 'bank' ? 'bank_transfer' : 'other'
    const cash = method === 'cash'
    return { method, amount: money(cash ? Math.min(p.amount, Math.max(0, b.total - b.payments.filter((x) => x !== p && x.mode !== 'cash').reduce((t, x) => t + x.amount, 0))) : p.amount), ...(p.ref ? { reference: p.ref.slice(0, 100) } : {}) }
  })
  return { shiftId: o.shiftId, date: new Date(b.date).toISOString().slice(0, 10), ...(b.customerId && b.customerId !== o.walkInId ? { customerId: b.customerId } : {}), lines, payments, ...(b.coupon ? {} : {}) }
}

/** The total a payment error says the invoice came to: "...must equal the sale total (236)". */
export const serverTotalFrom = (detail: string): number | null => { const m = /sale total \(([0-9.]+)\)/.exec(detail); return m ? Number(m[1]) : null }

/** Puts the difference between the phone's total and the server's (rounding rules) on the largest payment, so the sale goes through. */
export function retotal(payments: Array<Record<string, unknown>>, serverTotal: number): Array<Record<string, unknown>> {
  if (!payments.length) return payments
  const paid = payments.reduce((t, p) => t + num(p['amount']), 0)
  const diff = round2(serverTotal - paid)
  const idx = payments.reduce((best, p, i) => (num(p['amount']) > num(payments[best]?.['amount']) ? i : best), 0)
  return payments.map((p, i) => (i === idx ? { ...p, amount: money(num(p['amount']) + diff) } : p))
}

export const staffUser = (id: string, name: string): User => ({ id, name, role: 'owner', active: true })
