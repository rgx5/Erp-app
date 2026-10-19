import type { Purchase, PurchaseItem, Supplier } from './types'
import { round2 } from './money'
import { round3 } from './qty'
import { supplierOwed } from './stock'

/** A line as typed on the goods-receipt form: strings until they are used, blank means "not filled in yet". */
export interface GrnDraftLine { variantId: string; qty: string; cost: string }

export interface GrnBuilt { items: PurchaseItem[]; total: number; skipped: number }

/** Turns the form's lines into purchase items. Lines without a quantity are left out (and counted), the rest must be sane. */
export function buildGrn(lines: GrnDraftLine[]): GrnBuilt {
  const items: PurchaseItem[] = []
  let skipped = 0
  for (const l of lines) {
    const qty = round3(Number(l.qty))
    if (!l.qty.trim() || !Number.isFinite(qty) || qty <= 0) { skipped++; continue }
    const cost = Math.max(0, round2(Number(l.cost) || 0))
    items.push({ variantId: l.variantId, qty, cost })
  }
  return { items, total: grnTotal(items), skipped }
}

export const grnTotal = (items: Array<Pick<PurchaseItem, 'qty' | 'cost'>>) => round2(items.reduce((s, i) => s + i.qty * i.cost, 0))

export interface InvoiceCheck { diff: number; ok: boolean }

/** Compares what we computed with the total printed on the supplier's bill. A rupee of rounding is not a mismatch. */
export function invoiceCheck(computed: number, invoiceTotal: number | undefined): InvoiceCheck | null {
  if (!invoiceTotal || invoiceTotal <= 0) return null
  const diff = round2(computed - invoiceTotal)
  return { diff, ok: Math.abs(diff) <= 1 }
}

/** A starting selling price from a cost and a markup %, rounded up to a price tag people use (₹1 below ₹100, else ₹5). */
export function suggestPrice(cost: number, markupPct: number): number {
  if (!(cost > 0)) return 0
  const raw = cost * (1 + markupPct / 100)
  const step = raw >= 100 ? 5 : 1
  return Math.ceil(raw / step - 1e-9) * step
}

/** What the business has bought from suppliers since `since` (a timestamp). */
export const boughtSince = (purchases: Purchase[], since: number) =>
  round2(purchases.filter((p) => p.date >= since).reduce((s, p) => s + p.total, 0))

export const totalPayable = (suppliers: Supplier[], purchases: Purchase[]) =>
  round2(suppliers.reduce((s, x) => s + Math.max(0, supplierOwed(x, purchases)), 0))

/** The supplier each variant was last received from — used to group the reorder list. */
export function lastSupplierByVariant(purchases: Purchase[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const p of [...purchases].sort((a, b) => a.date - b.date)) for (const i of p.items) out.set(i.variantId, p.supplierId)
  return out
}

/** Receipts matching a search on number, the supplier's bill number or the supplier's name — newest first. */
export function filterPurchases(purchases: Purchase[], needle: string, nameOf: (supplierId: string) => string): Purchase[] {
  const n = needle.trim().toLowerCase()
  return purchases
    .filter((p) => !n || p.no.toLowerCase().includes(n) || p.invoiceRef.toLowerCase().includes(n) || nameOf(p.supplierId).toLowerCase().includes(n))
    .sort((a, b) => b.date - a.date)
}

export interface PriceDraftText { price: string; mrp: string }

/**
 * Reads the "price later" form: rows with a price become updates, blank rows are left for later. A missing MRP defaults
 * to the price; an MRP below the price is refused (the tag can't promise less than it charges).
 */
export function readPrices(drafts: Record<string, PriceDraftText>): { rows: Array<{ id: string; price: number; mrp: number }>; errors: Record<string, string> } {
  const rows: Array<{ id: string; price: number; mrp: number }> = []
  const errors: Record<string, string> = {}
  for (const [id, d] of Object.entries(drafts)) {
    if (!d.price.trim() && !d.mrp.trim()) continue
    const price = round2(Number(d.price))
    if (!(price > 0)) { errors[id] = 'Enter a selling price'; continue }
    const mrp = d.mrp.trim() ? round2(Number(d.mrp)) : price
    if (mrp < price) { errors[id] = 'MRP can’t be below the price'; continue }
    rows.push({ id, price, mrp })
  }
  return { rows, errors }
}
