/**
 * Restaurant: tables, running orders (the tab until it is settled into a bill), KOTs sent to the kitchen, modifiers, tips.
 * Grocery: pack → loose selling rules, home-delivery orders. See docs/MODULES.md.
 */

// ───────────────────────────── restaurant: tables ─────────────────────────────

/** A table is just a name and a seat count — whether it is free, seated or waiting to be billed is worked out from the
 *  orders that touch it (`logic/tables.ts`), never stored here, so two phones can never disagree about it. */
export interface FoodTable {
  id: string
  no: string
  name: string
  zone: string
  seats: number
  active: boolean
  branchId?: string
}

// ───────────────────────────── restaurant: modifiers ─────────────────────────────

export interface ModifierOption { id: string; name: string; priceDelta: number }

/** A set of add-ons/choices offered on an order line ("Spice level", "Extra cheese"). `min`/`max` picks allowed; both 0
 *  means optional with no limit. `categoryIds` narrows it to those item categories; empty applies to everything. */
export interface FoodModifierGroup {
  id: string
  name: string
  min: number
  max: number
  categoryIds: string[]
  options: ModifierOption[]
  active: boolean
}

/** A modifier chosen on one order line, with its price kept at the moment it was picked. */
export interface FoodModifierPick { groupId: string; groupName: string; optionId: string; name: string; priceDelta: number }

// ───────────────────────────── restaurant: the running order ─────────────────────────────

export type FoodOrderKind = 'dine_in' | 'takeaway' | 'delivery'
export type FoodOrderStatus = 'open' | 'billed' | 'cancelled'
export type FoodLineStatus = 'new' | 'sent' | 'ready' | 'served'
/** A coarse progress for takeaway / delivery orders (dine-in tracks progress per line instead). */
export type FoodOrderStage = 'placed' | 'preparing' | 'ready' | 'out_for_delivery' | 'completed'

export interface FoodOrderLine {
  id: string
  variantId: string
  name: string
  qty: number
  /** Base price of the item, before modifiers. */
  price: number
  /** Where it goes on the ticket ("Starters", "Mains"…) — printed as the KOT's heading. */
  course: string
  /** Which kitchen prints it ("Kitchen", "Bar", "Tandoor"…). */
  station: string
  modifiers: FoodModifierPick[]
  notes: string
  status: FoodLineStatus
  voided?: boolean
  voidReason?: string
}

/** The running tab for a table (or several, once merged), a takeaway counter order, or a delivery — until it is settled
 *  into a normal `bills` document. Nothing here duplicates billing: totals, tax and payment happen at checkout. */
export interface FoodOrder {
  id: string
  /** FO-0001 */
  no: string
  kind: FoodOrderKind
  /** Dine-in: the table(s) this order is seated at (more than one once tables are merged). Empty for takeaway/delivery. */
  tableIds: string[]
  status: FoodOrderStatus
  /** The floor asked for the bill — a table shows as "billing" once this is set. */
  requestedBill: boolean
  stage?: FoodOrderStage
  lines: FoodOrderLine[]
  customerId?: string | null
  partyName: string
  partyPhone: string
  deliveryAddress: string
  notes: string
  openedAt: number
  openedBy: string
  billedAt?: number
  billId?: string
  cancelledAt?: number
  cancelReason?: string
  /** Set on the pieces created by splitting a bill by item; the parent is cancelled once every piece is settled. */
  parentOrderId?: string
  branchId?: string
}

// ───────────────────────────── restaurant: KOT ─────────────────────────────

export interface FoodKotLine { lineId: string; name: string; qty: number; modifiers: string; notes: string }

/** A printed kitchen order ticket: one per station, for the lines sent to the kitchen at that moment. Posted once. */
export interface FoodKot {
  id: string
  /** KOT-0001 */
  no: string
  orderId: string
  tableLabel: string
  kind: FoodOrderKind
  station: string
  lines: FoodKotLine[]
  createdAt: number
  createdBy: string
  branchId?: string
}

// ───────────────────────────── restaurant: tips ─────────────────────────────

export type TipMode = 'cash' | 'upi' | 'card'

/** Money collected as a tip — kept separate from the sale (it is owed to staff, not revenue). Posted once. */
export interface FoodTip {
  id: string
  billId?: string
  orderId?: string
  amount: number
  mode: TipMode
  waiterId?: string
  note: string
  date: number
  userId: string
  branchId?: string
}

// ───────────────────────────── grocery: pack → loose ─────────────────────────────

/** How a packed item may be broken open and sold loose, e.g. a 1 kg bag sold in 250 g portions. The id is the packed
 *  variant's id. Price and stock are never duplicated: a loose sale prices and deducts a fraction of this same variant. */
export interface FoodLooseRule {
  id: string
  packSizeG: number
  unitLabel: 'g' | 'ml'
  /** Smallest amount that may be sold loose. */
  minG: number
  active: boolean
}

// ───────────────────────────── grocery: home delivery ─────────────────────────────

export type DeliveryStatus = 'placed' | 'out' | 'delivered' | 'cancelled'

export interface DeliveryLine { variantId: string; name: string; qty: number; price: number }

/** A home-delivery order: address and a simple status, until it becomes a normal bill on delivery. */
export interface FoodDelivery {
  id: string
  /** DL-0001 */
  no: string
  customerId?: string | null
  partyName: string
  partyPhone: string
  address: string
  lines: DeliveryLine[]
  deliveryCharge: number
  status: DeliveryStatus
  placedAt: number
  outAt?: number
  deliveredAt?: number
  cancelledAt?: number
  cancelReason?: string
  billId?: string
  notes: string
  userId: string
  branchId?: string
}

declare module '@/data/state' {
  interface CollMap {
    foodTables: FoodTable
    foodModifierGroups: FoodModifierGroup
    foodOrders: FoodOrder
    foodKots: FoodKot
    foodTips: FoodTip
    foodLooseRules: FoodLooseRule
    foodDeliveries: FoodDelivery
  }
}
