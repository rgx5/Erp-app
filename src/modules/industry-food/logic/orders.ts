import { round2 } from '@/domain/money'
import type { CartLine } from '@/domain/cart'
import { listOf, type DataState } from '@/data/state'
import type { FoodModifierPick, FoodOrder, FoodOrderKind, FoodOrderLine } from '../types'

export const KIND_LABEL: Record<FoodOrderKind, string> = { dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' }
export const STAGE_LABEL: Record<string, string> = { placed: 'Placed', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'Out for delivery', completed: 'Completed' }
export const STAGE_ORDER = ['placed', 'preparing', 'ready', 'out_for_delivery', 'completed'] as const

export const modifierTotal = (mods: FoodModifierPick[]) => round2(mods.reduce((s, m) => s + m.priceDelta, 0))
export const lineUnitPrice = (l: Pick<FoodOrderLine, 'price' | 'modifiers'>) => round2(l.price + modifierTotal(l.modifiers))
export const lineTotal = (l: Pick<FoodOrderLine, 'price' | 'qty' | 'modifiers'>) => round2(lineUnitPrice(l) * l.qty)

export const activeLines = (order: Pick<FoodOrder, 'lines'>): FoodOrderLine[] => order.lines.filter((l) => !l.voided)
export const orderSubtotal = (order: Pick<FoodOrder, 'lines'>) => round2(activeLines(order).reduce((s, l) => s + lineTotal(l), 0))
export const orderItemCount = (order: Pick<FoodOrder, 'lines'>) => activeLines(order).reduce((s, l) => s + l.qty, 0)

/** The open order touching a table, if any (dine-in orders are found this way; a table never stores its own order id). */
export const openOrderForTable = (state: DataState, tableId: string): FoodOrder | undefined =>
  listOf(state.foodOrders).find((o) => o.status === 'open' && o.tableIds.includes(tableId))

export const openCounterOrders = (state: DataState, kind: 'takeaway' | 'delivery'): FoodOrder[] =>
  listOf(state.foodOrders).filter((o) => o.status === 'open' && o.kind === kind).sort((a, b) => a.openedAt - b.openedAt)

/** "T4", "T4 + T5" (merged), "Takeaway #FO-0003", "Delivery to Meera" — for KOTs, lists and receipts. */
export function orderLabel(state: DataState, order: Pick<FoodOrder, 'kind' | 'tableIds' | 'no' | 'partyName'>): string {
  if (order.kind === 'dine_in') {
    const names = order.tableIds.map((id) => state.foodTables[id]?.no ?? '?')
    return names.length ? names.join(' + ') : order.no
  }
  return `${KIND_LABEL[order.kind]}${order.partyName ? ` · ${order.partyName}` : ` #${order.no}`}`
}

/** Turns an order's active lines into cart lines for the existing checkout flow. Each line carries the order and line id
 *  (and its modifiers) in `ext`, so the receipt can print them and the bill hook can find its way back to the order. */
export function orderToCartLines(state: DataState, order: FoodOrder): CartLine[] {
  return activeLines(order).map((l) => {
    const v = state.variants[l.variantId]
    const p = v ? state.products[v.productId] : undefined
    const price = lineUnitPrice(l)
    return {
      variantId: l.variantId, productId: v?.productId, sku: v?.sku ?? '', barcode: v?.barcode ?? '', name: l.name, size: '', color: '',
      hsn: v?.hsn ?? p?.hsn ?? '', mrp: Math.max(v?.mrp ?? price, price), price, qty: l.qty, stock: v?.stock ?? 0,
      discountType: 'amt', discountValue: 0, noStock: p ? p.trackStock === false : true, unit: p?.unit, cost: v?.avgCost ?? v?.cost,
      ext: { industryFood: { orderId: order.id, lineId: l.id, course: l.course, station: l.station, modifiers: l.modifiers, notes: l.notes } },
    }
  })
}

/** Why an order cannot be sent to checkout right now. */
export function settleProblem(order: Pick<FoodOrder, 'status' | 'lines'>): string | null {
  if (order.status !== 'open') return 'This order is already settled.'
  if (!activeLines(order).length) return 'Add at least one item before settling.'
  return null
}
