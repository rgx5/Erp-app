import { applyMutations } from '@/replication'
import { actorWith, rig } from '@/replication/testkit'
import { listOf } from '@/data/state'
import { fromInputDate } from '@/domain/dates'
import { registerPaymentMethod } from '@/modules/registry'
import { addPeriod, dueSubscriptions, endingSoon, nextAfter, periodsDue, scheduleAhead } from '../logic/subscriptions'
import { deleteSubscription, generateInvoices, saveSubscription, setSubscriptionActive, type SubscriptionDraft } from '../ops'
import { baseState, commit, ctx, dl, installBillHook, NOW } from './helpers'

const d = (iso: string) => fromInputDate(iso)
const DAY = 86_400_000

const draftFor = (s = baseState(), over: Partial<SubscriptionDraft> = {}): SubscriptionDraft => ({
  kind: 'subscription', customerId: 'c1', items: [dl(s, 'v1', 1)], frequency: 'monthly', startDate: d('2026-08-31'), payMode: 'cash', coverage: '', notes: '', ...over,
})

function withPlan(over: Partial<SubscriptionDraft> = {}) {
  let s = baseState()
  const sub = saveSubscription(s, draftFor(s, over), undefined, ctx()).subscription
  s = commit(s, { put: { subscriptions: [sub] } })
  return { s, sub }
}

describe('schedules', () => {
  test('a month at the end of the month clamps to its last day and comes back to the 31st', () => {
    const start = d('2026-01-31')
    const feb = addPeriod(start, 'monthly', 31)
    expect(new Date(feb).getDate()).toBe(28)
    expect(new Date(addPeriod(feb, 'monthly', 31)).getDate()).toBe(31)
    expect(new Date(addPeriod(start, 'quarterly')).getMonth()).toBe(3)
    expect(new Date(addPeriod(d('2026-02-28'), 'yearly')).getFullYear()).toBe(2027)
  })

  test('every missed period is due, up to a cap; paused and ended plans have nothing due', () => {
    const { sub } = withPlan({ startDate: d('2026-05-31') })
    const due = periodsDue(sub, NOW)
    expect(due.map((x) => new Date(x).getDate())).toEqual([31, 30, 31, 31, 30]) // 31 May, 30 Jun, 31 Jul, 31 Aug, 30 Sep
    expect(new Date(due[3]).getMonth()).toBe(7)
    expect(periodsDue(sub, NOW, 2)).toHaveLength(2)
    expect(periodsDue({ ...sub, active: false }, NOW)).toEqual([])
    expect(periodsDue({ ...sub, endDate: d('2026-06-30') }, NOW)).toHaveLength(2)
    expect(nextAfter(sub, 5)).toBe(d('2026-10-31'))
    expect(scheduleAhead(sub, 3).map((x) => new Date(x).getDate())).toEqual([31, 30, 31])
    expect(scheduleAhead({ ...sub, endDate: d('2026-06-30') }, 5)).toHaveLength(2)
  })

  test('plans with something due are listed, oldest first', () => {
    const { s } = withPlan({ startDate: d('2026-10-01') })
    expect(dueSubscriptions(s, NOW)).toHaveLength(1)
    expect(dueSubscriptions(s, d('2026-09-01'))).toEqual([])
  })

  test('plans ending soon are found for the renewal call', () => {
    const { s, sub } = withPlan({ kind: 'amc', startDate: d('2026-10-01'), endDate: NOW + 10 * DAY })
    expect(endingSoon(s, NOW).map((x) => [x.sub.id, x.daysLeft])).toEqual([[sub.id, 11]])
    expect(endingSoon(s, NOW, 5)).toEqual([])
    expect(endingSoon(commit(s, { put: { subscriptions: [{ ...sub, active: false }] } }), NOW)).toEqual([])
  })
})

