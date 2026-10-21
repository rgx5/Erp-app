import { round2 } from '@/domain/money'
import { listOf, type DataState } from '@/data/state'
import type { Rfq, RfqQuote, SupplierPrice } from './types'

/**
 * Supplier price lists and quote comparison. A price list says what a supplier normally charges (with quantity breaks); an RFQ
 * asks several suppliers for a price on a shopping list and lines their answers up so the cheapest deal is easy to see.
 * Prices are before tax. Nothing here chooses for you: the comparison shows the cheapest supplier for the whole list, the cheapest
 * for each item, and what splitting the order saves.
 */

const inWindow = (p: Pick<SupplierPrice, 'validFrom' | 'validTo'>, at: number) => (!p.validFrom || p.validFrom <= at) && (!p.validTo || p.validTo >= at)

/** The price a supplier's list gives for a quantity on a date: the break with the highest minimum the quantity reaches. */
export function listPrice(prices: SupplierPrice[], supplierId: string, variantId: string, qty: number, at: number): SupplierPrice | null {
  const rows = prices.filter((p) => p.supplierId === supplierId && p.variantId === variantId && inWindow(p, at) && p.minQty <= qty)
  if (!rows.length) return null
  return rows.reduce((best, p) => (p.minQty > best.minQty || (p.minQty === best.minQty && p.price < best.price) ? p : best))
}

/** What we paid this supplier last time for the item (from their receipts), if ever. */
export function lastPaid(state: DataState, supplierId: string, variantId: string): { cost: number; date: number } | null {
  let best: { cost: number; date: number } | null = null
  for (const p of listOf(state.purchases)) {
    if (p.supplierId !== supplierId) continue
    const it = p.items.find((i) => i.variantId === variantId)
    if (it && it.cost > 0 && (!best || p.date > best.date)) best = { cost: it.cost, date: p.date }
  }
  return best
}

/** The cost to suggest on a purchase order line: the supplier's list price for the quantity, else what they charged last. */
export function suggestedCost(state: DataState, supplierId: string, variantId: string, qty: number, at: number): { cost: number; from: 'list' | 'last' } | null {
  const l = listPrice(listOf(state.supplierPrices), supplierId, variantId, qty, at)
  if (l) return { cost: l.price, from: 'list' }
  const p = lastPaid(state, supplierId, variantId)
  return p ? { cost: p.cost, from: 'last' } : null
}

export interface PriceOption { supplierId: string; price: number; leadDays?: number; source: 'list' | 'last' }

/** Every supplier that sells an item, cheapest first: by list price for the quantity, falling back on the last price paid. */
export function priceOptions(state: DataState, variantId: string, qty: number, at: number): PriceOption[] {
  const prices = listOf(state.supplierPrices)
  const out = new Map<string, PriceOption>()
  for (const s of listOf(state.suppliers)) {
    const l = listPrice(prices, s.id, variantId, qty, at)
    if (l) { out.set(s.id, { supplierId: s.id, price: l.price, leadDays: l.leadDays, source: 'list' }); continue }
    const p = lastPaid(state, s.id, variantId)
    if (p) out.set(s.id, { supplierId: s.id, price: p.cost, source: 'last' })
  }
  return [...out.values()].sort((a, b) => a.price - b.price)
}

// ───────────────────────────── comparing quotes ─────────────────────────────

export interface QuoteColumn {
  supplierId: string
  /** The unit price for each item they quoted. */
  prices: Record<string, number | undefined>
  /** What the items they quoted cost at the quantities wanted. */
  itemsTotal: number
  freight: number
  /** Items + freight: comparable only when `complete`. */
  total: number
  /** They priced every item on the list. */
  complete: boolean
  missing: number
  leadDays?: number
  validTill?: number
  terms: string
}

