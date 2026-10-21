import { audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { id } from '@/domain/ids'
import { nextNo } from '../numbering'
import { momentOn } from './logic/attendance'
import { cancelId, decisionId, decisionsByRef, statusOf } from './logic/decisions'
import { balancesFor, leaveBalance, leaveDays, leaveFactsFor, overlappingLeave, STARTER_LEAVE_TYPES } from './logic/leave'
import { ONBOARDING_STEPS, canMoveTo } from './logic/recruitment'
import { buildIndex } from './logic/select'
import { hrSettings, settingsProblem } from './logic/settings'
import { liveSlipFor } from './logic/slips'
import { labelYM, isClock, isYM, isYMD, monthOf, weekdayOf, ymdOf, eachDay, toDays } from './logic/ymd'
import type {
  AttendanceMark, Candidate, CandidateStage, DocKind, Employee, EmployeeDoc, EmployeePay, HrDecision, HrSettings, Interview, LeaveGrant, LeaveRequest, LeaveType,
  MarkStatus, Opening, OpeningStatus, PayAllowance, PayType, Punch, Regularisation, RosterEntry, WorkShift, YMD, YM, Holiday, HrTarget,
} from './types'
import './replication'

const branch = (ctx: OpCtx, e?: { branchId?: string }) => { const b = e?.branchId ?? ctx.branchId; return b ? { branchId: b } : {} }
const r2 = (n: number) => Math.round(n * 100) / 100
const text = (s: string | undefined) => (s ?? '').trim()

export function employeeOrThrow(state: DataState, employeeId: string): Employee {
  const e = state.employees?.[employeeId]
  if (!e) throw new OpError('That person is not in the employee list.')
  return e
}

/** Payroll for a month that has been run is final: attendance and leave for it cannot change until the payslip is voided. */
export function assertOpen(state: DataState, employeeId: string, date: YMD) {
  const slip = liveSlipFor(state, employeeId, monthOf(date))
  if (slip) throw new OpError(`Salary for ${labelYM(slip.month)} has already been run (${slip.no}). Void that payslip first to change this month.`)
}

// ───────────────────────────── employees ─────────────────────────────

export interface EmployeeDraft {
  name: string; phone: string; email: string; userId?: string; designation: string; department: string; joinDate: YMD; dob?: YMD; gender?: Employee['gender']
  address: string; emergency: Employee['emergency']; shiftId?: string; weeklyOff: number[]; notes: string
}

export function saveEmployee(state: DataState, d: EmployeeDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; employee: Employee } {
  const name = text(d.name)
  if (!name) throw new OpError('Enter the employee’s name.')
  if (!isYMD(d.joinDate)) throw new OpError('Enter the joining date as YYYY-MM-DD.')
  if (d.dob && !isYMD(d.dob)) throw new OpError('Enter the date of birth as YYYY-MM-DD.')
  if (text(d.phone) && text(d.phone).replace(/\D/g, '').length < 7) throw new OpError('That phone number looks too short.')
  if (d.weeklyOff.some((x) => !Number.isInteger(x) || x < 0 || x > 6)) throw new OpError('Weekly off days are Sunday to Saturday.')
  if (d.shiftId && !state.workShifts?.[d.shiftId]) throw new OpError('That shift no longer exists.')
  if (d.userId) {
    if (!state.users[d.userId]) throw new OpError('That sign-in account no longer exists.')
    const other = listOf(state.employees ?? {}).find((e) => e.userId === d.userId && e.id !== existingId)
    if (other) throw new OpError(`${other.name} already uses that sign-in account.`)
  }
  const base = {
    name, phone: text(d.phone), email: text(d.email), userId: d.userId || undefined, designation: text(d.designation), department: text(d.department), joinDate: d.joinDate,
    dob: d.dob || undefined, gender: d.gender, address: text(d.address), emergency: { name: text(d.emergency.name), phone: text(d.emergency.phone), relation: text(d.emergency.relation) },
    shiftId: d.shiftId || undefined, weeklyOff: [...new Set(d.weeklyOff)].sort(), notes: text(d.notes),
  }
  if (existingId) {
    const cur = employeeOrThrow(state, existingId)
    if (cur.exitDate && d.joinDate > cur.exitDate) throw new OpError('The joining date is after the leaving date.')
    const e: Employee = { ...cur, ...base }
    return { employee: e, changes: { put: { employees: [e], audit: [audit(ctx, 'EMPLOYEE_EDIT', `${cur.code} ${name}`)] } } }
  }
  const e: Employee = {
    id: id('emp', ctx.now), code: nextNo('EMP-', listOf(state.employees ?? {}).map((x) => x.code), ctx), active: true, createdAt: ctx.now, ...branch(ctx), ...base,
  }
  return { employee: e, changes: { put: { employees: [e], audit: [audit(ctx, 'EMPLOYEE_ADD', `${e.code} ${name}`)] } } }
}

export interface PayDraft {
  payType: PayType; basic: number; allowances: PayAllowance[]; pf: boolean; esi: boolean; pt: boolean; tds: boolean; tdsMonthly?: number; overtimeEligible: boolean
  bank: EmployeePay['bank']; pan: string; uan: string; esiNo: string; notes: string
}

/** Sets how a person is paid (one document per employee). */
export function savePay(state: DataState, employeeId: string, d: PayDraft, ctx: OpCtx): { changes: Changes; pay: EmployeePay } {
  const emp = employeeOrThrow(state, employeeId)
  if (!['monthly', 'daily', 'hourly'].includes(d.payType)) throw new OpError('Choose monthly, daily or hourly pay.')
  if (!(d.basic > 0)) throw new OpError(d.payType === 'monthly' ? 'Enter the monthly basic pay.' : d.payType === 'daily' ? 'Enter the day rate.' : 'Enter the hourly rate.')
  const allowances = d.allowances.map((a) => ({ name: text(a.name), amount: r2(a.amount) })).filter((a) => a.name || a.amount)
  if (allowances.some((a) => !a.name || !(a.amount >= 0))) throw new OpError('Every allowance needs a name and an amount.')
  const ifsc = text(d.bank.ifsc).toUpperCase()
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new OpError('An IFSC code is 11 characters, like HDFC0001234.')
  const pan = text(d.pan).toUpperCase()
  if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) throw new OpError('A PAN looks like ABCDE1234F.')
  const account = text(d.bank.account).replace(/\s/g, '')
  if (account && !/^\d{6,20}$/.test(account)) throw new OpError('An account number is 6 to 20 digits.')
  if (d.tdsMonthly !== undefined && !(d.tdsMonthly >= 0)) throw new OpError('TDS cannot be negative.')
  const pay: EmployeePay = {
    id: employeeId, employeeId, payType: d.payType, basic: r2(d.basic), allowances, pf: d.pf, esi: d.esi, pt: d.pt, tds: d.tds, tdsMonthly: d.tds ? d.tdsMonthly : undefined,
    overtimeEligible: d.overtimeEligible && d.payType !== 'hourly', bank: { holder: text(d.bank.holder), bankName: text(d.bank.bankName), account, ifsc, upi: text(d.bank.upi) },
    pan, uan: text(d.uan), esiNo: text(d.esiNo), notes: text(d.notes), ...branch(ctx, emp),
  }
  return { pay, changes: { put: { employeePay: [pay], audit: [audit(ctx, 'PAY_TERMS', `${emp.code} ${emp.name}`)] } } }
}

