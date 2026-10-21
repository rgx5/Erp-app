import { listOf, type Coll, type DataState } from '@/data/state'
import { ROLE_PERMISSIONS } from '@/domain/permissions'
import { mutationsFromChanges } from '@/replication/client'
import { actorWith, rig } from '@/replication/testkit'
import { allCollectionMetas } from '@/replication/registry'
import { decideClaim, issueAdvance, paySalary, reimburseClaim, runPayroll, saveAdjustment, saveIncentivePlan, submitClaim, voidPayslip } from '../payrollOps'
import {
  assignRoster, decideLeave, decideRegularisation, markAttendance, punch, requestLeave, requestRegularisation, saveCandidate, saveEmployee, saveEmployeeDoc, saveHoliday, saveHrSettings,
  saveOpening, savePay, saveShift, saveTarget, seedLeaveTypes, hireCandidate,
} from '../ops'
import { AFTER, at, baseState, ctx, ctxAt, empDraft, payDraft } from './helpers'

const HR_COLLS: Coll[] = [
  'employees', 'employeeDocs', 'employeePay', 'punches', 'attendance', 'regularisations', 'hrDecisions', 'workShifts', 'rosters', 'hrHolidays', 'leaveTypes', 'leaveRequests', 'leaveGrants',
  'payAdjustments', 'staffAdvances', 'staffRepayments', 'payslips', 'payslipVoids', 'salaryPayouts', 'hrSettings', 'incentivePlans', 'hrTargets', 'expenseClaims', 'claimPayouts', 'hrOpenings', 'hrCandidates',
]
const late = () => ctx({ now: AFTER })
const count = (rec: unknown) => Object.keys((rec as object) ?? {}).length
let seq = 0
const muts = (state: DataState, changes: Parameters<typeof mutationsFromChanges>[1]) => mutationsFromChanges(state, changes, { deviceId: 'dev2', nextSeq: () => ++seq })

/** A month of people-and-payroll work on a phone, every step sent through the server's rules. */
async function busyMonth() {
  const r = rig(baseState()); await r.seed()
  const shift = await r.run((s) => saveShift(s, { name: 'Morning', start: '09:00', end: '18:00', breakMins: 60, graceMins: 10, active: true }, undefined, ctx()))
  const ravi = await r.run((s) => saveEmployee(s, empDraft({ userId: 'u_cash', shiftId: shift.shift.id }), undefined, ctx()))
  await r.run((s) => savePay(s, ravi.employee.id, payDraft(), ctx()))
  await r.run((s) => saveEmployeeDoc(s, { employeeId: ravi.employee.id, kind: 'aadhaar', title: 'Aadhaar', number: '1', note: '' }, undefined, ctx()))
  await r.run((s) => saveHoliday(s, { date: '2026-10-20', name: 'Diwali' }, ctx()))
  await r.run((s) => assignRoster(s, { employeeIds: [ravi.employee.id], from: '2026-10-26', to: '2026-10-27', shiftId: 'off' }, ctx()))
  await r.run((s) => seedLeaveTypes(s, ctx()))
  await r.run((s) => punch(s, ravi.employee.id, { geo: 'Shop' }, ctxAt('2026-10-12', '09:00', { userId: 'u_cash' })))
  await r.run((s) => punch(s, ravi.employee.id, {}, ctxAt('2026-10-12', '18:00', { userId: 'u_cash' })))
  await r.run((s) => markAttendance(s, { employeeId: ravi.employee.id, date: '2026-10-13', status: 'half', reason: 'Left early' }, ctx()))
  const reg = await r.run((s) => requestRegularisation(s, { employeeId: ravi.employee.id, date: '2026-10-14', inTime: '09:00', outTime: '18:00', reason: 'Forgot' }, ctx()))
  await r.run((s) => decideRegularisation(s, reg.request.id, 'approved', '', ctx()))
  const cl = listOf(r.phone.leaveTypes).find((t) => t.code === 'CL')!
  const lv = await r.run((s) => requestLeave(s, { employeeId: ravi.employee.id, typeId: cl.id, from: '2026-10-21', to: '2026-10-22', reason: '' }, ctx()))
  await r.run((s) => decideLeave(s, lv.request.id, 'approved', '', ctx()))
  await r.run((s) => saveTarget(s, { employeeId: ravi.employee.id, month: '2026-10', amount: 10000 }, ctx()))
  await r.run((s) => saveIncentivePlan(s, { name: 'Std', baseRatePct: 1, slabs: [], bonusAtTarget: 0, minSales: 0, cap: 0, active: true }, undefined, ctx()))
  await r.run((s) => saveHrSettings(s, { geoNote: 'Within 100 m of the shop' }, ctx()))
  const adv = await r.run((s) => issueAdvance(s, { employeeId: ravi.employee.id, kind: 'loan', amount: 3000, mode: 'cash', installments: 3, startMonth: '2026-10' }, ctx()))
  await r.run((s) => saveAdjustment(s, { employeeId: ravi.employee.id, month: '2026-10', kind: 'bonus', label: 'Diwali', amount: 1000, note: '' }, undefined, late()))
  const run1 = await r.run((s) => runPayroll(s, '2026-10', undefined, late()))
  await r.run((s) => voidPayslip(s, run1.payslips[0].id, 'redo', late()))
  const run2 = await r.run((s) => runPayroll(s, '2026-10', undefined, late()))
  await r.run((s) => paySalary(s, run2.payslips[0].id, { mode: 'bank', ref: 'N1' }, late()))
  const claim = await r.run((s) => submitClaim(s, { employeeId: ravi.employee.id, date: '2026-10-15', category: 'Travel', amount: 500, description: 'Auto' }, ctx()))
  await r.run((s) => decideClaim(s, claim.claim.id, 'approved', 450, '', ctx()))
  await r.run((s) => reimburseClaim(s, claim.claim.id, { mode: 'cash' }, ctx()))
  const opening = await r.run((s) => saveOpening(s, { title: 'Helper', department: '', positions: 1, location: '', payRange: '', description: '' }, undefined, ctx()))
  const cand = await r.run((s) => saveCandidate(s, { openingId: opening.opening.id, name: 'Anil', phone: '9999999999', email: '', source: '', expectedPay: 0, notes: '' }, undefined, ctx()))
  await r.run((s) => hireCandidate(s, cand.candidate.id, { joinDate: '2026-11-01', weeklyOff: [0] }, ctx()))
  return { r, ravi: ravi.employee, adv: adv.advance, run2 }
}

