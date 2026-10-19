import type { BillItem, Customer, Product, StoreSettings, Supplier, User, Variant } from '@/domain/types'
import { DEFAULT_SLABS } from '@/domain/tax'
import { priceCart, type CartLine } from '@/domain/cart'
import { applyChanges, emptyData, type Changes, type DataState } from '../state'
import type { BillInput, OpCtx } from '../ops'

export const NOW = new Date('2026-10-19T10:00:00').getTime()

export const ctx = (over: Partial<OpCtx> = {}): OpCtx => ({ now: NOW, userId: 'u_owner', series: '', barcodeBase: 1, ...over })

export const store = (over: Partial<StoreSettings> = {}): StoreSettings => ({
  id: 'st1', name: 'Test Store', tagline: '', address: '', city: '', phone: '', email: '', gstin: '',
  invoicePrefix: 'INV-', nextInvoiceNo: 1, slabs: DEFAULT_SLABS, priceIncludesTax: true, receiptWidth: '80mm',
  returnPolicy: '', footerNote: '', loyaltyEarnPct: 1, loyaltyRedeemValue: 1, maxCashierDiscountPct: 10, lowStockDefault: 3,
  ...over,
})

export const owner: User = { id: 'u_owner', name: 'Asha Owner', role: 'owner', active: true, code: '01' }
export const cashier: User = { id: 'u_cash', name: 'Ravi', role: 'cashier', active: true, code: '02' }

export const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', styleCode: 'MS-101', name: 'Oxford Shirt', categoryId: 'cat_mshirt', brand: 'Acme', fabric: 'Cotton', season: 'All',
  hsn: '6205', active: true, createdAt: NOW, unit: 'pc', ...over,
})

export const variant = (over: Partial<Variant> = {}): Variant => ({
  id: 'v1', productId: 'p1', sku: 'MS-101-NAV-M', barcode: '2100000000015', size: 'M', color: 'Navy',
  cost: 400, mrp: 1299, price: 999, stock: 10, reorderLevel: 3, avgCost: 400, ...over,
})

export const customer = (over: Partial<Customer> = {}): Customer => ({
  id: 'c1', name: 'Meera', phone: '9876543210', email: '', dob: '', anniversary: '', address: '', gstin: '',
  loyaltyPoints: 50, storeCredit: 0, createdAt: NOW, notes: '', ...over,
})

export const supplier = (over: Partial<Supplier> = {}): Supplier => ({ id: 's1', name: 'Fab Mills', phone: '', gstin: '', address: '', openingBalance: 0, ...over })

/** A small business: one shirt in two sizes, a customer, a supplier, an owner and a cashier. */
export function baseState(over: { store?: Partial<StoreSettings> } = {}): DataState {
  const s = emptyData()
  s.store = store(over.store)
  s.users = { [owner.id]: owner, [cashier.id]: cashier }
  s.categories = { cat_mshirt: { id: 'cat_mshirt', name: 'Shirts', group: 'Men', config: { prefix: 'MS' } } }
  s.products = { p1: product() }
  s.variants = {
    v1: variant(),
    v2: variant({ id: 'v2', sku: 'MS-101-NAV-L', barcode: '2100000000022', size: 'L', stock: 4 }),
  }
  s.customers = { c1: customer() }
  s.suppliers = { s1: supplier() }
  return s
}

export const line = (v: Variant, qty = 1, over: Partial<CartLine> = {}): CartLine => ({
  variantId: v.id, productId: v.productId, sku: v.sku, barcode: v.barcode, name: 'Oxford Shirt', size: v.size, color: v.color, hsn: '6205',
  mrp: v.mrp, price: v.price, qty, stock: v.stock, discountType: 'amt', discountValue: 0, cost: v.avgCost ?? v.cost, ...over,
})

/** A priced bill ready to save. */
export function billInput(state: DataState, lines: CartLine[], over: Partial<BillInput> = {}): BillInput {
  const t = priceCart(lines, 'amt', 0, state.store!.slabs, state.store!.priceIncludesTax)
  const items: BillItem[] = t.items.map((i) => ({ ...i, soldBy: 'u_owner' }))
  return {
    date: NOW, customerId: null, items, grossMrp: t.grossMrp, itemDiscount: t.itemDiscount, billDiscountType: 'amt', billDiscountValue: 0,
    billDiscount: t.billDiscount, coupon: '', subtotal: t.subtotal, taxableTotal: t.taxableTotal, cgstTotal: t.cgstTotal, sgstTotal: t.sgstTotal,
    taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total, payments: [{ mode: 'cash', amount: t.total }], paid: t.total, changeDue: 0,
    loyaltyEarned: 0, loyaltyRedeemed: 0, creditUsed: 0, cashierId: 'u_owner', soldBy: 'u_owner', status: 'paid', notes: '', ...over,
  }
}

export const apply = (s: DataState, c: Changes) => applyChanges(s, c)
