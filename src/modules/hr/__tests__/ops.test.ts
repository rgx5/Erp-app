import { billInput, line } from '@/data/__tests__/helpers'
import { OpError, saveBill } from '@/data/ops'
import { listOf } from '@/data/state'
import { advanceStandings } from '../logic/advances'
import { claimRows } from '../logic/claims'
import { balancesFor } from '../logic/leave'
import { payrollPreview } from '../logic/payroll'
import { buildIndex, employeeMonth } from '../logic/select'
import { hrSettings } from '../logic/settings'
import { livePayslips, paidOf } from '../logic/slips'
import { scorecards } from '../logic/targets'
import {
  assignRoster, clearMark, decideLeave, decideRegularisation, deleteEmployeeDoc, deleteLeaveType, deleteShift, exitEmployee, grantLeave, hireCandidate, markAttendance, moveCandidate, punch, reactivateEmployee,
  requestLeave, requestRegularisation, saveCandidate, saveEmployee, saveEmployeeDoc, saveHoliday, saveHrSettings, saveLeaveType, saveOpening, savePay, saveTarget, seedLeaveTypes, setOpeningStatus,
  toggleOnboarding, addInterview,
} from '../ops'
import {
  cancelClaim, decideClaim, deleteAdjustment, issueAdvance, paySalaries, paySalary, postIncentives, reimburseClaim, repayAdvance, runPayroll, saveAdjustment, saveIncentivePlan, submitClaim,
  voidPayslip, writeOffAdvance,
} from '../payrollOps'
import { AFTER, at, ctx, ctxAt, empDraft, hrState, payDraft, presentAllMonth, run } from './helpers'

const fails = (fn: () => unknown, msg: RegExp | string) => { expect(fn).toThrow(OpError); expect(fn).toThrow(msg) }
const late = () => ctx({ now: AFTER })

describe('employees', () => {
  test('numbered, linked to one sign-in, and pay terms are checked', () => {
    const { s, ravi, meera } = hrState()
    expect([ravi.code, meera.code]).toEqual(['EMP-0001', 'EMP-0002'])
    fails(() => saveEmployee(s, empDraft({ name: 'Other', userId: 'u_cash' }), undefined, ctx()), /already uses/)
    fails(() => saveEmployee(s, empDraft({ name: ' ' }), undefined, ctx()), /name/)
    fails(() => saveEmployee(s, empDraft({ joinDate: '2026-13-40' }), undefined, ctx()), /joining date/)
    fails(() => savePay(s, ravi.id, payDraft({ bank: { holder: '', bankName: '', account: '', ifsc: 'bad', upi: '' } }), ctx()), /IFSC/)
    fails(() => savePay(s, ravi.id, payDraft({ basic: 0 }), ctx()), /basic/)
    fails(() => savePay(s, ravi.id, payDraft({ pan: '123' }), ctx()), /PAN/)
    const edited = run(s, saveEmployee(s, empDraft({ name: 'Ravi K', userId: 'u_cash' }), ravi.id, ctx()))
    expect(edited.employees[ravi.id]).toMatchObject({ name: 'Ravi K', code: 'EMP-0001' })
  })
  test('leaving and rejoining; documents; onboarding', () => {
    const { s, ravi } = hrState()
    fails(() => exitEmployee(s, ravi.id, '2025-12-31', ctx()), /before the joining/)
    let t = run(s, exitEmployee(s, ravi.id, '2026-10-31', ctx()))
    expect(t.employees[ravi.id]).toMatchObject({ active: false, exitDate: '2026-10-31' })
    t = run(t, reactivateEmployee(t, ravi.id, ctx()))
    expect(t.employees[ravi.id].active).toBe(true)
    const d = saveEmployeeDoc(t, { employeeId: ravi.id, kind: 'aadhaar', title: 'Aadhaar', number: '1234', expiresOn: '2027-01-01', note: '' }, undefined, ctx())
    t = run(t, d)
    expect(listOf(t.employeeDocs)).toHaveLength(1)
    fails(() => saveEmployeeDoc(t, { employeeId: ravi.id, kind: 'pan', title: '', number: '', note: '' }, undefined, ctx()), /title or a number/)
    t = run(t, deleteEmployeeDoc(t, d.doc.id, ctx()))
    expect(listOf(t.employeeDocs)).toHaveLength(0)
    fails(() => toggleOnboarding(t, ravi.id, 0, ctx()), /no longer/)
  })
})

