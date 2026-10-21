import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { registerCollectionMeta } from '@/replication/registry'
import { DEFAULT_HR_SETTINGS, settingsProblem } from './logic/settings'
import { isClock, isYM, isYMD } from './logic/ymd'
import type { HrSettings } from './types'
import './types'
import './postings'

/**
 * Who may do what.
 *   hr       the people side: employee master, shifts, leave and attendance decisions, recruitment.
 *   payroll  the money side: pay terms and bank details, payslips, payouts, advances, incentive plans. A cashier never receives it.
 *   hrSelf   what any member of staff does for themselves: punch in and out, ask for leave, submit an expense claim.
 * The server checks the role, not the person: it cannot tell that a punch is "your own". Every punch, request and claim carries
 * who sent it (and the server records it), but a manager should treat self-service documents as the staff member's word.
 */
registerPermission('hr', ['manager'])
registerPermission('payroll', ['manager'])
registerPermission('hrSelf', ['manager', 'cashier'])

registerCollections([
  'employees', 'employeeDocs', 'employeePay', 'punches', 'attendance', 'regularisations', 'hrDecisions', 'workShifts', 'rosters', 'hrHolidays',
  'leaveTypes', 'leaveRequests', 'leaveGrants', 'payAdjustments', 'staffAdvances', 'staffRepayments', 'payslips', 'payslipVoids', 'salaryPayouts',
  'hrSettings', 'incentivePlans', 'hrTargets', 'expenseClaims', 'claimPayouts', 'hrOpenings', 'hrCandidates',
])

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0
const oneOf = (v: unknown, list: string[]) => typeof v === 'string' && list.includes(v)

const STAFF = ['hr', 'hrSelf']
const PEOPLE = ['hr', 'hrSelf', 'payroll']
const PAY = 'payroll'