/** A person leaves: they drop off the payroll after the leaving date. */
export function exitEmployee(state: DataState, employeeId: string, exitDate: YMD, ctx: OpCtx): { changes: Changes; employee: Employee } {
  const cur = employeeOrThrow(state, employeeId)
  if (!isYMD(exitDate)) throw new OpError('Enter the last working day as YYYY-MM-DD.')
  if (exitDate < cur.joinDate) throw new OpError('The last day is before the joining date.')
  const e: Employee = { ...cur, active: false, exitDate }
  return { employee: e, changes: { put: { employees: [e], audit: [audit(ctx, 'EMPLOYEE_EXIT', `${cur.code} ${cur.name} · ${exitDate}`)] } } }
}

export function reactivateEmployee(state: DataState, employeeId: string, ctx: OpCtx): { changes: Changes; employee: Employee } {
  const cur = employeeOrThrow(state, employeeId)
  const e: Employee = { ...cur, active: true, exitDate: undefined }
  return { employee: e, changes: { put: { employees: [e], audit: [audit(ctx, 'EMPLOYEE_REJOIN', `${cur.code} ${cur.name}`)] } } }
}

export interface DocDraft { employeeId: string; kind: DocKind; title: string; number: string; issuedOn?: YMD; expiresOn?: YMD; note: string }

export function saveEmployeeDoc(state: DataState, d: DocDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; doc: EmployeeDoc } {
  const emp = employeeOrThrow(state, d.employeeId)
  if (!text(d.title) && !text(d.number)) throw new OpError('Give the document a title or a number.')
  for (const x of [d.issuedOn, d.expiresOn]) if (x && !isYMD(x)) throw new OpError('Enter dates as YYYY-MM-DD.')
  if (d.issuedOn && d.expiresOn && d.expiresOn < d.issuedOn) throw new OpError('The document expires before it was issued.')
  const prev = existingId ? state.employeeDocs?.[existingId] : undefined
  if (existingId && !prev) throw new OpError('That document no longer exists.')
  const doc: EmployeeDoc = {
    id: existingId ?? id('edoc', ctx.now), employeeId: d.employeeId, kind: d.kind, title: text(d.title), number: text(d.number), issuedOn: d.issuedOn || undefined, expiresOn: d.expiresOn || undefined,
    note: text(d.note), createdAt: prev?.createdAt ?? ctx.now, ...branch(ctx, emp),
  }
  return { doc, changes: { put: { employeeDocs: [doc], audit: [audit(ctx, 'EMPLOYEE_DOC', `${emp.code} · ${doc.title || doc.kind}`)] } } }
}

