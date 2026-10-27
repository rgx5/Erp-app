import { reportText, signatureProblem, visitLog, visitMinutes, missedVisits, visitsOn } from '../logic/visits'
import { cancelVisit, checkIn, completeVisit, saveVisit, saveVisitReport, sellPackage, signVisit } from '../ops'
import { cctx, ctx, mctx, NOW, planId, run, shopState, todayAt, tomorrowAt } from './helpers'

const vdraft = (over = {}) => ({ customerId: 'c1' as string | null, partyName: '', partyPhone: '', address: '12 MG Road', purpose: 'Install CCTV', userId: 'u_cash', plannedAt: todayAt('14:00'), notes: '', ...over })

function planned() {
  const s = shopState()
  const v = run(s, saveVisit(s, vdraft(), undefined, ctx()))
  return { s: v.state, id: v.result.visit.id }
}

describe('field visits', () => {
  test('planned → checked in (time and place) → report → signature → done', () => {
    let { s, id } = planned()
    expect(s.fieldVisits[id]).toMatchObject({ no: 'FV-0001', status: 'planned', partyName: 'Meera', userId: 'u_cash' })
    s = run(s, checkIn(s, id, { place: 'Customer shop, Andheri' }, cctx({ now: todayAt('14:10') }))).state
    expect(s.fieldVisits[id]).toMatchObject({ status: 'checked_in', checkInAt: todayAt('14:10'), checkInPlace: 'Customer shop, Andheri' })
    s = run(s, saveVisitReport(s, id, { notes: 'Power point far', report: { summary: 'Installed 4 cameras', workDone: '4 cameras, DVR', nextSteps: 'Return Friday to train' }, photos: ['file:///x.jpg'] }, cctx())).state
    s = run(s, signVisit(s, id, { kind: 'typed', name: 'Meera Rao' }, cctx({ now: todayAt('15:30') }))).state
    expect(s.fieldVisits[id].signature).toMatchObject({ kind: 'typed', name: 'Meera Rao', signedAt: todayAt('15:30') })
    const done = run(s, completeVisit(s, id, cctx({ now: todayAt('15:40') })))
    expect(done.state.fieldVisits[id]).toMatchObject({ status: 'completed', checkOutAt: todayAt('15:40') })
    expect(visitMinutes(done.state.fieldVisits[id])).toBe(90)
    const text = reportText(done.state.fieldVisits[id], 'FixIt', 'Ravi')
    expect(text).toContain('Visited by Ravi')
    expect(text).toContain('Installed 4 cameras')
    expect(text).toContain('Signed by Meera Rao (typed name)')
    expect(() => saveVisitReport(done.state, id, { notes: 'x' }, ctx())).toThrow('closed')
  })

  test('a drawn signature needs real strokes', () => {
    let { s, id } = planned()
    s = run(s, checkIn(s, id, { place: 'Site' }, cctx())).state
    expect(() => signVisit(s, id, { kind: 'drawn', name: 'Meera', strokes: ['M 1 1'], width: 300, height: 120 }, ctx())).toThrow('sign in the box')
    expect(() => signVisit(s, id, { kind: 'typed', name: ' ' }, ctx())).toThrow('name')
    const r = signVisit(s, id, { kind: 'drawn', name: 'Meera', strokes: ['M 1 1 L 20 30 L 40 10 L 60 50'], width: 300, height: 120 }, ctx())
    expect(r.visit.signature).toMatchObject({ kind: 'drawn', width: 300, height: 120 })
    expect(signatureProblem({ kind: 'drawn', name: 'x', strokes: [] })).toBeTruthy()
  })

  test('refusals: checking in twice or for someone else, finishing without a summary or before check-in', () => {
    let { s, id } = planned()
    expect(() => checkIn(s, id, { place: '' }, cctx())).toThrow('where you are')
    expect(() => checkIn(s, id, { place: 'Site' }, ctx({ userId: 'u_mgr' }))).not.toThrow() // a manager may
    const other = { ...s, users: { ...s.users } }
    expect(() => checkIn(other, id, { place: 'Site' }, ctx({ userId: 'u_owner' }))).not.toThrow() // the owner may
    expect(() => completeVisit(s, id, ctx())).toThrow('Check in')
    s = run(s, checkIn(s, id, { place: 'Site', lat: 19.07, lng: 72.87 }, cctx())).state
    expect(s.fieldVisits[id]).toMatchObject({ lat: 19.07, lng: 72.87 })
    expect(() => checkIn(s, id, { place: 'Site' }, cctx())).toThrow('on site')
    expect(() => completeVisit(s, id, ctx())).toThrow('summary')
    const p2 = planned()
    expect(() => checkIn(p2.s, p2.id, { place: 'x', lat: 200, lng: 0 }, cctx())).toThrow('coordinates')
    // a cashier who is not the visitor cannot check in for someone else
    const v2 = run(s, saveVisit(s, vdraft({ userId: 'u_mgr' }), undefined, ctx()))
    expect(() => checkIn(v2.state, v2.result.visit.id, { place: 'Site' }, cctx())).toThrow('checks in for this visit')
  })

  test('a visit can be paid for with a package session', () => {
    let { s, id } = planned()
    s = run(s, sellPackage(s, { customerId: 'c1', planId: planId(s), mode: 'cash' }, ctx())).state
    s = run(s, checkIn(s, id, { place: 'Site' }, cctx())).state
    s = run(s, saveVisitReport(s, id, { report: { summary: 'Done' } }, cctx())).state
    const pid = Object.values(s.customerPackages)[0].id
    const r = run(s, completeVisit(s, id, cctx(), { packageId: pid }))
    expect(r.state.customerPackages[pid].sessionsUsed).toBe(1)
    expect(r.state.fieldVisits[id].packageUseId).toBe(Object.values(r.state.packageUses)[0].id)
  })

  test('cancelling, the day list and missed visits', () => {
    let { s, id } = planned()
    const v2 = run(s, saveVisit(s, vdraft({ plannedAt: tomorrowAt('10:00'), customerId: null, partyName: 'Shop B' }), undefined, ctx()))
    s = v2.state
    expect(visitsOn(s, NOW).map((v) => v.id)).toEqual([id])
    expect(missedVisits(s, todayAt('16:00'))).toHaveLength(1)
    s = run(s, cancelVisit(s, id, 'Customer away', ctx())).state
    expect(s.fieldVisits[id]).toMatchObject({ status: 'cancelled' })
    expect(s.fieldVisits[id].notes).toContain('Customer away')
    expect(missedVisits(s, todayAt('16:00'))).toHaveLength(0)
    expect(() => cancelVisit(s, id, '', ctx())).toThrow('already')
    expect(visitLog(s, 0, Infinity, NOW)).toHaveLength(2)
    expect(() => saveVisit(s, vdraft({ customerId: null, partyName: '' }), undefined, ctx())).toThrow('who is being visited')
    expect(() => saveVisit(s, vdraft({ userId: 'ghost' }), undefined, ctx())).toThrow('no longer exists')
    expect(() => saveVisit(s, vdraft(), id, mctx())).toThrow('planned')
  })
})
