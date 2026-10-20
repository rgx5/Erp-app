import { billInput, line } from '@/data/__tests__/helpers'
import { OpError, saveBill } from '@/data/ops'
import { listOf } from '@/data/state'
import { rig } from '@/replication/testkit'
import { isBalanced, postingsFor } from '@/modules/postings'
import { buildInstalments, layawayStatus, orderMoney, overdueLayaways, reservedByVariant, reservedQty, advanceOnHand, advanceSource } from '../logic/orders'
import { orderHtml, orderText } from '../html'
import { cancelOrder, deleteSalesOrder, refundOrderPayment, saveSalesOrder, setOrderReady, takeOrderPayment } from '../ops'
import { applyMutations } from '@/replication'
import { baseState, commit, ctx, dl, NOW, installBillHook } from './helpers'

const DAY = 86_400_000
const draftFor = (s = baseState(), over: Record<string, unknown> = {}) => ({
  customerId: 'c1', items: [dl(s, 'v1', 2), dl(s, 'v2', 1)], billDiscountType: 'amt' as const, billDiscountValue: 0, expectedDate: NOW + 7 * DAY, notes: '', ...over,
})

function withOrder(over: Record<string, unknown> = {}) {
  let s = baseState()
  const o = saveSalesOrder(s, draftFor(s, over), undefined, ctx()).order
  s = commit(s, { put: { salesOrders: [o] } })
  return { s, o }
}

describe('sales orders', () => {
  test('an order needs a customer and priced lines, is numbered, and totals like a bill', () => {
    const s = baseState()
    expect(() => saveSalesOrder(s, draftFor(s, { customerId: 'nobody' }), undefined, ctx())).toThrow('customer')
    const { order } = saveSalesOrder(s, draftFor(s), undefined, ctx())
    expect(order.no).toBe('SO-0001')
    expect(order.status).toBe('open')
    expect(order.total).toBe(2997) // 3 × ₹999, GST inclusive
  })

  test('advance: money in, balance falls, over-payment refused, refunds limited to what is held', () => {
    let { s, o } = withOrder()
    s = commit(s, takeOrderPayment(s, o.id, { amount: 1000, mode: 'upi', ref: 'T1' }, ctx({ now: NOW + 1 })))
    let m = orderMoney(o, listOf(s.orderPayments))
    expect(m).toMatchObject({ received: 1000, paidIn: 1000, onHand: 1000, toPay: 1997 })
    expect(() => takeOrderPayment(s, o.id, { amount: 5000, mode: 'cash' }, ctx())).toThrow('more than the order’s balance'.replace('’', "'"))
    expect(() => takeOrderPayment(s, o.id, { amount: 0, mode: 'cash' }, ctx())).toThrow('amount received')
    expect(() => refundOrderPayment(s, o.id, { amount: 1500, mode: 'cash' }, ctx())).toThrow('Only ₹1000 of advance')
    s = commit(s, refundOrderPayment(s, o.id, { amount: 300, mode: 'cash' }, ctx({ now: NOW + 2 })))
    m = orderMoney(o, listOf(s.orderPayments))
    expect(m).toMatchObject({ received: 1000, refunded: 300, paidIn: 700, onHand: 700, toPay: 2297 })
  })

  test('stock is reserved by open orders and released when they close', () => {
    let { s, o } = withOrder()
    expect(reservedQty(s, 'v1')).toBe(2)
    expect(reservedQty(s, 'v2')).toBe(1)
    expect(reservedByVariant(s).get('v1')).toBe(2)
    s = commit(s, setOrderReady(s, o.id, true, ctx()))
    expect(reservedQty(s, 'v1')).toBe(2) // ready still holds the goods
    s = commit(s, cancelOrder(s, o.id, null, ctx()))
    expect(reservedQty(s, 'v1')).toBe(0)
  })

  test('cancelling must say where held advance goes; a mistaken order with no money can be deleted', () => {
    let { s, o } = withOrder()
    expect(deleteSalesOrder(s, o.id, ctx()).changes.del!.salesOrders).toEqual([o.id])
    s = commit(s, takeOrderPayment(s, o.id, { amount: 500, mode: 'cash' }, ctx({ now: NOW + 1 })))
    expect(() => deleteSalesOrder(s, o.id, ctx())).toThrow('cancel it instead')
    expect(() => cancelOrder(s, o.id, null, ctx())).toThrow('choose how it is given back')
    const done = commit(s, cancelOrder(s, o.id, { mode: 'cash' }, ctx({ now: NOW + 2 })))
    expect(done.salesOrders[o.id].status).toBe('cancelled')
    expect(orderMoney(o, listOf(done.orderPayments))).toMatchObject({ paidIn: 0, onHand: 0 })
    expect(() => takeOrderPayment(done, o.id, { amount: 1, mode: 'cash' }, ctx())).toThrow('closed')
  })

  test('editing is blocked once a bill has used the advance, and cannot cut the total below what was paid', () => {
    let { s, o } = withOrder()
    s = commit(s, takeOrderPayment(s, o.id, { amount: 2000, mode: 'cash' }, ctx({ now: NOW + 1 })))
    expect(() => saveSalesOrder(s, draftFor(s, { items: [dl(s, 'v1', 1)] }), o.id, ctx())).toThrow('paid in')
    expect(saveSalesOrder(s, draftFor(s, { notes: 'gift wrap' }), o.id, ctx()).order.notes).toBe('gift wrap')
  })
})