export function deleteEmployeeDoc(state: DataState, docId: string, ctx: OpCtx): { changes: Changes } {
  const d = state.employeeDocs?.[docId]
  if (!d) throw new OpError('That document no longer exists.')
  return { changes: { del: { employeeDocs: [docId] }, put: { audit: [audit(ctx, 'EMPLOYEE_DOC_DELETE', `${d.title || d.kind}`)] } } }
}

/** Ticks (or unticks) a step of the first-week checklist. */
export function toggleOnboarding(state: DataState, employeeId: string, index: number, ctx: OpCtx): { changes: Changes; employee: Employee } {
  const cur = employeeOrThrow(state, employeeId)
  const list = cur.onboarding ?? []
  if (!list[index]) throw new OpError('That step no longer exists.')
  const e: Employee = { ...cur, onboarding: list.map((x, i) => (i === index ? { ...x, done: !x.done } : x)) }
  return { employee: e, changes: { put: { employees: [e], audit: [audit(ctx, 'ONBOARDING', `${cur.code} · ${list[index].label}`)] } } }
}

// ───────────────────────────── attendance ─────────────────────────────

const markId = (employeeId: string, date: YMD) => `${employeeId}_${date}`

/**
 * Punches a person in, or out if they are in. A punch after midnight that closes a shift started the evening before belongs to
 * that earlier day. `geo` is a note about where (no location permission is needed); the shop can require it.
 */
export function punch(state: DataState, employeeId: string, input: { geo?: string; note?: string }, ctx: OpCtx): { changes: Changes; punch: Punch } {
  const emp = employeeOrThrow(state, employeeId)
  if (!emp.active) throw new OpError(`${emp.name} is no longer on the staff list.`)
  const settings = hrSettings(state)
  const geo = text(input.geo)
  if (settings.requireGeoNote && !geo) throw new OpError('Say where you are punching from.')
  const mine = listOf(state.punches ?? {}).filter((p) => p.employeeId === employeeId).sort((a, b) => b.at - a.at)
  const last = mine[0]
  if (last && ctx.now - last.at < 60_000) throw new OpError('You just punched. Wait a minute.')
  const closing = !!last && last.kind === 'in' && ctx.now - last.at < 20 * 3_600_000
  const kind: Punch['kind'] = closing ? 'out' : 'in'
  const date = closing ? last.date : ymdOf(ctx.now)
  if (date < emp.joinDate) throw new OpError('The joining date of this person is later than today.')
  if (emp.exitDate && date > emp.exitDate) throw new OpError('This person has left.')
  assertOpen(state, employeeId, date)
  const p: Punch = {
    id: id('pn', ctx.now), employeeId, at: ctx.now, date, kind, geo, note: text(input.note), source: emp.userId && emp.userId === ctx.userId ? 'self' : 'manager', userId: ctx.userId, ...branch(ctx, emp),
  }
  return { punch: p, changes: { put: { punches: [p] } } }
}

export interface MarkDraft { employeeId: string; date: YMD; status: MarkStatus; inTime?: string; outTime?: string; reason: string }

function buildMark(state: DataState, d: MarkDraft, ctx: OpCtx): AttendanceMark {
  const emp = employeeOrThrow(state, d.employeeId)
  if (!isYMD(d.date)) throw new OpError('Enter the day as YYYY-MM-DD.')
  if (d.date < emp.joinDate) throw new OpError(`${emp.name} joined on ${emp.joinDate}.`)
  if (emp.exitDate && d.date > emp.exitDate) throw new OpError(`${emp.name} left on ${emp.exitDate}.`)
  if (d.date > ymdOf(ctx.now)) throw new OpError('You cannot mark a day that has not happened yet.')
  assertOpen(state, d.employeeId, d.date)
  const inAt = d.inTime?.trim() ? momentOn(d.date, d.inTime) : undefined
  const outAt = d.outTime?.trim() ? momentOn(d.date, d.outTime) : undefined
  if (d.inTime?.trim() && inAt === undefined) throw new OpError('Enter the in time as HH:MM, like 09:30.')
  if (d.outTime?.trim() && outAt === undefined) throw new OpError('Enter the out time as HH:MM, like 18:00.')
  if (inAt !== undefined && outAt !== undefined && outAt <= inAt) throw new OpError('The out time must be after the in time.')
  return {
    id: markId(d.employeeId, d.date), employeeId: d.employeeId, date: d.date, status: d.status, inAt, outAt, reason: text(d.reason), markedBy: ctx.userId, markedAt: ctx.now, ...branch(ctx, emp),
  }
}

/** A manager's mark for a day (it overrides the punches). */
export function markAttendance(state: DataState, d: MarkDraft, ctx: OpCtx): { changes: Changes; mark: AttendanceMark } {
  const mark = buildMark(state, d, ctx)
  const emp = employeeOrThrow(state, d.employeeId)
  return { mark, changes: { put: { attendance: [mark], audit: [audit(ctx, 'ATTENDANCE_MARK', `${emp.code} ${d.date} ${d.status}${mark.reason ? ` · ${mark.reason}` : ''}`)] } } }
}

