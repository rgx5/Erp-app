import { planRecoveries, type AdvanceStanding } from '../logic/advances'
import type { MonthSummary } from '../logic/attendance'
import { DEFAULT_HR_SETTINGS, settingsProblem } from '../logic/settings'
import { annualTax, computePayslip, estimateMonthlyTds, professionalTax, providentFund, stateInsurance, type PayrollInput } from '../logic/payroll'
import type { EmployeePay, PayAdjustment, StaffAdvance } from '../types'

const S = DEFAULT_HR_SETTINGS
const summary = (over: Partial<MonthSummary> = {}): MonthSummary => ({
  month: '2026-10', days: 31, employedDays: 31, presentDays: 26, paidLeaveDays: 0, unpaidLeaveDays: 0, holidayDays: 1, weekoffDays: 4, absentDays: 0, unmarkedDays: 0, futureDays: 0,
  notEmployedDays: 0, lateCount: 0, incompleteCount: 0, workedMins: 26 * 540, overtimeMins: 0, lopDays: 0, ...over,
})
const pay = (over: Partial<EmployeePay> = {}): EmployeePay => ({
  id: 'e1', employeeId: 'e1', payType: 'monthly', basic: 20000, allowances: [{ name: 'HRA', amount: 5000 }], pf: true, esi: false, pt: true, tds: false, overtimeEligible: false,
  bank: { holder: '', bankName: '', account: '', ifsc: '', upi: '' }, pan: '', uan: '', esiNo: '', notes: '', ...over,
})
const input = (over: Partial<PayrollInput> = {}): PayrollInput => ({ employee: { id: 'e1' }, pay: pay(), month: '2026-10', settings: S, summary: summary(), adjustments: [], advances: [], ...over })
const line = (r: { deductions: Array<{ key: string; amount: number }> }, key: string) => r.deductions.filter((d) => d.key === key).reduce((t, d) => t + d.amount, 0)

describe('statutory pieces', () => {
  test('PF is on at most the ceiling, to the rupee', () => {
    expect(providentFund(20000, S)).toEqual({ wage: 15000, employee: 1800, employer: 1800 })
    expect(providentFund(10000, S)).toEqual({ wage: 10000, employee: 1200, employer: 1200 })
    expect(providentFund(20000, { ...S, pfCap: false }).employee).toBe(2400)
    expect(providentFund(0, S).employee).toBe(0)
    expect(providentFund(9999, S).employee).toBe(1200) // 1199.88 -> 1200
  })
  test('ESI applies up to the wage ceiling and rounds up', () => {
    expect(stateInsurance(20000, 20000, S)).toEqual({ employee: 150, employer: 650, covered: true })
    expect(stateInsurance(12345, 12345, S).employee).toBe(93) // 92.59
    expect(stateInsurance(25000, 25000, S)).toMatchObject({ employee: 0, covered: false })
  })
  test('professional tax picks the slab', () => {
    expect(professionalTax(9000, S.ptSlabs)).toBe(0)
    expect(professionalTax(10000, S.ptSlabs)).toBe(0)
    expect(professionalTax(10001, S.ptSlabs)).toBe(200)
  })
  test('income tax: nothing under the rebate limit, slabs and cess above', () => {
    expect(annualTax(1_200_000, S)).toBe(0)
    expect(annualTax(1_500_000, S)).toBe(109_200)
    expect(estimateMonthlyTds(1_575_000, S)).toBe(9100)
    expect(estimateMonthlyTds(300_000, S)).toBe(0)
  })
  test('the default settings are sound, and bad ones are named', () => {
    expect(settingsProblem(S)).toBeNull()
    expect(settingsProblem({ ...S, pfEmployeePct: 120 })).toMatch(/percentage/)
    expect(settingsProblem({ ...S, ptSlabs: [{ upTo: 5000, amount: 0 }] })).toMatch(/no upper limit/)
    expect(settingsProblem({ ...S, payDay: 31 })).toMatch(/Salary day/)
  })
})

