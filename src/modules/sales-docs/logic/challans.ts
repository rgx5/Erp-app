import { round3 } from '@/domain/qty'
import type { Challan, ChallanLine, ChallanStatus, DocLine, SalesOrder } from '../types'

export const CHALLAN_LABEL: Record<ChallanStatus, string> = { packed: 'Packed', dispatched: 'On the way', delivered: 'Delivered' }
export const CHALLAN_STEPS: ChallanStatus[] = ['packed', 'dispatched', 'delivered']

/** The next step a challan can take, or null once delivered. */
export const nextChallanStatus = (s: ChallanStatus): ChallanStatus | null => CHALLAN_STEPS[CHALLAN_STEPS.indexOf(s) + 1] ?? null

export const linesFromDoc = (items: DocLine[]): ChallanLine[] => items.map((i) => ({ variantId: i.variantId, name: i.name, sku: i.sku, qty: i.qty, ...(i.unit ? { unit: i.unit } : {}) }))

/** How much of an order has already gone out on challans (all but cancelled — there is no cancelled state; every challan counts). */
export function dispatchedQty(order: Pick<SalesOrder, 'id'>, challans: Challan[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of challans) {
    if (c.orderId !== order.id) continue
    for (const l of c.items) if (l.variantId) m.set(l.variantId, round3((m.get(l.variantId) ?? 0) + l.qty))
  }
  return m
}

/** What is left to dispatch for an order (lines with nothing left are dropped). */
export function undispatched(order: SalesOrder, challans: Challan[]): ChallanLine[] {
  const done = dispatchedQty(order, challans)
  return linesFromDoc(order.items)
    .map((l) => ({ ...l, qty: round3(l.qty - (done.get(l.variantId ?? '') ?? 0)) }))
    .filter((l) => l.qty > 0)
}