/** The same status for several people on one day (everyone present today). */
export function bulkMark(state: DataState, date: YMD, employeeIds: string[], status: MarkStatus, ctx: OpCtx): { changes: Changes; marked: number } {
  const marks: AttendanceMark[] = []
  for (const employeeId of employeeIds) {
    try { marks.push(buildMark(state, { employeeId, date, status, reason: 'Marked together' }, ctx)) } catch (e) { if (!(e instanceof OpError)) throw e }
  }
  if (!marks.length) throw new OpError('Nobody could be marked for that day.')
  return { marked: marks.length, changes: { put: { attendance: marks, audit: [audit(ctx, 'ATTENDANCE_BULK', `${date} · ${marks.length} ${status}`)] } } }
}

export function clearMark(state: DataState, employeeId: string, date: YMD, ctx: OpCtx): { changes: Changes } {
  if (!state.attendance?.[markId(employeeId, date)]) throw new OpError('There is no mark to remove for that day.')
  assertOpen(state, employeeId, date)
  return { changes: { del: { attendance: [markId(employeeId, date)] }, put: { audit: [audit(ctx, 'ATTENDANCE_CLEAR', `${employeeId} ${date}`)] } } }
}

export function requestRegularisation(state: DataState, d: { employeeId: string; date: YMD; inTime?: string; outTime?: string; reason: string }, ctx: OpCtx): { changes: Changes; request: Regularisation } {
  const emp = employeeOrThrow(state, d.employeeId)
  if (!isYMD(d.date) || d.date > ymdOf(ctx.now)) throw new OpError('Pick a day that has already happened.')
  if (d.date < emp.joinDate) throw new OpError(`${emp.name} joined on ${emp.joinDate}.`)
  if (!text(d.reason)) throw new OpError('Say what happened (forgot to punch, phone dead…).')
  const inAt = d.inTime?.trim() ? momentOn(d.date, d.inTime) : undefined
  const outAt = d.outTime?.trim() ? momentOn(d.date, d.outTime) : undefined
  if (inAt === undefined && outAt === undefined) throw new OpError('Enter the time you came in or went out, like 09:30.')
  if (inAt !== undefined && outAt !== undefined && outAt <= inAt) throw new OpError('The out time must be after the in time.')
  assertOpen(state, d.employeeId, d.date)
  const decisions = decisionsByRef(state)
  const waiting = listOf(state.regularisations ?? {}).find((r) => r.employeeId === d.employeeId && r.date === d.date && statusOf(decisions.get(r.id)) === 'pending')
  if (waiting) throw new OpError('A request for that day is already waiting.')
  const request: Regularisation = { id: id('reg', ctx.now), employeeId: d.employeeId, date: d.date, inAt, outAt, reason: text(d.reason), requestedAt: ctx.now, requestedBy: ctx.userId, ...branch(ctx, emp) }
  return { request, changes: { put: { regularisations: [request], audit: [audit(ctx, 'REGULARISE_ASK', `${emp.code} ${d.date}`)] } } }
}

function decision(kind: HrDecision['kind'], refId: string, outcome: HrDecision['decision'], note: string, ctx: OpCtx, extra: Partial<HrDecision> = {}, bid?: string): HrDecision {
  return { id: outcome === 'cancelled' ? cancelId(refId) : decisionId(refId), kind, refId, decision: outcome, note: text(note), decidedBy: ctx.userId, at: ctx.now, ...(bid ? { branchId: bid } : {}), ...extra }
}

/** Approving a request writes the mark (present, with the times given). */
export function decideRegularisation(state: DataState, requestId: string, outcome: 'approved' | 'rejected', note: string, ctx: OpCtx): { changes: Changes; decision: HrDecision } {
  const r = state.regularisations?.[requestId]
  if (!r) throw new OpError('That request no longer exists.')
  if (statusOf(decisionsByRef(state).get(requestId)) !== 'pending') throw new OpError('That request has already been answered.')
  const emp = employeeOrThrow(state, r.employeeId)
  const dec = decision('regularisation', requestId, outcome, note, ctx, {}, r.branchId)
  const put: Changes['put'] = { hrDecisions: [dec], audit: [audit(ctx, outcome === 'approved' ? 'REGULARISE_OK' : 'REGULARISE_NO', `${emp.code} ${r.date}`)] }
  if (outcome === 'approved') put.attendance = [buildMark(state, { employeeId: r.employeeId, date: r.date, status: 'present', inTime: r.inAt !== undefined ? clock(r.inAt) : undefined, outTime: r.outAt !== undefined ? clock(r.outAt) : undefined, reason: `Regularised: ${r.reason}` }, ctx)]
  return { decision: dec, changes: { put } }
}
const clock = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

// ───────────────────────────── shifts, roster, holidays ─────────────────────────────

export interface ShiftDraft { name: string; start: string; end: string; breakMins: number; graceMins: number; active: boolean }

