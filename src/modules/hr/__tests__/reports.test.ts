import { toCsv } from '@/domain/csv'
import { advancesTable, attendanceSheetTable, bankExport, claimsTable, leaveBalanceTable, payrollRegisterTable, statutoryTable, tableCsvRows } from '../logic/reports'
import { payslipHtml, tableHtml } from '../html'
import { expiringDocs, payrollOverdue, waitingApprovals } from '../notices'
import { issueAdvance, paySalary, runPayroll, submitClaim } from '../payrollOps'
import { requestLeave, saveEmployeeDoc, seedLeaveTypes } from '../ops'
import { listOf } from '@/data/state'
import { AFTER, at, ctx, hrState, presentAllMonth, run } from './helpers'

const late = () => ctx({ now: AFTER })

function month() {
  let { s, ravi, meera } = hrState()
  s = presentAllMonth(s, '2026-10', [ravi.id, meera.id], ['2026-10-05'])
  s = run(s, issueAdvance(s, { employeeId: ravi.id, kind: 'advance', amount: 1500, mode: 'cash', installments: 1, startMonth: '2026-10' }, ctx()))
  s = run(s, runPayroll(s, '2026-10', undefined, late()))
  return { s, ravi, meera }
}

describe('reports', () => {
  test('payroll register totals what the payslips say', () => {
    const { s } = month()
    const t = payrollRegisterTable(s, '2026-10')
    expect(t.rows).toHaveLength(3)
    const total = t.rows[2]
    const nets = t.rows.slice(0, 2).map((r) => r[10] as number)
    expect(total[10]).toBe(Math.round((nets[0] + nets[1]) * 100) / 100)
    expect(total[8]).toBe(1500)
    expect(t.rows[0][11]).toBe('To pay')
    expect(toCsv(tableCsvRows(t)).split('\r\n')[0]).toBe('Code,Name,Paid days,Gross,PF,ESI,PT,TDS,Advances,Other,Net pay,Status')
  })
  test('the statutory sheet carries the employer shares and says it is not advice', () => {
    const { s } = month()
    const t = statutoryTable(s, '2026-10')
    expect(t.subtitle).toMatch(/not tax or legal advice/i)
    expect(t.rows[t.rows.length - 1].slice(0, 3)).toEqual(['Total', 1800, 1800])
  })
  test('the bank file lists unpaid people with accounts, and names those without', () => {
    let { s } = month()
    let b = bankExport(s, '2026-10')
    expect(b.people).toBe(2) // Ravi has an account, Meera a UPI id
    expect(b.missing).toEqual([])
    expect(b.rows[1].slice(0, 4)).toEqual([1, 'EMP-0001', 'Ravi Kumar', '123456789012'])
    expect(b.rows[1][8]).toBe('Salary Oct 2026')
    const slip = listOf(s.payslips).find((p) => p.employeeName === 'Ravi Kumar')!
    s = run(s, paySalary(s, slip.id, { mode: 'bank' }, late()))
    b = bankExport(s, '2026-10')
    expect(b.people).toBe(1)
    expect(b.total).toBe(listOf(s.payslips).find((p) => p.employeeName === 'Meera Das')!.net)
    // no bank details at all
    const bare = { ...s, employeePay: { ...s.employeePay, [slip.employeeId]: { ...s.employeePay[slip.employeeId], bank: { holder: '', bankName: '', account: '', ifsc: '', upi: '' } } }, salaryPayouts: {} }
    expect(bankExport(bare, '2026-10').missing).toEqual(['Ravi Kumar'])
  })
  test('attendance sheet, leave balances, claims and advances', () => {
    let { s, ravi } = month()
    const sheet = attendanceSheetTable(s, '2026-10', AFTER)
    const row = sheet.rows.find((r) => r[1] === 'Ravi Kumar')!
    expect(row.slice(1, 3)).toEqual(['Ravi Kumar', 26])
    expect(row[9]).toBe(1) // 5 Oct unmarked: one day of loss of pay
    s = run(s, seedLeaveTypes(s, ctx()))
    expect(leaveBalanceTable(s, '2026-10-19').columns.map((c) => c.label)).toEqual(['Code', 'Name', 'Casual leave', 'Earned leave', 'Sick leave'])
    s = run(s, submitClaim(s, { employeeId: ravi.id, date: '2026-10-15', category: 'Travel', amount: 90, description: 'x' }, ctx()))
    expect(claimsTable(s).rows[0].slice(0, 7)).toEqual(['EC-0001', '2026-10-15', 'Ravi Kumar', 'Travel', 90, '', 'Waiting for approval'])
    const adv = advancesTable(s)
    expect(adv.rows[adv.rows.length - 1].slice(3, 8)).toEqual([1500, '', 1500, 0, 0])
  })
})

describe('printed pages', () => {
  test('a payslip prints the lines, the net in words, and hides most of the account number', () => {
    const { s, ravi } = month()
    const slip = listOf(s.payslips).find((p) => p.employeeId === ravi.id)!
    const html = payslipHtml(slip, { name: 'Krishna <Collection>', tagline: '', address: 'MG Road', city: 'Pune', phone: '', gstin: '' }, s.employees[ravi.id], s.employeePay[ravi.id])
    expect(html).toContain('Krishna &lt;Collection&gt;')
    expect(html).toContain('Oct 2026')
    expect(html).toContain('Provident fund')
    expect(html).toContain('XXXX9012')
    expect(html).not.toContain('123456789012')
    expect(html).toContain('computer-generated')
  })
  test('a report prints as a table', () => {
    const { s } = month()
    const html = tableHtml('Shop', payrollRegisterTable(s, '2026-10'))
    expect(html).toContain('Payroll register Oct 2026')
    expect(html.match(/<tr/g)!.length).toBe(4)
  })
})

describe('notices', () => {
  test('waiting requests, expiring documents, salary not yet run', () => {
    let { s, ravi } = hrState()
    expect(waitingApprovals(s).total).toBe(0)
    s = run(s, seedLeaveTypes(s, ctx()))
    const cl = listOf(s.leaveTypes).find((t) => t.code === 'CL')!
    s = run(s, requestLeave(s, { employeeId: ravi.id, typeId: cl.id, from: '2026-10-21', to: '2026-10-21', reason: '' }, ctx()))
    s = run(s, submitClaim(s, { employeeId: ravi.id, date: '2026-10-15', category: 'Food', amount: 50, description: 'x' }, ctx()))
    expect(waitingApprovals(s)).toMatchObject({ leave: 1, claims: 1, total: 2 })
    s = run(s, saveEmployeeDoc(s, { employeeId: ravi.id, kind: 'licence', title: 'Licence', number: '', expiresOn: '2026-10-25', note: '' }, undefined, ctx()))
    expect(expiringDocs(s, at('2026-10-20'))).toEqual({ expired: 0, soon: 1 })
    expect(expiringDocs(s, at('2026-11-20'))).toEqual({ expired: 1, soon: 0 })
    // on the 7th (salary day) September's salary has not been run
    expect(payrollOverdue(s, at('2026-10-03'))).toBeNull()
    expect(payrollOverdue(s, at('2026-10-08'))).toMatchObject({ month: '2026-09', people: 2 })
    expect(payrollOverdue({ ...s, employeePay: {} }, at('2026-10-08'))).toBeNull()
  })
})
