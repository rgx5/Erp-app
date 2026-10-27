import { applyChanges, listOf } from '@/data/state'
import { postingsFor, isBalanced } from '@/modules/postings'
import '@/modules/accounting/postings'
import { OpError } from '@/data/ops'
import { saveBill } from '@/data/ops'
import { customerBalance, earnedAfter, lapseFor, packageLiability, packageStatus, releaseFor, remainingValue, splitPrice, taxAt, usageProblem } from '../logic/packages'
import { packagePayments } from '../hooks'
import { billAppointment, completeWithPackage, expireDue, expirePackage, reverseUse, saveAppointment, savePlan, sellPackage, setPackageFrozen, usePackageSession } from '../ops'
import { serviceBillInput } from '../logic/billing'
import { packageSalePosting, packageUsePosting } from '../postings'
import { bookDraft, cctx, ctx, DAY, mctx, NOW, planId, run, shopState, SVC } from './helpers'

const sell = (s: ReturnType<typeof shopState>, over = {}, c = ctx()) => run(s, sellPackage(s, { customerId: 'c1', planId: planId(s), mode: 'upi', ...over }, c))
const net = (s: ReturnType<typeof shopState>) => {
  const t: Record<string, number> = {}
  for (const p of postingsFor(s)) for (const l of p.lines) t[l.account] = Math.round(((t[l.account] ?? 0) + (l.debit ?? 0) - (l.credit ?? 0)) * 100) / 100
  return t
}

describe('the maths', () => {
  test('the price is split into revenue and GST', () => {
    expect(splitPrice(5900, 18)).toEqual({ taxable: 5000, tax: 900 })
    expect(splitPrice(1000, 0)).toEqual({ taxable: 1000, tax: 0 })
  })

  test('a package that does not divide evenly still earns exactly its price, to the paisa', () => {
    const { taxable, tax } = splitPrice(1000, 18)
    let p = { sessions: 3, sessionsUsed: 0, price: 1000, taxable, recognised: 0 }
    let value = 0, gst = 0
    for (let i = 0; i < 3; i++) {
      const r = releaseFor(p, 1)
      value += r.value; gst += r.tax
      p = { ...p, sessionsUsed: p.sessionsUsed + 1, recognised: Math.round((p.recognised + r.value) * 100) / 100 }
    }
    expect(Math.round(value * 100) / 100).toBe(taxable)
    expect(Math.round((value + gst) * 100) / 100).toBe(1000)
    expect(earnedAfter(p, 3)).toBe(taxable)
    expect(remainingValue(p)).toBe(0)
    expect(taxAt(p, taxable)).toBeCloseTo(tax, 2)
  })
})

describe('selling', () => {
  test('a sale makes the customer\'s package with every session unused', () => {
    const s = shopState()
    const r = sell(s)
    expect(r.result.sale).toMatchObject({ no: 'PK-0001', price: 5900, taxable: 5000, sessions: 5, mode: 'upi' })
    const p = r.result.package
    expect(p).toMatchObject({ id: r.result.sale.id, customerId: 'c1', sessions: 5, sessionsUsed: 0, recognised: 0, status: 'active' })
    expect(p.expiresAt).toBe(NOW + 90 * DAY)
    expect(customerBalance(r.state, 'c1', NOW)).toMatchObject({ sessions: 5, value: 5900, packages: 1 })
    expect(customerBalance(r.state, 'c2', NOW).sessions).toBe(0)
  })

  test('refusals: unknown customer, a plan that is off sale, no way to pay, a cashier changing the price', () => {
    let s = shopState()
    expect(() => sellPackage(s, { customerId: 'nope', planId: planId(s), mode: 'cash' }, ctx())).toThrow(OpError)
    expect(() => sellPackage(s, { customerId: 'c1', planId: planId(s), mode: 'cheque' as never }, ctx())).toThrow('how the money')
    expect(() => sellPackage(s, { customerId: 'c1', planId: planId(s), mode: 'cash', price: 5000 }, cctx())).toThrow('Only a manager')
    const sale = sellPackage(s, { customerId: 'c1', planId: planId(s), mode: 'cash', price: 5000 }, mctx())
    expect(sale.sale.price).toBe(5000)
    s = run(s, savePlan(s, { ...s.packagePlans[planId(s)], variantIds: [SVC.spa], notes: '', active: false }, planId(s), mctx())).state
    expect(() => sellPackage(s, { customerId: 'c1', planId: planId(s), mode: 'cash' }, ctx())).toThrow('not on sale')
    expect(() => savePlan(s, { name: '', price: 100, sessions: 1, validityDays: 0, variantIds: [], gstRate: 18, notes: '', active: true }, undefined, mctx())).toThrow('name')
    expect(() => savePlan(s, { name: 'x', price: 100, sessions: 0, validityDays: 0, variantIds: [], gstRate: 18, notes: '', active: true }, undefined, mctx())).toThrow('Sessions')
  })
})