export function saveShift(state: DataState, d: ShiftDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; shift: WorkShift } {
  const name = text(d.name)
  if (!name) throw new OpError('Name the shift (Morning, Evening…).')
  if (!isClock(d.start) || !isClock(d.end)) throw new OpError('Enter start and end times as HH:MM, like 09:30.')
  if (d.start === d.end) throw new OpError('A shift cannot start and end at the same time.')
  if (!(d.breakMins >= 0 && d.breakMins <= 240) || !(d.graceMins >= 0 && d.graceMins <= 120)) throw new OpError('Break and grace are minutes (break up to 4 hours, grace up to 2).')
  if (listOf(state.workShifts ?? {}).some((s) => s.id !== existingId && s.name.toLowerCase() === name.toLowerCase())) throw new OpError('There is already a shift with that name.')
  if (existingId && !state.workShifts?.[existingId]) throw new OpError('That shift no longer exists.')
  const shift: WorkShift = { id: existingId ?? id('shf', ctx.now), name, start: d.start, end: d.end, breakMins: Math.round(d.breakMins), graceMins: Math.round(d.graceMins), active: d.active }
  return { shift, changes: { put: { workShifts: [shift], audit: [audit(ctx, 'SHIFT_SAVE', `${name} ${d.start}–${d.end}`)] } } }
}

export function deleteShift(state: DataState, shiftId: string, ctx: OpCtx): { changes: Changes } {
  const s = state.workShifts?.[shiftId]
  if (!s) throw new OpError('That shift no longer exists.')
  if (listOf(state.employees ?? {}).some((e) => e.shiftId === shiftId) || listOf(state.rosters ?? {}).some((r) => r.shiftId === shiftId)) throw new OpError('People are still on this shift. Move them first, or switch the shift off instead.')
  return { changes: { del: { workShifts: [shiftId] }, put: { audit: [audit(ctx, 'SHIFT_DELETE', s.name)] } } }
}

/** Puts people on a shift (or a day off, or back to their usual shift) for a run of days. */
export function assignRoster(state: DataState, d: { employeeIds: string[]; from: YMD; to: YMD; shiftId: string | 'off' | 'usual'; skipWeeklyOff?: boolean }, ctx: OpCtx): { changes: Changes; entries: number } {
  if (!isYMD(d.from) || !isYMD(d.to) || d.to < d.from) throw new OpError('Pick the first and last day.')
  if (toDays(d.to) - toDays(d.from) > 62) throw new OpError('Roster at most two months at a time.')
  if (!d.employeeIds.length) throw new OpError('Choose at least one person.')
  if (d.shiftId !== 'off' && d.shiftId !== 'usual' && !state.workShifts?.[d.shiftId]) throw new OpError('That shift no longer exists.')
  const put: RosterEntry[] = []
  const del: string[] = []
  for (const employeeId of d.employeeIds) {
    const emp = employeeOrThrow(state, employeeId)
    for (const date of eachDay(d.from, d.to)) {
      if (d.skipWeeklyOff && emp.weeklyOff.includes(weekdayOf(date)) && d.shiftId !== 'off' && d.shiftId !== 'usual') continue
      const rid = markId(employeeId, date)
      if (d.shiftId === 'usual') { if (state.rosters?.[rid]) del.push(rid) } else put.push({ id: rid, employeeId, date, shiftId: d.shiftId === 'off' ? null : d.shiftId, ...branch(ctx, emp) })
    }
  }
  return { entries: put.length + del.length, changes: { put: { rosters: put, audit: [audit(ctx, 'ROSTER', `${d.from}..${d.to} · ${d.employeeIds.length} people`)] }, ...(del.length ? { del: { rosters: del } } : {}) } }
}

export function saveHoliday(state: DataState, d: { date: YMD; name: string }, ctx: OpCtx): { changes: Changes; holiday: Holiday } {
  if (!isYMD(d.date)) throw new OpError('Enter the date as YYYY-MM-DD.')
  if (!text(d.name)) throw new OpError('Name the holiday (Diwali, Eid…).')
  const holiday: Holiday = { id: `hol_${d.date}`, date: d.date, name: text(d.name) }
  return { holiday, changes: { put: { hrHolidays: [holiday], audit: [audit(ctx, 'HOLIDAY', `${d.date} ${holiday.name}`)] } } }
}

export function deleteHoliday(state: DataState, holidayId: string, ctx: OpCtx): { changes: Changes } {
  const h = state.hrHolidays?.[holidayId]
  if (!h) throw new OpError('That holiday no longer exists.')
  return { changes: { del: { hrHolidays: [holidayId] }, put: { audit: [audit(ctx, 'HOLIDAY_DELETE', `${h.date} ${h.name}`)] } } }
}

// ───────────────────────────── leave ─────────────────────────────

export type LeaveTypeDraft = Omit<LeaveType, 'id'>

export function saveLeaveType(state: DataState, d: LeaveTypeDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; type: LeaveType } {
  const name = text(d.name)
  if (!name) throw new OpError('Name the leave type.')
  if (!(d.daysPerYear >= 0 && d.daysPerYear <= 366)) throw new OpError('Days per year is between 0 and 366.')
  if (!(d.carryForwardMax >= 0)) throw new OpError('Carry forward cannot be negative.')
  if (listOf(state.leaveTypes ?? {}).some((t) => t.id !== existingId && t.name.toLowerCase() === name.toLowerCase())) throw new OpError('There is already a leave type with that name.')
  if (existingId && !state.leaveTypes?.[existingId]) throw new OpError('That leave type no longer exists.')
  const type: LeaveType = { ...d, id: existingId ?? id('lt', ctx.now), name, code: text(d.code).toUpperCase() || name.slice(0, 2).toUpperCase(), daysPerYear: d.paid ? d.daysPerYear : 0 }
  return { type, changes: { put: { leaveTypes: [type], audit: [audit(ctx, 'LEAVE_TYPE', name)] } } }
}

