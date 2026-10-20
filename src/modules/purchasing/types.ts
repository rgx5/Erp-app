export type PoStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled'

export interface PoLine {
  variantId: string
  qty: number
  cost: number
  /** How much of this line has arrived (kept up to date by goods receipts that reference the order). */
  receivedQty: number
}

/** A purchase order: what was asked of a supplier, and how much of it has arrived. */
export interface PurchaseOrder {
  id: string
  no: string
  supplierId: string
  date: number
  expectedDate?: number
  status: PoStatus
  items: PoLine[]
  total: number
  notes: string
  createdBy: string
  branchId?: string
  /** Kept by the server from the approval documents (clients cannot set these). The decision holds for `approvedAmount` only. */
  approvalStatus?: 'approved' | 'rejected'
  approvedAmount?: number
  approvedBy?: string
  approvedAt?: number
}

// ───────────────────────────── approvals and settings ─────────────────────────────

/** Someone with the authority approved (or turned down) a purchase order at a given amount. Posted once. */
export interface PoApproval {
  id: string
  orderId: string
  /** The order's number, for reading the log. */
  orderNo: string
  decision: 'approved' | 'rejected'
  /** The order total this decision is about; editing the order afterwards makes it stale. */
  amount: number
  /** The deciding person's role at the time. */
  role: string
  userId: string
  note: string
  date: number
  branchId?: string
}

/** The shop's rules for this module (one document, id 'purchasing'). */
export interface PurchaseSettings {
  id: 'purchasing'
  approvalsOn: boolean
  /** Orders up to this amount never need approval. */
  approvalAbove: number
  /** The most each role may approve (or send without approval). The owner has no limit; a role not listed cannot approve. */
  limits: Record<string, number>
  /** Days to pay a supplier who has no terms of their own. */
  defaultDays: number
  /** How many days ahead the Home screen warns about payments falling due. */
  remindDays: number
}

/** How long a supplier gives us to pay. One per supplier; the id is the supplier's id. */
export interface SupplierTerms {
  id: string
  supplierId: string
  creditDays: number
  notes: string
}

// ───────────────────────────── money going out ─────────────────────────────

export type PayMode = 'cash' | 'upi' | 'card' | 'bank' | 'cheque'

/** A key into the documents that make up what we owe a supplier: 'purchases:<id>', 'purchaseInvoices:<id>' or 'opening:<supplierId>'. */
export type PayableRef = string

/** Reversal marker: a document with `reverses` cancels the posted document it names (same shape, opposite effect). */
export interface Reverses { reverses?: string }

/** Money paid to a supplier against what we owe. Posted once; a mistake is cancelled by a reversal. */
export interface SupplierPayment extends Reverses {
  id: string
  /** SP-0001 */
  no: string
  supplierId: string
  amount: number
  mode: PayMode
  /** Cheque number, UTR, UPI reference… */
  ref: string
  date: number
  /** Which receipts / invoices it settles. The part not allocated stays as an advance with the supplier. */
  allocations: Array<{ ref: PayableRef; amount: number }>
  advance: number
  note: string
  userId: string
  branchId?: string
}

// ───────────────────────────── purchase invoices and GST ─────────────────────────────

/** Why GST input credit may not be taken (section 17(5) and the like). 'none' = no block. */
export type ItcBlock = 'none' | 'food' | 'vehicle' | 'personal' | 'gifts' | 'works' | 'club' | 'other'

export interface InvoiceLine {
  description: string
  hsn: string
  /** Value before tax. */
  taxable: number
  /** GST %, e.g. 5, 12, 18. */
  rate: number
  cgst: number
  sgst: number
  igst: number
}

/** What the tax on a purchase invoice means for input credit. Amounts are what may be claimed (zero when blocked). */
export interface ItcResult {
  eligible: boolean
  /** In words, when not eligible. */
  reason: string
  cgst: number
  sgst: number
  igst: number
}

/**
 * How the invoice relates to goods received: 'standalone' = nothing was received against it (a service, an expense): it becomes
 * what we owe in its own right. 'receipt-gross' = the receipt was entered at the invoice total (tax included): only the tax is
 * reclassified out of stock cost. 'receipt-net' = the receipt was entered before tax: the tax is added to what we owe.
 */
export type InvoiceBasis = 'standalone' | 'receipt-gross' | 'receipt-net'

/** A supplier's tax invoice, captured with its GST so input credit (ITC) can be claimed. Posted once; cancelled by a reversal. */
export interface PurchaseInvoice extends Reverses {
  id: string
  /** PI-0001 — our entry number. */
  no: string
  supplierId: string
  /** The number printed on the supplier's invoice. */
  invoiceNo: string
  invoiceDate: number
  dueDate?: number
  supplierGstin: string
  /** The tax is IGST (the supplier is in another state), not CGST + SGST. */
  interState: boolean
  kind: 'goods' | 'services'
  /** For services: the expense this is booked to ('Repairs', 'Rent'). */
  head: string
  /** The goods receipt this invoice is for. */
  purchaseId?: string
  basis: InvoiceBasis
  lines: InvoiceLine[]
  taxable: number
  cgst: number
  sgst: number
  igst: number
  roundOff: number
  total: number
  /** The part of the total that adds to what we owe in its own right: all of it (standalone), the tax only (receipt-net), or nothing. */
  payable: number
  blocked: ItcBlock
  itc: ItcResult
  note: string
  /** When it was entered. */
  date: number
  userId: string
  branchId?: string
}