describe('hr replicates', () => {
  test('every collection reaches the server exactly as it is on the phone', async () => {
    const { r } = await busyMonth()
    const view = await r.serverView()
    for (const c of HR_COLLS) expect({ c, v: view[c] }).toEqual({ c, v: r.phone[c] })
    for (const c of ['payslips', 'punches', 'employees', 'hrDecisions', 'salaryPayouts', 'claimPayouts'] as const) expect(count(view[c])).toBeGreaterThan(0)
    // the voided payslip and its replacement are both there
    expect(listOf(view.payslips)).toHaveLength(2)
    expect(listOf(view.payslipVoids)).toHaveLength(1)
  })

  test('the module registers every collection it uses, once', () => {
    const names = allCollectionMetas().map((m) => m.name)
    for (const c of HR_COLLS) expect(names.filter((n) => n === c)).toHaveLength(1)
  })

  test('a cashier cannot read payroll, pay terms, advances or recruitment — and cannot write them', async () => {
    const { r, ravi, run2 } = await busyMonth()
    const cashier = actorWith(ROLE_PERMISSIONS.cashier, 'u_cash')
    const view = await r.serverView(cashier)
    for (const c of ['payslips', 'payslipVoids', 'salaryPayouts', 'employeePay', 'staffAdvances', 'staffRepayments', 'payAdjustments', 'incentivePlans', 'claimPayouts', 'hrOpenings', 'hrCandidates', 'employeeDocs', 'hrTargets'] as const) {
      expect({ c, n: count(view[c]) }).toEqual({ c, n: 0 })
    }
    // what a cashier does see: the roster side and their own self-service documents
    for (const c of ['employees', 'punches', 'workShifts', 'hrHolidays', 'leaveTypes', 'leaveRequests', 'hrSettings', 'expenseClaims', 'hrDecisions'] as const) expect(count(view[c])).toBeGreaterThan(0)
    const base = baseState()
    const forged = [
      muts(base, runPayroll(r.phone, '2026-11', undefined, ctx({ now: at('2026-12-02') })).changes),
      muts(base, savePay(r.phone, ravi.id, payDraft({ basic: 90000 }), ctx()).changes),
      muts(base, issueAdvance(r.phone, { employeeId: ravi.id, kind: 'advance', amount: 100, mode: 'cash', installments: 1, startMonth: '2026-10' }, ctx()).changes),
      muts(base, saveHrSettings(r.phone, { payDay: 20 }, ctx()).changes),
      muts(base, paySalary({ ...r.phone, salaryPayouts: {} }, run2.payslips[0].id, { mode: 'cash' }, ctx()).changes),
    ]
    for (const m of forged) {
      const res = await r.send(m.filter((x) => ['payslips', 'employeePay', 'staffAdvances', 'hrSettings', 'salaryPayouts'].includes(x.coll)), cashier).catch((e: Error) => e.message)
      expect(String(res)).toContain('forbidden')
    }
    expect(listOf((await r.serverView()).staffAdvances)).toHaveLength(1)
    expect((await r.serverView()).employeePay[ravi.id].basic).toBe(20000)
  })

  test('a cashier can punch, ask for leave and submit a claim — but not decide them or mark attendance', async () => {
    const { r, ravi } = await busyMonth()
    const cashier = actorWith(ROLE_PERMISSIONS.cashier, 'u_cash')
    const state = r.phone
    const cl = listOf(state.leaveTypes).find((t) => t.code === 'CL')!
    const p = punch(state, ravi.id, { geo: 'Shop' }, ctxAt('2026-11-03', '09:00', { userId: 'u_cash' }))
    const lv = requestLeave(state, { employeeId: ravi.id, typeId: cl.id, from: '2026-11-04', to: '2026-11-04', reason: '' }, ctx({ now: at('2026-11-03') }))
    const cm = submitClaim(state, { employeeId: ravi.id, date: '2026-11-02', category: 'Food', amount: 100, description: 'Tea' }, ctx({ now: at('2026-11-03') }))
    await r.send(muts(state, p.changes).filter((m) => m.coll === 'punches'), cashier)
    await r.send(muts(state, lv.changes).filter((m) => m.coll === 'leaveRequests'), cashier)
    await r.send(muts(state, cm.changes).filter((m) => m.coll === 'expenseClaims'), cashier)
    const seen = await r.serverView()
    expect(listOf(seen.punches).some((x) => x.id === p.punch.id)).toBe(true)
    expect(seen.leaveRequests[lv.request.id]).toBeTruthy()
    expect(seen.expenseClaims[cm.claim.id]).toBeTruthy()
    // approving, rejecting, marking attendance are for the people side
    const approve = decideLeave({ ...state, leaveRequests: { ...state.leaveRequests, [lv.request.id]: lv.request } }, lv.request.id, 'approved', '', ctx({ now: at('2026-11-03') }))
    const mark = markAttendance(state, { employeeId: ravi.id, date: '2026-11-02', status: 'present', reason: '' }, ctx({ now: at('2026-11-03') }))
    for (const m of [...muts(state, approve.changes).filter((x) => x.coll === 'hrDecisions'), ...muts(state, mark.changes).filter((x) => x.coll === 'attendance')]) {
      await expect(r.send([m], cashier)).rejects.toThrow('forbidden')
    }
  })

  test('posted payslips, punches and decisions cannot be edited or deleted', async () => {
    const { r, run2 } = await busyMonth()
    const slip = run2.payslips[0]
    await expect(r.send([{ mid: 'e1', coll: 'payslips', id: slip.id, op: 'patch', data: { net: 99999 }, at: 1 }])).rejects.toThrow('immutable')
    await expect(r.send([{ mid: 'e2', coll: 'payslips', id: slip.id, op: 'delete', at: 2 }])).rejects.toThrow('immutable')
    const dec = listOf(r.phone.hrDecisions)[0]
    await expect(r.send([{ mid: 'e3', coll: 'hrDecisions', id: dec.id, op: 'patch', data: { decision: 'rejected' }, at: 3 }])).rejects.toThrow('immutable')
  })

  test('a second device running the same payroll creates no second payslip, and a second approval is ignored', async () => {
    const { r, run2 } = await busyMonth()
    const dup = muts(baseState(), { put: { payslips: [run2.payslips[0]] } })
    const res = await r.send(dup)
    expect(res.map((x) => x.status)).toEqual(['duplicate'])
    expect(listOf((await r.serverView()).payslips)).toHaveLength(2)
  })

  test('the server refuses malformed documents', async () => {
    const r = rig(baseState()); await r.seed()
    const bad = (coll: string, data: Record<string, unknown>) => r.send([{ mid: `m${++seq}`, coll, id: String(data.id), op: 'create', data, at: 1 }])
    await expect(bad('payslips', { id: 'x', employeeId: 'e', month: 'October', net: 1, gross: 1, earnings: [], deductions: [] })).rejects.toThrow('payslip needs')
    await expect(bad('employees', { id: 'x', name: '', joinDate: '2026-01-01', weeklyOff: [] })).rejects.toThrow('employee needs')
    await expect(bad('workShifts', { id: 'x', name: 'N', start: '9am', end: '18:00' })).rejects.toThrow('shift needs')
    await expect(bad('hrSettings', { id: 'hr', pfEmployeePct: 500 })).rejects.toThrow('percentage')
  })
})
