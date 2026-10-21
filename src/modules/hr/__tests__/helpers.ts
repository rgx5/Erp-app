import { baseState, ctx, NOW } from '@/data/__tests__/helpers'
import { applyChanges, type Changes, type DataState } from '@/data/state'
import type { OpCtx } from '@/data/ops'
import { bulkMark, saveEmployee, savePay, saveShift, type EmployeeDraft, type PayDraft } from '../ops'
import type { Employee, YMD } from '../types'
import { eachDay, monthDays, weekdayOf } from '../logic/ymd'
import '../replication'

export { baseState, ctx, NOW }

export const run = <R extends { changes: Changes }>(s: DataState, r: R): DataState => applyChanges(s, r.changes)

/** Nov 2 2026, after October is over. */
export const AFTER = new Date('2026-11-02T10:00:00').getTime()
export const at = (date: string, hhmm = '10:00') => new Date(`${date}T${hhmm}:00`).getTime()
export const ctxAt = (date: string, hhmm = '10:00', over: Partial<OpCtx> = {}): OpCtx => ctx({ now: at(date, hhmm), ...over })

export const empDraft = (over: Partial<EmployeeDraft> = {}): EmployeeDraft => ({
  name: 'Ravi Kumar', phone: '9876500001', email: '', designation: 'Salesman', department: 'Shop', joinDate: '2026-01-01', address: '', emergency: { name: '', phone: '', relation: '' },
  weeklyOff: [0], notes: '', ...over,
})

export const payDraft = (over: Partial<PayDraft> = {}): PayDraft => ({
  payType: 'monthly', basic: 20000, allowances: [{ name: 'HRA', amount: 5000 }], pf: true, esi: false, pt: true, tds: false, overtimeEligible: false,
  bank: { holder: 'Ravi Kumar', bankName: 'HDFC Bank', account: '123456789012', ifsc: 'HDFC0001234', upi: '' }, pan: '', uan: '', esiNo: '', notes: '', ...over,
})

/** The base shop plus a morning shift, and two staff: Ravi (monthly, ₹25,000, linked to the cashier's sign-in) and Meera (daily wage). */
export function hrState(): { s: DataState; ravi: Employee; meera: Employee } {
  let s = baseState()
  s = run(s, saveShift(s, { name: 'Morning', start: '09:00', end: '18:00', breakMins: 60, graceMins: 10, active: true }, undefined, ctx()))
  const shift = Object.values(s.workShifts)[0]
  const r = saveEmployee(s, empDraft({ userId: 'u_cash', shiftId: shift.id }), undefined, ctx()); s = run(s, r)
  s = run(s, savePay(s, r.employee.id, payDraft(), ctx()))
  const m = saveEmployee(s, empDraft({ name: 'Meera Das', phone: '9876500002', designation: 'Helper', shiftId: shift.id }), undefined, ctx({ now: NOW + 1000 })); s = run(s, m)
  s = run(s, savePay(s, m.employee.id, payDraft({ payType: 'daily', basic: 600, allowances: [], pf: false, pt: false, bank: { holder: '', bankName: '', account: '', ifsc: '', upi: 'meera@upi' } }), ctx()))
  return { s, ravi: r.employee, meera: m.employee }
}

/** Marks everyone present on every day of the month except the listed days and weekly offs (Sundays). */
export function presentAllMonth(s: DataState, month: string, ids: string[], skip: YMD[] = []): DataState {
  let out = s
  for (const d of monthDays(month)) {
    if (weekdayOf(d) === 0 || skip.includes(d)) continue
    out = run(out, bulkMark(out, d, ids, 'present', ctx({ now: AFTER })))
  }
  return out
}

export { eachDay }
