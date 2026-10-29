import { audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { id } from '@/domain/ids'
import { nextNo } from '@/modules/numbering'
import type { FoodKot, FoodModifierGroup, FoodModifierPick, FoodOrder, FoodOrderKind, FoodOrderLine, FoodOrderStage, FoodTable, FoodTip, TipMode } from './types'
import { groupByStation, kotLinesOf, pendingLines } from './logic/kot'
import { activeLines, openCounterOrders, openOrderForTable, orderSubtotal } from './logic/orders'
import { isBusy } from './logic/tables'
import { type SplitGroup, unassigned } from './logic/split'

// ───────────────────────────── tables ─────────────────────────────

export type TableDraft = Pick<FoodTable, 'no' | 'name' | 'zone' | 'seats'>

export function saveTable(state: DataState, d: TableDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; table: FoodTable } {
  const no = d.no.trim()
  if (!no) throw new OpError('Give the table a number or name.')
  if (listOf(state.foodTables).some((t) => t.id !== existingId && t.active && t.no.toLowerCase() === no.toLowerCase())) throw new OpError(`Table ${no} already exists.`)
  const table: FoodTable = { id: existingId ?? id('ftb', ctx.now), no, name: d.name.trim(), zone: d.zone.trim(), seats: Math.max(1, Math.round(d.seats)), active: true, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) }
  return { table, changes: { put: { foodTables: [table] } } }
}

export function archiveTable(state: DataState, tableId: string, ctx: OpCtx): { changes: Changes } {
  const t = state.foodTables[tableId]
  if (!t) throw new OpError('That table no longer exists.')
  if (isBusy(state, tableId)) throw new OpError('This table has an open order — settle or move it first.')
  return { changes: { put: { foodTables: [{ ...t, active: false }] } } }
}

// ───────────────────────────── modifier groups ─────────────────────────────

export type ModifierGroupDraft = Pick<FoodModifierGroup, 'name' | 'min' | 'max' | 'categoryIds' | 'options'>

export function saveModifierGroup(state: DataState, d: ModifierGroupDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; group: FoodModifierGroup } {
  const name = d.name.trim()
  if (!name) throw new OpError('Give the modifier group a name.')
  if (!d.options.length) throw new OpError('Add at least one option.')
  const options = d.options.map((o, i) => ({ id: o.id || id('mod', ctx.now + i), name: o.name.trim(), priceDelta: o.priceDelta || 0 })).filter((o) => o.name)
  if (!options.length) throw new OpError('Add at least one option.')
  const group: FoodModifierGroup = { id: existingId ?? id('fmg', ctx.now), name, min: Math.max(0, d.min), max: Math.max(0, d.max), categoryIds: d.categoryIds, options, active: true }
  return { group, changes: { put: { foodModifierGroups: [group] } } }
}

export const setModifierGroupActive = (state: DataState, groupId: string, active: boolean): { changes: Changes } => {
  const g = state.foodModifierGroups[groupId]
  if (!g) throw new OpError('That modifier group no longer exists.')
  return { changes: { put: { foodModifierGroups: [{ ...g, active }] } } }
}

// ───────────────────────────── orders ─────────────────────────────

export interface OpenOrderDraft {
  kind: FoodOrderKind
  tableIds?: string[]
  customerId?: string | null
  partyName?: string
  partyPhone?: string
  deliveryAddress?: string
  notes?: string
}

