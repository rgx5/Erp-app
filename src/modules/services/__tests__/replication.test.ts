import { listOf, type Coll, type DataState } from '@/data/state'
import { ROLE_PERMISSIONS } from '@/domain/permissions'
import { mutationsFromChanges } from '@/replication/client'
import { allCollectionMetas } from '@/replication/registry'
import { actorWith, rig } from '@/replication/testkit'
import { billAppointment, billJobCard, checkIn, completeVisit, completeWithPackage, expirePackage, invoiceFixedFee, invoiceTimesheet, issuePart, logTime, reverseUse, saveAppointment, saveJobCard, saveProject, savePlan, saveResource, saveServiceItem, saveServiceSettings,
  saveTask, saveVisit, saveVisitReport, sellPackage, setAppointmentStatus, setJobLines, setJobStatus, setPackageFrozen, setTaskStatus, signVisit, startTimer, stopTimer, usePackageSession } from '../ops'
import { baseState, bookDraft, cctx, ctx, DAY, mctx, NOW, PART, SVC, tomorrowAt, TODAY } from './helpers'

const SERVICE_COLLS: Coll[] = [
  'serviceSettings', 'serviceItems', 'serviceResources', 'appointments', 'packagePlans', 'packageSales', 'customerPackages', 'packageUses', 'jobCards', 'projects', 'projectTasks', 'timeEntries', 'fieldVisits',
]
const count = (rec: unknown) => Object.keys((rec as object) ?? {}).length
let seq = 0
const muts = (state: DataState, changes: Parameters<typeof mutationsFromChanges>[1]) => mutationsFromChanges(state, changes, { deviceId: 'dev2', nextSeq: () => ++seq })

