import { listOf, type DataState } from '@/data/state'
import type { AttendanceMark, Employee, Holiday, LeaveRequest, LeaveType, Punch, YM, YMD } from '../types'
import type { AttendanceInputs, DayInfo, LeaveSpan, MonthSummary } from './attendance'
import { dayInfo, monthSheet, summarise } from './attendance'
import { decisionsByRef, statusOf, type RequestStatus } from './decisions'
import { hrSettings } from './settings'
import { ymdOf } from './ymd'

/** The documents of the module, grouped once per person so a screen or a payroll run does not scan everything for every employee. */
export interface HrIndex {
  punchesBy: Map<string, Punch[]>
  marksBy: Map<string, Record<YMD, AttendanceMark>>
  rosterBy: Map<string, Record<YMD, string | null>>
  holidays: Record<YMD, string>
  leavesBy: Map<string, LeaveSpan[]>
  leaveStatus: Map<string, RequestStatus>
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]) }

export function buildIndex(state: DataState): HrIndex {
  const punchesBy = new Map<string, Punch[]>()
  for (const p of listOf(state.punches ?? {})) push(punchesBy, p.employeeId, p)
  const marksBy = new Map<string, Record<YMD, AttendanceMark>>()
  for (const m of listOf(state.attendance ?? {})) { const r = marksBy.get(m.employeeId) ?? {}; r[m.date] = m; marksBy.set(m.employeeId, r) }
  const rosterBy = new Map<string, Record<YMD, string | null>>()
  for (const r of listOf(state.rosters ?? {})) { const x = rosterBy.get(r.employeeId) ?? {}; x[r.date] = r.shiftId; rosterBy.set(r.employeeId, x) }
  const holidays: Record<YMD, string> = {}
  for (const h of listOf(state.hrHolidays ?? {}) as Holiday[]) holidays[h.date] = h.name
  const decisions = decisionsByRef(state)
  const leaveStatus = new Map<string, RequestStatus>()
  const leavesBy = new Map<string, LeaveSpan[]>()
  const types = state.leaveTypes ?? {}
  for (const r of listOf(state.leaveRequests ?? {}) as LeaveRequest[]) {
    const st = statusOf(decisions.get(r.id))
    leaveStatus.set(r.id, st)
    if (st !== 'approved') continue
    const t: LeaveType | undefined = types[r.typeId]
    push(leavesBy, r.employeeId, { requestId: r.id, typeId: r.typeId, from: r.from, to: r.to, half: r.half, paid: t ? t.paid : true })
  }
  return { punchesBy, marksBy, rosterBy, holidays, leavesBy, leaveStatus }
}

/** Everything attendance needs to know about one person. */
export function attendanceInputs(state: DataState, idx: HrIndex, employee: Employee, now: number): AttendanceInputs {
  const shifts: AttendanceInputs['shifts'] = {}
  for (const s of listOf(state.workShifts ?? {})) shifts[s.id] = s
  return {
    employee, shifts, roster: idx.rosterBy.get(employee.id) ?? {}, holidays: idx.holidays, punches: idx.punchesBy.get(employee.id) ?? [],
    marks: idx.marksBy.get(employee.id) ?? {}, leaves: idx.leavesBy.get(employee.id) ?? [], settings: hrSettings(state), today: ymdOf(now),
  }
}

/** A person's month: every day and the totals. */
export function employeeMonth(state: DataState, idx: HrIndex, employee: Employee, month: YM, now: number): { sheet: DayInfo[]; summary: MonthSummary } {
  const sheet = monthSheet(attendanceInputs(state, idx, employee, now), month)
  return { sheet, summary: summarise(sheet, month, hrSettings(state)) }
}

/** The employee who signs in as this user, if any. */
export const employeeOfUser = (state: DataState, userId: string | undefined): Employee | undefined =>
  userId ? listOf(state.employees ?? {}).find((e) => e.userId === userId && e.active) : undefined

/** People still on the payroll on a date. */
export const activeOn = (state: DataState, date: YMD): Employee[] =>
  listOf(state.employees ?? {}).filter((e) => e.joinDate <= date && (!e.exitDate || e.exitDate >= date)).sort((a, b) => a.name.localeCompare(b.name))

/** People who worked at any time in a month. */
export const employedIn = (state: DataState, first: YMD, last: YMD): Employee[] =>
  listOf(state.employees ?? {}).filter((e) => e.joinDate <= last && (!e.exitDate || e.exitDate >= first)).sort((a, b) => a.name.localeCompare(b.name))

/** Everyone on the staff list today, with what their day looks like so far. */
export function dayBoard(state: DataState, idx: HrIndex, date: YMD, now: number): Array<{ employee: Employee; info: DayInfo }> {
  const settings = hrSettings(state)
  const shifts: AttendanceInputs['shifts'] = {}
  for (const s of listOf(state.workShifts ?? {})) shifts[s.id] = s
  return activeOn(state, date).map((employee) => ({
    employee,
    info: dayInfo({
      employee, shifts, roster: idx.rosterBy.get(employee.id) ?? {}, holidays: idx.holidays, punches: idx.punchesBy.get(employee.id) ?? [], marks: idx.marksBy.get(employee.id) ?? {},
      leaves: idx.leavesBy.get(employee.id) ?? [], settings, today: ymdOf(now),
    }, date),
  }))
}