export interface Comparison {
  columns: QuoteColumn[]
  /** For each item, the supplier with the lowest quoted price (ties go to the first quote received). */
  cheapest: Record<string, string>
  /** The complete quote with the lowest total, if any supplier priced everything. */
  bestSingle: QuoteColumn | null
  /** What buying each item from its cheapest supplier would cost (freight of each supplier used is added). */
  split: { total: number; suppliers: string[]; lines: Array<{ variantId: string; supplierId: string; price: number; qty: number }> } | null
  /** `bestSingle.total − split.total`, when splitting is cheaper. */
  splitSaves: number
}

export function compareQuotes(rfq: Pick<Rfq, 'items'>, quotes: RfqQuote[]): Comparison {
  const ordered = [...quotes].sort((a, b) => a.date - b.date)
  const columns: QuoteColumn[] = ordered.map((q) => {
    let itemsTotal = 0, missing = 0
    const prices: Record<string, number | undefined> = {}
    for (const it of rfq.items) {
      const p = q.prices[it.variantId]
      if (typeof p === 'number' && p > 0) { prices[it.variantId] = p; itemsTotal += p * it.qty } else { prices[it.variantId] = undefined; missing++ }
    }
    itemsTotal = round2(itemsTotal)
    return { supplierId: q.supplierId, prices, itemsTotal, freight: q.freight || 0, total: round2(itemsTotal + (q.freight || 0)), complete: missing === 0 && rfq.items.length > 0, missing, leadDays: q.leadDays, validTill: q.validTill, terms: q.terms }
  })
  const cheapest: Record<string, string> = {}
  for (const it of rfq.items) {
    let best: { s: string; p: number } | null = null
    for (const c of columns) {
      const p = c.prices[it.variantId]
      if (p !== undefined && (!best || p < best.p)) best = { s: c.supplierId, p }
    }
    if (best) cheapest[it.variantId] = best.s
  }
  const complete = columns.filter((c) => c.complete)
  const bestSingle = complete.length ? complete.reduce((b, c) => (c.total < b.total ? c : b)) : null
  const covered = rfq.items.every((it) => cheapest[it.variantId])
  let split: Comparison['split'] = null
  if (covered && rfq.items.length) {
    const lines = rfq.items.map((it) => ({ variantId: it.variantId, supplierId: cheapest[it.variantId], price: columns.find((c) => c.supplierId === cheapest[it.variantId])!.prices[it.variantId] as number, qty: it.qty }))
    const used = [...new Set(lines.map((l) => l.supplierId))]
    const total = round2(lines.reduce((s, l) => s + l.price * l.qty, 0) + used.reduce((s, id) => s + (columns.find((c) => c.supplierId === id)?.freight ?? 0), 0))
    split = { total, suppliers: used, lines }
  }
  const splitSaves = bestSingle && split && split.suppliers.length > 1 ? Math.max(0, round2(bestSingle.total - split.total)) : 0
  return { columns, cheapest, bestSingle, split, splitSaves }
}

/** Prefills quotes for an RFQ from the suppliers' price lists (for the quantities wanted). Suppliers with nothing listed are skipped. */
export function quotesFromLists(state: DataState, rfq: Rfq, at: number): Array<Pick<RfqQuote, 'supplierId' | 'prices' | 'leadDays'>> {
  const prices = listOf(state.supplierPrices)
  const out: Array<Pick<RfqQuote, 'supplierId' | 'prices' | 'leadDays'>> = []
  for (const sid of rfq.supplierIds) {
    const row: Record<string, number> = {}
    let lead: number | undefined
    for (const it of rfq.items) {
      const p = listPrice(prices, sid, it.variantId, it.qty, at)
      if (p) { row[it.variantId] = p.price; lead = Math.max(lead ?? 0, p.leadDays ?? 0) || lead }
    }
    if (Object.keys(row).length) out.push({ supplierId: sid, prices: row, leadDays: lead })
  }
  return out
}

export const quotesFor = (state: DataState, rfqId: string): RfqQuote[] => listOf(state.rfqQuotes).filter((q) => q.rfqId === rfqId)
export const quoteId = (rfqId: string, supplierId: string) => `${rfqId}:${supplierId}`