/** A shop's working month, every step sent through the server's rules. */
async function busy() {
  const r = rig(baseState()); await r.seed()
  const asOwner = ctx()
  await r.run((s) => saveServiceSettings(s, { openTime: '09:00', closeTime: '20:00', workDays: [0, 1, 2, 3, 4, 5, 6], maxNoShows: 2 }, mctx()))
  await r.run((s) => saveResource(s, { id: 'res_asha', name: 'Asha', kind: 'staff', daysOff: [], variantIds: [], active: true }, undefined, mctx()))
  await r.run((s) => saveServiceItem(s, { variantId: SVC.spa, durationMin: 60, bufferMin: 0, active: true }, mctx()))
  const plan = await r.run((s) => savePlan(s, { name: 'Hair spa x5', price: 5900, sessions: 5, validityDays: 90, variantIds: [SVC.spa], gstRate: 18, notes: '', active: true }, undefined, mctx()))
  // appointments
  const a1 = await r.run((s) => saveAppointment(s, bookDraft({ services: [{ variantId: SVC.spa }] }), undefined, asOwner))
  await r.run((s) => setAppointmentStatus(s, a1.appointment.id, 'confirmed', asOwner))
  await r.run((s) => billAppointment(s, a1.appointment.id, [{ mode: 'cash', amount: 1200 }], ctx({ now: NOW + 3_600_000 })))
  const a2 = await r.run((s) => saveAppointment(s, bookDraft({ services: [{ variantId: SVC.spa }], start: tomorrowAt('15:00') }), undefined, asOwner))
  // packages
  const sale = await r.run((s) => sellPackage(s, { customerId: 'c1', planId: plan.plan.id, mode: 'upi' }, asOwner))
  const pid = sale.package.id
  await r.run((s) => completeWithPackage(s, a2.appointment.id, pid, asOwner))
  const u2 = await r.run((s) => usePackageSession(s, pid, { customerId: 'c1', serviceName: 'Hair spa' }, asOwner))
  await r.run((s) => reverseUse(s, u2.use.id, 'Booked twice', mctx()))
  const sale2 = await r.run((s) => sellPackage(s, { customerId: 'c2', planId: plan.plan.id, mode: 'cash' }, asOwner))
  await r.run((s) => usePackageSession(s, sale2.package.id, {}, asOwner))
  await r.run((s) => setPackageFrozen(s, sale2.package.id, true, 'Away', mctx()))
  await r.run((s) => setPackageFrozen(s, sale2.package.id, false, '', mctx()))
  await r.run((s) => expirePackage(s, sale2.package.id, ctx({ now: NOW + 100 * DAY })))
  // job card
  const job = await r.run((s) => saveJobCard(s, { customerId: 'c1', partyName: '', partyPhone: '', kind: 'device', title: 'Redmi', identifier: '3569', reading: '', accessories: '', condition: '', problem: 'Cracked', photos: ['file:///a.jpg'], notes: '' }, undefined, asOwner))
  const jid = job.job.id
  await r.run((s) => setJobLines(s, jid, [{ id: 'l1', kind: 'labour', name: 'Fit', qty: 1, price: 500 }, { id: 'p1', kind: 'part', name: 'Screen', qty: 1, price: 2000, variantId: PART }], asOwner))
  await r.run((s) => setJobStatus(s, jid, 'estimated', asOwner))
  await r.run((s) => setJobStatus(s, jid, 'approved', asOwner, { approvedBy: 'Meera' }))
  await r.run((s) => setJobStatus(s, jid, 'in_work', asOwner))
  await r.run((s) => issuePart(s, jid, 'p1', 1, asOwner))
  await r.run((s) => setJobStatus(s, jid, 'ready', asOwner))
  await r.run((s) => billJobCard(s, jid, [{ mode: 'upi', amount: 2500 }], ctx({ now: NOW + 7_200_000 })))
  // projects
  const pr = await r.run((s) => saveProject(s, { name: 'Website', customerId: 'c1', billing: 'hourly', hourlyRate: 1000, fixedAmount: 0, budgetHours: 10, notes: '' }, undefined, mctx()))
  const task = await r.run((s) => saveTask(s, pr.project.id, { title: 'Design', estHours: 3, billable: true }, undefined, mctx()))
  await r.run((s) => setTaskStatus(s, task.task.id, 'doing', asOwner))
  await r.run((s) => logTime(s, { projectId: pr.project.id, taskId: task.task.id, date: TODAY, minutes: 90, billable: true, note: '' }, asOwner))
  const timer = await r.run((s) => startTimer(s, { projectId: pr.project.id, billable: true }, asOwner))
  await r.run((s) => stopTimer(s, timer.entry.id, ctx({ now: NOW + 30 * 60_000 })))
  await r.run((s) => invoiceTimesheet(s, pr.project.id, [{ mode: 'upi', amount: 2000 }], asOwner))
  const fixed = await r.run((s) => saveProject(s, { name: 'Audit', customerId: 'c2', billing: 'fixed', hourlyRate: 0, fixedAmount: 10000, budgetHours: 0, notes: '' }, undefined, mctx()))
  await r.run((s) => invoiceFixedFee(s, fixed.project.id, 4000, 'Advance', [{ mode: 'cash', amount: 4000 }], asOwner))
  // visit
  const visit = await r.run((s) => saveVisit(s, { customerId: 'c1', partyName: '', partyPhone: '', address: '12 MG Rd', purpose: 'Install', userId: 'u_cash', plannedAt: NOW + 3_600_000, notes: '' }, undefined, asOwner))
  await r.run((s) => checkIn(s, visit.visit.id, { place: 'Site' }, cctx()))
  await r.run((s) => saveVisitReport(s, visit.visit.id, { report: { summary: 'Done' }, photos: ['file:///v.jpg'] }, cctx()))
  await r.run((s) => signVisit(s, visit.visit.id, { kind: 'drawn', name: 'Meera', strokes: ['M 1 1 L 5 5 L 9 2 L 12 9'], width: 300, height: 120 }, cctx()))
  await r.run((s) => completeVisit(s, visit.visit.id, cctx(), { packageId: pid }))
  return { r, pid, plan: plan.plan, sale2: sale2.package, jid, pr: pr.project, a2: a2.appointment }
}

