import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { withEffects } from '@/replication/local'
import { nextNo } from '../numbering'
import { isInterState } from './itc'
import { allocateLanded, capitalised, chargesTotal, claimableGst, inputsOf, variantAfterLanded } from './landed'
import { PAY_MODES } from './ops-payables'
import { reversalOf } from './ops-reverse'
import type { Charge, LandedCost, PayMode } from './types'
import './replication'

export interface LandedDraft {
  purchaseId: string
  charges: Charge[]
  basis?: 'value' | 'qty'
  /** The transporter / clearing agent, kept as a supplier, who bills us; otherwise say how it was paid. */
  payeeId?: string
  mode?: PayMode
  interState?: boolean
  note?: string
  date?: number
}

/**
 * Spreads freight, duty and handling over a receipt's items. Units still in stock take their share into the item's average cost
 * (and its latest cost when this receipt set it); units already sold have theirs booked to cost of goods sold.
 */
export function recordLandedCost(state: DataState, d: LandedDraft, ctx: OpCtx): { changes: Changes; landed: LandedCost } {
  const grn = state.purchases[d.purchaseId]
  if (!grn) throw new OpError('Choose the goods receipt these charges belong to.')
  const charges = d.charges.filter((c) => c.amount > 0)
  if (!charges.length) throw new OpError('Add at least one charge.')
  for (const c of charges) if (!(c.gst >= 0)) throw new OpError('GST cannot be negative.')
  if (d.payeeId && !state.suppliers[d.payeeId]) throw new OpError('That supplier no longer exists.')
  if (!d.payeeId && !PAY_MODES.includes(d.mode as PayMode)) throw new OpError('Choose who bills for these charges, or how they were paid.')
  const stock = Object.fromEntries(grn.items.map((i) => [i.variantId, state.variants[i.variantId]?.stock ?? 0]))
  const latest = Object.fromEntries(grn.items.map((i) => [i.variantId, state.variants[i.variantId]?.cost ?? -1]))
  const lines = allocateLanded(inputsOf(grn), stock, capitalised(charges), d.basis ?? 'value', latest)
  const landed: LandedCost = {
    id: id('lc_', ctx.now), no: nextNo('LC-', listOf(state.landedCosts).map((l) => l.no), ctx), purchaseId: grn.id, supplierId: grn.supplierId, date: d.date ?? ctx.now,
    charges: charges.map((c) => ({ ...c, label: c.label.trim(), amount: round2(c.amount), gst: round2(c.gst) })), basis: d.basis ?? 'value',
    interState: d.interState ?? isInterState(state.store, d.payeeId ? state.suppliers[d.payeeId]?.gstin : state.suppliers[grn.supplierId]?.gstin), lines,
    total: chargesTotal(charges), itc: claimableGst(charges), ...(d.payeeId ? { payeeId: d.payeeId } : { mode: d.mode }), note: (d.note ?? '').trim(),
    userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  const variants = lines.filter((l) => state.variants[l.variantId]).map((l) => variantAfterLanded(state.variants[l.variantId], l))
  const base: Changes = { put: { landedCosts: [landed], variants, audit: [audit(ctx, 'LANDED_COST', `${landed.no} — ${grn.no} ₹${landed.total}`)] } }
  return { landed, changes: withEffects(state, base, ['landedCosts'], ctx.now) }
}

/** Cancels landed cost: the item costs go back and the bill is no longer owed. */
export function reverseLandedCost(state: DataState, landedId: string, note: string, ctx: OpCtx): { changes: Changes; landed: LandedCost } {
  const { original, doc } = reversalOf(state, 'landedCosts', landedId, note, ctx)
  const variants = original.lines.filter((l) => state.variants[l.variantId]).map((l) => variantAfterLanded(state.variants[l.variantId], l, true))
  const base: Changes = { put: { landedCosts: [doc], variants, audit: [audit(ctx, 'LANDED_COST_REVERSED', `${original.no} cancelled`)] } }
  return { landed: doc, changes: withEffects(state, base, ['landedCosts'], ctx.now) }
}