describe('layaway', () => {
  test('instalments split the total and the last takes the remainder', () => {
    const plan = buildInstalments(1000, 3, NOW, 30)
    expect(plan.map((p) => p.amount)).toEqual([333.33, 333.33, 333.34])
    expect(plan[1].dueDate - plan[0].dueDate).toBe(30 * DAY)
    expect(() => saveSalesOrder(baseState(), draftFor(baseState(), { instalments: [{ dueDate: NOW, amount: 100 }] }), undefined, ctx())).toThrow('add up to')
  })

  test('each instalment is paid once the money received covers it; the first unpaid is due or overdue', () => {
    const order = { instalments: [{ dueDate: NOW - 10 * DAY, amount: 1000 }, { dueDate: NOW + 5 * DAY, amount: 1000 }, { dueDate: NOW + 20 * DAY, amount: 997 }] }
    const none = layawayStatus(order, 0, NOW)
    expect(none.rows.map((r) => r.state)).toEqual(['overdue', 'due', 'upcoming'])
    expect(none.overdue).toBe(1)
    expect(none.overdueAmount).toBe(1000)
    expect(none.next?.cumulative).toBe(1000)
    const some = layawayStatus(order, 1400, NOW)
    expect(some.rows.map((r) => r.state)).toEqual(['paid', 'due', 'upcoming'])
    expect(some.overdue).toBe(0)
    expect(layawayStatus(order, 2997, NOW).next).toBeNull()
  })

  test('overdue layaways are found from the data', () => {
    const s0 = baseState()
    const plan = [{ dueDate: NOW - 2 * DAY, amount: 1500 }, { dueDate: NOW + 20 * DAY, amount: 1497 }]
    let { s, o } = (() => { const o2 = saveSalesOrder(s0, draftFor(s0, { instalments: plan }), undefined, ctx()).order; return { s: commit(s0, { put: { salesOrders: [o2] } }), o: o2 } })()
    expect(overdueLayaways(s, NOW).map((x) => x.amount)).toEqual([1500])
    s = commit(s, takeOrderPayment(s, o.id, { amount: 1500, mode: 'cash' }, ctx({ now: NOW + 1 })))
    expect(overdueLayaways(s, NOW)).toEqual([])
  })
})

describe('fulfilling an order with its advance', () => {
  function ready() {
    installBillHook()
    let { s, o } = withOrder()
    s = commit(s, takeOrderPayment(s, o.id, { amount: 1000, mode: 'upi' }, ctx({ now: NOW + 1 })))
    return { s, o }
  }
  const lines = (s: ReturnType<typeof baseState>) => [line(s.variants.v1, 2), line(s.variants.v2, 1)]

  test('advance is offered only to a customer who holds some', () => {
    const { s, o } = ready()
    expect(advanceOnHand(s, 'c1')).toBe(1000)
    expect(advanceOnHand(s, 'someone-else')).toBe(0)
    expect(advanceOnHand(s, null)).toBe(0)
    expect(advanceSource(s, 'c1', o.id)?.order.id).toBe(o.id)
  })

  test('billing the order uses the advance, marks it delivered and links the bill', () => {
    const { s, o } = ready()
    const input = billInput(s, lines(s), { customerId: 'c1', ext: { 'sales-docs': { orderId: o.id } }, payments: [{ mode: 'advance', amount: 1000 }, { mode: 'cash', amount: 1997 }], paid: 2997 })
    const r = saveBill(s, input, ctx({ now: NOW + 9 }))
    const after = commit(s, r)
    expect(after.salesOrders[o.id]).toMatchObject({ status: 'delivered', billId: r.bill.id })
    const applied = listOf(after.orderPayments).filter((p) => p.kind === 'applied')
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ amount: 1000, billId: r.bill.id, orderId: o.id, mode: 'advance' })
    expect(advanceOnHand(after, 'c1')).toBe(0)
    expect(reservedQty(after, 'v1')).toBe(0)
  })

  test('using more advance than is held, or advance for someone who has none, is refused', () => {
    const { s, o } = ready()
    const tooMuch = billInput(s, lines(s), { customerId: 'c1', ext: { 'sales-docs': { orderId: o.id } }, payments: [{ mode: 'advance', amount: 1500 }, { mode: 'cash', amount: 1497 }], paid: 2997 })
    expect(() => saveBill(s, tooMuch, ctx())).toThrow('Only ₹1000 of advance')
    const stranger = billInput(s, lines(s), { customerId: null, payments: [{ mode: 'advance', amount: 100 }, { mode: 'cash', amount: 2897 }], paid: 2997 })
    expect(() => saveBill(s, stranger, ctx())).toThrow(OpError)
    expect(() => saveBill(s, stranger, ctx())).toThrow('No advance is held')
  })

  test('a closed order cannot be billed again', () => {
    const { s, o } = ready()
    const input = billInput(s, lines(s), { customerId: 'c1', ext: { 'sales-docs': { orderId: o.id } } })
    const after = commit(s, saveBill(s, input, ctx({ now: NOW + 9 })))
    expect(() => saveBill(after, input, ctx())).toThrow('already delivered')
  })

  test('using advance without fulfilling draws on the oldest order that holds some', () => {
    const { s, o } = ready()
    const input = billInput(s, [line(s.variants.v1, 1)], { customerId: 'c1', payments: [{ mode: 'advance', amount: 400 }, { mode: 'cash', amount: 599 }], paid: 999 })
    const after = commit(s, saveBill(s, input, ctx({ now: NOW + 9 })))
    expect(after.salesOrders[o.id].status).toBe('open')
    expect(orderMoney(o, listOf(after.orderPayments))).toMatchObject({ applied: 400, onHand: 600 })
  })
})

