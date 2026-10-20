import type { Bill, BillItem, Purchase } from '@/domain/types'
import { round3 } from '@/domain/qty'
import { fmtDate } from '@/domain/dates'
import { listOf, type DataState } from '@/data/state'
import {
  allocateFefo, batchId, batchesOf, isExpired, isMain, kitOf, lineExt, locationName, newBatchInit, normSerial, receiptExt, restorePlan, ruleFor, serialAvailable,
  serialId, stockAt, variantName, warrantyUntil,
} from './logic'
import type { Batch, BatchMoveInput, Serial } from './types'

/**
 * What a sale, a goods receipt or a return means for batches, serial numbers and locations — worked out once, as plain data.
 * The hooks refuse when `problems` is not empty and otherwise turn the plan into documents, so what is checked is exactly
 * what is written.
 */

export interface StockStep {
  variantId: string
  qty: number
  type: 'sale' | 'return' | 'transfer'
  reason: string
  locationId?: string
}

export interface SalePlan {
  batchMoves: BatchMoveInput[]
  serials: Serial[]
  /** Stock movements beyond the ones the core sale makes: a kit's components, stock taken from a shelf. */
  steps: StockStep[]
  problems: string[]
}

const tracked = (state: DataState, variantId: string) => state.products[state.variants[variantId]?.productId ?? '']?.trackStock !== false

/** Takes `qty` of a variant out of its batches, soonest expiry first, keeping a running balance across the lines of one bill. */
function takeFromBatches(
  state: DataState, left: Map<string, number>, variantId: string, qty: number,
  o: { now: number; ref: string; billId?: string; viaKit?: string; preferId?: string; allowExpired?: boolean },
  moves: BatchMoveInput[], problems: string[],
) {
  const name = variantName(state, variantId)
  const batches: Batch[] = batchesOf(state, variantId).map((b) => ({ ...b, qty: left.get(b.id) ?? b.qty }))
  if (o.preferId) {
    const b = state.batches[o.preferId]
    if (!b || b.variantId !== variantId) { problems.push(`That batch is not one of ${name}.`); return }
    if (isExpired(b, o.now) && !o.allowExpired) { problems.push(`Batch ${b.batchNo} of ${name} expired on ${fmtDate(b.expiry!)}. Choose another batch.`); return }
  }
  const { alloc, short } = allocateFefo(batches, qty, { now: o.now, preferId: o.preferId, allowExpired: o.allowExpired })
  for (const a of alloc) {
    left.set(a.batchId, round3((left.get(a.batchId) ?? state.batches[a.batchId]?.qty ?? 0) - a.qty))
    moves.push({ batchId: a.batchId, variantId, qty: -a.qty, reason: 'sale', ref: o.ref, ...(o.billId ? { billId: o.billId } : {}), ...(o.viaKit ? { viaKit: o.viaKit } : {}) })
  }
  // Stock beyond what any batch holds is simply unbatched (counted before batches were set up) — unless good batches are not
  // the reason: if expired batches still hold stock the shortfall is the expired part, and that is not sold by accident.
  if (short > 0 && !o.allowExpired && batches.some((b) => b.qty > 0 && isExpired(b, o.now))) {
    problems.push(`Only ${round3(qty - short)} of ${name} are within date; the rest has expired.`)
  }
}

