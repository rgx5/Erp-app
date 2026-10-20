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
}

declare module '@/data/state' {
  interface CollMap {
    purchaseOrders: PurchaseOrder
  }
}
