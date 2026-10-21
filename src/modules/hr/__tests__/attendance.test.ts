import { dayInfo, monthSheet, summarise, type AttendanceInputs } from '../logic/attendance'
import type { AttendanceMark, Punch, WorkShift } from '../types'
import { at } from './helpers'

const shift: WorkShift = { id: 'sh1', name: 'Morning', start: '09:00', end: '18:00', breakMins: 60, graceMins: 10, active: true }
const night: WorkShift = { id: 'sh2', name: 'Night', start: '22:00', end: '06:00', breakMins: 0, graceMins: 10, active: true }

let n = 0
const punch = (date: string, kind: 'in' | 'out', hhmm: string, d2 = date): Punch => ({ id: `p${++n}`, employeeId: 'e1', at: at(d2, hhmm), date, kind, geo: '', note: '', source: 'self', userId: 'u', })

const inputs = (over: Partial<AttendanceInputs> = {}): AttendanceInputs => ({
  employee: { id: 'e1', joinDate: '2026-01-01', exitDate: undefined, shiftId: 'sh1', weeklyOff: [0] },
  shifts: { sh1: shift, sh2: night }, roster: {}, holidays: {}, punches: [], marks: {}, leaves: [], settings: { workDayMins: 480 }, today: '2026-10-31', ...over,
})

describe('a day from punches', () => {
  test('a full shift is present, on time', () => {
    const d = dayInfo(inputs({ punches: [punch('2026-10-12', 'in', '09:05'), punch('2026-10-12', 'out', '18:10')] }), '2026-10-12')
    expect(d).toMatchObject({ status: 'present', presentFrac: 1, late: false, source: 'punch', workedMins: 485 })
    expect(d.overtimeMins).toBe(5)
  })
  test('late beyond the grace is flagged', () => {
    const d = dayInfo(inputs({ punches: [punch('2026-10-12', 'in', '09:30'), punch('2026-10-12', 'out', '18:30')] }), '2026-10-12')
    expect(d.late).toBe(true)
    expect(d.status).toBe('present')
  })
  test('about half a shift is a half day; less is absent', () => {
    expect(dayInfo(inputs({ punches: [punch('2026-10-12', 'in', '09:00'), punch('2026-10-12', 'out', '13:30')] }), '2026-10-12')).toMatchObject({ status: 'half', presentFrac: 0.5 })
    expect(dayInfo(inputs({ punches: [punch('2026-10-12', 'in', '09:00'), punch('2026-10-12', 'out', '10:30')] }), '2026-10-12')).toMatchObject({ status: 'absent', presentFrac: 0 })
  })
  test('a punch-in with no punch-out counts as present but is flagged', () => {
    const d = dayInfo(inputs({ punches: [punch('2026-10-12', 'in', '09:00')] }), '2026-10-12')
    expect(d).toMatchObject({ status: 'present', incomplete: true })
  })
  test('a night shift out after midnight belongs to the day it started', () => {
    const i = inputs({ employee: { id: 'e1', joinDate: '2026-01-01', shiftId: 'sh2', weeklyOff: [0] }, punches: [punch('2026-10-12', 'in', '22:00'), punch('2026-10-12', 'out', '06:05', '2026-10-13')] })
    expect(dayInfo(i, '2026-10-12')).toMatchObject({ status: 'present', workedMins: 485 })
  })
})