registerCollectionMeta(
  // the people
  {
    name: 'employees', kind: 'master', perm: 'hr', readPerm: PEOPLE, branched: true,
    validate: (d) => (str(d.name) && isYMD(d.joinDate) && Array.isArray(d.weeklyOff) ? null : 'An employee needs a name, a joining date and weekly offs'),
  },
  { name: 'employeeDocs', kind: 'master', perm: 'hr', readPerm: 'hr', branched: true, validate: (d) => (str(d.employeeId) && str(d.kind) ? null : 'A document needs an employee and a kind') },
  {
    name: 'employeePay', kind: 'master', perm: PAY, readPerm: PAY, branched: true,
    validate: (d) => (oneOf(d.payType, ['monthly', 'daily', 'hourly']) && finite(d.basic) && d.basic >= 0 && Array.isArray(d.allowances) ? null : 'Pay terms need a pay type, an amount and allowances'),
  },
  // attendance
  {
    name: 'punches', kind: 'ledger', perm: STAFF, readPerm: STAFF, branched: true,
    validate: (d) => (str(d.employeeId) && finite(d.at) && oneOf(d.kind, ['in', 'out']) && isYMD(d.date) ? null : 'A punch needs an employee, a time, in or out, and a day'),
  },
  {
    name: 'attendance', kind: 'master', perm: 'hr', readPerm: PEOPLE, branched: true,
    validate: (d) => (str(d.employeeId) && isYMD(d.date) && oneOf(d.status, ['present', 'half', 'absent']) ? null : 'A mark needs an employee, a day and present, half or absent'),
  },
  {
    name: 'regularisations', kind: 'ledger', perm: STAFF, readPerm: STAFF, branched: true,
    validate: (d) => (str(d.employeeId) && isYMD(d.date) && str(d.reason) ? null : 'A request needs an employee, a day and a reason'),
  },
  {
    name: 'hrDecisions', kind: 'ledger', perm: 'hr', readPerm: STAFF, branched: true,
    validate: (d) => (oneOf(d.kind, ['leave', 'claim', 'regularisation']) && str(d.refId) && oneOf(d.decision, ['approved', 'rejected', 'cancelled']) ? null : 'A decision needs what it answers and the answer'),
  },
  // shifts
  { name: 'workShifts', kind: 'master', perm: 'hr', readPerm: STAFF, validate: (d) => (str(d.name) && isClock(d.start) && isClock(d.end) ? null : 'A shift needs a name and start and end times (HH:MM)') },
  { name: 'rosters', kind: 'master', perm: 'hr', readPerm: STAFF, branched: true, validate: (d) => (str(d.employeeId) && isYMD(d.date) ? null : 'A roster entry needs an employee and a day') },
  { name: 'hrHolidays', kind: 'master', perm: 'hr', readPerm: STAFF, validate: (d) => (isYMD(d.date) && str(d.name) ? null : 'A holiday needs a date and a name') },
  // leave
  { name: 'leaveTypes', kind: 'master', perm: 'hr', readPerm: STAFF, validate: (d) => (str(d.name) && finite(d.daysPerYear) && d.daysPerYear >= 0 ? null : 'A leave type needs a name and days per year') },
  {
    name: 'leaveRequests', kind: 'ledger', perm: STAFF, readPerm: STAFF, branched: true,
    validate: (d) => (str(d.employeeId) && str(d.typeId) && isYMD(d.from) && isYMD(d.to) && d.to >= d.from && finite(d.days) && d.days > 0 ? null : 'A leave request needs a person, a type, dates and days'),
  },
  { name: 'leaveGrants', kind: 'ledger', perm: 'hr', readPerm: STAFF, branched: true, validate: (d) => (str(d.employeeId) && str(d.typeId) && finite(d.days) && d.days !== 0 && isYMD(d.date) ? null : 'A leave adjustment needs a person, a type, days and a date') },
  // payroll
  {
    name: 'payAdjustments', kind: 'master', perm: PAY, readPerm: PAY, branched: true,
    validate: (d) => (str(d.employeeId) && isYM(d.month) && oneOf(d.kind, ['incentive', 'bonus', 'allowance', 'deduction']) && finite(d.amount) && d.amount > 0 ? null : 'An adjustment needs a person, a month, a kind and an amount'),
  },
  {
    name: 'staffAdvances', kind: 'ledger', perm: PAY, readPerm: PAY, branched: true,
    validate: (d) => (str(d.employeeId) && finite(d.amount) && d.amount > 0 && finite(d.installments) && d.installments >= 1 && isYM(d.startMonth) ? null : 'An advance needs a person, an amount, instalments and a first month'),
  },
  {
    name: 'staffRepayments', kind: 'ledger', perm: PAY, readPerm: PAY, branched: true,
    validate: (d) => (str(d.advanceId) && str(d.employeeId) && finite(d.amount) && d.amount > 0 ? null : 'A repayment needs an advance and an amount'),
  },
  {
    name: 'payslips', kind: 'ledger', perm: PAY, readPerm: PAY, branched: true,
    validate: (d) => (str(d.employeeId) && isYM(d.month) && finite(d.net) && finite(d.gross) && Array.isArray(d.earnings) && Array.isArray(d.deductions) ? null : 'A payslip needs a person, a month, its lines and the net pay'),
  },
  { name: 'payslipVoids', kind: 'ledger', perm: PAY, readPerm: PAY, branched: true, validate: (d) => (str(d.payslipId) ? null : 'A void needs the payslip') },
  {
    name: 'salaryPayouts', kind: 'ledger', perm: PAY, readPerm: PAY, branched: true,
    validate: (d) => (str(d.payslipId) && str(d.employeeId) && finite(d.amount) && d.amount > 0 && oneOf(d.mode, ['cash', 'bank', 'upi']) ? null : 'A payout needs a payslip, an amount and how it was paid'),
  },
  {
    name: 'hrSettings', kind: 'master', perm: PAY, readPerm: PEOPLE,
    validate: (d) => settingsProblem({ ...DEFAULT_HR_SETTINGS, ...(d as unknown as Partial<HrSettings>) }),
  },
  // targets & incentives
  {
    name: 'incentivePlans', kind: 'master', perm: PAY, readPerm: PAY,
    validate: (d) => (str(d.name) && finite(d.baseRatePct) && d.baseRatePct >= 0 && Array.isArray(d.slabs) && finite(d.bonusAtTarget) && d.bonusAtTarget >= 0 ? null : 'A plan needs a name, a rate and slabs'),
  },
  { name: 'hrTargets', kind: 'master', perm: 'hr', readPerm: ['hr', 'payroll'], validate: (d) => (str(d.employeeId) && isYM(d.month) && finite(d.amount) && d.amount >= 0 ? null : 'A target needs a person, a month and an amount') },
  // expense claims
  {
    name: 'expenseClaims', kind: 'ledger', perm: STAFF, readPerm: STAFF, branched: true,
    validate: (d) => (str(d.employeeId) && finite(d.amount) && d.amount > 0 && str(d.category) && isYMD(d.date) ? null : 'A claim needs a person, a date, a category and an amount'),
  },
  {
    name: 'claimPayouts', kind: 'ledger', perm: PAY, readPerm: ['payroll', 'hr'], branched: true,
    validate: (d) => (str(d.claimId) && str(d.employeeId) && finite(d.amount) && d.amount > 0 && oneOf(d.mode, ['cash', 'bank', 'upi']) ? null : 'A reimbursement needs a claim, an amount and how it was paid'),
  },
  // recruitment
  { name: 'hrOpenings', kind: 'master', perm: 'hr', readPerm: 'hr', validate: (d) => (str(d.title) && oneOf(d.status, ['open', 'on_hold', 'closed']) ? null : 'An opening needs a title') },
  {
    name: 'hrCandidates', kind: 'master', perm: 'hr', readPerm: 'hr',
    validate: (d) => (str(d.name) && str(d.openingId) && oneOf(d.stage, ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected']) ? null : 'A candidate needs a name, an opening and a stage'),
  },
)
