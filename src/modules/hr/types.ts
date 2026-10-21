/**
 * People & payroll — the documents. Dates are typed text (`YYYY-MM-DD`, months `YYYY-MM`) so a payroll month never shifts with a
 * time zone; moments (a punch) are milliseconds. Anything with a number that other things add up is a *ledger* document
 * (punches, payslips, payouts, advances, claims): created once, fixed by a new document that reverses it.
 *
 * Who sees what (permissions are registered in replication.ts):
 *   hr       owner + manager   the employee master, shifts, leave decisions, recruitment
 *   payroll  owner + manager   pay terms, bank details, payslips, advances, payouts
 *   hrSelf   everyone on staff punch in/out, ask for leave, submit a claim
 */

export type YMD = string
export type YM = string

export type PayType = 'monthly' | 'daily' | 'hourly'

export interface EmergencyContact { name: string; phone: string; relation: string }

export interface Employee {
  id: string
  /** EMP-0001 */
  code: string
  name: string
  phone: string
  email: string
  /** The sign-in account this person uses, if any. Bills carry that user as the salesperson, which is how targets find them. */
  userId?: string
  /** Job title: "Salesman", "Tailor", "Store manager". */
  designation: string
  department: string
  joinDate: YMD
  exitDate?: YMD
  active: boolean
  dob?: YMD
  gender?: 'female' | 'male' | 'other'
  address: string
  emergency: EmergencyContact
  /** The usual shift. */
  shiftId?: string
  /** Weekly off days, 0 = Sunday … 6 = Saturday. */
  weeklyOff: number[]
  /** First-week checklist carried over when a candidate is hired. */
  onboarding?: Array<{ label: string; done: boolean }>
  notes: string
  branchId?: string
  createdAt: number
}

export interface PayAllowance { name: string; amount: number }

export interface BankDetails { holder: string; bankName: string; account: string; ifsc: string; upi: string }

/** How a person is paid. One per employee (the id is the employee's id); only people with the payroll permission can read it. */
export interface EmployeePay {
  id: string
  employeeId: string
  payType: PayType
  /** Monthly: the monthly basic. Daily: the day rate. Hourly: the hour rate. */
  basic: number
  /** Monthly: per month. Daily: per day worked. Hourly: per hour. */
  allowances: PayAllowance[]
  pf: boolean
  esi: boolean
  pt: boolean
  tds: boolean
  /** A fixed monthly TDS the accountant has worked out; leave empty to use the estimate. */
  tdsMonthly?: number
  overtimeEligible: boolean
  bank: BankDetails
  pan: string
  uan: string
  esiNo: string
  notes: string
  branchId?: string
}

export type DocKind = 'aadhaar' | 'pan' | 'passport' | 'licence' | 'offer' | 'contract' | 'certificate' | 'other'

export interface EmployeeDoc {
  id: string
  employeeId: string
  kind: DocKind
  title: string
  number: string
  issuedOn?: YMD
  expiresOn?: YMD
  note: string
  createdAt: number
  branchId?: string
}

// ───────────────────────────── attendance ─────────────────────────────

/** One punch, never edited. The day's status is worked out from the punches (and any manual mark over them). */
export interface Punch {
  id: string
  employeeId: string
  at: number
  /** The day the punch belongs to (a night shift's punch-out after midnight belongs to the day it started). */
  date: YMD
  kind: 'in' | 'out'
  /** Where, in words ("Main shop", "Delivery at Mehta Traders") or typed coordinates. No location permission is needed. */
  geo: string
  note: string
  source: 'self' | 'manager'
  userId: string
  branchId?: string
}

export type MarkStatus = 'present' | 'half' | 'absent'

/** A manager's mark for one day. It overrides the punches. The id is `${employeeId}_${date}`. */
export interface AttendanceMark {
  id: string
  employeeId: string
  date: YMD
  status: MarkStatus
  inAt?: number
  outAt?: number
  reason: string
  markedBy: string
  markedAt: number
  branchId?: string
}

/** A request to fix a day (forgot to punch). Approving it writes the mark. */
export interface Regularisation {
  id: string
  employeeId: string
  date: YMD
  inAt?: number
  outAt?: number
  reason: string
  requestedAt: number
  requestedBy: string
  branchId?: string
}

export type DecisionKind = 'leave' | 'claim' | 'regularisation'
export type DecisionOutcome = 'approved' | 'rejected' | 'cancelled'

/** A manager's answer to a request. The first answer to a request stands; cancelling an approved one is a second document. */
export interface HrDecision {
  id: string
  kind: DecisionKind
  refId: string
  decision: DecisionOutcome
  /** Claims: the amount approved (never more than claimed). */
  amount?: number
  note: string
  decidedBy: string
  at: number
  branchId?: string
}

// ───────────────────────────── shifts, roster, holidays ─────────────────────────────