describe('punching', () => {
  test('in, then out; a second tap within a minute is refused', () => {
    const { s, ravi } = hrState()
    const a = punch(s, ravi.id, { geo: 'Main shop' }, ctxAt('2026-10-12', '09:02', { userId: 'u_cash' }))
    expect(a.punch).toMatchObject({ kind: 'in', date: '2026-10-12', source: 'self', geo: 'Main shop' })
    let t = run(s, a)
    fails(() => punch(t, ravi.id, {}, ctxAt('2026-10-12', '09:02', { userId: 'u_cash' })), /just punched/)
    const b = punch(t, ravi.id, {}, ctxAt('2026-10-12', '18:05', { userId: 'u_cash' }))
    expect(b.punch.kind).toBe('out')
    t = run(t, b)
    const m = employeeMonth(t, buildIndex(t), ravi, '2026-10', at('2026-10-12', '19:00')).sheet.find((d) => d.date === '2026-10-12')!
    expect(m).toMatchObject({ status: 'present', source: 'punch', late: false })
    // the next morning starts a new day
    expect(punch(t, ravi.id, {}, ctxAt('2026-10-13', '09:00')).punch).toMatchObject({ kind: 'in', date: '2026-10-13', source: 'manager' })
  })
  test('a punch-out after midnight closes the evening’s shift', () => {
    const { s, ravi } = hrState()
    const t = run(s, punch(s, ravi.id, {}, ctxAt('2026-10-12', '22:00')))
    expect(punch(t, ravi.id, {}, ctxAt('2026-10-13', '06:00')).punch).toMatchObject({ kind: 'out', date: '2026-10-12' })
  })
  test('a place can be required; people who left cannot punch', () => {
    let { s, ravi } = hrState()
    s = run(s, saveHrSettings(s, { requireGeoNote: true }, ctx()))
    fails(() => punch(s, ravi.id, {}, ctxAt('2026-10-12', '09:00')), /where/)
    s = run(s, exitEmployee(s, ravi.id, '2026-10-31', ctx()))
    fails(() => punch(s, ravi.id, { geo: 'x' }, ctxAt('2026-10-12', '09:00')), /no longer on the staff/)
  })
})

describe('marks and regularisation', () => {
  test('a manager marks a day; times are checked; future days are refused', () => {
    const { s, ravi } = hrState()
    const m = markAttendance(s, { employeeId: ravi.id, date: '2026-10-12', status: 'present', inTime: '09:00', outTime: '18:00', reason: 'Forgot to punch' }, ctx())
    expect(m.mark.id).toBe(`${ravi.id}_2026-10-12`)
    fails(() => markAttendance(s, { employeeId: ravi.id, date: '2026-10-12', status: 'present', inTime: '9am', reason: '' }, ctx()), /HH:MM/)
    fails(() => markAttendance(s, { employeeId: ravi.id, date: '2026-10-12', status: 'present', inTime: '18:00', outTime: '09:00', reason: '' }, ctx()), /after the in time/)
    fails(() => markAttendance(s, { employeeId: ravi.id, date: '2026-10-25', status: 'present', reason: '' }, ctx()), /not happened/)
    fails(() => markAttendance(s, { employeeId: ravi.id, date: '2025-12-31', status: 'present', reason: '' }, ctx()), /joined/)
    const t = run(s, m)
    expect(listOf(run(t, clearMark(t, ravi.id, '2026-10-12', ctx())).attendance)).toHaveLength(0)
    fails(() => clearMark(s, ravi.id, '2026-10-13', ctx()), /no mark/)
  })
  test('a request to fix a day is approved into a mark, once', () => {
    const { s, ravi } = hrState()
    const q = requestRegularisation(s, { employeeId: ravi.id, date: '2026-10-12', inTime: '09:00', outTime: '18:00', reason: 'Phone died' }, ctx())
    let t = run(s, q)
    fails(() => requestRegularisation(t, { employeeId: ravi.id, date: '2026-10-12', inTime: '09:00', reason: 'again' }, ctx()), /already waiting/)
    t = run(t, decideRegularisation(t, q.request.id, 'approved', '', ctx()))
    expect(t.attendance[`${ravi.id}_2026-10-12`]).toMatchObject({ status: 'present', reason: 'Regularised: Phone died' })
    fails(() => decideRegularisation(t, q.request.id, 'rejected', '', ctx()), /already been answered/)
    fails(() => requestRegularisation(t, { employeeId: ravi.id, date: '2026-10-12', reason: 'x' }, ctx()), /time you came in/)
  })
  test('shifts, rosters and holidays', () => {
    const { s, ravi } = hrState()
    const shift = Object.values(s.workShifts)[0]
    fails(() => deleteShift(s, shift.id, ctx()), /still on this shift/)
    const r = assignRoster(s, { employeeIds: [ravi.id], from: '2026-10-12', to: '2026-10-14', shiftId: 'off' }, ctx())
    expect(r.entries).toBe(3)
    let t = run(s, r)
    expect(t.rosters[`${ravi.id}_2026-10-12`].shiftId).toBeNull()
    t = run(t, assignRoster(t, { employeeIds: [ravi.id], from: '2026-10-12', to: '2026-10-14', shiftId: 'usual' }, ctx()))
    expect(listOf(t.rosters)).toHaveLength(0)
    fails(() => assignRoster(s, { employeeIds: [ravi.id], from: '2026-10-12', to: '2027-01-14', shiftId: 'off' }, ctx()), /two months/)
    t = run(t, saveHoliday(t, { date: '2026-11-08', name: 'Diwali' }, ctx()))
    expect(hrSettings(t).payDay).toBe(7)
  })
})