export function deleteLeaveType(state: DataState, typeId: string, ctx: OpCtx): { changes: Changes } {
  const t = state.leaveTypes?.[typeId]
  if (!t) throw new OpError('That leave type no longer exists.')
  if (listOf(state.leaveRequests ?? {}).some((r) => r.typeId === typeId) || listOf(state.leaveGrants ?? {}).some((g) => g.typeId === typeId)) throw new OpError('Leave has been taken under this type. Switch it off instead.')
  return { changes: { del: { leaveTypes: [typeId] }, put: { audit: [audit(ctx, 'LEAVE_TYPE_DELETE', t.name)] } } }
}

/** Casual, sick, earned and unpaid leave, if the business has no leave types yet. */
export function seedLeaveTypes(state: DataState, ctx: OpCtx): { changes: Changes; added: number } {
  if (listOf(state.leaveTypes ?? {}).length) throw new OpError('Leave types are already set up.')
  const types: LeaveType[] = STARTER_LEAVE_TYPES.map((t, i) => ({ ...t, id: id('lt', ctx.now + i) }))
  return { added: types.length, changes: { put: { leaveTypes: types, audit: [audit(ctx, 'LEAVE_TYPE_SEED', `${types.length} types`)] } } }
}

export interface LeaveDraft { employeeId: string; typeId: string; from: YMD; to: YMD; half?: 'first' | 'second'; reason: string }

export function requestLeave(state: DataState, d: LeaveDraft, ctx: OpCtx): { changes: Changes; request: LeaveRequest } {
  const emp = employeeOrThrow(state, d.employeeId)
  const type = state.leaveTypes?.[d.typeId]
  if (!type || !type.active) throw new OpError('Choose a leave type.')
  if (!isYMD(d.from) || !isYMD(d.to)) throw new OpError('Enter the dates as YYYY-MM-DD.')
  if (d.to < d.from) throw new OpError('The last day is before the first.')
  if (d.half && d.from !== d.to) throw new OpError('Half a day is for a single day.')
  if (d.from < emp.joinDate) throw new OpError(`${emp.name} joined on ${emp.joinDate}.`)
  if (toDays(d.to) - toDays(d.from) > 120) throw new OpError('That is a very long leave. Ask for at most four months at a time.')
  const idx = buildIndex(state)
  const days = leaveDays(d.from, d.to, !!d.half, emp.weeklyOff, idx.holidays)
  if (!(days > 0)) throw new OpError('Those days are already weekly offs or holidays — no leave is needed.')
  if (overlappingLeave(state, idx, d.employeeId, d.from, d.to, d.half)) throw new OpError('There is already a leave request for some of those days.')
  const settings = hrSettings(state)
  if (type.paid && !type.allowNegative) {
    const today = ymdOf(ctx.now)
    const bal = leaveBalance(type, emp.joinDate, leaveFactsFor(state, idx, emp.id, type.id), d.from > today ? d.from : today, settings.leaveYearStartMonth)
    if (bal.available < days) throw new OpError(`${emp.name} has ${Math.max(0, bal.available)} day${bal.available === 1 ? '' : 's'} of ${type.name} left; this needs ${days}.`)
  }
  const request: LeaveRequest = {
    id: id('lv', ctx.now), no: nextNo('LV-', listOf(state.leaveRequests ?? {}).map((r) => r.no), ctx), employeeId: d.employeeId, typeId: d.typeId, from: d.from, to: d.to, ...(d.half ? { half: d.half } : {}),
    days, reason: text(d.reason), requestedAt: ctx.now, requestedBy: ctx.userId, ...branch(ctx, emp),
  }
  return { request, changes: { put: { leaveRequests: [request], audit: [audit(ctx, 'LEAVE_ASK', `${request.no} ${emp.code} ${d.from}..${d.to} (${days})`)] } } }
}

/** Approve, reject or cancel a leave request. The first answer stands; an approved leave can still be cancelled. */
export function decideLeave(state: DataState, requestId: string, outcome: 'approved' | 'rejected' | 'cancelled', note: string, ctx: OpCtx): { changes: Changes; decision: HrDecision } {
  const r = state.leaveRequests?.[requestId]
  if (!r) throw new OpError('That leave request no longer exists.')
  const idx = buildIndex(state)
  const st = idx.leaveStatus.get(requestId) ?? 'pending'
  const emp = employeeOrThrow(state, r.employeeId)
  if (outcome === 'cancelled') {
    if (st !== 'pending' && st !== 'approved') throw new OpError(`That request is already ${st}.`)
    if (st === 'approved') assertOpen(state, r.employeeId, r.from)
  } else {
    if (st !== 'pending') throw new OpError(`That request is already ${st}.`)
    if (outcome === 'approved') {
      assertOpen(state, r.employeeId, r.from)
      const type = state.leaveTypes?.[r.typeId]
      if (type && type.paid && !type.allowNegative) {
        const bal = leaveBalance(type, emp.joinDate, leaveFactsFor(state, idx, emp.id, type.id), r.from > ymdOf(ctx.now) ? r.from : ymdOf(ctx.now), hrSettings(state).leaveYearStartMonth)
        if (bal.balance < r.days) throw new OpError(`${emp.name} has only ${bal.balance} day${bal.balance === 1 ? '' : 's'} of ${type.name}. Add leave to the balance first, or reject this.`)
      }
    }
  }
  const dec = decision('leave', requestId, outcome, note, ctx, {}, r.branchId)
  return { decision: dec, changes: { put: { hrDecisions: [dec], audit: [audit(ctx, `LEAVE_${outcome.toUpperCase()}`, `${r.no} ${emp.code}`)] } } }
}