export function openOrder(state: DataState, d: OpenOrderDraft, ctx: OpCtx): { changes: Changes; order: FoodOrder } {
  const tableIds = d.kind === 'dine_in' ? [...new Set(d.tableIds ?? [])] : []
  if (d.kind === 'dine_in') {
    if (!tableIds.length) throw new OpError('Choose at least one table.')
    for (const tid of tableIds) {
      if (!state.foodTables[tid]) throw new OpError('That table no longer exists.')
      if (isBusy(state, tid)) throw new OpError(`Table ${state.foodTables[tid].no} already has an open order.`)
    }
  }
  const order: FoodOrder = {
    id: id('fod', ctx.now), no: nextNo('FO-', listOf(state.foodOrders).map((o) => o.no), ctx), kind: d.kind, tableIds, status: 'open', requestedBill: false,
    ...(d.kind !== 'dine_in' ? { stage: 'placed' as FoodOrderStage } : {}),
    lines: [], customerId: d.customerId ?? null, partyName: (d.partyName ?? '').trim(), partyPhone: (d.partyPhone ?? '').trim(),
    deliveryAddress: (d.deliveryAddress ?? '').trim(), notes: (d.notes ?? '').trim(), openedAt: ctx.now, openedBy: ctx.userId,
    ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  const where = tableIds.length ? ` — table ${tableIds.map((t) => state.foodTables[t].no).join('+')}` : ''
  return { order, changes: { put: { foodOrders: [order], audit: [audit(ctx, 'FOOD_ORDER_OPEN', `${order.no}${where}`)] } } }
}

export interface OrderLineDraft { variantId: string; qty: number; course?: string; station?: string; modifiers?: FoodModifierPick[]; notes?: string }

export function addOrderLines(state: DataState, orderId: string, draft: OrderLineDraft[], ctx: OpCtx): { changes: Changes; order: FoodOrder } {
  const o = state.foodOrders[orderId]
  if (!o) throw new OpError('That order no longer exists.')
  if (o.status !== 'open') throw new OpError('This order is already settled.')
  if (!draft.length) throw new OpError('Add at least one item.')
  const lines: FoodOrderLine[] = draft.map((d, i) => {
    const v = state.variants[d.variantId]
    if (!v) throw new OpError('That item no longer exists.')
    const p = state.products[v.productId]
    if (!(d.qty > 0)) throw new OpError('Enter a quantity.')
    return {
      id: id('fol', ctx.now + i), variantId: d.variantId, name: p?.name ?? v.sku, qty: d.qty, price: v.price,
      course: d.course ?? '', station: d.station ?? 'Kitchen', modifiers: d.modifiers ?? [], notes: (d.notes ?? '').trim(), status: 'new',
    }
  })
  const next: FoodOrder = { ...o, lines: [...o.lines, ...lines] }
  return { order: next, changes: { put: { foodOrders: [next] } } }
}

export function voidOrderLine(state: DataState, orderId: string, lineId: string, reason: string, ctx: OpCtx): { changes: Changes } {
  const o = state.foodOrders[orderId]
  if (!o) throw new OpError('That order no longer exists.')
  const line = o.lines.find((l) => l.id === lineId)
  if (!line) throw new OpError('That line no longer exists.')
  const lines = o.lines.map((l) => (l.id === lineId ? { ...l, voided: true, voidReason: reason.trim() } : l))
  return { changes: { put: { foodOrders: [{ ...o, lines }], audit: [audit(ctx, 'FOOD_LINE_VOID', `${o.no}: ${line.name}${reason ? ` — ${reason}` : ''}`)] } } }
}

/** Prints the KOT(s) for everything not yet sent: one ticket per station. */
export function sendToKitchen(state: DataState, orderId: string, ctx: OpCtx): { changes: Changes; kots: FoodKot[] } {
  const o = state.foodOrders[orderId]
  if (!o) throw new OpError('That order no longer exists.')
  if (o.status !== 'open') throw new OpError('This order is already settled.')
  const pending = pendingLines(activeLines(o))
  if (!pending.length) throw new OpError('Nothing new to send to the kitchen.')
  const groups = groupByStation(pending)
  const existing = listOf(state.foodKots).map((k) => k.no)
  const tableLabel = o.kind === 'dine_in' ? o.tableIds.map((t) => state.foodTables[t]?.no ?? '?').join('+') : o.no
  const kots: FoodKot[] = []
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const no = nextNo('KOT-', [...existing, ...kots.map((k) => k.no)], ctx)
    kots.push({
      id: id('fkt', ctx.now + i), no, orderId, tableLabel, kind: o.kind, station: g.station, lines: kotLinesOf(g.lines),
      createdAt: ctx.now, createdBy: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    })
  }
  const sentIds = new Set(pending.map((l) => l.id))
  const lines = o.lines.map((l) => (sentIds.has(l.id) ? { ...l, status: 'sent' as const } : l))
  return { kots, changes: { put: { foodOrders: [{ ...o, lines }], foodKots: kots, audit: [audit(ctx, 'FOOD_KOT_SEND', `${o.no}: ${kots.length} ticket${kots.length === 1 ? '' : 's'}`)] } } }
}

export function setLineStatus(state: DataState, orderId: string, lineId: string, status: 'ready' | 'served', ctx: OpCtx): { changes: Changes } {
  const o = state.foodOrders[orderId]
  if (!o) throw new OpError('That order no longer exists.')
  const line = o.lines.find((l) => l.id === lineId)
  if (!line || line.status === 'new') throw new OpError('Send it to the kitchen first.')
  const lines = o.lines.map((l) => (l.id === lineId ? { ...l, status } : l))
  return { changes: { put: { foodOrders: [{ ...o, lines }] } } }
}

export function setStage(state: DataState, orderId: string, stage: FoodOrderStage, ctx: OpCtx): { changes: Changes } {
  const o = state.foodOrders[orderId]
  if (!o) throw new OpError('That order no longer exists.')
  if (o.kind === 'dine_in') throw new OpError('Dine-in orders track progress per item, not a single stage.')
  return { changes: { put: { foodOrders: [{ ...o, stage }], audit: [audit(ctx, 'FOOD_ORDER_STAGE', `${o.no}: ${stage}`)] } } }
}