describe('subscriptions and AMC', () => {
  test('AMCs and subscriptions are numbered in their own series and need a customer, lines and sane dates', () => {
    const s = baseState()
    expect(saveSubscription(s, draftFor(s), undefined, ctx()).subscription.no).toBe('SUB-0001')
    const amc = saveSubscription(s, draftFor(s, { kind: 'amc', coverage: 'Two services a year' }), undefined, ctx()).subscription
    expect(amc).toMatchObject({ no: 'AMC-0001', kind: 'amc', coverage: 'Two services a year', active: true, billCount: 0, nextDate: d('2026-08-31') })
    expect(() => saveSubscription(s, draftFor(s, { customerId: 'nobody' }), undefined, ctx())).toThrow('Choose the customer')
    expect(() => saveSubscription(s, draftFor(s, { items: [] }), undefined, ctx())).toThrow('at least one item')
    expect(() => saveSubscription(s, draftFor(s, { endDate: d('2026-01-01') }), undefined, ctx())).toThrow('before the start')
  })

  test('once it has billed, the start and next date no longer move; it can be paused, and only an unused plan deleted', () => {
    installBillHook()
    let { s, sub } = withPlan({ startDate: d('2026-10-01') })
    expect(deleteSubscription(s, sub.id, ctx()).changes.del!.subscriptions).toEqual([sub.id])
    s = commit(s, generateInvoices(s, sub.id, undefined, ctx()))
    const edited = saveSubscription(s, draftFor(s, { startDate: d('2026-01-01'), notes: 'x' }), sub.id, ctx()).subscription
    expect(edited.startDate).toBe(d('2026-10-01'))
    expect(edited.nextDate).toBe(d('2026-11-01'))
    expect(() => deleteSubscription(s, sub.id, ctx())).toThrow('pause it instead')
    s = commit(s, setSubscriptionActive(s, sub.id, false, ctx()))
    expect(() => generateInvoices(s, sub.id, undefined, ctx())).toThrow('nothing due')
  })

  test('generating makes one ordinary bill per missed period, takes the stock out and moves the plan on', () => {
    installBillHook()
    const { s, sub } = withPlan({ startDate: d('2026-08-31') })
    const r = generateInvoices(s, sub.id, undefined, ctx())
    expect(r.bills).toHaveLength(2) // 31 Aug and 30 Sep
    expect(new Set(r.bills.map((b) => b.no)).size).toBe(2)
    expect(r.bills[0]).toMatchObject({ customerId: 'c1', total: 999, paid: 999 })
    expect(r.bills[0].notes).toContain('Subscription SUB-0001')
    expect(r.bills[0].ext?.['sales-docs']).toMatchObject({ subscriptionId: sub.id })
    const after = commit(s, r)
    expect(after.variants.v1.stock).toBe(8)
    expect(after.subscriptions[sub.id]).toMatchObject({ billCount: 2, nextDate: d('2026-10-31'), lastBillId: r.bills[1].id, active: true })
    expect(() => generateInvoices(after, sub.id, undefined, ctx())).toThrow('nothing due') // 31 Oct is not yet due
  })

  test('a plan ends itself after its last invoice', () => {
    installBillHook()
    const { s, sub } = withPlan({ startDate: d('2026-09-30'), endDate: d('2026-10-15') })
    const after = commit(s, generateInvoices(s, sub.id, undefined, ctx()))
    expect(after.subscriptions[sub.id]).toMatchObject({ billCount: 1, active: false })
  })

  test('refused: not enough stock, a customer who is gone, and billing on account without the credit app', () => {
    installBillHook()
    const { s, sub } = withPlan({ startDate: d('2026-10-01'), items: [dl(baseState(), 'v2', 5)] })
    expect(() => generateInvoices(s, sub.id, undefined, ctx())).toThrow('Only 4 of Oxford Shirt in stock')
    const ok = withPlan({ startDate: d('2026-10-01') })
    expect(() => generateInvoices({ ...ok.s, customers: {} }, ok.sub.id, undefined, ctx())).toThrow('no longer exists')
    expect(() => generateInvoices(ok.s, ok.sub.id, 'due', ctx())).toThrow('needs the Credit app')
  })

  test('with the credit app installed, an invoice can go on account', () => {
    installBillHook()
    registerPaymentMethod({ id: 'due', label: 'On account', icon: (() => null) as never, order: 50 })
    const { s, sub } = withPlan({ startDate: d('2026-10-01') })
    const r = generateInvoices(s, sub.id, 'due', ctx())
    expect(r.bills[0].payments).toEqual([{ mode: 'due', amount: 999 }])
    expect(r.bills[0].paid).toBe(0)
  })

  test('the server ends up with the plan and its invoices, and a counter person cannot write plans', async () => {
    installBillHook()
    const r = rig(baseState())
    await r.seed()
    const made = await r.run((s) => saveSubscription(s, draftFor(s, { startDate: d('2026-09-01') }), undefined, ctx({ now: NOW + 1 })))
    const gen = await r.run((s) => generateInvoices(s, made.subscription.id, undefined, ctx({ now: NOW + 2 })))
    await r.run((s) => setSubscriptionActive(s, made.subscription.id, false, ctx({ now: NOW + 3 })))
    const server = await r.serverView()
    expect(server.subscriptions).toEqual(r.phone.subscriptions)
    expect(server.subscriptions[made.subscription.id]).toMatchObject({ billCount: 2, active: false })
    expect(listOf(server.bills).map((b) => b.id).sort()).toEqual(gen.bills.map((b) => b.id).sort())
    expect(server.variants.v1.stock).toBe(8)

    const res = await applyMutations(r.db, [{ mid: 'cash:1', coll: 'subscriptions', id: 'sub_x', op: 'create', data: { ...made.subscription, id: 'sub_x' }, at: 1 }], actorWith(['pos']))
    expect(res[0]).toMatchObject({ status: 'rejected', code: 'forbidden' })
  })
})
