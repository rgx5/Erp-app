import { audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { id } from '@/domain/ids'
import { nextNo } from '@/modules/numbering'
import type { DeliveryLine, DeliveryStatus, FoodDelivery, FoodLooseRule } from './types'
import { looseRuleProblem } from './logic/loose'
import { DELIVERY_NEXT } from './logic/delivery'

// ───────────────────────────── pack → loose rules ─────────────────────────────

export interface LooseRuleDraft { variantId: string; packSizeG: number; unitLabel: 'g' | 'ml'; minG: number }

export function saveLooseRule(state: DataState, d: LooseRuleDraft, ctx: OpCtx): { changes: Changes; rule: FoodLooseRule } {
  if (!state.variants[d.variantId]) throw new OpError('That item no longer exists.')
  const problem = looseRuleProblem(d.packSizeG, d.minG)
  if (problem) throw new OpError(problem)
  const rule: FoodLooseRule = { id: d.variantId, packSizeG: d.packSizeG, unitLabel: d.unitLabel, minG: d.minG, active: true }
  return { rule, changes: { put: { foodLooseRules: [rule] }, audit: [audit(ctx, 'FOOD_LOOSE_RULE', `${state.variants[d.variantId].sku}: ${d.packSizeG} ${d.unitLabel} pack`)] } }
}

export function setLooseRuleActive(state: DataState, variantId: string, active: boolean): { changes: Changes } {
  const r = state.foodLooseRules[variantId]
  if (!r) throw new OpError('That rule no longer exists.')
  return { changes: { put: { foodLooseRules: [{ ...r, active }] } } }
}

// ───────────────────────────── home delivery ─────────────────────────────

export interface DeliveryDraft {
  customerId?: string | null
  partyName: string
  partyPhone: string
  address: string
  lines: DeliveryLine[]
  deliveryCharge?: number
  notes?: string
}

export function placeDelivery(state: DataState, d: DeliveryDraft, ctx: OpCtx): { changes: Changes; delivery: FoodDelivery } {
  if (!d.partyName.trim()) throw new OpError('Give the delivery a name.')
  if (!d.address.trim()) throw new OpError('Enter the delivery address.')
  if (!d.lines.length) throw new OpError('Add at least one item.')
  const delivery: FoodDelivery = {
    id: id('fdl', ctx.now), no: nextNo('DL-', listOf(state.foodDeliveries).map((x) => x.no), ctx), customerId: d.customerId ?? null,
    partyName: d.partyName.trim(), partyPhone: d.partyPhone.trim(), address: d.address.trim(), lines: d.lines,
    deliveryCharge: d.deliveryCharge || 0, status: 'placed', placedAt: ctx.now, notes: (d.notes ?? '').trim(), userId: ctx.userId,
    ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  return { delivery, changes: { put: { foodDeliveries: [delivery] }, audit: [audit(ctx, 'FOOD_DELIVERY_PLACE', delivery.no)] } }
}

export function advanceDelivery(state: DataState, deliveryId: string, to: DeliveryStatus, ctx: OpCtx, reason = ''): { changes: Changes } {
  const d = state.foodDeliveries[deliveryId]
  if (!d) throw new OpError('That delivery no longer exists.')
  if (!DELIVERY_NEXT[d.status].includes(to)) throw new OpError(`A ${d.status} delivery cannot become "${to}".`)
  const stamp = to === 'out' ? { outAt: ctx.now } : to === 'delivered' ? { deliveredAt: ctx.now } : to === 'cancelled' ? { cancelledAt: ctx.now, cancelReason: reason.trim() } : {}
  return { changes: { put: { foodDeliveries: [{ ...d, status: to, ...stamp }], audit: [audit(ctx, 'FOOD_DELIVERY_STATUS', `${d.no}: ${to}`)] } } }
}