export interface WorkShift {
  id: string
  name: string
  /** HH:MM, 24-hour. A shift that ends before it starts runs past midnight. */
  start: string
  end: string
  breakMins: number
  /** Minutes a person may be late before they are marked late (and short of a full day). */
  graceMins: number
  active: boolean
}

/** One person's shift on one day (`shiftId` null = a day off). The id is `${employeeId}_${date}`. */
export interface RosterEntry {
  id: string
  employeeId: string
  date: YMD
  shiftId: string | null
  branchId?: string
}

export interface Holiday { id: string; date: YMD; name: string }

// ───────────────────────────── leave ─────────────────────────────

export interface LeaveType {
  id: string
  name: string
  code: string
  /** Days credited in a leave year (ignored for unpaid leave). */
  daysPerYear: number
  accrual: 'monthly' | 'yearly'
  /** The most that rolls over to the next year. */
  carryForwardMax: number
  paid: boolean
  /** A request may take the balance below zero (the manager decides what the shortfall means for pay). */
  allowNegative: boolean
  active: boolean
}

export interface LeaveRequest {
  id: string
  /** LV-0001 */
  no: string
  employeeId: string
  typeId: string
  from: YMD
  to: YMD
  /** A single day can be half a day. */
  half?: 'first' | 'second'
  /** Working days it takes (weekly offs and holidays inside the dates are not counted). */
  days: number
  reason: string
  requestedAt: number
  requestedBy: string
  branchId?: string
}

/** Days added to (or taken off) a balance by hand: an opening balance, a comp-off, a correction. */
export interface LeaveGrant {
  id: string
  employeeId: string
  typeId: string
  days: number
  date: YMD
  reason: string
  userId: string
  branchId?: string
}

// ───────────────────────────── payroll ─────────────────────────────

export type AdjustmentKind = 'incentive' | 'bonus' | 'allowance' | 'deduction'

/** A one-off amount for one month's payslip: an incentive, a bonus, a fine. Used once, by the payslip that includes it. */
export interface PayAdjustment {
  id: string
  employeeId: string
  month: YM
  kind: AdjustmentKind
  label: string
  amount: number
  /** Where it came from: 'target:2026-10' for an incentive the targets screen worked out. */
  source: string
  note: string
  createdBy: string
  createdAt: number
  branchId?: string
}

export type AdvanceKind = 'advance' | 'loan'

/** Money given to an employee to be taken back from the salary (an advance in one go, or a loan in instalments). */
export interface StaffAdvance {
  id: string
  /** ADV-0001 */
  no: string
  employeeId: string
  kind: AdvanceKind
  amount: number
  date: number
  mode: 'cash' | 'bank' | 'upi'
  ref: string
  /** Months to recover it over. */
  installments: number
  /** Recovered each month from this month on. */
  startMonth: YM
  note: string
  userId: string
  branchId?: string
}

/** Money paid back outside payroll (cash handed over), or a balance written off. */
export interface StaffRepayment {
  id: string
  advanceId: string
  employeeId: string
  amount: number
  mode: 'cash' | 'bank' | 'upi' | 'writeoff'
  date: number
  note: string
  userId: string
  branchId?: string
}

export interface SlipLine { key: string; label: string; amount: number; /** The full-month amount before loss of pay. */ full?: number }

/** A month's salary for one person. Never edited: a mistake is voided and run again. The id is `ps_${month}_${employeeId}_${rev}`. */
export interface Payslip {
  id: string
  /** PS-2026-10-0001 */
  no: string
  employeeId: string
  employeeCode: string
  employeeName: string
  designation: string
  month: YM
  rev: number
  payType: PayType
  /** Calendar days (or 30 on a fixed-30 month) the pay is spread over. */
  basisDays: number
  daysInMonth: number
  presentDays: number
  paidLeaveDays: number
  holidayDays: number
  weekoffDays: number
  lopDays: number
  overtimeHours: number
  earnings: SlipLine[]
  deductions: SlipLine[]
  employerPf: number
  employerEsi: number
  gross: number
  totalDeductions: number
  roundOff: number
  net: number
  /** Advances and loans recovered in this payslip. */
  recoveries: Array<{ advanceId: string; amount: number }>
  adjustmentIds: string[]
  createdBy: string
  createdAt: number
  branchId?: string
}

export interface PayslipVoid { id: string; payslipId: string; reason: string; userId: string; at: number; branchId?: string }

/** The net salary paid out (one per payslip). */
export interface SalaryPayout {
  id: string
  payslipId: string
  employeeId: string
  month: YM
  amount: number
  mode: 'cash' | 'bank' | 'upi'
  ref: string
  date: number
  userId: string
  branchId?: string
}

// ───────────────────────────── targets & incentives ─────────────────────────────

/** One person's sales target for a month. The id is `${employeeId}_${month}`. */
export interface HrTarget { id: string; employeeId: string; month: YM; amount: number }

export interface IncentiveSlab { minAchievementPct: number; ratePct: number }