describe('using sessions', () => {
  test('each use consumes a session and earns a share; the last one finishes exactly', () => {
    let s = sell(shopState()).state
    const pid = listOf(s.customerPackages)[0].id
    for (let i = 1; i <= 5; i++) {
      const r = run(s, usePackageSession(s, pid, { customerId: 'c1', variantIds: [SVC.spa], serviceName: 'Hair spa' }, ctx()))
      s = r.state
      expect(s.customerPackages[pid].sessionsUsed).toBe(i)
      expect(r.result.use).toMatchObject({ kind: 'use', sessions: 1, value: 1000, tax: 180 })
    }
    expect(s.customerPackages[pid].recognised).toBe(5000)
    expect(() => usePackageSession(s, pid, {}, ctx())).toThrow('no sessions left')
    expect(customerBalance(s, 'c1', NOW).sessions).toBe(0)
  })

  test('it must cover the service, belong to the customer, and not be frozen or expired', () => {
    let s = sell(shopState()).state
    const pid = listOf(s.customerPackages)[0].id
    expect(() => usePackageSession(s, pid, { variantIds: [SVC.cut] }, ctx())).toThrow('does not cover')
    expect(() => usePackageSession(s, pid, { customerId: 'c2' }, ctx())).toThrow('another customer')
    expect(() => usePackageSession(s, pid, {}, ctx({ now: NOW + 91 * DAY }))).toThrow('expired')
    expect(() => setPackageFrozen(s, pid, true, 'away', cctx())).toThrow('Only a manager')
    s = run(s, setPackageFrozen(s, pid, true, 'away', mctx())).state
    expect(() => usePackageSession(s, pid, {}, ctx())).toThrow('frozen')
    expect(packageStatus(s.customerPackages[pid], NOW)).toBe('frozen')
    s = run(s, setPackageFrozen(s, pid, false, '', mctx())).state
    expect(usageProblem(s.customerPackages[pid], NOW)).toBeNull()
  })

  test('giving a session back reverses it once, for managers only', () => {
    let s = sell(shopState()).state
    const pid = listOf(s.customerPackages)[0].id
    const u = run(s, usePackageSession(s, pid, {}, ctx()))
    s = u.state
    expect(() => reverseUse(s, u.result.use.id, 'oops', cctx())).toThrow('Only a manager')
    expect(() => reverseUse(s, u.result.use.id, '', mctx())).toThrow('why')
    const r = run(s, reverseUse(s, u.result.use.id, 'Booked twice', mctx()))
    s = r.state
    expect(s.customerPackages[pid]).toMatchObject({ sessionsUsed: 0, recognised: 0 })
    expect(r.result.use).toMatchObject({ id: `rev_${u.result.use.id}`, kind: 'reversal', sessions: -1, value: -1000, tax: -180 })
    expect(() => reverseUse(s, u.result.use.id, 'again', mctx())).toThrow('already been given back')
    expect(() => reverseUse(s, r.result.use.id, 'x', mctx())).toThrow('Only a used session')
  })

  test('a package that lapses unused earns what is left once, and cannot be used again', () => {
    let s = sell(shopState()).state
    const pid = listOf(s.customerPackages)[0].id
    s = run(s, usePackageSession(s, pid, {}, ctx())).state
    expect(() => expirePackage(s, pid, ctx())).toThrow('still valid')
    const later = ctx({ now: NOW + 100 * DAY })
    expect(packageStatus(s.customerPackages[pid], later.now)).toBe('expired')
    const r = run(s, expirePackage(s, pid, later))
    s = r.state
    expect(r.result.use).toMatchObject({ kind: 'expiry', sessions: 4, value: 4000, tax: 720 })
    expect(s.customerPackages[pid]).toMatchObject({ status: 'expired', sessionsUsed: 5, recognised: 5000 })
    expect(() => expirePackage(s, pid, later)).toThrow('already lapsed')
    expect(expireDue(s, later).count).toBe(0)
    expect(remainingValue(s.customerPackages[pid])).toBe(0)
  })

  test('expireDue lapses every package past its date', () => {
    let s = sell(shopState()).state
    s = sell(s, { customerId: 'c2' }).state
    const r = expireDue(s, ctx({ now: NOW + 200 * DAY }))
    expect(r.count).toBe(2)
    expect(lapseFor({ taxable: 5000, price: 5900, recognised: 0 })).toEqual({ value: 5000, tax: 900 })
  })
})