describe('leave', () => {
  test('request, balance, approve, cancel', () => {
    let { s, ravi } = hrState()
    s = run(s, seedLeaveTypes(s, ctx()))
    fails(() => seedLeaveTypes(s, ctx()), /already set up/)
    const cl = listOf(s.leaveTypes).find((t) => t.code === 'CL')!
    // joined 1 Jan: by 19 Oct that is 10 months of casual leave
    const bal = () => balancesFor(s, buildIndex(s), ravi, '2026-10-19', 1).find((b) => b.type.id === cl.id)!.balance
    expect(bal()).toMatchObject({ accrued: 10, balance: 10, available: 10 })
    const q = requestLeave(s, { employeeId: ravi.id, typeId: cl.id, from: '2026-10-21', to: '2026-10-23', reason: 'Wedding' }, ctx())
    expect(q.request).toMatchObject({ no: 'LV-0001', days: 3 })
    s = run(s, q)
    expect(bal()).toMatchObject({ pending: 3, available: 7 })
    fails(() => requestLeave(s, { employeeId: ravi.id, typeId: cl.id, from: '2026-10-22', to: '2026-10-22', reason: '' }, ctx()), /already a leave request/)
    fails(() => requestLeave(s, { employeeId: ravi.id, typeId: cl.id, from: '2026-11-01', to: '2026-11-01', reason: '' }, ctx()), /already weekly offs/)
    fails(() => requestLeave(s, { employeeId: ravi.id, typeId: cl.id, from: '2026-11-02', to: '2026-11-20', reason: '' }, ctx()), /left; this needs/)
    s = run(s, decideLeave(s, q.request.id, 'approved', 'Enjoy', ctx()))
    expect(bal()).toMatchObject({ taken: 3, balance: 7, pending: 0 })
    fails(() => decideLeave(s, q.request.id, 'rejected', '', ctx()), /already approved/)
    // approved leave shows up in attendance as paid leave
    const sheet = employeeMonth(s, buildIndex(s), ravi, '2026-10', AFTER).sheet
    expect(sheet.find((d) => d.date === '2026-10-22')).toMatchObject({ status: 'leave', leavePaid: true })
    s = run(s, decideLeave(s, q.request.id, 'cancelled', '', ctx()))
    expect(bal().taken).toBe(0)
    expect(employeeMonth(s, buildIndex(s), ravi, '2026-10', AFTER).sheet.find((d) => d.date === '2026-10-22')!.status).toBe('unmarked')
  })
  test('half days, unpaid leave, grants and type rules', () => {
    let { s, ravi } = hrState()
    s = run(s, seedLeaveTypes(s, ctx()))
    const lwp = listOf(s.leaveTypes).find((t) => t.code === 'LWP')!
    const cl = listOf(s.leaveTypes).find((t) => t.code === 'CL')!
    const half = requestLeave(s, { employeeId: ravi.id, typeId: cl.id, from: '2026-10-21', to: '2026-10-21', half: 'first', reason: '' }, ctx())
    expect(half.request.days).toBe(0.5)
    fails(() => requestLeave(s, { employeeId: ravi.id, typeId: cl.id, from: '2026-10-21', to: '2026-10-22', half: 'first', reason: '' }, ctx()), /single day/)
    s = run(s, half)
    // the other half of the same day can be asked separately
    expect(requestLeave(s, { employeeId: ravi.id, typeId: cl.id, from: '2026-10-21', to: '2026-10-21', half: 'second', reason: '' }, ctx()).request.days).toBe(0.5)
    expect(requestLeave(s, { employeeId: ravi.id, typeId: lwp.id, from: '2026-11-02', to: '2026-11-20', reason: '' }, ctx()).request.days).toBe(17)
    fails(() => grantLeave(s, { employeeId: ravi.id, typeId: lwp.id, days: 2, date: '2026-10-01', reason: 'x' }, ctx()), /no balance/)
    fails(() => grantLeave(s, { employeeId: ravi.id, typeId: cl.id, days: 0, date: '2026-10-01', reason: 'x' }, ctx()), /number of days/)
    s = run(s, grantLeave(s, { employeeId: ravi.id, typeId: cl.id, days: 5, date: '2026-10-01', reason: 'Comp-off' }, ctx()))
    expect(balancesFor(s, buildIndex(s), ravi, '2026-10-19', 1).find((b) => b.type.id === cl.id)!.balance.balance).toBe(15)
    fails(() => deleteLeaveType(s, cl.id, ctx()), /Switch it off/)
    const edited = saveLeaveType(s, { ...cl, daysPerYear: 14 }, cl.id, ctx())
    expect(edited.type.daysPerYear).toBe(14)
    fails(() => saveLeaveType(s, { ...cl, name: 'sick leave' }, cl.id, ctx()), /already a leave type/)
  })
})

