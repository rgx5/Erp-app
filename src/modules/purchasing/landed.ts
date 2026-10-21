import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import type { Purchase, Variant } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import { live } from './reversal'
import type { Charge, ChargeKind, LandedCost, LandedLine } from './types'

/**
 * Landed cost: the freight, duty and handling it took to bring a delivery in, spread over its items so each item's cost is what
 * it really cost to have it on the shelf. The charges go where the goods are: the part for units still in stock raises the item's
 * average cost; the part for units already sold has gone out as cost of goods sold.
 */

export const CHARGE_LABEL: Record<ChargeKind, string> = { freight: 'Freight', duty: 'Customs duty', handling: 'Handling & loading', insurance: 'Insurance', other: 'Other' }

/** The part of the charges that is cost: the amounts, plus GST that cannot be claimed back. */
export function capitalised(charges: Charge[]): number {
  return round2(charges.reduce((s, c) => s + c.amount + (c.itcEligible ? 0 : c.gst), 0))
}
/** GST on the charges that can be claimed as input credit. */
export const claimableGst = (charges: Charge[]) => round2(charges.reduce((s, c) => s + (c.itcEligible ? c.gst : 0), 0))
/** Everything paid for the charges, GST included. */
export const chargesTotal = (charges: Charge[]) => round2(charges.reduce((s, c) => s + c.amount + c.gst, 0))

/** Cuts `amount` into parts proportional to `weights`, in whole paise, the last part taking the rounding. */
export function shares(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  if (!weights.length) return []
  if (!(sum > 0)) return weights.map((_, i) => (i === weights.length - 1 ? round2(amount) : 0))
  let given = 0
  return weights.map((w, i) => {
    if (i === weights.length - 1) return round2(amount - given)
    const part = round2((amount * w) / sum)
    given = round2(given + part)
    return part
  })
}

export interface LandedInput { variantId: string; qty: number; cost: number }

/**
 * Spreads the cost over the receipt's lines (by value or by quantity) and splits each share between the units still in stock and
 * those sold. `stock` is what is on hand now for each item.
 */
export function allocateLanded(lines: LandedInput[], stock: Record<string, number>, amount: number, basis: 'value' | 'qty', latest: Record<string, number> = {}): LandedLine[] {
  const merged: LandedInput[] = []
  for (const l of lines) {
    const m = merged.find((x) => x.variantId === l.variantId)
    if (m) { m.cost = (m.qty * m.cost + l.qty * l.cost) / (m.qty + l.qty); m.qty = round3(m.qty + l.qty) } else merged.push({ ...l })
  }
  const parts = shares(amount, merged.map((l) => (basis === 'value' ? l.qty * l.cost : l.qty)))
  return merged.map((l, i) => {
    const alloc = parts[i]
    const onHand = Math.max(0, Math.min(stock[l.variantId] ?? 0, l.qty))
    const toStock = l.qty > 0 ? round2((alloc * onHand) / l.qty) : 0
    const perUnit = onHand > 0 ? round2(toStock / onHand) : 0
    // The latest cost moves only when this receipt is the one that set it.
    const latestUp = latest[l.variantId] !== undefined && Math.abs(latest[l.variantId] - l.cost) < 0.005 && l.qty > 0 ? round2(alloc / l.qty) : 0
    return { variantId: l.variantId, qty: l.qty, alloc, toStock, toCogs: round2(alloc - toStock), perUnit, latestUp }
  })
}

/** The variant after the cost lands on it (or, with `back`, after it is taken off again). Stock is unchanged. */
export function variantAfterLanded(v: Variant, l: LandedLine, back = false): Variant {
  const dir = back ? -1 : 1
  const avg = v.avgCost ?? v.cost
  const avgCost = v.stock > 0 && l.toStock ? round2(avg + (dir * l.toStock) / v.stock) : avg
  const cost = l.latestUp ? round2(v.cost + dir * l.latestUp) : v.cost
  return { ...v, avgCost, cost }
}

/** Receipts that can still take landed cost (any receipt can take several bills; this just lists them newest first). */
export const landedFor = (state: DataState, purchaseId: string): LandedCost[] => live(listOf(state.landedCosts)).filter((l) => l.purchaseId === purchaseId)

export function landedList(state: DataState): Array<LandedCost & { reversed: boolean }> {
  const all = listOf(state.landedCosts)
  const gone = new Set(all.filter((l) => l.reverses).map((l) => l.reverses))
  return all.filter((l) => !l.reverses).map((l) => ({ ...l, reversed: gone.has(l.id) })).sort((a, b) => b.date - a.date)
}

/** The receipt's items as the allocator wants them. */
export const inputsOf = (p: Purchase): LandedInput[] => p.items.map((i) => ({ variantId: i.variantId, qty: i.qty, cost: i.cost }))
