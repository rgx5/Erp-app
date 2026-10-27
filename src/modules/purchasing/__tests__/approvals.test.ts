import { ctx, NOW } from '@/data/__tests__/helpers'
import { applyChanges } from '@/data/state'
import { actorWith, rig } from '@/replication/testkit'
import { approvalRefusal, approvalState, awaitingApproval, canSend, limitFor, needsApproval, settingsOf } from '../approvals'
import { savePurchaseOrder, setPoStatus } from '../ops'
import { decidePurchaseOrder } from '../ops-approvals'
import { savePurchaseSettings } from '../ops-payables'
import { manager, purchasingState } from './helpers'

const big = { supplierId: 's1', notes: '', items: [{ variantId: 'v1', qty: 100, cost: 800 }] } // ₹80,000
const mid = { supplierId: 's1', notes: '', items: [{ variantId: 'v1', qty: 50, cost: 400 }] } // ₹20,000

function setup() {
  let s = purchasingState()
  s = applyChanges(s, savePurchaseSettings(s, { approvalsOn: true, approvalAbove: 10_000, limits: { manager: 50_000 } }, ctx()).changes)
  return s
}
const asManager = (over = {}) => ctx({ userId: manager.id, ...over })

describe('approval rules', () => {
  test('nothing changes until approvals are switched on', () => {
    const s = purchasingState()
    const { order } = savePurchaseOrder(s, big, undefined, ctx())
    expect(needsApproval(settingsOf(s), order.total)).toBe(false)
    expect(setPoStatus(applyChanges(s, { put: { purchaseOrders: [order] } }), order.id, 'sent', asManager()).order.status).toBe('sent')
  })

  test('limits: the owner has none, a manager has theirs, others have nothing', () => {
    const st = settingsOf(setup())
    expect(limitFor(st, 'owner')).toBe(Infinity)
    expect(limitFor(st, 'manager')).toBe(50_000)
    expect(limitFor(st, 'cashier')).toBe(0)
  })

  test('under the threshold anyone sends; within your own limit you send; above it the order waits', () => {
    let s = setup()
    const small = savePurchaseOrder(s, { ...mid, items: [{ variantId: 'v1', qty: 5, cost: 400 }] }, undefined, ctx()).order
    const middling = savePurchaseOrder(s, mid, undefined, ctx()).order
    const huge = savePurchaseOrder(s, big, undefined, ctx()).order
    s = applyChanges(s, { put: { purchaseOrders: [small, middling, huge] } })
    const st = settingsOf(s)
    expect(canSend(st, small, 'cashier').ok).toBe(true)
    expect(canSend(st, middling, 'manager').ok).toBe(true)
    const blocked = canSend(st, huge, 'manager')
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toContain('needs approval')
    expect(() => setPoStatus(s, huge.id, 'sent', asManager())).toThrow('needs approval')
    expect(setPoStatus(s, huge.id, 'sent', ctx()).order.status).toBe('sent') // the owner can
    expect(awaitingApproval(s).map((o) => o.id)).toEqual([middling.id, huge.id])
  })

  test('the owner approves, the order can then be sent by the manager, and editing it asks again', () => {
    let s = setup()
    const huge = savePurchaseOrder(s, big, undefined, asManager()).order
    s = applyChanges(s, { put: { purchaseOrders: [huge] } })
    expect(() => decidePurchaseOrder(s, huge.id, 'approved', '', asManager())).toThrow('Your limit')
    const { changes, approval } = decidePurchaseOrder(s, huge.id, 'approved', 'ok', ctx())
    s = applyChanges(s, changes)
    expect(approval.amount).toBe(80_000)
    const po = s.purchaseOrders[huge.id]
    expect(po).toMatchObject({ approvalStatus: 'approved', approvedAmount: 80_000, approvedBy: 'u_owner' })
    expect(approvalState(settingsOf(s), po)).toBe('approved')
    expect(setPoStatus(s, huge.id, 'sent', asManager()).order.status).toBe('sent')

    const edited = savePurchaseOrder(s, { ...big, items: [{ variantId: 'v1', qty: 101, cost: 800 }] }, huge.id, ctx()).order
    expect(approvalState(settingsOf(s), edited)).toBe('pending')
  })

  test('turning an order down needs a reason, and a rejected order cannot be sent', () => {
    let s = setup()
    const huge = savePurchaseOrder(s, big, undefined, asManager()).order
    s = applyChanges(s, { put: { purchaseOrders: [huge] } })
    expect(() => decidePurchaseOrder(s, huge.id, 'rejected', ' ', ctx())).toThrow('Say why')
    s = applyChanges(s, decidePurchaseOrder(s, huge.id, 'rejected', 'too much stock', ctx()).changes)
    expect(s.purchaseOrders[huge.id].approvalStatus).toBe('rejected')
    expect(() => setPoStatus(s, huge.id, 'sent', ctx({ userId: manager.id }))).toThrow('turned down')
  })

  test('approval is refused when it is switched off, the order is small, or it already left draft', () => {
    const off = purchasingState()
    const o = savePurchaseOrder(off, big, undefined, ctx()).order
    expect(approvalRefusal(settingsOf(off), o, 'owner')).toContain('switched off')
    const on = setup()
    const small = savePurchaseOrder(on, { ...mid, items: [{ variantId: 'v1', qty: 1, cost: 400 }] }, undefined, ctx()).order
    expect(approvalRefusal(settingsOf(on), small, 'owner')).toContain('under the approval threshold')
    expect(approvalRefusal(settingsOf(on), { ...savePurchaseOrder(on, big, undefined, ctx()).order, status: 'sent' }, 'owner')).toContain('draft')
  })

  test('settings refuse nonsense and never store a limit for the owner', () => {
    const s = purchasingState()
    expect(() => savePurchaseSettings(s, { approvalAbove: -1 }, ctx())).toThrow('negative')
    expect(() => savePurchaseSettings(s, { defaultDays: 1.5 }, ctx())).toThrow('whole number')
    expect(savePurchaseSettings(s, { limits: { owner: 5, manager: 9 } }, ctx()).settings.limits).toEqual({ manager: 9 })
  })
})

describe('approvals replicate: the server grants the approval, a client cannot', () => {
  test('server == phone after a decision, and only approvePurchases can post one', async () => {
    const r = rig(setup())
    await r.seed()
    const made = await r.run((s) => savePurchaseOrder(s, big, undefined, ctx({ now: NOW + 1 })))
    await r.run((s) => decidePurchaseOrder(s, made.order.id, 'approved', 'fine', ctx({ now: NOW + 2 })))
    const server = await r.serverView()
    expect(server.purchaseOrders).toEqual(r.phone.purchaseOrders)
    expect(server.poApprovals).toEqual(r.phone.poApprovals)
    expect(server.purchaseOrders[made.order.id].approvalStatus).toBe('approved')

    // A cashier-level actor may not create an approval, nor patch the order's approval fields.
    const cashier = actorWith(['pos', 'customers', 'purchases'], 'u_cash')
    const forged = await r.send([{ mid: 'x1', coll: 'poApprovals', id: 'forged', op: 'create', data: { id: 'forged', orderId: made.order.id, decision: 'approved', amount: 1 }, at: NOW }], cashier).catch((e: Error) => e)
    expect(String(forged instanceof Error ? forged.message : JSON.stringify(forged))).toMatch(/refused|rejected|permission/i)
  })
})