describe('payroll', () => {
  const setup = () => {
    const base = hrState()
    const s = presentAllMonth(base.s, '2026-10', [base.ravi.id, base.meera.id])
    return { ...base, s }
  }

  test('a month is run once for everyone, then final', () => {
    const { s, ravi, meera } = setup()
    const rows = payrollPreview(s, '2026-10', AFTER)
    expect(rows).toHaveLength(2)
    const r = runPayroll(s, '2026-10', undefined, late())
    expect(r.payslips.map((p) => p.no)).toEqual(['PS-2026-10-0001', 'PS-2026-10-0002'])
    const ravi1 = r.payslips.find((p) => p.employeeId === ravi.id)!
    const meera1 = r.payslips.find((p) => p.employeeId === meera.id)!
    expect(ravi1).toMatchObject({ gross: 25000, net: 23000, employerPf: 1800, lopDays: 0, rev: 1 })
    expect(meera1).toMatchObject({ gross: 16200, net: 16200, presentDays: 27 })
    const t = run(s, r)
    fails(() => runPayroll(t, '2026-10', undefined, late()), /already been run/)
    fails(() => runPayroll(t, '2026-12', undefined, late()), /not started/)
    // attendance for a run month is locked
    fails(() => markAttendance(t, { employeeId: ravi.id, date: '2026-10-05', status: 'absent', reason: '' }, late()), /already been run/)
    fails(() => saveAdjustment(t, { employeeId: ravi.id, month: '2026-10', kind: 'bonus', label: 'x', amount: 10, note: '' }, undefined, late()), /already been run/)
  })

  test('absent days cost pay; a person with no pay terms is skipped, not run', () => {
    let { s, ravi } = hrState()
    s = presentAllMonth(s, '2026-10', [ravi.id], ['2026-10-05', '2026-10-06', '2026-10-07'])
    const noPay = run(s, saveEmployee(s, empDraft({ name: 'New Joiner', phone: '', joinDate: '2026-10-01' }), undefined, ctx({ now: 5 })))
    const r = runPayroll(noPay, '2026-10', undefined, late())
    expect(r.payslips).toHaveLength(2) // Meera has pay terms but no attendance: she is run, with nothing to pay
    expect(r.skipped).toEqual([{ name: 'New Joiner', why: 'No pay terms set yet.' }])
    expect(r.payslips.find((p) => p.employeeName === 'Ravi Kumar')).toMatchObject({ lopDays: 3, presentDays: 24 })
  })

  test('void, run again as revision 2, then pay', () => {
    let { s, ravi } = setup()
    let r = runPayroll(s, '2026-10', [ravi.id], late())
    s = run(s, r)
    const first = r.payslips[0]
    fails(() => voidPayslip(s, first.id, '', late()), /why/)
    s = run(s, voidPayslip(s, first.id, 'Wrong attendance', late()))
    expect(livePayslips(s).map((p) => p.employeeId)).toEqual([])
    fails(() => voidPayslip(s, first.id, 'again', late()), /already been voided/)
    r = runPayroll(s, '2026-10', [ravi.id], late())
    expect(r.payslips[0]).toMatchObject({ rev: 2, no: 'PS-2026-10-0002' })
    expect(r.payslips[0].id).toBe(`ps_2026-10_${ravi.id}_2`)
    s = run(s, r)
    const p = paySalary(s, r.payslips[0].id, { mode: 'bank', ref: 'NEFT-1' }, late())
    expect(p.payout).toMatchObject({ amount: 23000, mode: 'bank' })
    s = run(s, p)
    expect(paidOf(s, r.payslips[0].id)).toBe(23000)
    fails(() => paySalary(s, r.payslips[0].id, { mode: 'bank' }, late()), /already marked paid/)
    fails(() => voidPayslip(s, r.payslips[0].id, 'oops', late()), /has been paid/)
  })

  test('pay everyone in one go', () => {
    let { s } = setup()
    s = run(s, runPayroll(s, '2026-10', undefined, late()))
    const all = paySalaries(s, '2026-10', { mode: 'bank', ref: 'BATCH-1' }, late())
    expect(all.payouts.map((p) => p.amount).sort((a, b) => a - b)).toEqual([16200, 23000])
    s = run(s, all)
    fails(() => paySalaries(s, '2026-10', { mode: 'bank' }, late()), /already paid/)
  })

  test('advances and loans are recovered from salary and tracked to zero', () => {
    let { s, ravi } = setup()
    fails(() => issueAdvance(s, { employeeId: ravi.id, kind: 'loan', amount: 0, mode: 'cash', installments: 2, startMonth: '2026-10' }, ctx()), /amount/)
    const a = issueAdvance(s, { employeeId: ravi.id, kind: 'loan', amount: 6000, mode: 'cash', installments: 3, startMonth: '2026-10' }, ctx())
    expect(a.advance.no).toBe('ADV-0001')
    s = run(s, a)
    const r = runPayroll(s, '2026-10', [ravi.id], late())
    expect(r.payslips[0].recoveries).toEqual([{ advanceId: a.advance.id, amount: 2000 }])
    expect(r.payslips[0].net).toBe(21000)
    s = run(s, r)
    expect(advanceStandings(s)[0]).toMatchObject({ recovered: 2000, balance: 4000 })
    // hand back 1,000 in cash, then write off the rest
    s = run(s, repayAdvance(s, a.advance.id, { amount: 1000, mode: 'cash' }, late()))
    fails(() => repayAdvance(s, a.advance.id, { amount: 9000, mode: 'cash' }, late()), /still to come back/)
    expect(advanceStandings(s)[0].balance).toBe(3000)
    s = run(s, writeOffAdvance(s, a.advance.id, 'Left the job', late()))
    expect(advanceStandings(s)[0].balance).toBe(0)
    fails(() => writeOffAdvance(s, a.advance.id, '', late()), /Nothing is left/)
    // voiding the payslip gives the instalment back
    s = run(s, voidPayslip(s, r.payslips[0].id, 'redo', late()))
    expect(advanceStandings(s)[0].recovered).toBe(0)
  })

  test('adjustments are used once and cannot be edited after', () => {
    let { s, ravi } = setup()
    const a = saveAdjustment(s, { employeeId: ravi.id, month: '2026-10', kind: 'bonus', label: 'Diwali bonus', amount: 2000, note: '' }, undefined, late())
    s = run(s, a)
    const fine = saveAdjustment(s, { employeeId: ravi.id, month: '2026-10', kind: 'deduction', label: 'Cash short', amount: 500, note: '' }, undefined, late())
    s = run(s, fine)
    const r = runPayroll(s, '2026-10', [ravi.id], late())
    expect(r.payslips[0].gross).toBe(27000)
    expect(r.payslips[0].net).toBe(24500)
    s = run(s, r)
    fails(() => deleteAdjustment(s, a.adjustment.id, late()), /already includes/)
    fails(() => saveAdjustment(s, { employeeId: ravi.id, month: '2026-10', kind: 'bonus', label: 'x', amount: 1, note: '' }, a.adjustment.id, late()), /already been run/)
  })

  test('settings change the numbers', () => {
    let { s, ravi } = setup()
    s = run(s, saveHrSettings(s, { pfCap: false }, ctx()))
    const r = runPayroll(s, '2026-10', [ravi.id], late())
    expect(r.payslips[0].deductions.find((d) => d.key === 'pf')!.amount).toBe(2400)
    fails(() => saveHrSettings(s, { pfEmployeePct: 150 }, ctx()), /percentage/)
  })
})