// ───────────────────────────── returns and debit notes ─────────────────────────────

export type ReturnReason = 'damaged' | 'wrong' | 'excess' | 'quality' | 'other'

export interface ReturnLine {
  variantId: string
  qty: number
  /** Value of one unit at the receipt's cost, before tax. */
  cost: number
  /** GST % the supplier charged on it. */
  rate: number
}

/** Goods sent back to a supplier, and the debit note that cuts what we owe. Posted once; cancelled by a reversal. */
export interface PurchaseReturn extends Reverses {
  id: string
  /** DN-0001 */
  no: string
  supplierId: string
  /** The receipt (and/or supplier invoice) the goods came in on. */
  purchaseId?: string
  invoiceId?: string
  date: number
  reason: ReturnReason
  note: string
  items: ReturnLine[]
  taxable: number
  cgst: number
  sgst: number
  igst: number
  /** Taxable + tax: what the supplier credits us. */
  total: number
  /** The tax is taken back out of input credit (the original was claimed). Otherwise it comes out of stock cost. */
  itcReversed: boolean
  interState: boolean
  /** Money the supplier handed back at once (the rest cuts what we owe). */
  refund: number
  refundMode?: PayMode
  userId: string
  branchId?: string
}

// ───────────────────────────── landed cost ─────────────────────────────

export type ChargeKind = 'freight' | 'duty' | 'handling' | 'insurance' | 'other'

export interface Charge {
  kind: ChargeKind
  label: string
  /** Before GST. */
  amount: number
  /** GST charged on it (paid in the same bill). */
  gst: number
  /** Input credit can be taken on that GST; otherwise it becomes part of the cost. */
  itcEligible: boolean
}

export interface LandedLine {
  variantId: string
  /** Quantity on the receipt. */
  qty: number
  /** The share of the charges (and ineligible tax) that belongs to this line. */
  alloc: number
  /** The part for units still in stock: added to the stock value. */
  toStock: number
  /** The part for units already sold: goes to cost of goods sold. */
  toCogs: number
  /** Per-unit effect on the cost of the units in stock. */
  perUnit: number
  /** How much the item's latest cost went up (0 when a later receipt had already set a different cost). */
  latestUp: number
}

/** Freight, duty and handling spread over the items of one goods receipt, so each item's cost includes what it took to land it. */
export interface LandedCost extends Reverses {
  id: string
  /** LC-0001 */
  no: string
  purchaseId: string
  /** The supplier of the goods. */
  supplierId: string
  date: number
  charges: Charge[]
  basis: 'value' | 'qty'
  interState: boolean
  lines: LandedLine[]
  /** Charges + GST: what is paid for all of it. */
  total: number
  /** The GST on it that may be claimed. */
  itc: number
  /** Who bills us for it (a transporter or clearing agent kept as a supplier); otherwise it was paid straight away. */
  payeeId?: string
  mode?: PayMode
  note: string
  userId: string
  branchId?: string
}

// ───────────────────────────── price lists and quotes ─────────────────────────────

/** What a supplier charges for an item (before tax), from a quantity upward. */
export interface SupplierPrice {
  id: string
  supplierId: string
  variantId: string
  price: number
  /** The price holds from this quantity (quantity breaks are several rows). */
  minQty: number
  validFrom?: number
  validTo?: number
  leadDays?: number
  note: string
}

export type RfqStatus = 'open' | 'awarded' | 'closed'

/** A request for quotation: what we want, and which suppliers were asked. */
export interface Rfq {
  id: string
  /** RFQ-0001 */
  no: string
  title: string
  date: number
  closesOn?: number
  status: RfqStatus
  items: Array<{ variantId: string; qty: number }>
  supplierIds: string[]
  notes: string
  /** The purchase orders created when it was awarded. */
  poIds: string[]
  createdBy: string
  branchId?: string
}

/** One supplier's answer to a request. The id is `<rfq id>:<supplier id>`, so a quote is replaced, not duplicated. */
export interface RfqQuote {
  id: string
  rfqId: string
  supplierId: string
  prices: Record<string, number>
  freight: number
  leadDays?: number
  validTill?: number
  terms: string
  date: number
}

declare module '@/data/state' {
  interface CollMap {
    purchaseOrders: PurchaseOrder
    poApprovals: PoApproval
    purchaseSettings: PurchaseSettings
    supplierTerms: SupplierTerms
    supplierPayments: SupplierPayment
    purchaseInvoices: PurchaseInvoice
    purchaseReturns: PurchaseReturn
    landedCosts: LandedCost
    supplierPrices: SupplierPrice
    rfqs: Rfq
    rfqQuotes: RfqQuote
  }
}

declare module '@/domain/types' {
  interface Supplier {
    /**
     * What payments, debit notes, purchase invoices and landed-cost bills have done to what we owe, on top of the receipts
     * (negative = we owe less). Kept by the server and by the phone from the same effects; owed in all =
     * `supplierOwed(supplier, purchases) + payableAdjust`.
     */
    payableAdjust?: number
  }
}
