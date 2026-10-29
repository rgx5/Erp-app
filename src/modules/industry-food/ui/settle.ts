import { useCart } from '@/features/cart'
import type { DataState } from '@/data/state'
import type { FoodDelivery, FoodOrder } from '../types'
import { deliveryToCartLines } from '../logic/delivery'
import { orderLabel, orderToCartLines } from '../logic/orders'
import { EXT, type FoodCheckoutExtra } from '../hooks'

/** Loads a table/takeaway/delivery order into the shared cart and hands off to the existing checkout screen — settling
 *  it is then an ordinary bill; `foodBillHook` closes the order once that bill is saved. */
export function settleOrderToCart(state: DataState, order: FoodOrder) {
  const cart = useCart.getState()
  cart.clear()
  cart.setLines(orderToCartLines(state, order))
  if (order.customerId) cart.set({ customerId: order.customerId })
  const extra: FoodCheckoutExtra = { orderIds: [order.id], kind: order.kind, label: orderLabel(state, order) }
  cart.setExtra(EXT, extra)
}

export function settleDeliveryToCart(state: DataState, delivery: FoodDelivery) {
  const cart = useCart.getState()
  cart.clear()
  cart.setLines(deliveryToCartLines(state, delivery))
  if (delivery.customerId) cart.set({ customerId: delivery.customerId })
  const extra: FoodCheckoutExtra = { deliveryId: delivery.id, kind: 'delivery', label: `Delivery to ${delivery.partyName}` }
  cart.setExtra(EXT, extra)
}
