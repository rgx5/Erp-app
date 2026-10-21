/**
 * Manufacturing: recipes (bill of materials), work orders, what was issued and produced, quality checks, and job work.
 *
 *   recipes             master   what it takes to make one batch of an item (multi-level: a line may itself have a recipe)
 *   workOrders          master   a plan to make some quantity: planned → in progress → done (or cancelled)
 *   productionEntries   ledger   the facts of a work order: material issued / returned, finished goods received, the close
 *   qualityChecks       ledger   an inspection against the recipe's checklist: pass / fail, rejects scrapped or reworked
 *   jobOrders           master   a customer's order: made to order, or job work on the customer's own material
 */

/** One ingredient / part of a recipe. */
export interface RecipeLine {
  variantId: string
  /** How much one batch needs, in `unit` (without wastage). */
  qty: number
  /** The unit `qty` is counted in. Missing = the item's own unit. It must be convertible to it (g ↔ kg, ml ↔ l, pc ↔ dozen). */
  unit?: string
  /** Extra that is lost in making (cutting, evaporation, spillage), as a % of `qty`. The order asks for qty × (1 + wastage). */
  wastagePct: number
  /** The customer brings this material (job work): never taken off our stock and not in our cost. */
  customerSupplied?: boolean
  /** Cost this line at the item's stock cost even when the item has a recipe of its own (buy it, do not make it). */
  buy?: boolean
  note?: string
}

/** One thing to look at when inspecting the finished goods. */
export interface CheckItem {
  id: string
  label: string
  /** Failing a critical point rejects the whole lot inspected. */
  critical?: boolean
}

export interface Recipe {
  id: string
  /** Short code, e.g. R-001. */
  code: string
  name: string
  /** The item this makes (a finished good or a semi-finished part). */
  outputVariantId: string
  /** One batch makes this many (in the output's own unit). */
  outputQty: number
  /** Of what the batch is meant to make, the % that comes out good (100 = nothing is lost in making). */
  yieldPct: number
  lines: RecipeLine[]
  /** Wages for one batch, absorbed into the cost of what is made. */
  labourPerBatch: number
  /** Power, rent, consumables… for one batch, absorbed into the cost of what is made. */
  overheadPerBatch: number
  checklist: CheckItem[]
  active: boolean
  notes: string
  createdAt: number
  updatedAt: number
}

/** A line of a work order: the recipe's line scaled to the quantity, frozen when the order was planned. */
export interface WoLine {
  variantId: string
  /** Needed without wastage, in the item's own unit. */
  baseQty: number
  /** What to issue: baseQty plus wastage. */
  qty: number
  wastagePct: number
  /** Cost of one unit when planned / started. */
  unitCost: number
  customerSupplied?: boolean
}

export type WoStatus = 'planned' | 'in_progress' | 'done' | 'cancelled'

export interface WorkOrder {
  id: string
  no: string
  recipeId: string
  /** Frozen so renaming or editing the recipe later does not change a running order. */
  recipeName: string
  outputVariantId: string
  /** Good units wanted. */
  qty: number
  status: WoStatus
  lines: WoLine[]
  checklist: CheckItem[]
  /** Standard cost of one good unit: material (at the cost when started), labour and overheads. */
  stdMaterialPerUnit: number
  labourPerUnit: number
  overheadPerUnit: number
  /** Job work: the output belongs to the customer, so it is not added to stock and its cost goes to the cost of the job. */
  jobWork?: boolean
  jobOrderId?: string
  /** A part this order was planned for (a shortfall of a semi-finished item). */
  parentId?: string
  dueDate?: number
  notes: string
  createdAt: number
  startedAt?: number
  doneAt?: number
  userId: string
  branchId?: string
}

export type EntryKind = 'issue' | 'return' | 'receipt' | 'close'

export interface MaterialMove {
  variantId: string
  qty: number
  /** Cost of one unit at the time. */
  cost: number
  /** Customer's material: tracked but not our stock. */
  supplied?: boolean
}

/**
 * A posted fact of a work order. Nothing is edited; a mistake is put right by a new entry (return what was over-issued).
 *   issue    materials leave the shelf into work in progress           (lines, value)
 *   return   unused materials go back on the shelf                     (lines, value)
 *   receipt  finished goods received; scrap written off                (goodQty, scrapQty, materialValue, scrapValue, labour, overhead)
 *   close    what was issued but not accounted for by the output → variance (varianceValue; negative = used less than standard)
 */
export interface ProductionEntry {
  id: string
  no: string
  workOrderId: string
  kind: EntryKind
  date: number
  lines: MaterialMove[]
  /** issue / return: total cost of the lines. */
  value: number
  goodQty: number
  scrapQty: number
  /** receipt: standard material cost of the good units (moves from work in progress into stock, or into the job's cost). */
  materialValue: number
  /** receipt: standard material cost of the scrapped units (a loss). */
  scrapValue: number
  labour: number
  overhead: number
  /** receipt: what labour / overhead should have been at standard (for the variance report). */
  labourStd: number
  overheadStd: number
  varianceValue: number
  /** The output is not stock (job work): the cost goes to the cost of goods instead of inventory. */
  toExpense?: boolean
  note: string
  userId: string
  branchId?: string
}

export interface QcResult { itemId: string; label: string; pass: boolean; note?: string }
export type RejectAction = 'scrap' | 'rework'

export interface QualityCheck {
  id: string
  no: string
  workOrderId: string
  date: number
  /** Re-inspection of units that were sent back for rework. */
  recheck?: boolean
  results: QcResult[]
  qtyChecked: number
  qtyPassed: number
  qtyRejected: number
  rejectAction?: RejectAction
  notes: string
  userId: string
  branchId?: string
}

export type JobKind = 'made_to_order' | 'job_work'
export type JobStatus = 'received' | 'in_production' | 'ready' | 'delivered' | 'cancelled'

export interface JobStage { name: string; doneAt?: number }
export interface Measurement { label: string; value: string }

/** Material a customer hands over for job work. */
export interface CustomerMaterial {
  id: string
  description: string
  unit: string
  received: number
  used: number
  returned: number
}

export interface JobOrder {
  id: string
  no: string
  kind: JobKind
  customerId: string
  title: string
  qty: number
  /** What the customer is to be charged (billed at the counter as usual; this is the quote). */
  charge: number
  dueDate?: number
  measurements: Measurement[]
  stages: JobStage[]
  materials: CustomerMaterial[]
  recipeId?: string
  workOrderId?: string
  /** The customer's sales order this job fulfils (by id; sales documents are another module). */
  salesOrderId?: string
  billId?: string
  status: JobStatus
  notes: string
  createdAt: number
  deliveredAt?: number
  createdBy: string
  branchId?: string
}

declare module '@/data/state' {
  interface CollMap {
    recipes: Recipe
    workOrders: WorkOrder
    productionEntries: ProductionEntry
    qualityChecks: QualityCheck
    jobOrders: JobOrder
  }
}
