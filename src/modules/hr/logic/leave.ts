import { listOf, type DataState } from '@/data/state'
import type { Employee, LeaveType, YMD } from '../types'
import type { RequestStatus } from './decisions'
import type { HrIndex } from './select'
import { addDays, eachDay, weekdayOf } from './ymd'

const r2 = (n: number) => Math.round(n * 100) / 100

export interface LeaveYear { /** "2026" or "2026-27". */ key: string; from: YMD; to: YMD }

/** The leave year a date falls in, for a year that starts in `startMonth` (1 = January, 4 = April). */
export function leaveYearOf(date: YMD, startMonth: number): LeaveYear {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const startYear = m >= startMonth ? y : y - 1
  const mm = String(startMonth).padStart(2, '0')
  return {
    key: startMonth === 1 ? String(startYear) : `${startYear}-${String(startYear + 1).slice(2)}`,
    from: `${startYear}-${mm}-01`,
    to: addDays(`${startYear + 1}-${mm}-01`, -1),
  }
}

/** Working days a leave takes: weekly offs and holidays inside the dates are not counted. A single day can be a half. */
export function leaveDays(from: YMD, to: YMD, half: boolean, weeklyOff: number[], holidays: Record<YMD, unknown>): number {
  if (to < from) return 0
  const n = eachDay(from, to, 400).filter((d) => !weeklyOff.includes(weekdayOf(d)) && !(d in holidays)).length
  return half ? (from === to && n === 1 ? 0.5 : 0) : n
}

export interface LeaveFacts {
  requests: Array<{ from: YMD; days: number; status: RequestStatus }>
  grants: Array<{ date: YMD; days: number }>
}

export interface LeaveBalance {
  typeId: string
  /** Unpaid leave has no balance. */
  unlimited: boolean
  /** Carried in from earlier years. */
  opening: number
  accrued: number
  granted: number
  taken: number
  pending: number
  /** opening + accrued + granted − taken. */
  balance: number
  /** balance − pending: what a new request can draw on. */
  available: number
}

/** Months of a leave year the person earns for: the month they joined counts when they joined by the 15th. */
function monthsEarned(joinDate: YMD, year: LeaveYear, asOf: YMD, monthly: boolean): number {
  let count = 0
  let cursor = year.from
  for (let i = 0; i < 12; i++) {
    const ym = cursor.slice(0, 7)
    if (monthly && cursor > asOf) break
    if (joinDate <= `${ym}-15`) count++
    const [y, m] = ym.split('-').map(Number)
    cursor = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
  }
  return count
}

/** Leave credited in a year: monthly accrual runs up to `asOf`; a yearly grant is credited at the start (pro rata for a mid-year joiner). */
export function accruedIn(type: Pick<LeaveType, 'daysPerYear' | 'accrual'>, joinDate: YMD, year: LeaveYear, asOf: YMD): number {
  if (joinDate > year.to) return 0
  return r2((monthsEarned(joinDate, year, asOf, type.accrual === 'monthly') * type.daysPerYear) / 12)
}

/** One person's balance of one leave type on a date, carrying each year's unused leave (up to the type's cap) into the next. */
export function leaveBalance(type: LeaveType, joinDate: YMD, facts: LeaveFacts, asOf: YMD, startMonth: number): LeaveBalance {
  const base = { typeId: type.id }
  if (!type.paid) {
    const taken = r2(facts.requests.filter((r) => r.status === 'approved').reduce((s, r) => s + r.days, 0))
    return { ...base, unlimited: true, opening: 0, accrued: 0, granted: 0, taken, pending: 0, balance: 0, available: Infinity }
  }
  const last = leaveYearOf(asOf, startMonth)
  let year = leaveYearOf(joinDate > asOf ? asOf : joinDate, startMonth)
  let carry = 0
  let cur: LeaveBalance | null = null
  for (let guard = 0; guard < 20; guard++) {
    const isLast = year.key === last.key
    const inYear = (d: YMD) => d >= year.from && d <= year.to
    const accrued = accruedIn(type, joinDate, year, isLast ? asOf : year.to)
    const granted = r2(facts.grants.filter((g) => inYear(g.date)).reduce((s, g) => s + g.days, 0))
    const taken = r2(facts.requests.filter((r) => r.status === 'approved' && inYear(r.from)).reduce((s, r) => s + r.days, 0))
    const pending = r2(facts.requests.filter((r) => r.status === 'pending' && inYear(r.from)).reduce((s, r) => s + r.days, 0))
    const balance = r2(carry + accrued + granted - taken)
    if (isLast) { cur = { ...base, unlimited: false, opening: r2(carry), accrued, granted, taken, pending, balance, available: r2(balance - pending) }; break }
    carry = Math.min(balance, type.carryForwardMax)
    year = leaveYearOf(addDays(year.to, 1), startMonth)
  }
  return cur ?? { ...base, unlimited: false, opening: 0, accrued: 0, granted: 0, taken: 0, pending: 0, balance: 0, available: 0 }
}

export function leaveFactsFor(state: DataState, idx: HrIndex, employeeId: string, typeId: string): LeaveFacts {
  return {
    requests: listOf(state.leaveRequests ?? {}).filter((r) => r.employeeId === employeeId && r.typeId === typeId).map((r) => ({ from: r.from, days: r.days, status: idx.leaveStatus.get(r.id) ?? 'pending' })),
    grants: listOf(state.leaveGrants ?? {}).filter((g) => g.employeeId === employeeId && g.typeId === typeId).map((g) => ({ date: g.date, days: g.days })),
  }
}

/** Every active leave type's balance for a person. */
export function balancesFor(state: DataState, idx: HrIndex, employee: Employee, asOf: YMD, startMonth: number): Array<{ type: LeaveType; balance: LeaveBalance }> {
  return listOf(state.leaveTypes ?? {}).filter((t) => t.active).sort((a, b) => a.name.localeCompare(b.name))
    .map((type) => ({ type, balance: leaveBalance(type, employee.joinDate, leaveFactsFor(state, idx, employee.id, type.id), asOf, startMonth) }))
}

/** Another request of the same person that covers any of these dates (pending or approved). */
export function overlappingLeave(state: DataState, idx: HrIndex, employeeId: string, from: YMD, to: YMD, half?: 'first' | 'second') {
  return listOf(state.leaveRequests ?? {}).find((r) => {
    if (r.employeeId !== employeeId) return false
    const st = idx.leaveStatus.get(r.id) ?? 'pending'
    if (st === 'rejected' || st === 'cancelled') return false
    if (!(from <= r.to && to >= r.from)) return false
    // the two halves of one day can be taken separately
    return !(from === to && r.from === r.to && r.half && half && r.half !== half)
  })
}

/** Starter leave types for a new business. */
export const STARTER_LEAVE_TYPES: Array<Omit<LeaveType, 'id'>> = [
  { name: 'Casual leave', code: 'CL', daysPerYear: 12, accrual: 'monthly', carryForwardMax: 0, paid: true, allowNegative: false, active: true },
  { name: 'Sick leave', code: 'SL', daysPerYear: 6, accrual: 'yearly', carryForwardMax: 0, paid: true, allowNegative: false, active: true },
  { name: 'Earned leave', code: 'EL', daysPerYear: 15, accrual: 'monthly', carryForwardMax: 30, paid: true, allowNegative: false, active: true },
  { name: 'Leave without pay', code: 'LWP', daysPerYear: 0, accrual: 'yearly', carryForwardMax: 0, paid: false, allowNegative: true, active: true },
]