describe('the calendar', () => {
  test('weekly off, holiday, leave, future and unmarked', () => {
    const i = inputs({ holidays: { '2026-10-20': 'Diwali' }, leaves: [{ requestId: 'l1', typeId: 't', from: '2026-10-14', to: '2026-10-15', paid: true }], today: '2026-10-25' })
    expect(dayInfo(i, '2026-10-18').status).toBe('weekoff') // Sunday
    expect(dayInfo(i, '2026-10-20')).toMatchObject({ status: 'holiday', holiday: 'Diwali' })
    expect(dayInfo(i, '2026-10-14')).toMatchObject({ status: 'leave', leaveFrac: 1, leavePaid: true })
    expect(dayInfo(i, '2026-10-27').status).toBe('future')
    expect(dayInfo(i, '2026-10-13').status).toBe('unmarked')
  })
  test('before joining and after leaving a day is not employed', () => {
    const i = inputs({ employee: { id: 'e1', joinDate: '2026-10-10', exitDate: '2026-10-20', shiftId: 'sh1', weeklyOff: [0] } })
    expect(dayInfo(i, '2026-10-09').status).toBe('notEmployed')
    expect(dayInfo(i, '2026-10-21').status).toBe('notEmployed')
    expect(dayInfo(i, '2026-10-12').status).toBe('unmarked')
  })
  test('a manager’s mark overrides punches, leave and holidays', () => {
    const mark: AttendanceMark = { id: 'e1_2026-10-12', employeeId: 'e1', date: '2026-10-12', status: 'half', reason: '', markedBy: 'u', markedAt: 1 }
    expect(dayInfo(inputs({ marks: { '2026-10-12': mark }, punches: [punch('2026-10-12', 'in', '09:00'), punch('2026-10-12', 'out', '18:00')] }), '2026-10-12')).toMatchObject({ status: 'half', source: 'mark', presentFrac: 0.5 })
  })
  test('a roster entry changes the shift and a roster day off is a weekly off', () => {
    const i = inputs({ roster: { '2026-10-13': null, '2026-10-18': 'sh1' } })
    expect(dayInfo(i, '2026-10-13').status).toBe('weekoff')
    expect(dayInfo(i, '2026-10-18').status).toBe('unmarked') // working on a Sunday this week
  })
  test('working on a holiday counts as present', () => {
    const i = inputs({ holidays: { '2026-10-20': 'Diwali' }, punches: [punch('2026-10-20', 'in', '09:00'), punch('2026-10-20', 'out', '18:00')] })
    expect(dayInfo(i, '2026-10-20')).toMatchObject({ status: 'present', holiday: 'Diwali' })
  })
  test('a full-day leave wins over a stray punch; a half-day leave allows the other half', () => {
    const base = { punches: [punch('2026-10-14', 'in', '09:00'), punch('2026-10-14', 'out', '18:00')] }
    expect(dayInfo(inputs({ ...base, leaves: [{ requestId: 'l', typeId: 't', from: '2026-10-14', to: '2026-10-14', paid: true }] }), '2026-10-14')).toMatchObject({ leaveFrac: 1, presentFrac: 0 })
    expect(dayInfo(inputs({ ...base, leaves: [{ requestId: 'l', typeId: 't', from: '2026-10-14', to: '2026-10-14', half: 'first', paid: true }] }), '2026-10-14')).toMatchObject({ leaveFrac: 0.5, presentFrac: 0.5 })
  })
})

describe('a month', () => {
  test('summary counts days, loss of pay and overtime', () => {
    const punches: Punch[] = []
    for (const d of ['2026-10-01', '2026-10-05', '2026-10-06']) punches.push(punch(d, 'in', '09:00'), punch(d, 'out', '18:00'))
    punches.push(punch('2026-10-07', 'in', '09:00'), punch('2026-10-07', 'out', '13:30')) // half
    punches.push(punch('2026-10-08', 'in', '09:00'), punch('2026-10-08', 'out', '19:30')) // 90 min overtime
    const i = inputs({
      punches, holidays: { '2026-10-02': 'Gandhi Jayanti' }, today: '2026-10-09',
      leaves: [{ requestId: 'l', typeId: 't', from: '2026-10-09', to: '2026-10-09', paid: false }],
      marks: { '2026-10-03': { id: 'x', employeeId: 'e1', date: '2026-10-03', status: 'absent', reason: '', markedBy: 'u', markedAt: 1 } },
    })
    const sheet = monthSheet(i, '2026-10')
    const s = summarise(sheet, '2026-10', { overtimeMinMins: 30 })
    expect(s.days).toBe(31)
    expect(s.presentDays).toBe(4.5) // 01, 05, 06, 08 + half of 07
    expect(s.holidayDays).toBe(1)
    expect(s.weekoffDays).toBe(4) // the four Sundays
    expect(s.absentDays).toBe(1)
    expect(s.unpaidLeaveDays).toBe(1)
    expect(s.unmarkedDays).toBe(0) // 09-oct leave, none left before "today"
    expect(s.futureDays).toBe(19) // 10th to 31st without the three Sundays
    expect(s.overtimeMins).toBe(90)
    // lop: absent 1 + unpaid leave 1 + the missing half 0.5
    expect(s.lopDays).toBe(2.5)
  })
})