describe('targets and incentives', () => {
  test('sales by the signed-in user become a target score and an incentive adjustment', () => {
    let { s, ravi } = hrState()
    const sale = (day: string, qty: number) => {
      const b = billInput(s, [line(s.variants.v1, qty)])
      const items = b.items.map((i) => ({ ...i, soldBy: 'u_cash' }))
      s = run(s, saveBill(s, { ...b, items, date: at(day), cashierId: 'u_owner' }, ctxAt(day)))
      return items.reduce((t, i) => t + i.taxable, 0)
    }
    const sold = Math.round((sale('2026-10-10', 3) + sale('2026-10-11', 2)) * 100) / 100
    s = run(s, saveTarget(s, { employeeId: ravi.id, month: '2026-10', amount: 4000 }, ctx()))
    s = run(s, saveIncentivePlan(s, { name: 'Standard', baseRatePct: 1, slabs: [{ minAchievementPct: 100, ratePct: 2 }], bonusAtTarget: 500, minSales: 0, cap: 0, active: true }, undefined, ctx()))
    const card = scorecards(s, '2026-10', AFTER).find((c) => c.employee.id === ravi.id)!
    expect(card.sales).toBe(sold)
    expect(card.target).toBe(4000)
    expect(card.achievementPct).toBeCloseTo((sold / 4000) * 100, 1)
    const expected = card.achievementPct! >= 100 ? sold * 0.02 + 500 : sold * 0.01
    expect(card.incentive.amount).toBeCloseTo(expected, 1)
    const posted = postIncentives(s, '2026-10', late())
    expect(posted.posted).toBe(1)
    s = run(s, posted)
    expect(scorecards(s, '2026-10', AFTER).find((c) => c.employee.id === ravi.id)!.posted).toBe(true)
    fails(() => postIncentives(s, '2026-10', late()), /no new incentives/)
    // payroll for the month picks it up
    const adj = listOf(s.payAdjustments)[0]
    expect(adj).toMatchObject({ kind: 'incentive', source: 'target:2026-10' })
    expect(payrollPreview(s, '2026-10', AFTER).find((r) => r.employee.id === ravi.id)!.result!.adjustmentIds).toEqual([adj.id])
  })
  test('plan rules: cap, minimum, personal plan beats the general one', () => {
    const s0 = hrState().s
    expect(() => saveIncentivePlan(s0, { name: 'x', baseRatePct: 120, slabs: [], bonusAtTarget: 0, minSales: 0, cap: 0, active: true }, undefined, ctx())).toThrow(/percentage/)
  })
})