export function planSale(state: DataState, bill: Pick<Bill, 'id' | 'no' | 'items' | 'customerId' | 'date'>, now: number): SalePlan {
  const plan: SalePlan = { batchMoves: [], serials: [], steps: [], problems: [] }
  const left = new Map<string, number>()
  const need = new Map<string, number>()
  const seenSerials = new Set<string>()

  for (const it of bill.items as BillItem[]) {
    const ext = lineExt(it)
    const found = kitOf(state, it.variantId)
    const kit = found?.active ? found : undefined
    const parts = kit
      ? kit.components.map((c) => ({ variantId: c.variantId, qty: round3(c.qty * it.qty), viaKit: kit.variantId }))
      : [{ variantId: it.variantId, qty: it.qty, viaKit: undefined as string | undefined }]

    for (const p of parts) {
      const v = state.variants[p.variantId]
      if (!v) { plan.problems.push('One of the items in this bill no longer exists.'); continue }
      const name = variantName(state, p.variantId)
      const rule = ruleFor(state, p.variantId)

      if (kit) {
        if (tracked(state, p.variantId)) {
          need.set(p.variantId, round3((need.get(p.variantId) ?? 0) + p.qty))
          if ((need.get(p.variantId) ?? 0) > v.stock) plan.problems.push(`Not enough ${name} for ${kit.name}: ${v.stock} on hand, ${need.get(p.variantId)} needed.`)
          plan.steps.push({ variantId: p.variantId, qty: -p.qty, type: 'sale', reason: `Kit: ${kit.name}` })
        }
      } else if (ext.locationId && !isMain(ext.locationId) && tracked(state, p.variantId)) {
        if (!state.locations[ext.locationId]?.active) plan.problems.push('The location chosen for this item is not available.')
        else if (p.qty > stockAt(state, p.variantId, ext.locationId)) plan.problems.push(`Only ${stockAt(state, p.variantId, ext.locationId)} of ${name} at ${locationName(state, ext.locationId)}.`)
        else {
          // The core sale takes the stock off the total (main); this pair moves that part from the shelf instead.
          const reason = `Sold from ${locationName(state, ext.locationId)}`
          plan.steps.push({ variantId: p.variantId, qty: -p.qty, type: 'transfer', reason, locationId: ext.locationId }, { variantId: p.variantId, qty: p.qty, type: 'transfer', reason })
        }
      }

      if (rule?.trackBatch) {
        takeFromBatches(state, left, p.variantId, p.qty, { now, ref: bill.no, billId: bill.id, viaKit: p.viaKit, preferId: kit ? undefined : ext.batchId, allowExpired: !kit && ext.allowExpired }, plan.batchMoves, plan.problems)
      }

      if (rule?.trackSerial && !kit) {
        const wanted = (ext.serials ?? []).map(normSerial).filter(Boolean)
        if (wanted.length !== p.qty) { plan.problems.push(`${name}: enter ${p.qty === 1 ? 'the serial number' : `${p.qty} serial numbers`} (${wanted.length} entered).`); continue }
        for (const sn of wanted) {
          const s = state.serials[serialId(p.variantId, sn)]
          if (seenSerials.has(`${p.variantId}|${sn}`)) { plan.problems.push(`${sn} is on this bill twice.`); continue }
          seenSerials.add(`${p.variantId}|${sn}`)
          if (!s) { plan.problems.push(`${sn} is not in the system. Add it under Serial numbers first.`); continue }
          if (!serialAvailable(s)) { plan.problems.push(`${sn} is not in stock (${s.status === 'sold' ? 'already sold' : 'written off'}).`); continue }
          const months = rule.warrantyMonths ?? s.warrantyMonths
          const until = warrantyUntil(bill.date, months)
          plan.serials.push({
            ...s, status: 'sold', billId: bill.id, billNo: bill.no, customerId: bill.customerId, soldAt: bill.date,
            ...(months ? { warrantyMonths: months } : {}), ...(until ? { warrantyUntil: until } : {}),
            history: [...s.history, { at: now, status: 'sold', ref: bill.no }],
          })
        }
      }
    }
  }
  return plan
}

// ───────────────────────────── goods receipt ─────────────────────────────

export interface ReceiptPlan {
  batchMoves: BatchMoveInput[]
  serials: Serial[]
  locationId?: string
  problems: string[]
}

