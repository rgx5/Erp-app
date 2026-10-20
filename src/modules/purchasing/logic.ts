import type { Purchase } from '@/domain/types'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import type { PoLine, PoStatus, PurchaseOrder } from './types'

export const poTotal = (items: Array<Pick<PoLine, 'qty' | 'cost'>>) => round2(items.reduce((s, i) => s + i.qty * i.cost, 0))

/** Still to arrive on a line (never negative). */
export const remaining = (l: PoLine) => Math.max(0, round3(l.qty - l.receivedQty))

/** The status an order has once its receipts are counted: nothing arrived keeps it sent/draft; some → partial; all → received. */
export function statusFor(status: PoStatus, items: PoLine[]): PoStatus {
  if (status === 'cancelled') return status
  const got = items.reduce((s, i) => s + i.receivedQty, 0)
  if (items.length && items.every((i) => remaining(i) === 0)) return 'received'
  return got > 0 ? 'partial' : status === 'partial' || status === 'received' ? 'sent' : status
}

/** What a goods receipt that names an order does to that order. Pure: the phone and the server run exactly this. */
export function orderAfterReceipt(po: PurchaseOrder, receipt: Pick<Purchase, 'items'>): Partial<PurchaseOrder> {
  const items = po.items.map((l) => {
    const got = receipt.items.filter((x) => x.variantId === l.variantId).reduce((s, x) => s + x.qty, 0)
    return got ? { ...l, receivedQty: round3(l.receivedQty + got) } : l
  })
  return { items, status: statusFor(po.status, items) }
}

export const isOpen = (po: PurchaseOrder) => po.status === 'sent' || po.status === 'partial'
export const isOverdue = (po: PurchaseOrder, now: number) => isOpen(po) && !!po.expectedDate && po.expectedDate < now - 86_400_000
export const STATUS_LABEL: Record<PoStatus, string> = { draft: 'Draft', sent: 'Sent', partial: 'Part received', received: 'Received', cancelled: 'Cancelled' }
