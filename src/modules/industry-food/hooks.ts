import { audit, OpError } from '@/data/ops'
import { mergeChanges, type Changes, type DataState } from '@/data/state'
import { id } from '@/domain/ids'
import { inr, round2 } from '@/domain/money'
import type { Bill } from '@/domain/types'
import type { BillHook, ReceiptExtra } from '@/modules/registry'
import type { FoodModifierPick, FoodOrderKind, FoodTip, TipMode } from './types'

/** The key this module's data lives under in `bill.ext` and `cartLine.ext` (see `logic/orders.ts` / `logic/delivery.ts`). */
export const EXT = 'industry-food'

/** What the settle screen writes to `useCart().extras['industry-food']` before checkout — read back here when the bill
 *  is saved, so the order (or delivery) it came from can be closed in the same transaction as the bill. */
export interface FoodCheckoutExtra {
  orderIds?: string[]
  deliveryId?: string
  kind?: FoodOrderKind
  label?: string
  tip?: number
  tipMode?: TipMode
}

const extraOf = (bill: Pick<Bill, 'ext'>) => bill.ext?.[EXT] as FoodCheckoutExtra | undefined

/**
 * Settling a table, a takeaway/delivery order or a grocery home delivery is just an ordinary bill — this hook closes
 * the order (or delivery) it came from in the same transaction, and files a tip if one was added at checkout.
 */
export const foodBillHook: BillHook = {
  id: EXT,
  beforeSave: ({ state, bill }) => {
    const extra = extraOf(bill)
    for (const orderId of extra?.orderIds ?? []) {
      const o = state.foodOrders[orderId]
      if (!o) throw new OpError('That order no longer exists.')
      if (o.status !== 'open') throw new OpError(`${o.no} has already been settled.`)
    }
    if (extra?.deliveryId) {
      const d = state.foodDeliveries[extra.deliveryId]
      if (!d) throw new OpError('That delivery no longer exists.')
      if (d.status === 'delivered' || d.status === 'cancelled') throw new OpError(`${d.no} is already ${d.status}.`)
    }
  },
  onSave: ({ state, ctx, bill }) => {
    const extra = extraOf(bill)
    if (!extra) return null
    const parts: Changes[] = []
    for (const orderId of extra.orderIds ?? []) {
      const o = state.foodOrders[orderId]
      if (!o || o.status !== 'open') continue
      const lines = o.lines.map((l) => (l.voided ? l : { ...l, status: 'served' as const }))
      parts.push({ put: { foodOrders: [{ ...o, lines, status: 'billed', billedAt: ctx.now, billId: bill.id, requestedBill: true, ...(o.kind !== 'dine_in' ? { stage: 'completed' as const } : {}) }] } })
    }
    if (extra.deliveryId) {
      const d = state.foodDeliveries[extra.deliveryId]
      if (d && d.status !== 'delivered' && d.status !== 'cancelled') {
        parts.push({ put: { foodDeliveries: [{ ...d, status: 'delivered', deliveredAt: ctx.now, billId: bill.id }] } })
      }
    }
    if (extra.tip && extra.tip > 0) {
      const tip: FoodTip = {
        id: id('ftp', ctx.now), billId: bill.id, orderId: extra.orderIds?.[0], amount: round2(extra.tip), mode: extra.tipMode ?? 'cash',
        waiterId: bill.soldBy, note: '', date: ctx.now, userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      }
      parts.push({ put: { foodTips: [tip], audit: [audit(ctx, 'FOOD_TIP', `₹${tip.amount} with ${bill.no}`)] } })
    }
    return parts.length ? mergeChanges(...parts) : null
  },
}

const modifiersOf = (ext: Record<string, unknown> | undefined): FoodModifierPick[] => {
  const fx = ext?.[EXT] as { modifiers?: FoodModifierPick[] } | undefined
  return fx?.modifiers ?? []
}
const noteOf = (ext: Record<string, unknown> | undefined) => (ext?.[EXT] as { notes?: string } | undefined)?.notes ?? ''

/** Under an item on the printed bill: its modifiers and any note; in the header, the table/order it was for; a tip in the footer. */
export const foodReceiptExtra: ReceiptExtra = {
  id: EXT,
  header: (bill) => {
    const extra = extraOf(bill)
    if (!extra?.label) return []
    return [extra.kind === 'dine_in' ? `Table ${extra.label}` : extra.label]
  },
  item: (item) => {
    const mods = modifiersOf(item.ext)
    const note = noteOf(item.ext)
    const bits = [...mods.map((m) => m.name), ...(note ? [note] : [])]
    return bits.length ? bits.join(', ') : null
  },
  footer: (bill, state: DataState) => {
    void state
    const extra = extraOf(bill)
    return extra?.tip ? [`Tip: ${inr(extra.tip, 0)}`] : []
  },
}
