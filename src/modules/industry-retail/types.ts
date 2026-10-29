/**
 * The industry-specific depth of `industry-retail` (see docs/FEATURES.md §9): pieces that only pharmacy, electronics,
 * apparel or hardware shops need, and that no other module already covers.
 *
 *   • pharmacy    — Schedule H flag on an item, a prescription record (patient, doctor, photo), generic substitutes.
 *                   Batch / expiry is `warehouse`'s (see its `Batch`); this module only reads it.
 *   • electronics — trade-in (part-exchange) records; an EMI plan is informational, carried on `bill.ext` (no type here).
 *                   Warranty *claims* are `crm`'s `Ticket` (`kind: 'warranty'`) — not duplicated here.
 *   • apparel     — the size-grid helper is a UI layer over `@/data/ops` (`createItem` / `adjustStock`) — no new type.
 *                   Alteration jobs are new. Markdown / clearance pricing is `pricing`'s `Markdown` promotion — not duplicated.
 *   • hardware    — the BOQ (bill of quantities) is new. Contractor credit is `credit`'s `CustomerTerms` — not duplicated.
 */

// ───────────────────────────── pharmacy ─────────────────────────────

/** Whether an item is a Schedule H / H1 medicine that may not be sold without a prescription. One per product. */
export interface RxFlag {
  /** = the product id. */
  id: string
  scheduleH: boolean
  note: string
}

/** A prescription kept against a sale: who it is for, who wrote it, and a photo of the slip. */
export interface Prescription {
  id: string
  /** RX-0001 */
  no: string
  date: number
  patientName: string
  patientPhone: string
  doctorName: string
  doctorRegNo: string
  /** A photo of the prescription slip (local file uri from the pharmacy's own picker). */
  photo?: string
  /** What it was written for, as typed at the counter — a snapshot, not a link to the catalogue. */
  itemNames: string[]
  /** The bill number it was billed against, typed by hand; resolved to `billId` when that bill exists. */
  billNo: string
  billId?: string
  notes: string
  createdBy: string
  branchId?: string
}

/** A branded item's generic / substitute items (both ways round: either item's group lists the other). One per branded item. */
export interface SubstituteGroup {
  /** = the branded product id. */
  id: string
  subs: string[]
}

// ───────────────────────────── electronics ─────────────────────────────

export type TradeInCondition = 'working' | 'minor_damage' | 'not_working'

/** An old device taken in part-exchange: it reduced the bill by `value` and is recorded here. Posted once, with the bill. */
export interface TradeIn {
  id: string
  /** TI-0001 */
  no: string
  date: number
  billId: string
  customerId?: string | null
  device: string
  condition: TradeInCondition
  value: number
  notes: string
  userId: string
  branchId?: string
}

// ───────────────────────────── apparel ─────────────────────────────

export type AlterationStatus = 'received' | 'in_progress' | 'ready' | 'delivered' | 'cancelled'

/** A simple alteration / tailoring job: what, for whom, by when, and — once billed — what it became on a bill. */
export interface AlterationJob {
  id: string
  /** ALT-0001 */
  no: string
  date: number
  customerId?: string | null
  partyName: string
  partyPhone: string
  itemDesc: string
  notes: string
  dueDate: number
  status: AlterationStatus
  /** What the alteration costs; sold at the counter as its own line when the job is billed. */
  charge: number
  /** The bill it was charged on, typed by hand; resolved to `billId` when that bill exists. */
  billNo: string
  billId?: string
  userId: string
  branchId?: string
}

// ───────────────────────────── hardware ─────────────────────────────

export type BoqStatus = 'draft' | 'sent' | 'converted' | 'closed'

export interface BoqLine {
  variantId?: string
  name: string
  sku: string
  qty: number
  unit: string
  note: string
}

/**
 * A bill of quantities for a project or quote: what materials, how much. It stays a quantities list — turning it into a
 * sales order (to the contractor) or a purchase order (to a supplier) is still done in Sales / Purchasing using these
 * quantities; `convertedRef` just records which document it became, by hand, once that is done.
 */
export interface Boq {
  id: string
  /** BOQ-0001 */
  no: string
  date: number
  projectName: string
  customerId?: string | null
  partyName: string
  partyPhone: string
  items: BoqLine[]
  notes: string
  status: BoqStatus
  convertedRef: string
  convertedAt?: number
  createdBy: string
  branchId?: string
}

declare module '@/data/state' {
  interface CollMap {
    rxFlags: RxFlag
    prescriptions: Prescription
    substituteGroups: SubstituteGroup
    tradeIns: TradeIn
    alterationJobs: AlterationJob
    boqs: Boq
  }
}