/** Adds (or takes off) days of a leave type by hand: an opening balance, a comp-off. */
export function grantLeave(state: DataState, d: { employeeId: string; typeId: string; days: number; date: YMD; reason: string }, ctx: OpCtx): { changes: Changes; grant: LeaveGrant } {
  const emp = employeeOrThrow(state, d.employeeId)
  const type = state.leaveTypes?.[d.typeId]
  if (!type) throw new OpError('Choose a leave type.')
  if (!type.paid) throw new OpError('Leave without pay has no balance to adjust.')
  if (!Number.isFinite(d.days) || d.days === 0 || Math.abs(d.days) > 366) throw new OpError('Enter the number of days to add (or a negative number to take off).')
  if (!isYMD(d.date)) throw new OpError('Enter the date as YYYY-MM-DD.')
  if (!text(d.reason)) throw new OpError('Say why (opening balance, comp-off…).')
  const grant: LeaveGrant = { id: id('lg', ctx.now), employeeId: d.employeeId, typeId: d.typeId, days: r2(d.days), date: d.date, reason: text(d.reason), userId: ctx.userId, ...branch(ctx, emp) }
  return { grant, changes: { put: { leaveGrants: [grant], audit: [audit(ctx, 'LEAVE_GRANT', `${emp.code} ${type.name} ${grant.days > 0 ? '+' : ''}${grant.days}`)] } } }
}

export { balancesFor }

// ───────────────────────────── targets & settings ─────────────────────────────

export function saveTarget(state: DataState, d: { employeeId: string; month: YM; amount: number }, ctx: OpCtx): { changes: Changes; target: HrTarget } {
  const emp = employeeOrThrow(state, d.employeeId)
  if (!isYM(d.month)) throw new OpError('Pick the month.')
  if (!(d.amount >= 0)) throw new OpError('A target cannot be negative.')
  const target: HrTarget = { id: `${d.employeeId}_${d.month}`, employeeId: d.employeeId, month: d.month, amount: r2(d.amount) }
  return { target, changes: { put: { hrTargets: [target], audit: [audit(ctx, 'TARGET', `${emp.code} ${d.month} ₹${target.amount}`)] } } }
}

/** Statutory rates and company rules (the owner's, or whoever has the payroll permission). */
export function saveHrSettings(state: DataState, patch: Partial<Omit<HrSettings, 'id'>>, ctx: OpCtx): { changes: Changes; settings: HrSettings } {
  const settings: HrSettings = { ...hrSettings(state), ...patch, id: 'hr' }
  const bad = settingsProblem(settings)
  if (bad) throw new OpError(bad)
  return { settings, changes: { put: { hrSettings: [settings], audit: [audit(ctx, 'HR_SETTINGS', Object.keys(patch).join(', ') || 'saved')] } } }
}

// ───────────────────────────── recruitment ─────────────────────────────

export interface OpeningDraft { title: string; department: string; positions: number; location: string; payRange: string; description: string }

export function saveOpening(state: DataState, d: OpeningDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; opening: Opening } {
  if (!text(d.title)) throw new OpError('Give the opening a title (Sales associate…).')
  if (!(Number.isInteger(d.positions) && d.positions >= 1)) throw new OpError('How many people are you hiring? At least one.')
  const prev = existingId ? state.hrOpenings?.[existingId] : undefined
  if (existingId && !prev) throw new OpError('That opening no longer exists.')
  const opening: Opening = {
    id: existingId ?? id('opn', ctx.now), title: text(d.title), department: text(d.department), positions: d.positions, location: text(d.location), payRange: text(d.payRange), description: text(d.description),
    status: prev?.status ?? 'open', openedOn: prev?.openedOn ?? ymdOf(ctx.now), ...(prev?.closedOn ? { closedOn: prev.closedOn } : {}),
  }
  return { opening, changes: { put: { hrOpenings: [opening], audit: [audit(ctx, 'OPENING_SAVE', opening.title)] } } }
}

export function setOpeningStatus(state: DataState, openingId: string, status: OpeningStatus, ctx: OpCtx): { changes: Changes; opening: Opening } {
  const cur = state.hrOpenings?.[openingId]
  if (!cur) throw new OpError('That opening no longer exists.')
  const opening: Opening = { ...cur, status, closedOn: status === 'closed' ? ymdOf(ctx.now) : undefined }
  return { opening, changes: { put: { hrOpenings: [opening], audit: [audit(ctx, 'OPENING_STATUS', `${cur.title} → ${status}`)] } } }
}

