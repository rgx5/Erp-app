import { round2 } from '@/domain/money'
import { listOf, type DataState } from '@/data/state'
import { activeLines, orderSubtotal } from './orders'
import { pendingLines } from './kot'
import { floorBoard } from './tables'

const DAY = 86_400_000

export interface FoodAlerts {
  tablesWaitingBill: number
  openOrdersValue: number
  kotsWaiting: number
  openDeliveries: number
  staleOrders: number
}

/** What is worth a look right now: tables waiting to be billed, orders still unsent to the kitchen, and deliveries out. */
export function foodAlerts(state: DataState, now: number): FoodAlerts {
  const board = floorBoard(state)
  const open = listOf(state.foodOrders).filter((o) => o.status === 'open')
  return {
    tablesWaitingBill: board.billing,
    openOrdersValue: round2(open.reduce((s, o) => s + orderSubtotal(o), 0)),
    kotsWaiting: open.reduce((s, o) => s + pendingLines(activeLines(o)).length, 0),
    openDeliveries: listOf(state.foodDeliveries).filter((d) => d.status === 'placed' || d.status === 'out').length,
    staleOrders: open.filter((o) => now - o.openedAt > 3 * 3_600_000).length,
  }
}

/** A simple day summary for the Reports hub: orders settled, their value, and tips collected. */
export function dayFoodSummary(state: DataState, dayStart: number) {
  const dayEnd = dayStart + DAY
  const billed = listOf(state.foodOrders).filter((o) => o.status === 'billed' && (o.billedAt ?? 0) >= dayStart && (o.billedAt ?? 0) < dayEnd)
  const delivered = listOf(state.foodDeliveries).filter((d) => d.status === 'delivered' && (d.deliveredAt ?? 0) >= dayStart && (d.deliveredAt ?? 0) < dayEnd)
  const tips = listOf(state.foodTips).filter((t) => t.date >= dayStart && t.date < dayEnd)
  return {
    orders: billed.length, deliveries: delivered.length,
    tips: round2(tips.reduce((s, t) => s + t.amount, 0)),
    byKind: { dine_in: billed.filter((o) => o.kind === 'dine_in').length, takeaway: billed.filter((o) => o.kind === 'takeaway').length, delivery: billed.filter((o) => o.kind === 'delivery').length },
  }
}
