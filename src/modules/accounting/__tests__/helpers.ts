import { baseState, billInput, ctx, line, NOW } from '@/data/__tests__/helpers'
import { addExpense, closeDay, openDay, processReturn, receivePurchase, saveBill } from '@/data/ops'
import { applyChanges, type Changes, type DataState } from '@/data/state'
import type { StockMove } from '@/domain/types'
import { GST_PAYMENT_CATEGORY } from '@/domain/analytics'
import '../postings'
import '../replication'

export { baseState, billInput, ctx, line, NOW }

export const DAY = 86_400_000
export const commit = (s: DataState, r: { changes: Changes } | Changes): DataState => applyChanges(s, 'changes' in r ? r.changes : r)

/** The opening stock of the base state, as the movements the app writes when items are created. */
export function withOpeningStock(s: DataState): DataState {
  const moves: StockMove[] = Object.values(s.variants).map((v) => ({ id: `mv_open_${v.id}`, variantId: v.id, qty: v.stock, type: 'opening', ref: 'OPENING', reason: 'Opening stock', at: NOW - 30 * DAY, userId: 'u_owner' }))
  return commit(s, { put: { moves } })
}

/**
 * A month of trading: opening stock, a cash sale, a part-cash part-credit sale to Meera, a UPI sale, a return, a goods
 * receipt part-paid, three expenses (one is GST paid to the government) and a day close that came up short.
 */
export function trading(): DataState {
  let s = withOpeningStock(baseState())
  const at = (days: number) => ctx({ now: NOW - days * DAY })
  const sell = (lines: ReturnType<typeof line>[], over: Parameters<typeof billInput>[2] = {}, days = 0) => {
    const r = saveBill(s, billInput(s, lines, { date: NOW - days * DAY, ...over }), at(days))
    s = commit(s, r)
    return r.bill
  }
  sell([line(s.variants.v1, 2)], {}, 9)
  const t = billInput(s, [line(s.variants.v2, 1)]).total
  sell([line(s.variants.v2, 1)], { customerId: 'c1', payments: [{ mode: 'cash', amount: 400 }, { mode: 'due', amount: t - 400 }], paid: 400 }, 7)
  const upi = sell([line(s.variants.v1, 1)], { payments: [{ mode: 'upi', amount: billInput(s, [line(s.variants.v1, 1)]).total }] }, 5)
  s = commit(s, processReturn(s, upi.id, [{ variantId: 'v1', qty: 1 }], 'cash', at(3)))
  s = commit(s, receivePurchase(s, { supplierId: 's1', date: NOW - 6 * DAY, invoiceRef: 'F-1', items: [{ variantId: 'v1', qty: 10, cost: 400 }], total: 4000, paid: 1500, notes: '' }, at(6)))
  s = commit(s, addExpense({ date: NOW - 4 * DAY, category: 'Rent', amount: 1200, mode: 'cash', vendor: 'Landlord', note: '', recurring: false }, at(4)))
  s = commit(s, addExpense({ date: NOW - 2 * DAY, category: 'Electricity', amount: 300, mode: 'bank', vendor: '', note: '', recurring: false }, at(2)))
  s = commit(s, addExpense({ date: NOW - 1 * DAY, category: GST_PAYMENT_CATEGORY, amount: 100, mode: 'bank', vendor: '', note: '', recurring: false }, at(1)))
  const open = openDay(s, 500, at(1))
  s = commit(s, open)
  s = commit(s, closeDay(s, open.session.id, 450, at(1)))
  return s
}