export interface CandidateDraft { openingId: string; name: string; phone: string; email: string; source: string; expectedPay: number; notes: string }

export function saveCandidate(state: DataState, d: CandidateDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; candidate: Candidate } {
  if (!state.hrOpenings?.[d.openingId]) throw new OpError('Choose the opening this person applied for.')
  if (!text(d.name)) throw new OpError('Enter the candidate’s name.')
  const prev = existingId ? state.hrCandidates?.[existingId] : undefined
  if (existingId && !prev) throw new OpError('That candidate no longer exists.')
  const candidate: Candidate = {
    stage: 'applied', offeredPay: 0, interviews: [], appliedOn: ymdOf(ctx.now), ...prev, id: existingId ?? id('cnd', ctx.now), openingId: d.openingId, name: text(d.name), phone: text(d.phone), email: text(d.email),
    source: text(d.source), expectedPay: Math.max(0, d.expectedPay || 0), notes: text(d.notes), updatedAt: ctx.now,
  }
  return { candidate, changes: { put: { hrCandidates: [candidate], audit: [audit(ctx, 'CANDIDATE_SAVE', `${candidate.name}`)] } } }
}

export function moveCandidate(state: DataState, candidateId: string, stage: CandidateStage, ctx: OpCtx, offeredPay?: number): { changes: Changes; candidate: Candidate } {
  const cur = state.hrCandidates?.[candidateId]
  if (!cur) throw new OpError('That candidate no longer exists.')
  if (stage === 'hired') throw new OpError('Use “Hire” to make this person an employee.')
  if (!canMoveTo(cur.stage, stage)) throw new OpError(cur.stage === 'hired' ? 'This person has been hired already.' : 'They are already at that stage.')
  const candidate: Candidate = { ...cur, stage, updatedAt: ctx.now, ...(stage === 'offer' && offeredPay && offeredPay > 0 ? { offeredPay } : {}) }
  return { candidate, changes: { put: { hrCandidates: [candidate], audit: [audit(ctx, 'CANDIDATE_STAGE', `${cur.name} → ${stage}`)] } } }
}

export function addInterview(state: DataState, candidateId: string, i: Interview, ctx: OpCtx): { changes: Changes; candidate: Candidate } {
  const cur = state.hrCandidates?.[candidateId]
  if (!cur) throw new OpError('That candidate no longer exists.')
  if (!Number.isFinite(i.at)) throw new OpError('Pick the interview time.')
  if (i.rating !== undefined && !(i.rating >= 1 && i.rating <= 5)) throw new OpError('Rate from 1 to 5.')
  const candidate: Candidate = { ...cur, interviews: [...cur.interviews, { ...i, with: text(i.with), note: text(i.note) }], stage: cur.stage === 'applied' || cur.stage === 'screening' ? 'interview' : cur.stage, updatedAt: ctx.now }
  return { candidate, changes: { put: { hrCandidates: [candidate], audit: [audit(ctx, 'INTERVIEW', `${cur.name}`)] } } }
}

/** Hires a candidate: they become an employee with the first-week checklist, and the opening closes when it is filled. */
export function hireCandidate(state: DataState, candidateId: string, d: { joinDate: YMD; designation?: string; weeklyOff: number[]; shiftId?: string }, ctx: OpCtx): { changes: Changes; employee: Employee; candidate: Candidate } {
  const cur = state.hrCandidates?.[candidateId]
  if (!cur) throw new OpError('That candidate no longer exists.')
  if (cur.stage === 'hired') throw new OpError('This person has been hired already.')
  const opening = state.hrOpenings?.[cur.openingId]
  const made = saveEmployee(state, {
    name: cur.name, phone: cur.phone, email: cur.email, designation: d.designation ?? opening?.title ?? '', department: opening?.department ?? '', joinDate: d.joinDate, address: '',
    emergency: { name: '', phone: '', relation: '' }, shiftId: d.shiftId, weeklyOff: d.weeklyOff, notes: `Hired from “${opening?.title ?? 'opening'}”.`,
  }, undefined, ctx)
  const employee: Employee = { ...made.employee, onboarding: ONBOARDING_STEPS.map((label) => ({ label, done: false })) }
  const candidate: Candidate = { ...cur, stage: 'hired', employeeId: employee.id, updatedAt: ctx.now }
  const put: Changes['put'] = { employees: [employee], hrCandidates: [candidate], audit: [audit(ctx, 'CANDIDATE_HIRED', `${cur.name} → ${employee.code}`)] }
  if (opening && opening.status === 'open') {
    const hired = listOf(state.hrCandidates ?? {}).filter((c) => c.openingId === opening.id && c.stage === 'hired').length + 1
    if (hired >= opening.positions) put.hrOpenings = [{ ...opening, status: 'closed', closedOn: ymdOf(ctx.now) }]
  }
  return { employee, candidate, changes: { put } }
}
