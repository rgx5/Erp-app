import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import { listOf, type DataState } from '@/data/state'
import { splitTax } from './itc'
import { live } from './reversal'
import type { PurchaseReturn, ReturnLine, ReturnReason } from './types'

export const REASON_LABEL: Record<ReturnReason, string> = { damaged: 'Damaged', wrong: 'Wrong item sent', excess: 'Excess / not ordered', quality: 'Quality problem', other: 'Other' }

export interface ReturnTotals { taxable: number; cgst: number; sgst: number; igst: number; total: number }

/** The debit note's figures: goods at the receipt's cost, with the GST the supplier charged on them. */
export function returnTotals(items: Array<Pick<ReturnLine, 'qty' | 'cost' | 'rate'>>, interState: boolean): ReturnTotals {
  let taxable = 0, cgst = 0, sgst = 0, igst = 0
  for (const i of items) {
    const t = round2(i.qty * i.cost)
    const tax = splitTax(t, i.rate, interState)
    taxable += t; cgst += tax.cgst; sgst += tax.sgst; igst += tax.igst
  }
  taxable = round2(taxable); cgst = round2(cgst); sgst = round2(sgst); igst = round2(igst)
  return { taxable, cgst, sgst, igst, total: round2(taxable + cgst + sgst + igst) }
}

/** How much of each item on a receipt can still be sent back: what arrived, less what has already gone back against it. */
export function returnableQty(state: DataState, purchaseId: string): Record<string, number> {
  const p = state.purchases[purchaseId]
  if (!p) return {}
  const out: Record<string, number> = {}
  for (const i of p.items) out[i.variantId] = round3((out[i.variantId] ?? 0) + i.qty)
  for (const r of live(listOf(state.purchaseReturns))) {
    if (r.purchaseId !== purchaseId) continue
    for (const i of r.items) if (i.variantId in out) out[i.variantId] = round3(out[i.variantId] - i.qty)
  }
  for (const k of Object.keys(out)) out[k] = Math.max(0, out[k])
  return out
}

/** Debit notes, newest first (reversals left out; `reversed` says which have been cancelled). */
export function returnsList(state: DataState, supplierId?: string): Array<PurchaseReturn & { reversed: boolean }> {
  const all = listOf(state.purchaseReturns)
  const gone = new Set(all.filter((r) => r.reverses).map((r) => r.reverses))
  return all.filter((r) => !r.reverses && (!supplierId || r.supplierId === supplierId)).map((r) => ({ ...r, reversed: gone.has(r.id) })).sort((a, b) => b.date - a.date)
}

/** What we have sent back to suppliers over a period (debit notes standing). */
export const returnedValue = (state: DataState, from: number, to: number) =>
  round2(live(listOf(state.purchaseReturns)).filter((r) => r.date >= from && r.date <= to).reduce((s, r) => s + r.total, 0))
