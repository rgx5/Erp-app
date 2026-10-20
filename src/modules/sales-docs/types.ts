import type { CartLine } from '@/domain/cart'
import type { DiscountType } from '@/domain/types'

/**
 * A line on a quotation, order, challan or subscription: what the item was and what was agreed at the time. It is a snapshot
 * (like a bill line), so the document prints the same even if the item is renamed or re-priced later. It converts to a cart
 * line (`toCartLine`) when the document is turned into a bill.
 */
export type DocLine = Omit<CartLine, 'stock' | 'unpricedSale' | 'savePrice' | 'staffId' | 'ext' | 'priceOverridden'>

// ───────────────────────────── quotations ─────────────────────────────

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted'

export interface Quotation {
  id: string
  no: string
  date: number
  /** Last day the prices hold (end of that day). */
  validUntil: number
  customerId: string | null
  /** Who it is for when they are not a saved customer (walk-in enquiry). */
  partyName: string
  partyPhone: string
  items: DocLine[]
  billDiscountType: DiscountType
  billDiscountValue: number
  notes: string
  terms: string
  status: QuoteStatus
  /** The bill this became. */
  billId?: string
  convertedAt?: number
  createdBy: string
  branchId?: string
}

// ───────────────────────────── sales orders ─────────────────────────────

export type OrderStatus = 'open' | 'ready' | 'delivered' | 'cancelled'

/** One instalment of a layaway plan: how much should have been paid in total by this date is the running sum of amounts. */
export interface Instalment { dueDate: number; amount: number }

export interface SalesOrder {
  id: string
  no: string
  date: number
  customerId: string
  items: DocLine[]
  billDiscountType: DiscountType
  billDiscountValue: number
  expectedDate?: number
  status: OrderStatus
  /** Order value at the time it was taken (GST included). */
  total: number
  notes: string
  /** Pay-over-time plan; absent for an ordinary advance booking. */
  instalments?: Instalment[]
  billId?: string
  createdBy: string
  branchId?: string
}

export type OrderPayKind = 'advance' | 'refund' | 'applied'
/** How the money moved; `advance` marks an entry that uses advance up against a bill. */
export type OrderPayMode = 'cash' | 'upi' | 'card' | 'bank' | 'advance'

/**
 * Money moving against an order. `advance` is received, `refund` is given back, `applied` is used up against a bill (the bill
 * carries the matching 'advance' payment line). Posted once, never edited.
 */
export interface OrderPayment {
  id: string
  orderId: string
  customerId: string
  date: number
  kind: OrderPayKind
  amount: number
  mode: OrderPayMode
  ref: string
  note: string
  billId?: string
  userId: string
  branchId?: string
}

// ───────────────────────────── delivery challans ─────────────────────────────

export type ChallanStatus = 'packed' | 'dispatched' | 'delivered'

export interface ChallanLine { variantId?: string; name: string; sku: string; qty: number; unit?: string }

export interface Challan {
  id: string
  no: string
  date: number
  orderId?: string
  customerId: string | null
  partyName: string
  partyPhone: string
  address: string
  items: ChallanLine[]
  vehicle: string
  driver: string
  trackingNo: string
  status: ChallanStatus
  dispatchedAt?: number
  deliveredAt?: number
  /** Who received it / any proof note. */
  proof: string
  notes: string
  billId?: string
  createdBy: string
  branchId?: string
}

// ───────────────────────────── subscriptions & AMC ─────────────────────────────

export type Frequency = 'monthly' | 'quarterly' | 'yearly'
export type SubscriptionKind = 'subscription' | 'amc'
export type SubPayMode = 'cash' | 'upi' | 'card' | 'due'

export interface Subscription {
  id: string
  no: string
  kind: SubscriptionKind
  customerId: string
  items: DocLine[]
  frequency: Frequency
  startDate: number
  /** The next invoice date. */
  nextDate: number
  endDate?: number
  active: boolean
  /** How the generated invoices are settled ('due' = on account, when the credit module is present). */
  payMode: SubPayMode
  billCount: number
  lastBillId?: string
  /** AMC: what is covered. */
  coverage: string
  notes: string
  createdBy: string
  branchId?: string
}

// ───────────────────────────── commissions & targets ─────────────────────────────

export interface CommissionSlab {
  /** Applies once the person has reached this % of their target. */
  minAchievementPct: number
  rate: number
}

export interface CommissionRule {
  id: string
  name: string
  /** A staff user id, or '' for everyone. */
  staffId: string
  scope: 'all' | 'category' | 'item'
  categoryId?: string
  productId?: string
  /** `pct`: % of the sale value (GST excluded). `per_piece`: a fixed rupee amount per piece. */
  basis: 'pct' | 'per_piece'
  rate: number
  /** Higher rates for beating the target (only for `pct`); the highest slab reached wins. */
  slabs?: CommissionSlab[]
  active: boolean
}

export interface SalesTarget {
  id: string
  staffId: string
  /** `YYYY-MM` */
  month: string
  amount: number
}

// ───────────────────────────── shifts & cash movements ─────────────────────────────

export interface Shift {
  id: string
  no: string
  userId: string
  openedAt: number
  openingCash: number
  closedAt?: number
  countedCash?: number
  expectedCash?: number
  variance?: number
  status: 'open' | 'closed'
  note: string
  branchId?: string
}

/** Cash put in or taken out of the drawer outside a sale (float top-up, bank deposit, petty payment). Posted once. */
export interface CashMove {
  id: string
  shiftId: string
  date: number
  kind: 'in' | 'out'
  amount: number
  reason: string
  note: string
  userId: string
  branchId?: string
}

declare module '@/data/state' {
  interface CollMap {
    quotations: Quotation
    salesOrders: SalesOrder
    orderPayments: OrderPayment
    challans: Challan
    subscriptions: Subscription
    commissionRules: CommissionRule
    salesTargets: SalesTarget
    shifts: Shift
    cashMoves: CashMove
  }
}
