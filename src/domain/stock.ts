import type { Bill, Customer, Purchase, StockMove, Supplier, StoreSettings } from './types'
import type { VariantView } from './views'
import { round2 } from './money'
import { round3 } from './qty'
import { costFor } from './pricing'
import { isThisMonth } from './dates'

export type StockFilter = '' | 'low' | 'out' | 'nosale'
export const SALE_WINDOW_DAYS = 60

export type StockLevel = 'out' | 'low' | 'ok' | 'na'

/** Services and other untracked items have no stock level at all. */
export function stockLevel(v: Pick<VariantView, 'stock' | 'reorderLevel' | 'trackStock'>): StockLevel {
  if (!v.trackStock) return 'na'
  if (v.stock <= 0) return 'out'
  if (v.stock <= v.reorderLevel) return 'low'
  return 'ok'
}

export function filterStock(variants: VariantView[], needle: string, filter: StockFilter, soldRecently: Set<string>): VariantView[] {
  const n = needle.trim().toLowerCase()
  return variants
    .filter((v) => {
      if (!v.trackStock || !v.active) return false
      if (n && !(v.productName.toLowerCase().includes(n) || v.sku.toLowerCase().includes(n) || v.barcode.includes(n)
        || v.color.toLowerCase().includes(n) || v.size.toLowerCase() === n)) return false
      if (filter === 'low') return v.stock > 0 && v.stock <= v.reorderLevel
      if (filter === 'out') return v.stock <= 0
      if (filter === 'nosale') return v.stock > 0 && !soldRecently.has(v.id)
      return true
    })
    .sort((a, b) => a.stock - b.stock || a.productName.localeCompare(b.productName))
}

/** Variants that sold within the window — looked up from the full movement history. */
export function recentlySold(moves: StockMove[], now = Date.now(), days = SALE_WINDOW_DAYS): Set<string> {
  const cutoff = now - days * 86_400_000
  const set = new Set<string>()
  for (const m of moves) if (m.type === 'sale' && m.at >= cutoff) set.add(m.variantId)
  return set
}

export function stockValue(variants: Array<Pick<VariantView, 'stock' | 'cost' | 'avgCost' | 'trackStock'>>, basis?: StoreSettings['costBasis']) {
  return round2(variants.reduce((s, v) => s + (v.trackStock ? Math.max(0, v.stock) * costFor(v, basis) : 0), 0))
}
export const stockUnits = (variants: Array<Pick<VariantView, 'stock' | 'trackStock'>>) =>
  round3(variants.reduce((s, v) => s + (v.trackStock ? v.stock : 0), 0))

/** The suggested reorder quantity brings a variant back up to twice its reorder level. */
export const suggestReorder = (v: Pick<VariantView, 'reorderLevel' | 'stock'>) => Math.max(1, v.reorderLevel * 2 - v.stock)

export const needsRestock = (variants: VariantView[]) =>
  variants.filter((v) => v.trackStock && v.active && v.stock <= v.reorderLevel)

// ───────────────────────────── Physical count ─────────────────────────────

export interface CountRow { variant: VariantView; physical: number; variance: number }

export function countSheet(order: string[], counted: Record<string, number>, byId: Map<string, VariantView>): CountRow[] {
  return order
    .map((vid) => ({ variant: byId.get(vid), physical: counted[vid] ?? 0 }))
    .filter((r): r is { variant: VariantView; physical: number } => !!r.variant)
    .map((r) => ({ ...r, variance: round3(r.physical - r.variant.stock) }))
    // Differences first — they are what needs a decision.
    .sort((a, b) => Number(b.variance !== 0) - Number(a.variance !== 0))
}

/** A count far below the system figure usually means "not every piece was scanned", not a real loss. */
export const suspiciousCounts = (rows: CountRow[]) =>
  rows.filter((r) => r.variant.stock >= 3 && r.variant.stock - r.physical >= 3 && r.physical < r.variant.stock * 0.5)

// ───────────────────────────── Parties ─────────────────────────────

/** What is still owed to a supplier: what they were owed when the books started + every receipt − what was paid. */
export function supplierOwed(s: Supplier, purchases: Purchase[]): number {
  return round2(s.openingBalance + purchases.filter((p) => p.supplierId === s.id).reduce((t, p) => t + (p.total - p.paid), 0))
}
export const purchaseDue = (p: Pick<Purchase, 'total' | 'paid'>) => round2(p.total - p.paid)

export interface CustomerStats { bills: number; spent: number; last: number | null; avg: number }

export function customerStats(customerId: string, bills: Bill[]): CustomerStats {
  let n = 0, spent = 0, last: number | null = null
  for (const b of bills) {
    if (b.customerId !== customerId || b.status === 'held') continue
    spent += b.total
    if (b.total > 0) { n++; if (last === null || b.date > last) last = b.date }
  }
  return { bills: n, spent: round2(spent), last, avg: n ? round2(spent / n) : 0 }
}

export type CustomerView = '' | 'birthday' | 'credit' | 'points'

export function filterCustomers(customers: Customer[], needle: string, view: CustomerView, now = Date.now()): Customer[] {
  const n = needle.trim().toLowerCase()
  return customers
    .filter((c) => {
      if (n && !(c.phone.includes(n) || c.name.toLowerCase().includes(n) || c.email.toLowerCase().includes(n))) return false
      if (view === 'birthday') return isThisMonth(c.dob, now) || isThisMonth(c.anniversary, now)
      if (view === 'credit') return c.storeCredit > 0
      if (view === 'points') return c.loyaltyPoints > 0
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
