import type { AttendanceMark, Employee, HrSettings, Punch, WorkShift, YM, YMD } from '../types'
import { atTime, clockMins, monthDays, weekdayOf } from './ymd'

/** An approved leave, as attendance sees it. */
export interface LeaveSpan { requestId: string; typeId: string; from: YMD; to: YMD; half?: 'first' | 'second'; paid: boolean }

export type DayStatus = 'present' | 'half' | 'absent' | 'leave' | 'holiday' | 'weekoff' | 'unmarked' | 'future' | 'notEmployed'

export interface DayInfo {
  date: YMD
  status: DayStatus
  /** The part of the day worked: 0, ½ or 1. */
  presentFrac: number
  /** The part of the day on approved leave. */
  leaveFrac: number
  leavePaid: boolean
  leaveTypeId?: string
  inAt?: number
  outAt?: number
  workedMins: number
  late: boolean
  /** Minutes worked beyond the shift. */
  overtimeMins: number
  /** Punched in and never out (or out with no in). */
  incomplete: boolean
  source: 'mark' | 'punch' | 'leave' | 'holiday' | 'weekoff' | 'none'
  shiftId?: string
  holiday?: string
}

export interface AttendanceInputs {
  employee: Pick<Employee, 'id' | 'joinDate' | 'exitDate' | 'shiftId' | 'weeklyOff'>
  shifts: Record<string, WorkShift>
  /** date → the shift worked that day, or null for a day off. */
  roster: Record<YMD, string | null>
  holidays: Record<YMD, string>
  punches: Punch[]
  marks: Record<YMD, AttendanceMark>
  leaves: LeaveSpan[]
  settings: Pick<HrSettings, 'workDayMins'>
  today: YMD
}

/** Minutes a shift is worked for (its length less the break). */
export function shiftMins(shift: WorkShift | undefined, settings: Pick<HrSettings, 'workDayMins'>): number {
  if (!shift) return settings.workDayMins
  const start = clockMins(shift.start)
  let end = clockMins(shift.end)
  if (end <= start) end += 1440
  return Math.max(30, end - start - (shift.breakMins || 0))
}

/** The shift a person works on a date: the roster first, else their usual shift. */
export function shiftOn(inp: AttendanceInputs, date: YMD): WorkShift | undefined {
  const r = inp.roster[date]
  if (r !== undefined) return r ? inp.shifts[r] : undefined
  return inp.employee.shiftId ? inp.shifts[inp.employee.shiftId] : undefined
}

/** A weekly off, unless the roster puts them on a shift that day (or off on another). */
export function isWeekoff(inp: AttendanceInputs, date: YMD): boolean {
  const r = inp.roster[date]
  if (r === null) return true
  if (r !== undefined) return false
  return inp.employee.weeklyOff.includes(weekdayOf(date))
}

const leaveOn = (inp: AttendanceInputs, date: YMD) => inp.leaves.find((l) => date >= l.from && date <= l.to)

const none = (date: YMD, status: DayStatus, over: Partial<DayInfo> = {}): DayInfo => ({
  date, status, presentFrac: 0, leaveFrac: 0, leavePaid: false, workedMins: 0, late: false, overtimeMins: 0, incomplete: false, source: 'none', ...over,
})

function fromTimes(inAt: number | undefined, outAt: number | undefined, shift: WorkShift | undefined, date: YMD, settings: Pick<HrSettings, 'workDayMins'>) {
  const required = shiftMins(shift, settings)
  const grace = shift?.graceMins ?? 0
  const incomplete = (inAt === undefined) !== (outAt === undefined)
  const span = inAt !== undefined && outAt !== undefined && outAt > inAt ? Math.round((outAt - inAt) / 60_000) : 0
  // The break is not work, but only comes off once the person has stayed past it (a morning half day has had no break).
  const brk = shift?.breakMins ?? 0
  const worked = brk && span > required / 2 + brk ? span - brk : span
  let presentFrac = 0
  if (incomplete) presentFrac = 1 // benefit of the doubt; the manager sees it flagged
  else if (worked >= required - grace) presentFrac = 1
  else if (worked >= required / 2) presentFrac = 0.5
  const late = !!shift && inAt !== undefined && inAt > atTime(date, shift.start) + grace * 60_000
  return { worked, presentFrac, late, incomplete, overtimeMins: Math.max(0, worked - required) }
}

