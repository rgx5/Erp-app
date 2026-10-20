import type { ScaleLayout } from '@/domain/scale'

/** The three customer tiers a price list can stand for. */
export type Tier = 'retail' | 'wholesale' | 'dealer'
export const TIER_LABEL: Record<Tier, string> = { retail: 'Retail', wholesale: 'Wholesale', dealer: 'Dealer' }

/** What a list's percentage is worked on: the item's selling price, its MRP, or what it cost. */
export type PriceBasis = 'price' | 'mrp' | 'cost'

/**
 * A price list: a customer on it pays the list's price for an item. An item with its own entry (`PriceListItem`) costs that;
 * any other item is priced by the list's rule — its `basis` plus `pct` (−10 = 10% under, +15 = 15% over), rounded to `roundTo`.
 * Prices are in the same terms as the shop's selling prices (tax-inclusive when the shop sells tax-inclusive).
 */
export interface PriceList {
  id: string
  name: string
  tier: Tier
  basis: PriceBasis
  pct: number
  /** Round the rule's price to the nearest multiple of this (0 = to the paisa, 1 = whole rupee, 5 = nearest ₹5). */
  roundTo: number
  active: boolean
  notes?: string
}

/** One item's own price on one list. The id is `${listId}:${variantId}` so a price is found without searching. */
export interface PriceListItem {
  id: string
  listId: string
  variantId: string
  price: number
}
export const priceListItemId = (listId: string, variantId: string) => `${listId}:${variantId}`

export type BreakTarget = 'variant' | 'product' | 'category' | 'all'
export interface QtyBreak {
  /** From this quantity (counted across everything the rule covers) the break applies. */
  minQty: number
  /** `pct`: that percentage off the unit price. `price`: that is the unit price. */
  kind: 'pct' | 'price'
  value: number
}
/** Quantity breaks: the more you buy, the less each costs. Pure ladder per rule; the highest step reached applies. */
export interface QtyBreakRule {
  id: string
  name: string
  target: BreakTarget
  /** The variant / product / category id (empty for `all`). */
  targetId: string
  /** Only for customers on this price list; empty = everyone. */
  listId: string
  breaks: QtyBreak[]
  active: boolean
}

export type PromoKind = 'buy_x_get_y' | 'bundle' | 'category_sale' | 'happy_hour'
export const PROMO_LABEL: Record<PromoKind, string> = { buy_x_get_y: 'Buy X get Y', bundle: 'Bundle price', category_sale: 'Category sale', happy_hour: 'Happy hour' }

/** Which items a promotion covers. `all` = everything. Otherwise an item qualifies through any of its variant, product or category. */
export interface PromoScope {
  all?: boolean
  categoryIds?: string[]
  productIds?: string[]
  variantIds?: string[]
}

interface PromoBase {
  id: string
  name: string
  active: boolean
  /** Lower runs first and gets first pick of the items. */
  priority: number
  /** First and last moment it runs (epoch ms); empty = no limit. */
  validFrom?: number
  validTo?: number
  /** Days of the week it runs, 0 = Sunday … 6 = Saturday; empty = every day. */
  days?: number[]
  /** Time of day it runs, "HH:MM" (24 h); a window past midnight (22:00–02:00) works. Empty = all day. */
  startTime?: string
  endTime?: string
  /** Wholesale and dealer prices are already low: leave them out. */
  retailOnly?: boolean
}

/** Buy `buyQty`, get `getQty` more at `getPct`% off (100 = free). The cheapest items in each group are the ones discounted. */
export interface BuyXGetY extends PromoBase {
  kind: 'buy_x_get_y'
  scope: PromoScope
  buyQty: number
  getQty: number
  getPct: number
  /** The free items must be the same item as the bought ones (otherwise any covered items mix and match). */
  sameItem?: boolean
}
/** A set of items sold together for one price. */
export interface Bundle extends PromoBase {
  kind: 'bundle'
  items: Array<{ variantId: string; qty: number }>
  price: number
}
/** A markdown on the covered items: a category sale, or a happy hour (a markdown with a time window). */
export interface Markdown extends PromoBase {
  kind: 'category_sale' | 'happy_hour'
  scope: PromoScope
  off: { type: 'pct' | 'amt'; value: number }
}
export type Promotion = BuyXGetY | Bundle | Markdown

/** The shop's pricing settings: one document, id `settings`. */
export interface PricingSettings {
  id: 'settings'
  /** How weighing-scale / price-embedded barcodes are laid out (off until the shop turns it on). */
  scale?: Partial<ScaleLayout>
  /** The list used for customers who have none of their own; empty = the shop's selling prices. */
  defaultListId?: string
  /** E-invoice and e-way bill: the registered name and the dispatch pincode (the shop's profile has no pincode). */
  legalName?: string
  sellerPin?: string
  sellerAddr2?: string
  /** Show the e-invoice and e-way bill screens' nudges on Home. */
  eInvoiceOn?: boolean
  /** Goods worth more than this need an e-way bill (₹50,000 by default; some states set their own limit for movement within the state). */
  ewbThreshold?: number
}

/** What the person at the counter or in the back office adds for the invoice details the bill itself does not carry. */
export interface PartyDetails {
  name?: string
  addr1?: string
  addr2?: string
  loc?: string
  pin?: string
}

/**
 * A bill's e-invoice record. The IRP (the government's Invoice Registration Portal) is the only thing that can issue an IRN
 * and its signed QR; this app prepares the JSON, and the person pastes the portal's answer back here (`registered`).
 */
export interface EInvoiceRecord {
  id: string
  billId: string
  billNo: string
  docType: 'INV' | 'CRN'
  status: 'prepared' | 'registered' | 'cancelled'
  /** Buyer details the bill does not carry (address, pincode) — the portal rejects an invoice without them. */
  buyer?: PartyDetails
  preparedAt: number
  irn?: string
  ackNo?: string
  /** "2026-10-19 10:30:00", as the portal prints it. */
  ackDate?: string
  signedQr?: string
  signedInvoice?: string
  registeredAt?: number
  cancelledAt?: number
  cancelReason?: string
  userId: string
  branchId?: string
}
export const eInvoiceId = (billId: string) => `ei_${billId}`

export interface Transport {
  mode: 'road' | 'rail' | 'air' | 'ship'
  /** Whole kilometres between the two pincodes. */
  distanceKm: number
  vehicleNo?: string
  vehicleType?: 'regular' | 'odc'
  transporterId?: string
  transporterName?: string
  transDocNo?: string
  /** Date of the transporter's document, `YYYY-MM-DD`. */
  transDocDate?: string
}

export interface EwayRecord {
  id: string
  billId: string
  billNo: string
  status: 'prepared' | 'generated' | 'cancelled'
  /** Where the goods go, if different from the buyer's address (ship-to), and the dispatch-from details. */
  shipTo?: PartyDetails
  transport: Transport
  preparedAt: number
  ewbNo?: string
  /** `YYYY-MM-DD` the portal printed as the last day the e-way bill is valid. */
  validUpto?: string
  generatedAt?: number
  cancelledAt?: number
  cancelReason?: string
  userId: string
  branchId?: string
}
export const ewayId = (billId: string) => `ew_${billId}`

declare module '@/data/state' {
  interface CollMap {
    priceLists: PriceList
    priceListItems: PriceListItem
    qtyBreakRules: QtyBreakRule
    promotions: Promotion
    pricingSettings: PricingSettings
    eInvoices: EInvoiceRecord
    ewayBills: EwayRecord
  }
}