describe('expense claims', () => {
  test('submit, approve a smaller amount, reimburse once', () => {
    let { s, ravi } = hrState()
    const c = submitClaim(s, { employeeId: ravi.id, date: '2026-10-15', category: 'Travel', amount: 800, description: 'Auto to supplier', ref: 'R-12' }, ctx())
    expect(c.claim.no).toBe('EC-0001')
    fails(() => submitClaim(s, { employeeId: ravi.id, date: '2027-01-01', category: 'Travel', amount: 5, description: 'x' }, ctx()), /not in the future/)
    s = run(s, c)
    expect(claimRows(s)[0].status).toBe('pending')
    fails(() => reimburseClaim(s, c.claim.id, { mode: 'cash' }, ctx()), /approved claim/)
    fails(() => decideClaim(s, c.claim.id, 'approved', 900, '', ctx()), /Approve an amount/)
    fails(() => decideClaim(s, c.claim.id, 'rejected', undefined, '', ctx()), /why/)
    s = run(s, decideClaim(s, c.claim.id, 'approved', 650, 'Auto fare is 650', ctx()))
    expect(claimRows(s)[0]).toMatchObject({ status: 'approved', approved: 650 })
    fails(() => decideClaim(s, c.claim.id, 'rejected', undefined, 'no', ctx()), /already been answered/)
    const p = reimburseClaim(s, c.claim.id, { mode: 'cash' }, ctx())
    expect(p.payout).toMatchObject({ amount: 650, category: 'Travel' })
    s = run(s, p)
    expect(claimRows(s)[0].status).toBe('paid')
    fails(() => reimburseClaim(s, c.claim.id, { mode: 'cash' }, ctx()), /already been reimbursed/)
    fails(() => cancelClaim(s, c.claim.id, ctx()), /cannot be cancelled/)
  })
  test('a claim can be withdrawn before it is paid', () => {
    let { s, ravi } = hrState()
    const c = submitClaim(s, { employeeId: ravi.id, date: '2026-10-15', category: 'Food', amount: 200, description: 'Lunch' }, ctx())
    s = run(s, c)
    s = run(s, cancelClaim(s, c.claim.id, ctx()))
    expect(claimRows(s)[0].status).toBe('cancelled')
  })
})