describe('a monthly payslip', () => {
  test('full attendance: gross, PF on the capped wage, PT, net', () => {
    const r = computePayslip(input())
    expect(r.gross).toBe(25000)
    expect(line(r, 'pf')).toBe(1800)
    expect(r.employerPf).toBe(1800)
    expect(line(r, 'pt')).toBe(200)
    expect(r.totalDeductions).toBe(2000)
    expect(r.net).toBe(23000)
  })
  test('loss of pay takes a share of every earning', () => {
    const r = computePayslip(input({ summary: summary({ lopDays: 3.5 }) }))
    expect(r.earnings[0].amount).toBe(17741.94) // 20000 × 27.5 / 31
    expect(r.earnings[0].full).toBe(20000)
    expect(r.gross).toBe(22177.42)
    expect(r.lopDays).toBe(3.5)
  })
  test('a fixed-30 month pays the same in February as in March', () => {
    const feb = computePayslip(input({ month: '2026-02', settings: { ...S, daysBasis: 'fixed30' }, summary: summary({ month: '2026-02', days: 28 }) }))
    expect(feb.gross).toBe(25000)
    const oneAbsent = computePayslip(input({ settings: { ...S, daysBasis: 'fixed30' }, summary: summary({ lopDays: 1 }) }))
    expect(oneAbsent.gross).toBeCloseTo(25000 * 29 / 30, 1)
  })
  test('joining mid-month pays for the days employed', () => {
    const r = computePayslip(input({ summary: summary({ notEmployedDays: 10, employedDays: 21 }) }))
    expect(r.gross).toBeCloseTo(25000 * 21 / 31, 1)
  })
  test('ESI applies when the contract wage is within the limit, and is not charged above it', () => {
    const low = computePayslip(input({ pay: pay({ basic: 12000, allowances: [{ name: 'HRA', amount: 3000 }], esi: true, pf: false, pt: false }) }))
    expect(line(low, 'esi')).toBe(113) // 112.5 rounded up
    expect(low.employerEsi).toBe(488) // 487.5 up
    const high = computePayslip(input({ pay: pay({ esi: true }) }))
    expect(line(high, 'esi')).toBe(0)
    expect(high.warnings.join(' ')).toMatch(/ESI/)
  })
  test('overtime is paid at the multiplier on the hourly rate when the person is eligible', () => {
    const r = computePayslip(input({ pay: pay({ overtimeEligible: true, pf: false, pt: false }), summary: summary({ overtimeMins: 180 }) }))
    // 25000 / 31 / 8 = 100.806 per hour × 3 h × 2
    expect(r.overtimeHours).toBe(3)
    expect(r.earnings.find((e) => e.key === 'overtime')!.amount).toBeCloseTo(604.84, 2)
    expect(computePayslip(input({ summary: summary({ overtimeMins: 180 }) })).overtimeHours).toBe(0)
  })
  test('incentives add to the pay and fines come off it', () => {
    const adj = (kind: PayAdjustment['kind'], amount: number): PayAdjustment => ({ id: `a${amount}`, employeeId: 'e1', month: '2026-10', kind, label: kind, amount, source: 'manual', note: '', createdBy: 'u', createdAt: 1 })
    const r = computePayslip(input({ adjustments: [adj('incentive', 1500), adj('deduction', 300)] }))
    expect(r.gross).toBe(26500)
    expect(line(r, 'other')).toBe(300)
    expect(r.adjustmentIds).toEqual(['a1500', 'a300'])
    expect(r.net).toBe(26500 - 1800 - 200 - 300)
  })
  test('TDS: a fixed amount wins over the estimate; the estimate is flagged', () => {
    const fixed = computePayslip(input({ pay: pay({ tds: true, tdsMonthly: 500 }) }))
    expect(fixed.deductions.find((d) => d.key === 'tds')).toMatchObject({ amount: 500, label: 'TDS' })
    const est = computePayslip(input({ pay: pay({ tds: true, basic: 150000, allowances: [], pf: false, pt: false }) }))
    expect(est.deductions.find((d) => d.key === 'tds')!.label).toMatch(/estimate/)
  })
  test('the net is rounded to the rupee and the difference kept', () => {
    const r = computePayslip(input({ summary: summary({ lopDays: 3.5 }) }))
    expect(r.net).toBe(Math.round(r.gross - r.totalDeductions))
    expect(r.roundOff).toBeCloseTo(r.net - (r.gross - r.totalDeductions), 2)
    const exact = computePayslip(input({ summary: summary({ lopDays: 3.5 }), settings: { ...S, roundNet: false } }))
    expect(exact.roundOff).toBe(0)
  })
  test('unmarked days are counted as absent and flagged', () => {
    const r = computePayslip(input({ summary: summary({ lopDays: 2, unmarkedDays: 2 }) }))
    expect(r.warnings.join(' ')).toMatch(/2 days are not marked/)
  })
})

