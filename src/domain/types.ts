import type { TaxSlab } from './tax'

/**
 * The business model. Field names and shapes are deliberately identical to the cloud API (`GET /sync/snapshot`) so a
 * snapshot hydrates straight into the app and a record the phone creates posts to the server unchanged.
 */

export type Role = 'owner' | 'manager' | 'cashier'

export interface User {
  id: string
  name: string
  role: Role
  active: boolean
  /** Short staff number (01, 02…) picked on bills to say who served the customer. Unique per store. */
  code?: string
  /** Salted PIN hash — only for staff created on this phone in an offline workspace. Never leaves the device. */
  pin?: string
}

export interface StoreSettings {
  id: string
  name: string
  tagline: string
  address: string
  city: string
  phone: string
  email: string
  gstin: string
  invoicePrefix: string
  nextInvoiceNo: number
  slabs: TaxSlab[]
  priceIncludesTax: boolean
  receiptWidth: '58mm' | '80mm'
  returnPolicy: string
  /** Days after a sale that returns are expected within. Later returns are allowed but flagged in the audit log. 0 = no limit. */
  returnWindowDays?: number
  footerNote: string
  loyaltyEarnPct: number // points earned per ₹100 spent
  loyaltyRedeemValue: number // ₹ value of 1 point
  maxCashierDiscountPct: number
  lowStockDefault: number
  receiptShowTax?: boolean
  receiptShowHsn?: boolean
  receiptShowSavings?: boolean
  receiptShowLoyalty?: boolean
  /** Which purchase cost reports and stock value use: the weighted average over all receipts (default) or the latest. */
  costBasis?: 'average' | 'latest'
  plan?: string
  /** The industry pack this business runs on (shared by every device on a Kosh server). */
  industry?: string
  /** How the business is registered for GST. Missing = regular. Composition and unregistered dealers issue a bill of supply (no tax shown). */
  registrationType?: 'regular' | 'composition' | 'unregistered'
}

/** How goods in a category are sold. Copied onto each new item (so changing it later never alters existing items). */
export interface CategoryConfig {
  /** Unit code: 'pc', 'm', 'kg'… or any custom label. */
  unit?: string
  /** Quantities may be fractions (2.5 m). Defaults from the unit. */
  fractional?: boolean
  /** Step for the − / + buttons on a fractional quantity. */
  step?: number
  /** Smallest quantity per sale. */
  minQty?: number
  /** 'sizes' = two option axes (e.g. size × colour); 'plain' = one item, or a single list of types/designs. */
  variantMode?: 'sizes' | 'plain'
  /** Word for the options of a plain item: "Types", "Designs", "Widths"… */
  optionLabel?: string
  /** Code prefix: WS → WS-101. */
  prefix?: string
  hsn?: string
  /** Flat GST % for the category; empty = the price slabs. */
  gstRate?: number
  /** false = a service / charge: no stock is checked or deducted. */
  trackStock?: boolean
  /** true = no item or bill discount applies. */
  noDiscount?: boolean
  /** Low-stock warning level given to new items. */
  reorderLevel?: number
}

export interface Category {
  id: string
  name: string
  group: string
  config?: CategoryConfig
}

export interface Product {
  id: string
  styleCode: string
  name: string
  categoryId: string
  brand: string
  /** Industry-specific attribute #1 (fabric, composition, model, material…). Labelled by the industry pack. */
  fabric: string
  /** Industry-specific attribute #2 (season, warranty, shelf life…). Labelled by the industry pack. */
  season: string
  hsn: string
  active: boolean
  createdAt: number
  unit?: string
  fractional?: boolean
  step?: number
  minQty?: number
  /** false = a service / charge with no stock: never checked or deducted. Default true. */
  trackStock?: boolean
  noDiscount?: boolean
  /** Fixed GST rate for this item. Empty = use the slabs. */
  gstRate?: number
}

export interface Variant {
  id: string
  productId: string
  sku: string
  barcode: string
  /** First option axis (size, pack, strength, storage…). */
  size: string
  /** Second option axis (colour, flavour, variant…). */
  color: string
  cost: number
  mrp: number
  price: number
  stock: number
  reorderLevel: number
  /** Weighted-average purchase cost over all receipts. Missing = same as `cost`. `cost` is the latest receipt's cost. */
  avgCost?: number
  /** When this item was received without a selling price; stays set until a price is entered. */
  unpricedSince?: number
}

export interface Supplier {
  id: string
  name: string
  phone: string
  gstin: string
  address: string
  openingBalance: number
}

export interface PurchaseItem {
  variantId: string
  qty: number
  cost: number
  /** Quantity on the supplier's bill, when it differs from what actually arrived. */
  invoicedQty?: number
}

export interface Purchase {
  id: string
  no: string
  supplierId: string
  date: number
  invoiceRef: string
  /** Total printed on the supplier's bill, to check the receipt against. */
  invoiceTotal?: number
  items: PurchaseItem[]
  total: number
  paid: number
  notes: string
  userId: string
  /** The purchase order this receipt fulfils (updates its received quantities and status). */
  poId?: string
  /** Data a module attaches to the receipt, keyed by module id. */
  ext?: Record<string, unknown>
  branchId?: string
}

