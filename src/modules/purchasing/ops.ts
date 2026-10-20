import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { audit, OpCtx, OpError } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { nextNo } from '../numbering'
import { poTotal, statusFor } from './logic'
import type { PoLine, PoStatus, PurchaseOrder } from './types'
import './replication'

export interface PoDraft {
  supplierId: string
  expectedDate?: number
  notes: string
  items: Array<{ variantId: string; qty: number; cost: number }>
}

/** Creates a purchase order, or edits one that nothing has arrived for yet. */
export function savePurchaseOrder(state: DataState, d: PoDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; order: PurchaseOrder } {
  if (!state.suppliers[d.supplierId]) throw new OpError('Choose a supplier.')
  const items: PoLine[] = []
  for (const l of d.items) {
    if (!state.variants[l.variantId]) throw new OpError('One of the items no longer exists.')
    if (!(l.qty > 0)) throw new OpError('Every line needs a quantity.')
    if (!(l.cost >= 0)) throw new OpError('A cost cannot be negative.')
    const dup = items.find((i) => i.variantId === l.variantId)
    if (dup) dup.qty += l.qty
    else items.push({ variantId: l.variantId, qty: l.qty, cost: round2(l.cost), receivedQty: 0 })
  }
  if (!items.length) throw new OpError('Add at least one item to the order.')

  if (existingId) {
    const cur = state.purchaseOrders[existingId]
    if (!cur) throw new OpError('That purchase order no longer exists.')
    if (cur.status !== 'draft' && cur.status !== 'sent') throw new OpError('Only a draft or a sent order that has nothing received can be edited.')
    const order: PurchaseOrder = { ...cur, supplierId: d.supplierId, expectedDate: d.expectedDate, notes: d.notes.trim(), items, total: poTotal(items) }
    return { order, changes: { put: { purchaseOrders: [order], audit: [audit(ctx, 'PO_EDIT', `${cur.no} — ₹${order.total}`)] } } }
  }
  const order: PurchaseOrder = {
    id: id('po_', ctx.now), no: nextNo('PO-', listOf(state.purchaseOrders).map((p) => p.no), ctx), supplierId: d.supplierId, date: ctx.now,
    expectedDate: d.expectedDate, status: 'draft', items, total: poTotal(items), notes: d.notes.trim(), createdBy: ctx.userId,
    ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  return { order, changes: { put: { purchaseOrders: [order], audit: [audit(ctx, 'PO_CREATE', `${order.no} — ₹${order.total}`)] } } }
}

/** Moves an order along: send it to the supplier, take it back to draft, or cancel what has not arrived. */
export function setPoStatus(state: DataState, orderId: string, to: Extract<PoStatus, 'draft' | 'sent' | 'cancelled'>, ctx: OpCtx): { changes: Changes; order: PurchaseOrder } {
  const cur = state.purchaseOrders[orderId]
  if (!cur) throw new OpError('That purchase order no longer exists.')
  if (cur.status === 'received') throw new OpError('This order has been fully received.')
  if (cur.status === 'cancelled') throw new OpError('This order is cancelled.')
  const got = cur.items.some((i) => i.receivedQty > 0)
  if (to === 'draft' && (got || cur.status !== 'sent')) throw new OpError('Only a sent order with nothing received can go back to draft.')
  if (to === 'sent' && cur.status !== 'draft') throw new OpError('Only a draft can be sent.')
  const order: PurchaseOrder = { ...cur, status: to === 'cancelled' ? 'cancelled' : statusFor(to, cur.items) }
  const word = { draft: 'back to draft', sent: 'sent', cancelled: 'cancelled' }[to]
  return { order, changes: { put: { purchaseOrders: [order], audit: [audit(ctx, 'PO_STATUS', `${cur.no} ${word}`)] } } }
}

/** A draft that was never sent can simply be deleted. */
export function deletePurchaseOrder(state: DataState, orderId: string, ctx: OpCtx): { changes: Changes } {
  const cur = state.purchaseOrders[orderId]
  if (!cur) throw new OpError('That purchase order no longer exists.')
  if (cur.status !== 'draft') throw new OpError('Only a draft can be deleted — cancel an order that has been sent.')
  return { changes: { del: { purchaseOrders: [orderId] }, put: { audit: [audit(ctx, 'PO_DELETE', cur.no)] } } }
}