describe('daily and hourly pay', () => {
  test('daily wage pays for days worked, paid leave and holidays, not weekly offs', () => {
    const r = computePayslip(input({ pay: pay({ payType: 'daily', basic: 600, allowances: [{ name: 'Food', amount: 50 }], pf: false, pt: false }), summary: summary({ presentDays: 20, paidLeaveDays: 1, holidayDays: 1 }) }))
    expect(r.earnings[0].amount).toBe(13200) // 22 days × 600
    expect(r.earnings[1].amount).toBe(1100)
    expect(r.gross).toBe(14300)
  })
  test('weekly offs are paid when the setting says so', () => {
    const r = computePayslip(input({ pay: pay({ payType: 'daily', basic: 600, allowances: [], pf: false, pt: false }), settings: { ...S, payWeekoffForDaily: true }, summary: summary({ presentDays: 20, weekoffDays: 4, holidayDays: 0 }) }))
    expect(r.gross).toBe(14400)
  })
  test('hourly pay is the hours worked', () => {
    const r = computePayslip(input({ pay: pay({ payType: 'hourly', basic: 100, allowances: [], pf: false, pt: false }), summary: summary({ workedMins: 90 * 60 }) }))
    expect(r.gross).toBe(9000)
  })
})

describe('advances and loans in payroll', () => {
  const adv = (n: number, amount: number, installments: number, startMonth = '2026-10', date = n): AdvanceStanding => {
    const advance: StaffAdvance = { id: `adv${n}`, no: `ADV-000${n}`, employeeId: 'e1', kind: installments > 1 ? 'loan' : 'advance', amount, date, mode: 'cash', ref: '', installments, startMonth, note: '', userId: 'u' }
    return { advance, repaid: 0, recovered: 0, balance: amount, emi: Math.round((amount / installments) * 100) / 100 }
  }
  test('one instalment a month, from the start month', () => {
    expect(planRecoveries([adv(1, 6000, 3)], '2026-10', 99999)).toEqual([{ advanceId: 'adv1', amount: 2000, label: 'Loan ADV-0001' }])
    expect(planRecoveries([adv(1, 6000, 3, '2026-11')], '2026-10', 99999)).toEqual([])
  })
  test('the last instalment is only what is left', () => {
    const s = { ...adv(1, 6000, 3), recovered: 4500, balance: 1500 }
    expect(planRecoveries([s], '2026-12', 99999)[0].amount).toBe(1500)
  })
  test('never more than the pay can bear, oldest first', () => {
    const r = planRecoveries([adv(2, 3000, 1), adv(1, 4000, 1)], '2026-10', 5000)
    expect(r.map((x) => [x.advanceId, x.amount])).toEqual([['adv1', 4000], ['adv2', 1000]])
  })
  test('recoveries come off the net and appear on the slip', () => {
    const r = computePayslip(input({ advances: [adv(1, 6000, 3)] }))
    expect(r.recoveries).toEqual([{ advanceId: 'adv1', amount: 2000, label: 'Loan ADV-0001' }])
    expect(r.net).toBe(25000 - 1800 - 200 - 2000)
  })
  test('a small pay is not taken below nothing', () => {
    const r = computePayslip(input({ pay: pay({ basic: 3000, allowances: [], pf: false, pt: false }), advances: [adv(1, 20000, 2)] }))
    expect(r.net).toBe(0)
    expect(r.recoveries[0].amount).toBe(3000)
  })
})