describe('appointments paid by package', () => {
  test('completing with a package consumes a session and links it; no bill is made', () => {
    let s = sell(shopState()).state
    const pid = listOf(s.customerPackages)[0].id
    const a = run(s, saveAppointment(s, bookDraft({ services: [{ variantId: SVC.spa }] }), undefined, ctx()))
    s = a.state
    const r = run(s, completeWithPackage(s, a.result.appointment.id, pid, ctx()))
    expect(r.state.appointments[a.result.appointment.id]).toMatchObject({ status: 'completed', packageUseId: r.state.appointments[a.result.appointment.id].packageUseId })
    expect(r.state.customerPackages[pid].sessionsUsed).toBe(1)
    expect(listOf(r.state.bills)).toHaveLength(0)
    expect(() => completeWithPackage(r.state, a.result.appointment.id, pid, ctx())).toThrow('already been paid')
    expect(() => billAppointment(r.state, a.result.appointment.id, [{ mode: 'cash', amount: 1200 }], ctx())).toThrow('already been paid')
  })

  test('a package that does not cover the service is refused', () => {
    let s = sell(shopState()).state
    const pid = listOf(s.customerPackages)[0].id
    const a = run(s, saveAppointment(s, bookDraft(), undefined, ctx()))
    expect(() => completeWithPackage(a.state, a.result.appointment.id, pid, ctx())).toThrow('does not cover')
  })
})

describe('a bill paid with a package', () => {
  const pay = (s: ReturnType<typeof shopState>, c = ctx()) => {
    const input = serviceBillInput(s, { lines: [{ variantId: SVC.spa, name: 'Hair spa', qty: 1, price: 1180 }], customerId: 'c1', payments: [{ mode: 'package', amount: 1180 }], userId: c.userId, now: c.now })
    return saveBill(s, input, c)
  }

  test('the hook takes a session and the books clear the bill\'s tender against the package liability', () => {
    let s = sell(shopState()).state
    const pid = listOf(s.customerPackages)[0].id
    const r = run(s, pay(s))
    s = r.state
    expect(packagePayments(r.result.bill)).toBe(1)
    expect(s.customerPackages[pid].sessionsUsed).toBe(1)
    const use = listOf(s.packageUses)[0]
    expect(use).toMatchObject({ billId: r.result.bill.id, value: 1000, tax: 180 })
    const t = net(s)
    // sold 5900 into advances; the bill booked its own sale and GST against suspense; the use moved 1180 from advances to suspense
    expect(t.suspense).toBe(0)
    expect(t.advances_received).toBe(-(5900 - 1180))
    expect(t.sales).toBe(-1000)
  })

  test('without a package session the bill is refused', () => {
    const s = shopState()
    expect(() => pay(s)).toThrow('no package session')
    const sold = sell(s).state
    expect(() => pay(sold, ctx())).not.toThrow()
    const other = serviceBillInput(sold, { lines: [{ variantId: SVC.cut, name: 'Haircut', qty: 1, price: 500 }], customerId: 'c1', payments: [{ mode: 'package', amount: 500 }], userId: 'u_owner', now: NOW })
    expect(() => saveBill(sold, other, ctx())).toThrow('covers these items')
    const walkIn = serviceBillInput(sold, { lines: [{ variantId: SVC.spa, name: 'Hair spa', qty: 1, price: 1180 }], customerId: null, payments: [{ mode: 'package', amount: 1180 }], userId: 'u_owner', now: NOW })
    expect(() => saveBill(sold, walkIn, ctx())).toThrow('Choose a customer')
  })
})

