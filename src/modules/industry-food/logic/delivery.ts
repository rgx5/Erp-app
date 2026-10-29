import { round2 } from '@/domain/money'
import type { CartLine } from '@/domain/cart'
import { type DataState } from '@/data/state'
import type { DeliveryStatus, FoodDelivery } from '../types'

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = { placed: 'Placed', out: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' }
/** Allowed next steps from a status; a delivered or cancelled order is final. */
export const DELIVERY_NEXT: Record<DeliveryStatus, DeliveryStatus[]> = { placed: ['out', 'cancelled'], out: ['delivered', 'cancelled'], delivered: [], cancelled: [] }

export const deliveryItemsTotal = (d: Pick<FoodDelivery, 'lines'>) => round2(d.lines.reduce((s, l) => s + l.price * l.qty, 0))
export const deliveryTotal = (d: Pick<FoodDelivery, 'lines' | 'deliveryCharge'>) => round2(deliveryItemsTotal(d) + (d.deliveryCharge || 0))

/** Turns a delivery's lines into cart lines for checkout, once it is ready to become a bill. The delivery charge is left
 *  for the person settling it to add at checkout the same way any other charge would be (it is not an item). */
export function deliveryToCartLines(state: DataState, d: FoodDelivery): CartLine[] {
  return d.lines.map((l) => {
    const v = state.variants[l.variantId]
    const p = v ? state.products[v.productId] : undefined
    return {
      variantId: l.variantId, productId: v?.productId, sku: v?.sku ?? '', barcode: v?.barcode ?? '', name: l.name, size: '', color: '',
      hsn: v?.hsn ?? p?.hsn ?? '', mrp: Math.max(v?.mrp ?? l.price, l.price), price: l.price, qty: l.qty, stock: v?.stock ?? 0,
      discountType: 'amt', discountValue: 0, noStock: p ? p.trackStock === false : true, unit: p?.unit, cost: v?.avgCost ?? v?.cost,
      ext: { industryFood: { deliveryId: d.id } },
    }
  })
}

export function settleProblem(d: Pick<FoodDelivery, 'status' | 'lines'>): string | null {
  if (d.status === 'delivered') return 'This delivery is already billed.'
  if (d.status === 'cancelled') return 'This delivery was cancelled.'
  if (!d.lines.length) return 'Add at least one item.'
  return null
}
