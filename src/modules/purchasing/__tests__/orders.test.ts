import { baseState, ctx, NOW } from '@/data/__tests__/helpers'
import { OpError, receivePurchase } from '@/data/ops'
import { listOf } from '@/data/state'
import { rig } from '@/replication/testkit'
import { deletePurchaseOrder, savePurchaseOrder, setPoStatus } from '../ops'
import { isOverdue, orderAfterReceipt, statusFor } from '../logic'

const draft = { supplierId: 's1', notes: ' urgent ', items: [{ variantId: 'v1', qty: 10, cost: 400 }, { variantId: 'v2', qty: 4, cost: 410 }, { variantId: 'v1', qty: 2, cost: 400 }] }

describe('purchase orders', () => {
  test('a new order is numbered, totalled and merges repeated lines', () => {
    const s = baseState()
    const { order } = savePurchaseOrder(s, draft, undefined, ctx())
    expect(order.no).toBe('PO-0001')
    expect(order.items).toEqual([{ variantId: 'v1', qty: 12, cost: 400, receivedQty: 0 }, { variantId: 'v2', qty: 4, cost: 410, receivedQty: 0 }])
    expect(order.total).toBe(12 * 400 + 4 * 410)
    expect(order.status).toBe('draft')
    expect(order.notes).toBe('urgent')
  })

  test('refuses nonsense', () => {
    const s = baseState()
    expect(() => savePurchaseOrder(s, { ...draft, supplierId: 'nope' }, undefined, ctx())).toThrow(OpError)
    expect(() => savePurchaseOrder(s, { ...draft, items: [] }, undefined, ctx())).toThrow('at least one item')
    expect(() => savePurchaseOrder(s, { ...draft, items: [{ variantId: 'v1', qty: 0, cost: 1 }] }, undefined, ctx())).toThrow('quantity')
  })

  test('a connected phone numbers from its own series', () => {
    const { order } = savePurchaseOrder(baseState(), draft, undefined, ctx({ series: 'M4X' }))
    expect(order.no).toBe('PO-M4X-0001')
  })

  test('status follows what has arrived', () => {
    const lines = [{ variantId: 'v1', qty: 10, cost: 1, receivedQty: 0 }, { variantId: 'v2', qty: 4, cost: 1, receivedQty: 0 }]
    expect(statusFor('sent', lines)).toBe('sent')
    expect(statusFor('sent', [{ ...lines[0], receivedQty: 3 }, lines[1]])).toBe('partial')
    expect(statusFor('sent', lines.map((l) => ({ ...l, receivedQty: l.qty })))).toBe('received')
    expect(statusFor('cancelled', lines.map((l) => ({ ...l, receivedQty: l.qty })))).toBe('cancelled')
  })

  test('draft → sent → cancel, with the rules', () => {
    let s = baseState()
    const { order, changes } = savePurchaseOrder(s, draft, undefined, ctx())
    s = { ...s, purchaseOrders: { [order.id]: order } }
    void changes
    expect(() => setPoStatus(s, order.id, 'draft', ctx())).toThrow('sent order')
    const sent = setPoStatus(s, order.id, 'sent', ctx()).order
    expect(sent.status).toBe('sent')
    s = { ...s, purchaseOrders: { [order.id]: sent } }
    expect(() => setPoStatus(s, order.id, 'sent', ctx())).toThrow('Only a draft')
    expect(() => deletePurchaseOrder(s, order.id, ctx())).toThrow('Only a draft')
    expect(setPoStatus(s, order.id, 'cancelled', ctx()).order.status).toBe('cancelled')
  })

  test('overdue only counts open orders past their date', () => {
    const base = { ...savePurchaseOrder(baseState(), draft, undefined, ctx()).order, expectedDate: NOW - 5 * 86_400_000 }
    expect(isOverdue({ ...base, status: 'sent' }, NOW)).toBe(true)
    expect(isOverdue({ ...base, status: 'received' }, NOW)).toBe(false)
    expect(isOverdue({ ...base, status: 'sent', expectedDate: undefined }, NOW)).toBe(false)
  })
})

describe('receiving against an order, phone and server together', () => {
  test('two part deliveries finish the order, and the server agrees with the phone every step', async () => {
    const r = rig(baseState())
    await r.seed()
    const made = await r.run((s) => savePurchaseOrder(s, draft, undefined, ctx({ now: NOW + 1 })))
    const po = made.order
    await r.run((s) => setPoStatus(s, po.id, 'sent', ctx({ now: NOW + 2 })))

    // first delivery: 5 of v1
    await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW + 3, invoiceRef: 'B1', items: [{ variantId: 'v1', qty: 5, cost: 405 }], total: 5 * 405, paid: 0, notes: '', poId: po.id }, ctx({ now: NOW + 3 })))
    expect(r.phone.purchaseOrders[po.id].status).toBe('partial')
    expect(r.phone.purchaseOrders[po.id].items[0].receivedQty).toBe(5)
    let server = await r.serverView()
    expect(server.purchaseOrders[po.id]).toEqual(r.phone.purchaseOrders[po.id])
    expect(server.variants.v1.stock).toBe(r.phone.variants.v1.stock)

    // the rest
    await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW + 4, invoiceRef: 'B2', items: [{ variantId: 'v1', qty: 7, cost: 405 }, { variantId: 'v2', qty: 4, cost: 410 }], total: 7 * 405 + 4 * 410, paid: 0, notes: '', poId: po.id }, ctx({ now: NOW + 4 })))
    expect(r.phone.purchaseOrders[po.id].status).toBe('received')
    server = await r.serverView()
    expect(server.purchaseOrders[po.id]).toEqual(r.phone.purchaseOrders[po.id])
    expect(listOf(server.purchases)).toHaveLength(2)
    await expect(r.run((s) => setPoStatus(s, po.id, 'cancelled', ctx()))).rejects.toThrow('fully received')
  })

  test('orderAfterReceipt ignores items that are not on the order', () => {
    const { order } = savePurchaseOrder(baseState(), draft, undefined, ctx())
    const patch = orderAfterReceipt(order, { items: [{ variantId: 'other', qty: 9, cost: 1 }] })
    expect(patch.items).toEqual(order.items)
    expect(patch.status).toBe('draft')
  })
})
