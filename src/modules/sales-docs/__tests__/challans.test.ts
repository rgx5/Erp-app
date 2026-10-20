import { billInput, line } from '@/data/__tests__/helpers'
import { saveBill } from '@/data/ops'
import { listOf } from '@/data/state'
import { rig } from '@/replication/testkit'
import { challanHtml, challanText } from '../html'
import { dispatchedQty, linesFromDoc, nextChallanStatus, undispatched } from '../logic/challans'
import { advanceChallan, deleteChallan, saveChallan, saveSalesOrder, type ChallanDraft } from '../ops'
import { baseState, commit, ctx, dl, installBillHook, NOW } from './helpers'

const orderDraft = (s = baseState()) => ({ customerId: 'c1', items: [dl(s, 'v1', 4), dl(s, 'v2', 2)], billDiscountType: 'amt' as const, billDiscountValue: 0, notes: '' })
const challanFor = (orderId: string | undefined, items: ChallanDraft['items'], over: Partial<ChallanDraft> = {}): ChallanDraft => ({
  orderId, customerId: 'c1', partyName: '', partyPhone: '', address: '', items, vehicle: '', driver: '', trackingNo: '', notes: '', ...over,
})
const piece = (variantId: string, qty: number, name = 'Oxford Shirt') => ({ variantId, name, sku: variantId.toUpperCase(), qty })

function withOrder() {
  let s = baseState()
  const o = saveSalesOrder(s, orderDraft(s), undefined, ctx()).order
  s = commit(s, { put: { salesOrders: [o] } })
  return { s, o }
}

