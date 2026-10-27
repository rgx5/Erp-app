import { accruedIn, leaveBalance, leaveDays, leaveYearOf, type LeaveFacts } from '../logic/leave'
import type { LeaveType } from '../types'

const type = (over: Partial<LeaveType> = {}): LeaveType => ({ id: 't1', name: 'Casual', code: 'CL', daysPerYear: 12, accrual: 'monthly', carryForwardMax: 0, paid: true, allowNegative: false, active: true, ...over })

describe('leave years', () => {
  test('calendar and April-March years', () => {
    expect(leaveYearOf('2026-10-19', 1)).toEqual({ key: '2026', from: '2026-01-01', to: '2026-12-31' })
    expect(leaveYearOf('2026-10-19', 4)).toEqual({ key: '2026-27', from: '2026-04-01', to: '2027-03-31' })
    expect(leaveYearOf('2026-02-10', 4)).toEqual({ key: '2025-26', from: '2025-04-01', to: '2026-03-31' })
  })
})

describe('days a leave takes', () => {
  test('weekly offs and holidays inside the dates are free', () => {
    // Fri 9 Oct .. Tue 13 Oct: Fri, Sat, (Sun off), Mon, Tue  — Mon 12th a holiday
    expect(leaveDays('2026-10-09', '2026-10-13', false, [0], { '2026-10-12': 'x' })).toBe(3)
    expect(leaveDays('2026-10-18', '2026-10-18', false, [0], {})).toBe(0)
  })
  test('a single day can be half; a range cannot', () => {
    expect(leaveDays('2026-10-14', '2026-10-14', true, [0], {})).toBe(0.5)
    expect(leaveDays('2026-10-14', '2026-10-15', true, [0], {})).toBe(0)
  })
})

describe('accrual', () => {
  const y = leaveYearOf('2026-06-01', 1)
  test('monthly: one month each month, up to the date', () => {
    expect(accruedIn(type(), '2025-01-01', y, '2026-03-20')).toBe(3)
    expect(accruedIn(type(), '2025-01-01', y, '2026-12-31')).toBe(12)
  })
  test('a joiner earns from the month they joined if they joined by the 15th', () => {
    expect(accruedIn(type(), '2026-03-10', y, '2026-06-30')).toBe(4) // Mar Apr May Jun
    expect(accruedIn(type(), '2026-03-20', y, '2026-06-30')).toBe(3)
    expect(accruedIn(type(), '2027-01-01', y, '2026-06-30')).toBe(0)
  })
  test('yearly: the whole grant on day one, pro rata for a joiner', () => {
    const sick = type({ accrual: 'yearly', daysPerYear: 6 })
    expect(accruedIn(sick, '2025-01-01', y, '2026-01-02')).toBe(6)
    expect(accruedIn(sick, '2026-07-01', y, '2026-07-02')).toBe(3)
  })
})

describe('balance', () => {
  test('accrued less taken, with pending held back', () => {
    const facts: LeaveFacts = { requests: [{ from: '2026-02-10', days: 2, status: 'approved' }, { from: '2026-03-01', days: 1, status: 'pending' }, { from: '2026-03-05', days: 4, status: 'rejected' }], grants: [] }
    const b = leaveBalance(type(), '2025-06-01', facts, '2026-04-01', 1)
    expect(b).toMatchObject({ accrued: 4, taken: 2, pending: 1, balance: 2, available: 1 })
  })
  test('unused leave carries into the next year up to the cap', () => {
    const t = type({ carryForwardMax: 5 })
    // 2025: 12 accrued, 2 taken -> 10, carry capped at 5; 2026 to 31 Mar: 3 accrued
    const b = leaveBalance(t, '2025-01-01', { requests: [{ from: '2025-05-01', days: 2, status: 'approved' }], grants: [] }, '2026-03-31', 1)
    expect(b.opening).toBe(5)
    expect(b.accrued).toBe(3)
    expect(b.balance).toBe(8)
  })
  test('manual grants add and take off; a later joiner starts from nothing', () => {
    const b = leaveBalance(type(), '2026-01-01', { requests: [], grants: [{ date: '2026-02-01', days: 3 }, { date: '2026-02-02', days: -1 }] }, '2026-02-28', 1)
    expect(b.granted).toBe(2)
    expect(b.balance).toBe(2 + 2)
  })
  test('unpaid leave has no balance, only a count of days taken', () => {
    const b = leaveBalance(type({ paid: false }), '2026-01-01', { requests: [{ from: '2026-02-10', days: 2, status: 'approved' }], grants: [] }, '2026-04-01', 1)
    expect(b).toMatchObject({ unlimited: true, taken: 2 })
  })
  test('a debt carries forward', () => {
    const t = type({ allowNegative: true, carryForwardMax: 5 })
    const b = leaveBalance(t, '2025-12-01', { requests: [{ from: '2025-12-10', days: 3, status: 'approved' }], grants: [] }, '2026-01-31', 1)
    // 2025: Dec accrues 1, took 3 -> -2 carried; 2026 Jan accrues 1
    expect(b.opening).toBe(-2)
    expect(b.balance).toBe(-1)
  })
})
