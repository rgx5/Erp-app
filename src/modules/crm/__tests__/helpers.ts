import { baseState, billInput, ctx, customer, line, NOW } from '@/data/__tests__/helpers'
import { processReturn, saveBill } from '@/data/ops'
import { applyChanges, type Changes, type DataState } from '@/data/state'
import '../replication'

export { baseState, ctx, NOW, customer }
export const DAY = 86_400_000

export const commit = (s: DataState, r: { changes: Changes } | Changes): DataState => applyChanges(s, 'changes' in r ? r.changes : r)

/** A shop with four customers: Meera (c1), Arjun (c2), Priya (c3) and Zed (c4, nothing bought, no phone). */
export function shop(): DataState {
  const s = baseState()
  s.customers = {
    c1: customer({ id: 'c1', name: 'Meera Iyer', phone: '9876543210', dob: '1990-10-25', createdAt: NOW - 400 * DAY }),
    c2: customer({ id: 'c2', name: 'Arjun Rao', phone: '9876500002', dob: '1985-11-02', anniversary: '2015-10-19', createdAt: NOW - 200 * DAY, tags: ['VIP'] }),
    c3: customer({ id: 'c3', name: 'Priya Shah', phone: '9876500003', createdAt: NOW - 10 * DAY }),
    c4: customer({ id: 'c4', name: 'Zed', phone: '', createdAt: NOW - 5 * DAY }),
  }
  return s
}

/** Sells `qty` shirts (₹999 each) to a customer on a given day. */
export function sell(s: DataState, customerId: string, qty: number, daysAgo: number): { state: DataState; billId: string } {
  const at = NOW - daysAgo * DAY
  const r = saveBill(s, billInput(s, [line(s.variants.v1, qty)], { customerId, date: at }), ctx({ now: at }))
  return { state: commit(s, r), billId: r.bill.id }
}

export const returnAll = (s: DataState, billId: string, daysAgo = 0): DataState => {
  const bill = s.bills[billId]
  const at = NOW - daysAgo * DAY
  const r = processReturn(s, billId, bill.items.map((i) => ({ variantId: i.variantId, qty: i.qty })), 'cash', ctx({ now: at }), 'test')
  return commit(s, r)
}