/** One day of one person: what they did, or what the calendar says they should have done. */
export function dayInfo(inp: AttendanceInputs, date: YMD): DayInfo {
  const e = inp.employee
  if (date < e.joinDate || (e.exitDate && date > e.exitDate)) return none(date, 'notEmployed')
  const shift = shiftOn(inp, date)
  const shiftId = shift?.id
  const common = { shiftId }

  const mark = inp.marks[date]
  if (mark) {
    const frac = mark.status === 'present' ? 1 : mark.status === 'half' ? 0.5 : 0
    const t = mark.inAt !== undefined || mark.outAt !== undefined ? fromTimes(mark.inAt, mark.outAt, shift, date, inp.settings) : null
    return none(date, mark.status, { ...common, presentFrac: frac, source: 'mark', inAt: mark.inAt, outAt: mark.outAt, workedMins: t?.worked ?? 0, late: t?.late ?? false })
  }

  const day = inp.punches.filter((p) => p.date === date).sort((a, b) => a.at - b.at)
  const inAt = day.find((p) => p.kind === 'in')?.at
  const outAt = [...day].reverse().find((p) => p.kind === 'out')?.at
  const t = day.length ? fromTimes(inAt, outAt, shift, date, inp.settings) : null
  const punched = (frac = t?.presentFrac ?? 0): DayInfo => none(date, frac >= 1 ? 'present' : frac > 0 ? 'half' : 'absent', {
    ...common, presentFrac: frac, source: 'punch', inAt, outAt, workedMins: t?.worked ?? 0, late: t?.late ?? false, overtimeMins: t?.overtimeMins ?? 0, incomplete: t?.incomplete ?? false,
  })

  const holiday = inp.holidays[date]
  if (holiday || isWeekoff(inp, date)) {
    if (t) return { ...punched(), holiday }
    return none(date, holiday ? 'holiday' : 'weekoff', { ...common, source: holiday ? 'holiday' : 'weekoff', holiday })
  }

  const leave = leaveOn(inp, date)
  if (leave) {
    const half = !!leave.half
    const present = half && t ? Math.min(t.presentFrac, 0.5) : 0
    return none(date, 'leave', { ...common, leaveFrac: half ? 0.5 : 1, leavePaid: leave.paid, leaveTypeId: leave.typeId, presentFrac: present, source: 'leave', inAt, outAt, workedMins: t?.worked ?? 0 })
  }

  if (t) return punched()
  if (date > inp.today) return none(date, 'future', common)
  return none(date, 'unmarked', common)
}

/** Every day of a month. */
export const monthSheet = (inp: AttendanceInputs, month: YM): DayInfo[] => monthDays(month).map((d) => dayInfo(inp, d))

export interface MonthSummary {
  month: YM
  days: number
  /** Days between joining and leaving that fall in the month. */
  employedDays: number
  /** Days worked, counting a half day as ½ (a day worked on a holiday counts too). */
  presentDays: number
  paidLeaveDays: number
  unpaidLeaveDays: number
  holidayDays: number
  weekoffDays: number
  /** Marked absent. */
  absentDays: number
  /** Past days nobody marked: counted as absent in payroll, and flagged. */
  unmarkedDays: number
  futureDays: number
  notEmployedDays: number
  lateCount: number
  incompleteCount: number
  workedMins: number
  /** Overtime minutes that count (days with at least the minimum). */
  overtimeMins: number
  /** Days with no pay: absent, unmarked, unpaid leave and the missing half of half days. */
  lopDays: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function summarise(sheet: DayInfo[], month: YM, settings: Pick<HrSettings, 'overtimeMinMins'>): MonthSummary {
  const s: MonthSummary = {
    month, days: sheet.length, employedDays: 0, presentDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, holidayDays: 0, weekoffDays: 0, absentDays: 0, unmarkedDays: 0,
    futureDays: 0, notEmployedDays: 0, lateCount: 0, incompleteCount: 0, workedMins: 0, overtimeMins: 0, lopDays: 0,
  }
  for (const d of sheet) {
    if (d.status === 'notEmployed') { s.notEmployedDays++; continue }
    s.employedDays++
    s.presentDays += d.presentFrac
    if (d.leaveFrac) { if (d.leavePaid) s.paidLeaveDays += d.leaveFrac; else s.unpaidLeaveDays += d.leaveFrac }
    if (d.status === 'holiday') s.holidayDays++
    else if (d.status === 'weekoff') s.weekoffDays++
    else if (d.status === 'absent') s.absentDays++
    else if (d.status === 'unmarked') s.unmarkedDays++
    else if (d.status === 'future') s.futureDays++
    if (d.late) s.lateCount++
    if (d.incomplete) s.incompleteCount++
    s.workedMins += d.workedMins
    if (d.overtimeMins >= settings.overtimeMinMins) s.overtimeMins += d.overtimeMins
    // Holidays, weekly offs and days still to come cost nothing; any other day is paid in proportion to what was worked or covered by paid leave.
    if (d.status !== 'holiday' && d.status !== 'weekoff' && d.status !== 'future') s.lopDays += Math.max(0, 1 - d.presentFrac - (d.leavePaid ? d.leaveFrac : 0))
  }
  s.presentDays = r2(s.presentDays); s.paidLeaveDays = r2(s.paidLeaveDays); s.unpaidLeaveDays = r2(s.unpaidLeaveDays); s.lopDays = r2(s.lopDays)
  return s
}

export const STATUS_LABEL: Record<DayStatus, string> = {
  present: 'Present', half: 'Half day', absent: 'Absent', leave: 'On leave', holiday: 'Holiday', weekoff: 'Weekly off', unmarked: 'Not marked', future: '', notEmployed: '—',
}

/** The clock times of "09:30" style text as a moment on a date (null if it is not a time). */
export function momentOn(date: YMD, hhmm: string): number | undefined {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm.trim()) ? atTime(date, hhmm.trim()) : undefined
}