export interface Customer {
  id: string
  name: string
  phone: string
  email: string
  dob: string
  anniversary: string
  address: string
  gstin: string
  loyaltyPoints: number
  storeCredit: number
  createdAt: number
  notes: string
  /** The price list this customer buys on (the pricing module); empty = the shop's default list, if any. */
  priceListId?: string
}

export type DiscountType = 'pct' | 'amt'

export interface Coupon {
  id: string
  code: string
  type: DiscountType
  value: number
  /** The bill must be at least this much (before the coupon) for the code to apply. 0 = any bill. */
  minBill: number
  /** Last moment the code works; empty = never expires. */
  expiresAt?: number
  /** How many bills may use it in total; 0 = unlimited. */
  maxUses: number
  active: boolean
  createdAt: number
}

export interface BillItem {
  variantId: string
  sku: string
  barcode: string
  name: string
  size: string
  color: string
  hsn: string
  qty: number
  mrp: number
  price: number
  discountType: DiscountType
  discountValue: number
  discountAmount: number
  net: number
  taxable: number
  taxRate: number
  cgst: number
  sgst: number
  /** IGST, for an inter-state supply (then `cgst` and `sgst` are 0). Absent on an intra-state line. */
  igst?: number
  lineTotal: number
  returnedQty: number
  priceOverridden?: boolean
  /** The item had no selling price; a manager/owner typed one at the counter. */
  unpricedSale?: boolean
  /** Unit the quantity is in (e.g. 'm'). Missing on older bills = pieces. */
  unit?: string
  /** Staff member (user id) who sold this item. */
  soldBy?: string
  /** Purchase cost of one unit at the moment of sale, so profit reports do not move when the cost is edited later. */
  cost?: number
  /** Data a module attaches to the line (a batch, a serial number, a price-list id), keyed by module id. */
  ext?: Record<string, unknown>
}

/** The four built-in ways to pay; a module can add its own (`'due'`, `'giftcard'`…), so the type stays open. */
export type PayMode = 'cash' | 'card' | 'upi' | 'credit' | (string & {})

export interface Payment {
  mode: PayMode
  amount: number
  ref?: string
}

export type BillStatus = 'paid' | 'held' | 'returned' | 'partial-return'

export interface Bill {
  id: string
  no: string
  date: number
  customerId: string | null
  items: BillItem[]
  grossMrp: number
  itemDiscount: number
  billDiscountType: DiscountType
  billDiscountValue: number
  billDiscount: number
  coupon: string
  subtotal: number
  taxableTotal: number
  cgstTotal: number
  sgstTotal: number
  /** IGST total of an inter-state bill. Absent on an intra-state bill; `taxTotal` always includes it. */
  igstTotal?: number
  taxTotal: number
  roundOff: number
  total: number
  payments: Payment[]
  paid: number
  changeDue: number
  loyaltyEarned: number
  loyaltyRedeemed: number
  creditUsed: number
  cashierId: string
  /** Default seller for the bill (staff user id); individual items can differ. */
  soldBy?: string
  status: BillStatus
  refundOfBillId?: string
  refundAmount?: number
  notes: string
  /** Data a module attaches to the bill (a delivery address, the buyer's GSTIN, a table), keyed by module id. */
  ext?: Record<string, unknown>
  /** The branch / outlet that made the sale (multi-store). */
  branchId?: string
}

export type MoveType = 'opening' | 'purchase' | 'sale' | 'return' | 'adjust' | 'audit' | 'transfer'

export interface StockMove {
  id: string
  variantId: string
  qty: number
  type: MoveType
  ref: string
  reason: string
  at: number
  userId: string
  /** Where the stock moved (the warehouse module). Missing = the main location. */
  locationId?: string
}

export type ExpenseMode = 'cash' | 'card' | 'upi' | 'bank'

export interface Expense {
  id: string
  date: number
  category: string
  amount: number
  mode: ExpenseMode
  vendor: string
  note: string
  recurring: boolean
  userId: string
}

export interface AuditLog {
  id: string
  at: number
  userId: string
  action: string
  detail: string
}

/** Cash drawer session — day open / day close (Z-report). */
export interface DaySession {
  id: string
  openedAt: number
  openedBy: string
  openingCash: number
  closedAt?: number
  closedBy?: string
  countedCash?: number
  expectedCash?: number
  variance?: number
  note?: string
}

/** Entities the cloud API accepts, one per write endpoint — see `docs/API-CONTRACT.md`. */
export type SyncEntity = 'bill' | 'billReturn' | 'customer' | 'customerUpdate' | 'product' | 'productUpdate' | 'productDelete' | 'variant' | 'variantUpdate'
  | 'expense' | 'stockAdjust' | 'storeUpdate' | 'supplier' | 'supplierUpdate' | 'purchase' | 'session' | 'sessionUpdate'
  | 'user' | 'userUpdate' | 'coupon' | 'couponUpdate' | 'category' | 'categoryDelete'
  /** A document write for a Kosh server (see src/replication). */
  | 'mut'

/** One outbound write, queued right after the change it describes and flushed to the server in order. */
export interface OutboxEntry {
  id: number
  entity: SyncEntity
  payload: unknown
  createdAt: number
  /** 0 = waiting to upload, 1 = uploaded, 2 = refused by the server (set aside so it cannot block the queue). */
  synced: 0 | 1 | 2
  attempts: number
  lastError?: string
}