describe('delivery challans', () => {
  test('a challan is numbered, takes the customer’s details and starts packed', () => {
    const s = commit(baseState(), { put: { customers: [{ ...baseState().customers.c1, address: '12 Park Road' }] } })
    const { challan: c } = saveChallan(s, challanFor(undefined, [piece('v1', 1)]), undefined, ctx())
    expect(c).toMatchObject({ no: 'DC-0001', status: 'packed', partyName: 'Meera', partyPhone: '9876543210', address: '12 Park Road', proof: '' })
    expect(() => saveChallan(s, challanFor(undefined, [piece('v1', 1)], { customerId: null }), undefined, ctx())).toThrow('who the goods are going to')
    expect(() => saveChallan(s, challanFor(undefined, []), undefined, ctx())).toThrow('at least one item')
    expect(() => saveChallan(s, challanFor(undefined, [piece('v1', 0)]), undefined, ctx())).toThrow('quantity')
  })

  test('against an order, lines cannot exceed what is still to send — across every challan', () => {
    let { s, o } = withOrder()
    expect(undispatched(o, []).map((l) => l.qty)).toEqual([4, 2])
    const first = saveChallan(s, challanFor(o.id, [piece('v1', 3)]), undefined, ctx()).challan
    s = commit(s, { put: { challans: [first] } })
    expect(dispatchedQty(o, listOf(s.challans)).get('v1')).toBe(3)
    expect(undispatched(o, listOf(s.challans)).map((l) => [l.variantId, l.qty])).toEqual([['v1', 1], ['v2', 2]])
    expect(() => saveChallan(s, challanFor(o.id, [piece('v1', 2)]), undefined, ctx())).toThrow('Only 1 of Oxford Shirt is left to send')
    // Editing the first challan does not count its own lines against itself.
    expect(saveChallan(s, challanFor(o.id, [piece('v1', 4)]), first.id, ctx()).challan.items[0].qty).toBe(4)
    const rest = saveChallan(s, challanFor(o.id, [piece('v1', 1), piece('v2', 2)]), undefined, ctx()).challan
    expect(rest.no).toBe('DC-0002')
    expect(linesFromDoc(o.items)).toHaveLength(2)
  })

  test('packed → on the way → delivered, in that order only; a challan that has gone out is a record', () => {
    let s = baseState()
    const c = saveChallan(s, challanFor(undefined, [piece('v1', 1)]), undefined, ctx()).challan
    s = commit(s, { put: { challans: [c] } })
    expect(nextChallanStatus('packed')).toBe('dispatched')
    expect(nextChallanStatus('delivered')).toBeNull()
    expect(() => advanceChallan(s, c.id, 'delivered', {}, ctx())).toThrow('cannot go straight')
    s = commit(s, advanceChallan(s, c.id, 'dispatched', { vehicle: ' MH12 AB 1234 ', driver: 'Sunil', trackingNo: 'LR-55' }, ctx({ now: NOW + 5 })))
    expect(s.challans[c.id]).toMatchObject({ status: 'dispatched', vehicle: 'MH12 AB 1234', driver: 'Sunil', trackingNo: 'LR-55', dispatchedAt: NOW + 5 })
    expect(() => saveChallan(s, challanFor(undefined, [piece('v1', 2)]), c.id, ctx())).toThrow('has gone out')
    expect(() => deleteChallan(s, c.id, ctx())).toThrow('has gone out')
    s = commit(s, advanceChallan(s, c.id, 'delivered', { proof: 'Received by Meera' }, ctx({ now: NOW + 9 })))
    expect(s.challans[c.id]).toMatchObject({ status: 'delivered', deliveredAt: NOW + 9, proof: 'Received by Meera', vehicle: 'MH12 AB 1234' })
    expect(() => advanceChallan(s, c.id, 'delivered', {}, ctx())).toThrow('cannot go straight')
  })

  test('the printout shows quantities but no prices, and escapes what people type', () => {
    const s = baseState()
    const c = { ...saveChallan(s, challanFor(undefined, [piece('v1', 2)], { vehicle: '<MH12>' }), undefined, ctx()).challan }
    const html = challanHtml(c, s.store!)
    expect(html).toContain('DELIVERY CHALLAN')
    expect(html).toContain('&lt;MH12&gt;')
    expect(html).not.toContain('Rate')
    expect(challanText(c, s.store!)).toContain('Oxford Shirt × 2')
  })

  test('billing the order links its challans to the bill', () => {
    installBillHook()
    let { s, o } = withOrder()
    const c = saveChallan(s, challanFor(o.id, [piece('v1', 4), piece('v2', 2)]), undefined, ctx()).challan
    s = commit(s, { put: { challans: [c] } })
    const r = saveBill(s, billInput(s, [line(s.variants.v1, 4), line(s.variants.v2, 2)], { customerId: 'c1', ext: { 'sales-docs': { orderId: o.id } } }), ctx({ now: NOW + 3 }))
    const after = commit(s, r)
    expect(after.challans[c.id].billId).toBe(r.bill.id)
  })

  test('the server ends up with what the phone has, including a deleted draft', async () => {
    const r = rig(baseState())
    await r.seed()
    const o = await r.run((s) => saveSalesOrder(s, orderDraft(s), undefined, ctx({ now: NOW + 1 })))
    const c = await r.run((s) => saveChallan(s, challanFor(o.order.id, [piece('v1', 2)]), undefined, ctx({ now: NOW + 2 })))
    await r.run((s) => advanceChallan(s, c.challan.id, 'dispatched', { vehicle: 'KA01', driver: 'Ravi' }, ctx({ now: NOW + 3 })))
    await r.run((s) => advanceChallan(s, c.challan.id, 'delivered', { proof: 'signed' }, ctx({ now: NOW + 4 })))
    const d = await r.run((s) => saveChallan(s, challanFor(o.order.id, [piece('v2', 1)]), undefined, ctx({ now: NOW + 5 })))
    await r.run((s) => deleteChallan(s, d.challan.id, ctx({ now: NOW + 6 })))
    const server = await r.serverView()
    expect(server.challans).toEqual(r.phone.challans)
    expect(server.challans[c.challan.id].status).toBe('delivered')
    expect(server.challans[d.challan.id]).toBeUndefined()
  })
})
