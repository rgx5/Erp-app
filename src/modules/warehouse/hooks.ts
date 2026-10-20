import { audit, OpError, tracksStock } from '@/data/ops'
import { id } from '@/domain/ids'
import { fmtDate } from '@/domain/dates'
import { listOf, mergeChanges, type Changes, type DataState } from '@/data/state'
import type { Bill } from '@/domain/types'
import type { BillHook, CartAdjuster, ReceiptExtra, ReceiptHook, ReturnHook } from '@/modules/registry'
import { planReceipt, planReturnEffects, planSale, type StockStep } from './flow'
import { blendedPrice, conversionsOf, incChanges, levelEffects, lineExt, StockBook } from './logic'
import { batchChanges } from './ops'

/** The key this module's data lives under in `bill.ext`, `purchase.ext` and `cartLine.ext`. */
export const EXT = 'warehouse'

const mkId = (prefix: string, now: number) => id(prefix, now)

/** Movements a plan asks for, as documents; `offsets` is what the core operation beside them already did to the totals. */
function stockChanges(state: DataState, ctx: { now: number; userId: string }, offsets: Array<[string, number]>, steps: StockStep[], ref: string): Changes {
  if (!steps.length) return {}
  const book = new StockBook(state, ctx, mkId)
  for (const [variantId, delta] of offsets) book.offset(variantId, delta)
  for (const s of steps) book.move(s.variantId, s.qty, s.type, ref, s.reason, s.locationId)
  return book.changes()
}

const nothing = (c: Changes) => !Object.values(c.put ?? {}).some((rows) => rows && rows.length)

// ───────────────────────────── selling ─────────────────────────────

/**
 * Selling: refuse what cannot be honoured (an expired batch, a missing serial number, a kit without its parts), then — in the
 * bill's own transaction — take the stock out of its batches (soonest expiry first), mark the serial numbers sold with their
 * warranty, and take a kit's components off the shelf.
 */
export const billHook: BillHook = {
  id: EXT,
  beforeSave: ({ state, ctx, bill }) => {
    const plan = planSale(state, bill, ctx.now)
    if (plan.problems.length) throw new OpError(plan.problems[0])
  },
  onSave: ({ state, ctx, bill }) => {
    const plan = planSale(state, bill, ctx.now)
    const offsets = bill.items.filter((i) => tracksStock(state, i.variantId)).map((i): [string, number] => [i.variantId, -i.qty])
    const parts: Changes[] = [
      stockChanges(state, ctx, offsets, plan.steps, bill.no),
      batchChanges(state, plan.batchMoves, ctx),
      plan.serials.length ? { put: { serials: plan.serials } } : {},
    ]
    const out = mergeChanges(...parts)
    return nothing(out) ? null : out
  },
}

// ───────────────────────────── receiving ─────────────────────────────

/**
 * Receiving: the batch (number, expiry) and serial numbers that came in, and the location they were put in, are written with
 * the receipt. A tracked item received without its batch number or serial numbers is refused.
 */
export const receiptHook: ReceiptHook = {
  id: EXT,
  beforeSave: ({ state, ctx, purchase }) => {
    const plan = planReceipt(state, purchase, ctx.now)
    if (plan.problems.length) throw new OpError(plan.problems[0])
  },
  onSave: ({ state, ctx, purchase, moves }) => {
    const plan = planReceipt(state, purchase, ctx.now)
    const parts: Changes[] = [batchChanges(state, plan.batchMoves, ctx), plan.serials.length ? { put: { serials: plan.serials } } : {}]
    if (plan.locationId) {
      // The goods go to a shelf: the same movements, now naming it, so the level at that location rises with them.
      const located = moves.map((m) => ({ ...m, locationId: plan.locationId! }))
      parts.push({ put: { moves: located } }, incChanges(state, located.flatMap(levelEffects)))
    }
    const out = mergeChanges(...parts)
    return nothing(out) ? null : mergeChanges(out, { put: { audit: [audit(ctx, 'WAREHOUSE_RECEIPT', `${purchase.no}: ${plan.batchMoves.length} batch(es), ${plan.serials.length} serial(s)${plan.locationId ? ' to a location' : ''}`)] } })
  },
}

// ───────────────────────────── returns ─────────────────────────────

/** A return puts the goods back into the batches they came from, restores a kit's components, and frees serial numbers. */
export const returnHook: ReturnHook = {
  id: EXT,
  onReturn: ({ state, ctx, original, creditNote }) => {
    const plan = planReturnEffects(state, original, creditNote, ctx.now)
    const offsets = creditNote.items.filter((i) => tracksStock(state, i.variantId)).map((i): [string, number] => [i.variantId, i.qty])
    const out = mergeChanges(
      stockChanges(state, ctx, offsets, plan.steps, creditNote.no),
      batchChanges(state, plan.batchMoves, ctx),
      plan.serials.length ? { put: { serials: plan.serials } } : {},
    )
    return nothing(out) ? null : out
  },
}

// ───────────────────────────── multi-unit pricing ─────────────────────────────

/** Whole packs of a bigger unit sell at the pack price; the cart prices per base unit, so the line's price is blended. */
export const packAdjuster: CartAdjuster = {
  id: EXT,
  order: 40,
  adjust: (lines, c) =>
    lines.map((l) => {
      const packs = lineExt(l).packs
      if (!packs || l.priceOverridden || !l.productId) return l
      const conv = conversionsOf(c.state, l.productId).find((x) => x.unit === packs.unit)
      const price = blendedPrice(l, conv, packs.n)
      return price === l.price ? l : { ...l, price, mrp: Math.max(l.mrp, price) }
    }),
}

// ───────────────────────────── the printed bill ─────────────────────────────

/** Under an item on the receipt: the batch it came from and its expiry, or the serial numbers and warranty. */
export const receiptExtra: ReceiptExtra = {
  id: EXT,
  item: (item, bill: Bill, state) => {
    const bits: string[] = []
    const seen = new Set<string>()
    for (const m of listOf(state.batchMoves)) {
      if (m.billId !== bill.id || m.variantId !== item.variantId || m.reason !== 'sale' || seen.has(m.batchId)) continue
      seen.add(m.batchId)
      const b = state.batches[m.batchId]
      if (b) bits.push(`Batch ${b.batchNo}${b.expiry ? ` exp ${fmtDate(b.expiry)}` : ''}`)
    }
    const serials = listOf(state.serials).filter((s) => s.billId === bill.id && s.variantId === item.variantId)
    if (serials.length) {
      bits.push(`S/N ${serials.map((s) => s.serial).join(', ')}`)
      const w = serials.find((s) => s.warrantyUntil)
      if (w?.warrantyUntil) bits.push(`warranty to ${fmtDate(w.warrantyUntil)}`)
    }
    return bits.length ? bits.join(' · ') : null
  },
}