describe('the books', () => {
  test('selling debits the money and credits advances, balanced', () => {
    const r = sell(shopState())
    const p = packageSalePosting(r.result.sale)!
    expect(isBalanced(p)).toBe(true)
    expect(p.lines).toEqual([{ account: 'upi', debit: 5900 }, { account: 'advances_received', credit: 5900, party: { type: 'customer', id: 'c1' } }])
    for (const mode of ['cash', 'card', 'bank'] as const) expect(packageSalePosting({ ...r.result.sale, mode })!.lines[0].account).toBe(mode)
  })

  test('every use, reversal and expiry posts a balanced entry; at the end the liability is gone and revenue equals the price less GST', () => {
    let s = sell(shopState()).state
    const pid = listOf(s.customerPackages)[0].id
    const uses = []
    for (let i = 0; i < 2; i++) { const r = run(s, usePackageSession(s, pid, { serviceName: 'Hair spa' }, ctx())); s = r.state; uses.push(r.result.use) }
    s = run(s, reverseUse(s, uses[1].id, 'mistake', mctx())).state
    s = run(s, usePackageSession(s, pid, {}, ctx())).state
    s = run(s, expirePackage(s, pid, ctx({ now: NOW + 120 * DAY }))).state
    const posts = postingsFor(s).filter((p) => p.sourceColl === 'packageUses' || p.sourceColl === 'packageSales')
    expect(posts).toHaveLength(1 + 4 + 1)
    for (const p of posts) expect(isBalanced(p)).toBe(true)
    const t = net(s)
    expect(t.upi).toBe(5900)
    expect(Math.abs(t.advances_received)).toBe(0)
    expect(t.sales).toBe(-5000)
    expect(Math.round(((t.gst_output_cgst ?? 0) + (t.gst_output_sgst ?? 0)) * 100) / 100).toBe(-900)
    expect(s.customerPackages[pid].recognised).toBe(5000)
  })

  test('an odd GST amount splits into CGST and SGST that add up', () => {
    const r = sell(shopState())
    const u = packageUsePosting({ id: 'u1', customerPackageId: 'x', customerId: 'c1', kind: 'use', sessions: 1, value: 33.33, tax: 6.01, date: NOW, note: '', userId: 'u' })!
    expect(isBalanced(u)).toBe(true)
    expect(u.lines.find((l) => l.account === 'gst_output_cgst')!.credit! + u.lines.find((l) => l.account === 'gst_output_sgst')!.credit!).toBeCloseTo(6.01, 2)
    expect(r.state).toBeTruthy()
  })

  test('the liability report lists money held and what is already earned', () => {
    let s = sell(shopState()).state
    const pid = listOf(s.customerPackages)[0].id
    s = run(s, usePackageSession(s, pid, {}, ctx())).state
    const l = packageLiability(s, NOW)
    expect(l.sold).toBe(5900)
    expect(l.deferred).toBe(4720)
    expect(l.recognised).toBe(1000)
    expect(l.sessionsOutstanding).toBe(4)
    expect(applyChanges(s, {}).customerPackages[pid].sessionsUsed).toBe(1)
  })
})