export function planReceipt(state: DataState, purchase: Pick<Purchase, 'no' | 'supplierId' | 'items' | 'ext'>, now: number): ReceiptPlan {
  const plan: ReceiptPlan = { batchMoves: [], serials: [], problems: [] }
  const ext = receiptExt(purchase)
  if (ext.locationId && !isMain(ext.locationId)) {
    if (!state.locations[ext.locationId]?.active) plan.problems.push('The location chosen for this receipt is not available.')
    else plan.locationId = ext.locationId
  }
  const qtyOf = new Map<string, number>()
  for (const it of purchase.items) qtyOf.set(it.variantId, round3((qtyOf.get(it.variantId) ?? 0) + it.qty))
  const cost = (variantId: string) => purchase.items.find((i) => i.variantId === variantId)?.cost

  for (const [variantId, qty] of qtyOf) {
    if (!state.variants[variantId]) continue
    const rule = ruleFor(state, variantId)
    const line = ext.lines?.[variantId] ?? {}
    const name = variantName(state, variantId)
    if (rule?.trackBatch) {
      const no = (line.batchNo ?? '').trim()
      if (!no) { plan.problems.push(`${name}: enter the batch number.`); continue }
      if (line.mfgDate && line.expiry && line.expiry < line.mfgDate) { plan.problems.push(`${name}: the expiry date is before the manufacturing date.`); continue }
      if (line.expiry && isExpired({ expiry: line.expiry }, now)) { plan.problems.push(`${name}: this batch has already expired (${fmtDate(line.expiry)}).`); continue }
      const bid = batchId(variantId, no)
      const c = cost(variantId)
      plan.batchMoves.push({
        batchId: bid, variantId, qty, reason: 'receipt', ref: purchase.no,
        batch: newBatchInit(variantId, no, {
          receivedAt: now, supplierId: purchase.supplierId,
          ...(line.mfgDate ? { mfgDate: line.mfgDate } : {}), ...(line.expiry ? { expiry: line.expiry } : {}), ...(c ? { cost: c } : {}),
          ...(plan.locationId ? { locationId: plan.locationId } : {}),
        }),
      })
    }
    if (rule?.trackSerial) {
      const list = (line.serials ?? []).map(normSerial).filter(Boolean)
      if (list.length !== qty) { plan.problems.push(`${name}: enter ${qty === 1 ? 'the serial number' : `${qty} serial numbers`} (${list.length} entered).`); continue }
      if (new Set(list).size !== list.length) { plan.problems.push(`${name}: a serial number is entered twice.`); continue }
      for (const sn of list) {
        const cur = state.serials[serialId(variantId, sn)]
        if (cur && serialAvailable(cur)) { plan.problems.push(`${sn} is already in stock.`); continue }
        plan.serials.push({
          id: serialId(variantId, sn), variantId, serial: sn, status: 'in_stock', receivedAt: now, supplierId: purchase.supplierId,
          ...(rule.warrantyMonths ? { warrantyMonths: rule.warrantyMonths } : {}), ...(plan.locationId ? { locationId: plan.locationId } : {}),
          history: [...(cur?.history ?? []), { at: now, status: 'in_stock', ref: purchase.no }],
        })
      }
    }
  }
  return plan
}

// ───────────────────────────── returns ─────────────────────────────

export interface ReturnPlan {
  batchMoves: BatchMoveInput[]
  serials: Serial[]
  steps: StockStep[]
}

/** What a credit note gives back besides the shelf stock the core return already restores. */
export function planReturnEffects(state: DataState, original: Bill, creditNote: Pick<Bill, 'no' | 'items'>, now: number): ReturnPlan {
  const plan: ReturnPlan = { batchMoves: [], serials: [], steps: [] }
  for (const r of creditNote.items) {
    const qty = Math.abs(r.qty)
    const kit = kitOf(state, r.variantId)
    const parts = kit
      ? kit.components.map((c) => ({ variantId: c.variantId, qty: round3(c.qty * qty), viaKit: kit.variantId }))
      : [{ variantId: r.variantId, qty, viaKit: undefined as string | undefined }]
    const originalLine = original.items.find((i) => i.variantId === r.variantId)
    const ext = originalLine ? lineExt(originalLine) : {}
    for (const p of parts) {
      if (kit && tracked(state, p.variantId)) plan.steps.push({ variantId: p.variantId, qty: p.qty, type: 'return', reason: `Return of kit ${kit.name} (${original.no})` })
      // Stock that was taken from a shelf goes back to the shelf.
      if (!kit && ext.locationId && !isMain(ext.locationId) && state.locations[ext.locationId] && tracked(state, p.variantId)) {
        plan.steps.push({ variantId: p.variantId, qty: -p.qty, type: 'transfer', reason: `Returned to ${locationName(state, ext.locationId)}` })
        plan.steps.push({ variantId: p.variantId, qty: p.qty, type: 'transfer', reason: `Returned to ${locationName(state, ext.locationId)}`, locationId: ext.locationId })
      }
      if (ruleFor(state, p.variantId)?.trackBatch) {
        for (const a of restorePlan(state, original.id, p.variantId, p.qty, p.viaKit)) {
          plan.batchMoves.push({ batchId: a.batchId, variantId: p.variantId, qty: a.qty, reason: 'return', ref: creditNote.no, billId: original.id, ...(p.viaKit ? { viaKit: p.viaKit } : {}) })
        }
      }
      // Serial numbers: when every unit still sold on the bill comes back they are all known; otherwise the person chooses which
      // unit came back (Serial numbers › Take back), because the return screen does not ask.
      if (!kit && ruleFor(state, p.variantId)?.trackSerial) {
        const sold = listOf(state.serials).filter((s) => s.billId === original.id && s.variantId === p.variantId && s.status === 'sold')
        if (sold.length > 0 && sold.length <= p.qty) {
          for (const s of sold) plan.serials.push({ ...s, status: 'returned', history: [...s.history, { at: now, status: 'returned', ref: creditNote.no }] })
        }
      }
    }
  }
  return plan
}

export const hasLocations = (state: DataState) => listOf(state.locations).some((l) => l.active)
