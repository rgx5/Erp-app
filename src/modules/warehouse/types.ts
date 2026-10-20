/** The id of the location every stock movement without a `locationId` belongs to. */
export const MAIN = 'main'

export type LocationType = 'warehouse' | 'shelf' | 'counter'

export interface Location {
  id: string
  name: string
  type: LocationType
  parentId?: string
  /** The branch / outlet this location belongs to (multi-store); transfers between branches are transfers between locations. */
  branchId?: string
  active: boolean
  createdAt: number
}

/**
 * How much of a variant sits at a location **other than main**. Maintained by the server from stock movements that name a
 * location (`owned: qty`). Main is never stored: it is whatever the variant's total stock is minus everything elsewhere.
 */
export interface StockLevel {
  id: string
  variantId: string
  locationId: string
  qty: number
}

export interface TransferLine { variantId: string; qty: number }

/** Posted when stock is sent. What has arrived is posted separately as `TransferReceipt`s — so the transfer is never edited. */
export interface Transfer {
  id: string
  no: string
  fromId: string
  toId: string
  lines: TransferLine[]
  date: number
  userId: string
  notes: string
  branchId?: string
}

export interface TransferReceipt {
  id: string
  transferId: string
  lines: TransferLine[]
  date: number
  userId: string
  /** Close the transfer even though some stock did not arrive (it is lost in transit, not still on the way). */
  closed: boolean
  /** With `closed`: what never arrived, at cost. The books write it off (Dr stock adjustments, Cr inventory). */
  lossValue?: number
  notes: string
}

export interface BatchInit {
  variantId: string
  batchNo: string
  mfgDate?: number
  expiry?: number
  cost?: number
  locationId?: string
  receivedAt: number
  supplierId?: string
}

/** A lot of an item with its own expiry. `qty` is kept by the server from `batchMoves` (`owned`). */
export interface Batch extends BatchInit {
  id: string
  qty: number
}

export type BatchMoveReason = 'receipt' | 'sale' | 'return' | 'writeoff' | 'adjust' | 'opening'

/** Every change to a batch's quantity. `batch` carries the batch's details on the movement that first brings it in. */
export interface BatchMove {
  id: string
  batchId: string
  variantId: string
  qty: number
  reason: BatchMoveReason
  ref: string
  billId?: string
  /** The kit variant this movement was made for (selling a kit takes its components out of their batches). */
  viaKit?: string
  at: number
  userId: string
  batch?: BatchInit
}

/** What an operation asks for; the operation fills in the id, time and user. */
export interface BatchMoveInput {
  batchId: string
  variantId: string
  qty: number
  reason: BatchMoveReason
  ref: string
  billId?: string
  viaKit?: string
  batch?: BatchInit
}

export type SerialStatus = 'in_stock' | 'sold' | 'returned' | 'written_off'

export interface Serial {
  id: string
  variantId: string
  serial: string
  status: SerialStatus
  receivedAt?: number
  purchaseId?: string
  supplierId?: string
  locationId?: string
  billId?: string
  billNo?: string
  customerId?: string | null
  soldAt?: number
  warrantyMonths?: number
  warrantyUntil?: number
  history: Array<{ at: number; status: SerialStatus; ref: string }>
}

/** Per product: which things this product needs captured. */
export interface ItemRule {
  /** = the product id. */
  id: string
  trackSerial?: boolean
  trackBatch?: boolean
  warrantyMonths?: number
}

export interface UnitConversion {
  id: string
  productId: string
  /** The bigger unit: "box", "carton", "strip". */
  unit: string
  /** How many base units are in one of it. */
  factor: number
  /** What one of it sells for, if different from factor × the base price. */
  price?: number
}

export interface BundleComponent { variantId: string; qty: number }

/** A kit: selling its variant sells the components. */
export interface Bundle {
  id: string
  /** The variant that is sold as the kit (a no-stock item the module creates). */
  variantId: string
  name: string
  components: BundleComponent[]
  price: number
  active: boolean
  createdAt: number
}

export type WriteOffReason = 'damage' | 'expiry' | 'sample' | 'theft'

export interface WriteOffLine {
  variantId: string
  qty: number
  /** Cost of one unit when written off. */
  cost: number
  batchId?: string
  serial?: string
  locationId?: string
}

export interface WriteOff {
  id: string
  no: string
  date: number
  reason: WriteOffReason
  lines: WriteOffLine[]
  /** Value lost, at cost. */
  total: number
  notes: string
  userId: string
  branchId?: string
}

declare module '@/data/state' {
  interface CollMap {
    locations: Location
    itemRules: ItemRule
    unitConversions: UnitConversion
    bundles: Bundle
    batchMoves: BatchMove
    batches: Batch
    serials: Serial
    stockLevels: StockLevel
    transfers: Transfer
    transferReceipts: TransferReceipt
    writeOffs: WriteOff
  }
}
