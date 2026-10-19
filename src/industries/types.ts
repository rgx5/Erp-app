import type { CategoryConfig, StoreSettings } from '@/domain/types'
import type { TaxSlab } from '@/domain/tax'

/** Lucide icon names the packs refer to (resolved in `src/ui/icons.ts`). */
export type PackIcon = 'shirt' | 'shopping-basket' | 'pill' | 'smartphone' | 'utensils' | 'scissors' | 'hammer' | 'store'

export interface PackCategory { id: string; name: string; group: string; config: CategoryConfig }

/** One sample item for the demo workspace. Prices are what the customer pays (tax included). */
export interface DemoItem {
  name: string
  cat: string
  brand?: string
  attr1?: string
  attr2?: string
  cost: number
  mrp: number
  price: number
  /** First option axis (sizes, pack sizes, portions…). */
  options?: string[]
  /** Second option axis (colours…). */
  options2?: string[]
  /** Selling price for each option, in order (a Full portion costs more than a Half). Cost and MRP scale by the same ratio. */
  optionPrice?: number[]
  /** Starting stock per variant (min, max). Omit for services and anything not counted. */
  stock?: [number, number]
  /** Relative chance of being in a basket. */
  weight?: number
  /** Override the category's unit / GST for this item. */
  unit?: string
  gst?: number
  hsn?: string
  /** Typical quantity per sale (kg of onions: 0.5–2). */
  qty?: [number, number]
}

export interface IndustryPack {
  id: string
  name: string
  tagline: string
  icon: PackIcon
  /** Card colour on the picker. */
  tint: string
  /** What this industry calls things — used across every screen. */
  labels: {
    item: string
    items: string
    customer: string
    customers: string
    /** The first / second option axis of an item ("Size" / "Colour"). */
    option1: string
    option2: string
    /** Extra attributes on an item (stored as brand-adjacent fields); null hides the field. */
    attr1: string | null
    attr2: string | null
    attr1Hint?: string
    attr2Hint?: string
    sale: string
    sales: string
    newSale: string
    staff: string
    /** What the price tag is called. */
    price: string
  }
  /** One-tap suggestions when listing an item's options (sizes, colours…). */
  optionSuggestions?: { option1?: string[]; option2?: string[] }
  tax: { slabs: TaxSlab[]; inclusive: boolean; hsnHint: string; defaultHsn: string }
  categories: PackCategory[]
  /** Order the category groups appear in. */
  groupOrder: string[]
  /** Starting settings for a new business of this kind. */
  settings: Partial<StoreSettings>
  expenseCategories: string[]
  stockReasons: string[]
  returnReasons: string[]
  /** What can be said about how this pack is meant to be used (shown on the picker). */
  highlights: string[]
  /** Limits worth knowing about before choosing it. */
  caveat?: string
  demo: {
    storeName: string
    city: string
    ownerName: string
    tagline: string
    items: DemoItem[]
    suppliers: Array<{ name: string; gstin?: string }>
    /** Bills per day (weekday, weekend) and the typical number of lines per bill. */
    billsPerDay: [number, number]
    lines: [number, number]
    /** Share of payments by mode. */
    payMix: { cash: number; upi: number; card: number }
    /** Hours the business trades. */
    hours: [number, number]
    expenses: Array<{ category: string; amount: [number, number]; every: number; vendor?: string; mode?: 'cash' | 'upi' | 'bank' | 'card' }>
  }
}