/** How sales turn into an incentive: a rate on sales, a better rate at higher achievement, and a bonus for hitting target. */
export interface IncentivePlan {
  id: string
  name: string
  /** One person's own plan beats the plan for everyone. */
  employeeId?: string
  /** % of sales (excluding GST) earned before any slab. */
  baseRatePct: number
  slabs: IncentiveSlab[]
  /** Paid in full when the target is met. */
  bonusAtTarget: number
  /** Sales below this earn nothing. */
  minSales: number
  /** The most the plan pays in a month; 0 = no cap. */
  cap: number
  active: boolean
}

// ───────────────────────────── expense claims ─────────────────────────────

export interface ExpenseClaim {
  id: string
  /** EC-0001 */
  no: string
  employeeId: string
  date: YMD
  /** An expense category of the Expenses screen ("Travel", "Food"). */
  category: string
  amount: number
  description: string
  /** Bill number, UPI reference… */
  ref: string
  submittedAt: number
  submittedBy: string
  branchId?: string
}

/** The reimbursement of an approved claim (one per claim). */
export interface ClaimPayout {
  id: string
  claimId: string
  employeeId: string
  amount: number
  category: string
  mode: 'cash' | 'bank' | 'upi'
  ref: string
  date: number
  userId: string
  branchId?: string
}

// ───────────────────────────── recruitment ─────────────────────────────

export type OpeningStatus = 'open' | 'on_hold' | 'closed'

export interface Opening {
  id: string
  title: string
  department: string
  positions: number
  location: string
  payRange: string
  description: string
  status: OpeningStatus
  openedOn: YMD
  closedOn?: YMD
}

export type CandidateStage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'

export interface Interview { at: number; with: string; mode: 'in person' | 'phone' | 'video'; note: string; rating?: number }

export interface Candidate {
  id: string
  openingId: string
  name: string
  phone: string
  email: string
  source: string
  stage: CandidateStage
  expectedPay: number
  offeredPay: number
  notes: string
  interviews: Interview[]
  /** The employee created when the candidate was hired. */
  employeeId?: string
  appliedOn: YMD
  updatedAt: number
}

// ───────────────────────────── settings ─────────────────────────────

export interface PtSlab { /** Up to and including this monthly gross; null = no upper limit. */ upTo: number | null; amount: number }
export interface TdsSlab { upTo: number | null; ratePct: number }

/** Statutory rates and company rules. Defaults only — a shopkeeper's accountant confirms the current rates for their state. */
export interface HrSettings {
  id: 'hr'
  pfEmployeePct: number
  pfEmployerPct: number
  /** PF is worked out on at most this much a month when `pfCap` is on. */
  pfWageCeiling: number
  pfCap: boolean
  /** Which earnings PF is worked out on. */
  pfBasis: 'basic' | 'basic+allowances'
  esiEmployeePct: number
  esiEmployerPct: number
  /** ESI applies while the contractual monthly wage is at or below this. */
  esiWageCeiling: number
  ptSlabs: PtSlab[]
  tdsSlabs: TdsSlab[]
  tdsStandardDeduction: number
  /** Tax is nil while taxable income is at or below this (the 87A rebate limit). */
  tdsRebateLimit: number
  tdsCessPct: number
  /** Monthly pay is spread over the calendar days of the month, or always over 30. */
  daysBasis: 'calendar' | 'fixed30'
  /** Daily-wage staff are also paid for their weekly off. */
  payWeekoffForDaily: boolean
  overtimeMultiplier: number
  /** Overtime shorter than this is ignored. */
  overtimeMinMins: number
  /** Minutes in a normal working day when a person has no shift. */
  workDayMins: number
  roundNet: boolean
  /** First month of the leave year: 1 = January, 4 = April. */
  leaveYearStartMonth: number
  /** Weekly off for new employees. */
  weeklyOffDefault: number[]
  /** A hint shown at punch-in ("Within 100 m of the shop"); punching can require a place note. */
  geoNote: string
  requireGeoNote: boolean
  /** Day of the month salary is due; used for the reminder on Home. */
  payDay: number
}

declare module '@/data/state' {
  interface CollMap {
    employees: Employee
    employeeDocs: EmployeeDoc
    employeePay: EmployeePay
    punches: Punch
    attendance: AttendanceMark
    regularisations: Regularisation
    hrDecisions: HrDecision
    workShifts: WorkShift
    rosters: RosterEntry
    hrHolidays: Holiday
    leaveTypes: LeaveType
    leaveRequests: LeaveRequest
    leaveGrants: LeaveGrant
    payAdjustments: PayAdjustment
    staffAdvances: StaffAdvance
    staffRepayments: StaffRepayment
    payslips: Payslip
    payslipVoids: PayslipVoid
    salaryPayouts: SalaryPayout
    hrSettings: HrSettings
    incentivePlans: IncentivePlan
    hrTargets: HrTarget
    expenseClaims: ExpenseClaim
    claimPayouts: ClaimPayout
    hrOpenings: Opening
    hrCandidates: Candidate
  }
}