describe('recruitment', () => {
  test('an opening, candidates through the stages, then hired with a checklist', () => {
    let { s } = hrState()
    const o = saveOpening(s, { title: 'Sales associate', department: 'Shop', positions: 1, location: '', payRange: '', description: '' }, undefined, ctx())
    s = run(s, o)
    const c = saveCandidate(s, { openingId: o.opening.id, name: 'Anil', phone: '9999999999', email: '', source: 'Walk-in', expectedPay: 18000, notes: '' }, undefined, ctx())
    s = run(s, c)
    const c2 = saveCandidate(s, { openingId: o.opening.id, name: 'Bina', phone: '', email: '', source: '', expectedPay: 0, notes: '' }, undefined, ctx({ now: 2 }))
    s = run(s, c2)
    s = run(s, addInterview(s, c.candidate.id, { at: at('2026-10-20', '11:00'), with: 'Asha', mode: 'in person', note: 'Good', rating: 4 }, ctx()))
    expect(s.hrCandidates[c.candidate.id].stage).toBe('interview')
    fails(() => moveCandidate(s, c.candidate.id, 'hired', ctx()), /Hire/)
    s = run(s, moveCandidate(s, c.candidate.id, 'offer', ctx(), 17000))
    expect(s.hrCandidates[c.candidate.id].offeredPay).toBe(17000)
    s = run(s, moveCandidate(s, c2.candidate.id, 'rejected', ctx()))
    const h = hireCandidate(s, c.candidate.id, { joinDate: '2026-11-01', weeklyOff: [0] }, ctx())
    s = run(s, h)
    expect(h.employee).toMatchObject({ name: 'Anil', designation: 'Sales associate', code: 'EMP-0003' })
    expect(h.employee.onboarding!.length).toBeGreaterThan(5)
    expect(s.hrOpenings[o.opening.id]).toMatchObject({ status: 'closed' })
    fails(() => hireCandidate(s, c.candidate.id, { joinDate: '2026-11-01', weeklyOff: [0] }, ctx()), /hired already/)
    s = run(s, toggleOnboarding(s, h.employee.id, 0, ctx()))
    expect(s.employees[h.employee.id].onboarding![0].done).toBe(true)
    s = run(s, setOpeningStatus(s, o.opening.id, 'open', ctx()))
    expect(s.hrOpenings[o.opening.id].closedOn).toBeUndefined()
  })
})