describe('orders replicate and post to the books', () => {
  test('the server agrees with the phone through advance, refund, fulfilment', async () => {
    installBillHook()
    const r = rig(baseState())
    await r.seed()
    const made = await r.run((s) => saveSalesOrder(s, draftFor(s), undefined, ctx({ now: NOW + 1 })))
    await r.run((s) => takeOrderPayment(s, made.order.id, { amount: 1200, mode: 'cash' }, ctx({ now: NOW + 2 })))
    await r.run((s) => refundOrderPayment(s, made.order.id, { amount: 200, mode: 'cash' }, ctx({ now: NOW + 3 })))
    await r.run((s) => setOrderReady(s, made.order.id, true, ctx({ now: NOW + 4 })))
    await r.run((s) => saveBill(s, billInput(s, [line(s.variants.v1, 2), line(s.variants.v2, 1)], { customerId: 'c1', ext: { 'sales-docs': { orderId: made.order.id } }, payments: [{ mode: 'advance', amount: 1000 }, { mode: 'upi', amount: 1997 }], paid: 2997 }), ctx({ now: NOW + 5 })))
    const server = await r.serverView()
    expect(server.salesOrders).toEqual(r.phone.salesOrders)
    expect(server.orderPayments).toEqual(r.phone.orderPayments)
    expect(server.salesOrders[made.order.id].status).toBe('delivered')
    expect(listOf(server.orderPayments).map((p) => p.kind).sort()).toEqual(['advance', 'applied', 'refund'])
  })

  test('posted payments are immutable on the server', async () => {
    const r = rig(baseState())
    await r.seed()
    const made = await r.run((s) => saveSalesOrder(s, draftFor(s), undefined, ctx({ now: NOW + 1 })))
    const pay = await r.run((s) => takeOrderPayment(s, made.order.id, { amount: 100, mode: 'cash' }, ctx({ now: NOW + 2 })))
    const res = await applyMutations(r.db, [{ mid: 'x:1', coll: 'orderPayments', id: pay.payment.id, op: 'patch', data: { amount: 1 }, at: 1 }], { userId: 'u', can: () => true, branches: 'all' })
    expect(res[0]).toMatchObject({ status: 'rejected', code: 'immutable' })
  })

  test('advances and refunds post balanced entries against advances received', () => {
    let { s, o } = withOrder()
    s = commit(s, takeOrderPayment(s, o.id, { amount: 1000, mode: 'upi' }, ctx({ now: NOW + 1 })))
    s = commit(s, refundOrderPayment(s, o.id, { amount: 250, mode: 'cash' }, ctx({ now: NOW + 2 })))
    const ps = postingsFor(s).filter((p) => p.sourceColl === 'orderPayments')
    expect(ps).toHaveLength(2)
    expect(ps.every(isBalanced)).toBe(true)
    expect(ps[0].lines).toEqual([{ account: 'upi', debit: 1000 }, { account: 'advances_received', credit: 1000, party: { type: 'customer', id: 'c1' } }])
    expect(ps[1].lines).toEqual([{ account: 'cash', credit: 250 }, { account: 'advances_received', debit: 250, party: { type: 'customer', id: 'c1' } }])
  })

  test('the order printout and message say what was paid and what is left', () => {
    let { s, o } = withOrder()
    s = commit(s, takeOrderPayment(s, o.id, { amount: 1000, mode: 'upi' }, ctx({ now: NOW + 1 })))
    const money = orderMoney(o, listOf(s.orderPayments))
    const text = orderText(o, s.store!, 'Meera Rao', money)
    expect(text).toContain('Order SO-0001')
    expect(text).toContain('Advance received: ₹1,000')
    expect(text).toContain('Balance: ₹1,997')
    const html = orderHtml(o, s.store!, { name: 'Meera <script>' }, money)
    expect(html).toContain('SALES ORDER')
    expect(html).toContain('Meera &lt;script&gt;')
  })
})