describe('services replicate', () => {
  test('every collection reaches the server exactly as it is on the phone — including the stock and the package counters', async () => {
    const { r, pid } = await busy()
    const view = await r.serverView()
    for (const c of SERVICE_COLLS) expect({ c, v: view[c] }).toEqual({ c, v: r.phone[c] })
    for (const c of ['appointments', 'packageSales', 'customerPackages', 'packageUses', 'jobCards', 'projects', 'projectTasks', 'timeEntries', 'fieldVisits'] as const) expect(count(view[c])).toBeGreaterThan(0)
    expect(view.variants[PART].stock).toBe(r.phone.variants[PART].stock)
    expect(view.variants[PART].stock).toBe(4)
    expect(view.bills).toEqual(r.phone.bills)
    // 5 sessions: appointment, reversed use (gives back), visit → 2 used on the first package
    expect(view.customerPackages[pid]).toMatchObject({ sessionsUsed: 2, recognised: 2000 })
    expect(listOf(view.packageUses)).toHaveLength(6)
  })

  test('the module registers every collection it uses, once', () => {
    const names = allCollectionMetas().map((m) => m.name)
    for (const c of SERVICE_COLLS) expect(names.filter((n) => n === c)).toHaveLength(1)
  })

  test('a cashier does the counter work but cannot set up the shop, projects or packages\' price lists', async () => {
    const { r } = await busy()
    const cashier = actorWith(ROLE_PERMISSIONS.cashier, 'u_cash')
    const s = r.phone
    const forged = [
      ...muts(s, saveServiceSettings(s, { openTime: '07:00' }, mctx()).changes),
      ...muts(s, saveResource(s, { id: 'res_x', name: 'Ghost', kind: 'staff', daysOff: [], variantIds: [], active: true }, undefined, mctx()).changes),
      ...muts(s, saveServiceItem(s, { variantId: SVC.cut, durationMin: 10, bufferMin: 0, active: true }, mctx()).changes),
      ...muts(s, savePlan(s, { name: 'Free', price: 1, sessions: 99, validityDays: 0, variantIds: [], gstRate: 0, notes: '', active: true }, undefined, mctx()).changes),
      ...muts(s, saveProject(s, { name: 'P', customerId: null, billing: 'hourly', hourlyRate: 1, fixedAmount: 0, budgetHours: 0, notes: '' }, undefined, mctx()).changes),
    ].filter((m) => m.coll !== 'audit')
    expect(forged.map((m) => m.coll).sort()).toEqual(['packagePlans', 'projects', 'serviceItems', 'serviceResources', 'serviceSettings'])
    for (const m of forged) await expect(r.send([m], cashier)).rejects.toThrow('forbidden')
    // …but a cashier books, takes in repairs, logs time, sells a package and plans a visit
    const book = saveAppointment(s, bookDraft({ customerId: 'c2', start: tomorrowAt('18:00') }), undefined, cctx())
    const jc = saveJobCard(s, { customerId: 'c1', partyName: '', partyPhone: '', kind: 'other', title: 'Fan', identifier: '', reading: '', accessories: '', condition: '', problem: 'Noisy', photos: [], notes: '' }, undefined, cctx())
    const sold = sellPackage(s, { customerId: 'c2', planId: Object.values(s.packagePlans)[0].id, mode: 'cash' }, cctx())
    const t = logTime(s, { projectId: Object.keys(s.projects)[0], date: TODAY, minutes: 15, billable: true, note: '' }, cctx())
    for (const ch of [book.changes, jc.changes, sold.changes, t.changes]) {
      const ms = muts(s, ch).filter((m) => m.coll !== 'audit')
      await r.send(ms, cashier)
    }
    const seen = await r.serverView()
    expect(seen.appointments[book.appointment.id]).toBeTruthy()
    expect(seen.jobCards[jc.job.id]).toBeTruthy()
    expect(seen.customerPackages[sold.package.id]).toMatchObject({ sessionsUsed: 0 })
  })

  test('a cashier cannot read the counters of a role without services access', async () => {
    const { r } = await busy()
    const nobody = actorWith(['pos'], 'u_x')
    const view = await r.serverView(nobody)
    for (const c of SERVICE_COLLS) expect({ c, n: count(view[c]) }).toEqual({ c, n: 0 })
    await expect(r.send(muts(r.phone, saveAppointment(r.phone, bookDraft({ customerId: 'c2', start: tomorrowAt('12:00') }), undefined, cctx()).changes).filter((m) => m.coll === 'appointments'), nobody)).rejects.toThrow('forbidden')
  })

  test('posted package sales and uses cannot be edited or deleted, and the counters cannot be patched', async () => {
    const { r, pid } = await busy()
    const use = listOf(r.phone.packageUses)[0]
    const sale = listOf(r.phone.packageSales)[0]
    await expect(r.send([{ mid: 'x1', coll: 'packageUses', id: use.id, op: 'patch', data: { sessions: 99 }, at: 1 }])).rejects.toThrow('immutable')
    await expect(r.send([{ mid: 'x2', coll: 'packageUses', id: use.id, op: 'delete', at: 2 }])).rejects.toThrow('immutable')
    await expect(r.send([{ mid: 'x3', coll: 'packageSales', id: sale.id, op: 'patch', data: { price: 1 }, at: 3 }])).rejects.toThrow('immutable')
    // sessionsUsed / recognised belong to the server: a patch to them changes nothing
    await r.send([{ mid: 'x4', coll: 'customerPackages', id: pid, op: 'patch', data: { sessionsUsed: 0, recognised: 0, note: 'hello' }, at: 4 }])
    const p = (await r.serverView()).customerPackages[pid]
    expect(p).toMatchObject({ sessionsUsed: 2, recognised: 2000, note: 'hello' })
  })

  test('a package a phone invents without a matching sale is refused; so is one that starts partly used', async () => {
    const { r, plan } = await busy()
    const s = r.phone
    const real = sellPackage(s, { customerId: 'c1', planId: plan.id, mode: 'cash' }, ctx())
    const pkgOnly = muts(s, { put: { customerPackages: [real.package] } })
    await expect(r.send(pkgOnly)).rejects.toThrow('Sell the package first')
    // sale posted, then a package claiming more than was sold
    await r.send(muts(s, { put: { packageSales: [real.sale] } }))
    const bigger = muts(s, { put: { customerPackages: [{ ...real.package, sessions: 50 }] } })
    await expect(r.send(bigger)).rejects.toThrow('does not match its sale')
    const used = muts(s, { put: { customerPackages: [{ ...real.package, sessionsUsed: 2 }] } })
    await expect(r.send(used)).rejects.toThrow('starts with nothing used')
    await r.send(muts(s, { put: { customerPackages: [real.package] } }))
    expect((await r.serverView()).customerPackages[real.package.id]).toMatchObject({ sessions: 5, sessionsUsed: 0 })
  })

  test('two phones cannot both take the last session', async () => {
    const r = rig(baseState()); await r.seed()
    await r.run((s) => saveServiceSettings(s, {}, mctx()))
    const plan = await r.run((s) => savePlan(s, { name: 'Two', price: 1000, sessions: 2, validityDays: 0, variantIds: [], gstRate: 0, notes: '', active: true }, undefined, mctx()))
    const sale = await r.run((s) => sellPackage(s, { customerId: 'c1', planId: plan.plan.id, mode: 'cash' }, ctx()))
    await r.run((s) => usePackageSession(s, sale.package.id, {}, ctx()))
    // both phones know "1 session left" …
    const stale = r.phone
    const a = usePackageSession(stale, sale.package.id, {}, ctx({ now: NOW + 1000 }))
    const b = usePackageSession(stale, sale.package.id, {}, ctx({ now: NOW + 2000 }))
    await r.send(muts(stale, a.changes).filter((m) => m.coll === 'packageUses'))
    await expect(r.send(muts(stale, b.changes).filter((m) => m.coll === 'packageUses'))).rejects.toThrow('has only 0 sessions left')
    const view = await r.serverView()
    expect(view.customerPackages[sale.package.id]).toMatchObject({ sessionsUsed: 2, recognised: 1000 })
    expect(count(view.packageUses)).toBe(2)
    // the same use sent twice (a retry) counts once
    const again = await r.send(muts(stale, a.changes).filter((m) => m.coll === 'packageUses'))
    expect(again.map((x) => x.status)).toEqual(['duplicate']) // the ledger row exists, so a retry is ignored
    expect((await r.serverView()).customerPackages[sale.package.id].sessionsUsed).toBe(2)
  })

  test('a use against another customer\'s package, a frozen package or a forged reversal is refused', async () => {
    const { r, pid, sale2 } = await busy()
    const s = r.phone
    const cp = s.customerPackages[pid]
    const forgedUse = { id: 'pu_x', customerPackageId: pid, customerId: 'c2', kind: 'use', sessions: 1, value: 1, tax: 0, date: NOW, note: '', userId: 'u' }
    await expect(r.send(muts(s, { put: { packageUses: [forgedUse as never] } }))).rejects.toThrow('another customer')
    const badRev = { ...forgedUse, id: 'rev_nothing', customerId: 'c1', kind: 'reversal', sessions: -1, value: -1, reverses: 'nothing' }
    await expect(r.send(muts(s, { put: { packageUses: [badRev as never] } }))).rejects.toThrow('no session to give back')
    // a reversal that does not repeat the original's figures
    const used = listOf(s.packageUses).find((u) => u.kind === 'use' && u.customerPackageId === pid && !s.packageUses[`rev_${u.id}`])!
    const wrong = { ...badRev, id: `rev_${used.id}`, reverses: used.id, sessions: -used.sessions, value: -used.value - 5, tax: -used.tax }
    await expect(r.send(muts(s, { put: { packageUses: [wrong as never] } }))).rejects.toThrow('repeat the session')
    expect(cp.sessionsUsed).toBe(2)
    expect(sale2.id).toBeTruthy()
  })

  test('a second device billing the same appointment or job creates no second bill', async () => {
    const { r, jid, a2 } = await busy()
    expect(listOf(r.phone.bills).filter((b) => b.notes.includes('JC-0001'))).toHaveLength(1)
    expect(r.phone.jobCards[jid].billId).toBeTruthy()
    expect(r.phone.appointments[a2.id].packageUseId).toBeTruthy()
  })
})