export function requestBill(state: DataState, orderId: string): { changes: Changes } {
  const o = state.foodOrders[orderId]
  if (!o) throw new OpError('That order no longer exists.')
  if (o.status !== 'open') throw new OpError('This order is already settled.')
  if (!activeLines(o).length) throw new OpError('There is nothing to bill yet.')
  return { changes: { put: { foodOrders: [{ ...o, requestedBill: true }] } } }
}

export function cancelOrder(state: DataState, orderId: string, reason: string, ctx: OpCtx): { changes: Changes } {
  const o = state.foodOrders[orderId]
  if (!o) throw new OpError('That order no longer exists.')
  if (o.status !== 'open') throw new OpError('This order is already settled.')
  return { changes: { put: { foodOrders: [{ ...o, status: 'cancelled', cancelledAt: ctx.now, cancelReason: reason.trim() }], audit: [audit(ctx, 'FOOD_ORDER_CANCEL', `${o.no}${reason ? ` — ${reason}` : ''}`)] } } }
}

// ───────────────────────────── merge & split ─────────────────────────────

/** Combines two seated tables' orders into one bill: `otherId`'s tables and lines join `primaryId`, and `otherId` is closed. */
export function mergeOrders(state: DataState, primaryId: string, otherId: string, ctx: OpCtx): { changes: Changes; order: FoodOrder } {
  if (primaryId === otherId) throw new OpError('Choose two different tables to merge.')
  const a = state.foodOrders[primaryId]
  const b = state.foodOrders[otherId]
  if (!a || !b) throw new OpError('That order no longer exists.')
  if (a.status !== 'open' || b.status !== 'open') throw new OpError('Both orders must still be open.')
  if (a.kind !== 'dine_in' || b.kind !== 'dine_in') throw new OpError('Only dine-in tables can be merged.')
  const merged: FoodOrder = { ...a, tableIds: [...new Set([...a.tableIds, ...b.tableIds])], lines: [...a.lines, ...b.lines] }
  const closed: FoodOrder = { ...b, status: 'cancelled', cancelledAt: ctx.now, cancelReason: `Merged into ${a.no}` }
  return { order: merged, changes: { put: { foodOrders: [merged, closed], audit: [audit(ctx, 'FOOD_TABLE_MERGE', `${b.no} merged into ${a.no}`)] } } }
}

/** Splits an open order into one new order per group, each settled on its own; the original closes once every active
 *  line has gone to exactly one group. */
export function splitOrderByItems(state: DataState, orderId: string, groups: SplitGroup[], ctx: OpCtx): { changes: Changes; orders: FoodOrder[] } {
  const o = state.foodOrders[orderId]
  if (!o) throw new OpError('That order no longer exists.')
  if (o.status !== 'open') throw new OpError('This order is already settled.')
  if (groups.length < 2) throw new OpError('Split into at least two.')
  const left = unassigned(o, groups)
  if (left.length) throw new OpError('Every item must go to someone before splitting the bill.')
  const byId = new Map(o.lines.map((l) => [l.id, l]))
  const orders: FoodOrder[] = groups.map((g, i) => ({
    ...o, id: id('fod', ctx.now + i + 1), no: `${o.no}-${i + 1}`, status: 'open', requestedBill: false, parentOrderId: o.id,
    lines: g.lineIds.map((lid) => byId.get(lid)).filter((l): l is FoodOrderLine => !!l), openedAt: ctx.now, openedBy: ctx.userId,
  }))
  const closed: FoodOrder = { ...o, status: 'cancelled', cancelledAt: ctx.now, cancelReason: `Split into ${groups.length} bills` }
  return { orders, changes: { put: { foodOrders: [closed, ...orders], audit: [audit(ctx, 'FOOD_BILL_SPLIT', `${o.no} split into ${groups.length}`)] } } }
}

// ───────────────────────────── tips ─────────────────────────────

export interface TipDraft { billId?: string; orderId?: string; amount: number; mode: TipMode; waiterId?: string; note?: string }

export function collectTip(state: DataState, d: TipDraft, ctx: OpCtx): { changes: Changes; tip: FoodTip } {
  if (!(d.amount > 0)) throw new OpError('Enter the tip amount.')
  const tip: FoodTip = {
    id: id('ftp', ctx.now), billId: d.billId, orderId: d.orderId, amount: d.amount, mode: d.mode, waiterId: d.waiterId,
    note: (d.note ?? '').trim(), date: ctx.now, userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  return { tip, changes: { put: { foodTips: [tip] }, audit: [audit(ctx, 'FOOD_TIP', `₹${d.amount}${d.waiterId ? ` for ${d.waiterId}` : ''}`)] } }
}

export { orderSubtotal, openOrderForTable, openCounterOrders }
