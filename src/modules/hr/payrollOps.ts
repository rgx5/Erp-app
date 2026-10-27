import { audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { id } from '@/domain/ids'
import { nextNo } from '../numbering'
import { advanceStandings } from './logic/advances'
import { claimPayoutId, claimRows } from './logic/claims'
import { decisionId, cancelId, statusOf, decisionsByRef } from './logic/decisions'
import { payrollPreview } from './logic/payroll'
import { consumedAdjustmentIds, liveSlipFor, nextRev, paidOf, payoutId, payslipId, livePayslips, voidId, voidedIds } from './logic/slips'
import { incentiveAdjustmentId, scorecards } from './logic/targets'
import { isYM, isYMD, labelYM, ymOf, ymdOf } from './logic/ymd'
import { employeeOrThrow } from './ops'
import type {
  AdjustmentKind, AdvanceKind, ClaimPayout, ExpenseClaim, HrDecision, IncentivePlan, IncentiveSlab, PayAdjustment, Payslip, PayslipVoid, SalaryPayout, StaffAdvance, StaffRepayment, YM, YMD,
} from './types'

const branch = (ctx: OpCtx, e?: { branchId?: string }) => { const b = e?.branchId ?? ctx.branchId; return b ? { branchId: b } : {} }
const r2 = (n: number) => Math.round(n * 100) / 100
const text = (s: string | undefined) => (s ?? '').trim()

// ───────────────────────────── adjustments & incentives ─────────────────────────────

export interface AdjustmentDraft { employeeId: string; month: YM; kind: AdjustmentKind; label: string; amount: number; note: string }

/** An incentive, bonus, allowance or fine for one month's payslip. */
export function saveAdjustment(state: DataState, d: AdjustmentDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; adjustment: PayAdjustment } {
  const emp = employeeOrThrow(state, d.employeeId)
  if (!isYM(d.month)) throw new OpError('Pick the payroll month.')
  if (!(d.amount > 0)) throw new OpError('Enter an amount above zero.')
  if (!text(d.label)) throw new OpError('Say what it is for (Diwali bonus, late fine…).')
  if (!['incentive', 'bonus', 'allowance', 'deduction'].includes(d.kind)) throw new OpError('Choose what kind of adjustment this is.')
  const slip = liveSlipFor(state, d.employeeId, d.month)
  if (slip) throw new OpError(`${emp.name}’s ${labelYM(d.month)} salary has already been run (${slip.no}). Add it to next month instead.`)
  const prev = existingId ? state.payAdjustments?.[existingId] : undefined
  if (existingId) {
    if (!prev) throw new OpError('That adjustment no longer exists.')
    if (consumedAdjustmentIds(state).has(existingId)) throw new OpError('A payslip already includes this adjustment.')
  }
  const adjustment: PayAdjustment = {
    id: existingId ?? id('adj', ctx.now), employeeId: d.employeeId, month: d.month, kind: d.kind, label: text(d.label), amount: r2(d.amount), source: prev?.source ?? 'manual', note: text(d.note),
    createdBy: prev?.createdBy ?? ctx.userId, createdAt: prev?.createdAt ?? ctx.now, ...branch(ctx, emp),
  }
  return { adjustment, changes: { put: { payAdjustments: [adjustment], audit: [audit(ctx, 'PAY_ADJUST', `${emp.code} ${d.month} ${d.kind} ₹${adjustment.amount}`)] } } }
}

export function deleteAdjustment(state: DataState, adjustmentId: string, ctx: OpCtx): { changes: Changes } {
  const a = state.payAdjustments?.[adjustmentId]
  if (!a) throw new OpError('That adjustment no longer exists.')
  if (consumedAdjustmentIds(state).has(adjustmentId)) throw new OpError('A payslip already includes this. Void the payslip first.')
  return { changes: { del: { payAdjustments: [adjustmentId] }, put: { audit: [audit(ctx, 'PAY_ADJUST_DELETE', `${a.label} ₹${a.amount}`)] } } }
}

export interface PlanDraft { name: string; employeeId?: string; baseRatePct: number; slabs: IncentiveSlab[]; bonusAtTarget: number; minSales: number; cap: number; active: boolean }

export function saveIncentivePlan(state: DataState, d: PlanDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; plan: IncentivePlan } {
  if (!text(d.name)) throw new OpError('Name the plan.')
  if (!(d.baseRatePct >= 0 && d.baseRatePct <= 100)) throw new OpError('The rate is a percentage from 0 to 100.')
  if (d.slabs.some((s) => !(s.minAchievementPct > 0) || !(s.ratePct >= 0 && s.ratePct <= 100))) throw new OpError('Each slab needs an achievement % above 0 and a rate from 0 to 100.')
  if (![d.bonusAtTarget, d.minSales, d.cap].every((n) => n >= 0)) throw new OpError('Bonus, minimum sales and cap cannot be negative.')
  if (d.employeeId) employeeOrThrow(state, d.employeeId)
  if (existingId && !state.incentivePlans?.[existingId]) throw new OpError('That plan no longer exists.')
  const plan: IncentivePlan = { ...d, id: existingId ?? id('inp', ctx.now), name: text(d.name), employeeId: d.employeeId || undefined, slabs: [...d.slabs].sort((a, b) => a.minAchievementPct - b.minAchievementPct) }
  return { plan, changes: { put: { incentivePlans: [plan], audit: [audit(ctx, 'INCENTIVE_PLAN', plan.name)] } } }
}

export function deleteIncentivePlan(state: DataState, planId: string, ctx: OpCtx): { changes: Changes } {
  const p = state.incentivePlans?.[planId]
  if (!p) throw new OpError('That plan no longer exists.')
  return { changes: { del: { incentivePlans: [planId] }, put: { audit: [audit(ctx, 'INCENTIVE_PLAN_DELETE', p.name)] } } }
}

/** Turns the incentives the scorecards worked out for a month into adjustments, so the month's payroll pays them. Once per person per month. */
export function postIncentives(state: DataState, month: YM, ctx: OpCtx): { changes: Changes; posted: number; total: number } {
  if (!isYM(month)) throw new OpError('Pick the month.')
  const adjustments: PayAdjustment[] = []
  for (const row of scorecards(state, month, ctx.now)) {
    if (row.posted || !(row.incentive.amount > 0)) continue
    if (liveSlipFor(state, row.employee.id, month)) continue
    adjustments.push({
      id: incentiveAdjustmentId(row.employee.id, month), employeeId: row.employee.id, month, kind: 'incentive', label: `Sales incentive ${labelYM(month)}`, amount: row.incentive.amount,
      source: `target:${month}`, note: `Sales ₹${row.sales}${row.target ? ` of target ₹${row.target}` : ''}`, createdBy: ctx.userId, createdAt: ctx.now, ...branch(ctx, row.employee),
    })
  }
  if (!adjustments.length) throw new OpError('There are no new incentives to add for this month.')
  const total = r2(adjustments.reduce((s, a) => s + a.amount, 0))
  return { posted: adjustments.length, total, changes: { put: { payAdjustments: adjustments, audit: [audit(ctx, 'INCENTIVE_POST', `${month} · ${adjustments.length} people · ₹${total}`)] } } }
}

// ───────────────────────────── the monthly run ─────────────────────────────

/** Creates the payslips of a month for everyone who can be run (or just the people given). The run is final until a payslip is voided. */
export function runPayroll(state: DataState, month: YM, employeeIds: string[] | undefined, ctx: OpCtx): { changes: Changes; payslips: Payslip[]; skipped: Array<{ name: string; why: string }> } {
  if (!isYM(month)) throw new OpError('Pick the payroll month.')
  if (month > ymOf(ctx.now)) throw new OpError('That month has not started yet.')
  const rows = payrollPreview(state, month, ctx.now).filter((r) => !r.existing && (!employeeIds || employeeIds.includes(r.employee.id)))
  const skipped = rows.filter((r) => !r.result || r.problem).map((r) => ({ name: r.employee.name, why: r.problem ?? 'Cannot be run.' }))
  const todo = rows.filter((r) => r.result && !r.problem)
  if (!todo.length) throw new OpError(skipped.length ? `Nobody can be run: ${skipped[0].name} — ${skipped[0].why}` : `Salary for ${labelYM(month)} has already been run.`)
  const used = listOf(state.payslips ?? {}).map((p) => p.no)
  const payslips: Payslip[] = []
  for (const r of todo) {
    const x = r.result!
    const rev = nextRev(state, r.employee.id, month)
    const no = nextNo(`PS-${month}-`, [...used, ...payslips.map((p) => p.no)], ctx)
    payslips.push({
      id: payslipId(month, r.employee.id, rev), no, employeeId: r.employee.id, employeeCode: r.employee.code, employeeName: r.employee.name, designation: r.employee.designation, month, rev,
      payType: r.pay!.payType, basisDays: x.basisDays, daysInMonth: x.daysInMonth, presentDays: x.presentDays, paidLeaveDays: x.paidLeaveDays, holidayDays: x.holidayDays, weekoffDays: x.weekoffDays,
      lopDays: x.lopDays, overtimeHours: x.overtimeHours, earnings: x.earnings, deductions: x.deductions, employerPf: x.employerPf, employerEsi: x.employerEsi, gross: x.gross,
      totalDeductions: x.totalDeductions, roundOff: x.roundOff, net: x.net, recoveries: x.recoveries.map((c) => ({ advanceId: c.advanceId, amount: c.amount })), adjustmentIds: x.adjustmentIds,
      createdBy: ctx.userId, createdAt: ctx.now, ...branch(ctx, r.employee),
    })
  }
  const net = r2(payslips.reduce((s, p) => s + p.net, 0))
  return { payslips, skipped, changes: { put: { payslips, audit: [audit(ctx, 'PAYROLL_RUN', `${month} · ${payslips.length} payslips · net ₹${net}`)] } } }
}

/** Cancels a payslip so it can be run again (a wrong attendance mark, a missed adjustment). Not possible once the salary has been paid. */
export function voidPayslip(state: DataState, slipId: string, reason: string, ctx: OpCtx): { changes: Changes; void: PayslipVoid } {
  const slip = state.payslips?.[slipId]
  if (!slip) throw new OpError('That payslip no longer exists.')
  if (voidedIds(state).has(slipId)) throw new OpError('That payslip has already been voided.')
  if (!text(reason)) throw new OpError('Say why the payslip is being voided.')
  if (paidOf(state, slipId) > 0) throw new OpError('The salary has been paid. Put a correction in next month’s pay instead.')
  const v: PayslipVoid = { id: voidId(slipId), payslipId: slipId, reason: text(reason), userId: ctx.userId, at: ctx.now, ...branch(ctx, slip) }
  return { void: v, changes: { put: { payslipVoids: [v], audit: [audit(ctx, 'PAYSLIP_VOID', `${slip.no} ${slip.employeeName} · ${text(reason)}`)] } } }
}

export interface PayDraftOut { mode: SalaryPayout['mode']; ref?: string; date?: number }

function payoutFor(state: DataState, slipId: string, d: PayDraftOut, ctx: OpCtx): SalaryPayout {
  const slip = state.payslips?.[slipId]
  if (!slip || voidedIds(state).has(slipId)) throw new OpError('That payslip is not available.')
  if (!(slip.net > 0)) throw new OpError(`${slip.employeeName} has nothing to be paid this month.`)
  if (state.salaryPayouts?.[payoutId(slipId)]) throw new OpError(`${slip.employeeName}’s salary is already marked paid.`)
  if (!['cash', 'bank', 'upi'].includes(d.mode)) throw new OpError('Choose how the salary was paid.')
  return { id: payoutId(slipId), payslipId: slipId, employeeId: slip.employeeId, month: slip.month, amount: slip.net, mode: d.mode, ref: text(d.ref), date: d.date ?? ctx.now, userId: ctx.userId, ...branch(ctx, slip) }
}

/** Marks one person's salary as paid. */
export function paySalary(state: DataState, slipId: string, d: PayDraftOut, ctx: OpCtx): { changes: Changes; payout: SalaryPayout } {
  const payout = payoutFor(state, slipId, d, ctx)
  return { payout, changes: { put: { salaryPayouts: [payout], audit: [audit(ctx, 'SALARY_PAID', `${state.payslips[slipId].employeeName} ${payout.month} ₹${payout.amount}`)] } } }
}

/** Marks every unpaid payslip of a month as paid in one go (after the bank transfer file was uploaded). */
export function paySalaries(state: DataState, month: YM, d: PayDraftOut, ctx: OpCtx): { changes: Changes; payouts: SalaryPayout[] } {
  const payouts = livePayslips(state).filter((p) => p.month === month && p.net > 0 && !state.salaryPayouts?.[payoutId(p.id)]).map((p) => payoutFor(state, p.id, d, ctx))
  if (!payouts.length) throw new OpError(`Everyone’s ${labelYM(month)} salary is already paid.`)
  const total = r2(payouts.reduce((s, p) => s + p.amount, 0))
  return { payouts, changes: { put: { salaryPayouts: payouts, audit: [audit(ctx, 'SALARY_PAID_ALL', `${month} · ${payouts.length} people · ₹${total}`)] } } }
}

// ───────────────────────────── advances & loans ─────────────────────────────

export interface AdvanceDraft { employeeId: string; kind: AdvanceKind; amount: number; mode: StaffAdvance['mode']; ref?: string; installments: number; startMonth: YM; note?: string; date?: number }

export function issueAdvance(state: DataState, d: AdvanceDraft, ctx: OpCtx): { changes: Changes; advance: StaffAdvance } {
  const emp = employeeOrThrow(state, d.employeeId)
  if (!emp.active) throw new OpError(`${emp.name} has left; an advance cannot be given.`)
  if (!(d.amount > 0)) throw new OpError('Enter the amount.')
  if (!Number.isInteger(d.installments) || d.installments < 1 || d.installments > 60) throw new OpError('Instalments are whole months, from 1 to 60.')
  if (!isYM(d.startMonth)) throw new OpError('Pick the month recovery starts.')
  if (!['cash', 'bank', 'upi'].includes(d.mode)) throw new OpError('Choose how the money was given.')
  const advance: StaffAdvance = {
    id: id('adv', ctx.now), no: nextNo('ADV-', listOf(state.staffAdvances ?? {}).map((a) => a.no), ctx), employeeId: d.employeeId, kind: d.kind, amount: r2(d.amount), date: d.date ?? ctx.now,
    mode: d.mode, ref: text(d.ref), installments: d.kind === 'advance' ? d.installments : d.installments, startMonth: d.startMonth, note: text(d.note), userId: ctx.userId, ...branch(ctx, emp),
  }
  return { advance, changes: { put: { staffAdvances: [advance], audit: [audit(ctx, d.kind === 'loan' ? 'LOAN_GIVEN' : 'ADVANCE_GIVEN', `${advance.no} ${emp.code} ₹${advance.amount}`)] } } }
}

function standingOrThrow(state: DataState, advanceId: string) {
  const s = advanceStandings(state).find((x) => x.advance.id === advanceId)
  if (!s) throw new OpError('That advance no longer exists.')
  return s
}

/** Money handed back by hand, outside payroll. */
export function repayAdvance(state: DataState, advanceId: string, d: { amount: number; mode: 'cash' | 'bank' | 'upi'; note?: string }, ctx: OpCtx): { changes: Changes; repayment: StaffRepayment } {
  const st = standingOrThrow(state, advanceId)
  if (!(d.amount > 0)) throw new OpError('Enter the amount paid back.')
  if (d.amount > st.balance + 0.005) throw new OpError(`Only ₹${st.balance} is still to come back.`)
  const repayment: StaffRepayment = { id: id('rpy', ctx.now), advanceId, employeeId: st.advance.employeeId, amount: r2(d.amount), mode: d.mode, date: ctx.now, note: text(d.note), userId: ctx.userId, ...branch(ctx, st.advance) }
  return { repayment, changes: { put: { staffRepayments: [repayment], audit: [audit(ctx, 'ADVANCE_REPAID', `${st.advance.no} ₹${repayment.amount}`)] } } }
}

/** Forgives what is left of an advance (it becomes an expense). */
export function writeOffAdvance(state: DataState, advanceId: string, note: string, ctx: OpCtx): { changes: Changes; repayment: StaffRepayment } {
  const st = standingOrThrow(state, advanceId)
  if (!(st.balance > 0)) throw new OpError('Nothing is left to write off.')
  const repayment: StaffRepayment = { id: id('rpy', ctx.now), advanceId, employeeId: st.advance.employeeId, amount: st.balance, mode: 'writeoff', date: ctx.now, note: text(note), userId: ctx.userId, ...branch(ctx, st.advance) }
  return { repayment, changes: { put: { staffRepayments: [repayment], audit: [audit(ctx, 'ADVANCE_WRITEOFF', `${st.advance.no} ₹${st.balance}`)] } } }
}

// ───────────────────────────── expense claims ─────────────────────────────

export interface ClaimDraft { employeeId: string; date: YMD; category: string; amount: number; description: string; ref?: string }

export function submitClaim(state: DataState, d: ClaimDraft, ctx: OpCtx): { changes: Changes; claim: ExpenseClaim } {
  const emp = employeeOrThrow(state, d.employeeId)
  if (!isYMD(d.date) || d.date > ymdOf(ctx.now)) throw new OpError('Enter the date of the expense (not in the future).')
  if (!text(d.category)) throw new OpError('Choose what kind of expense it was.')
  if (!(d.amount > 0)) throw new OpError('Enter the amount.')
  if (!text(d.description)) throw new OpError('Say what it was for.')
  const claim: ExpenseClaim = {
    id: id('clm', ctx.now), no: nextNo('EC-', listOf(state.expenseClaims ?? {}).map((c) => c.no), ctx), employeeId: d.employeeId, date: d.date, category: text(d.category), amount: r2(d.amount),
    description: text(d.description), ref: text(d.ref), submittedAt: ctx.now, submittedBy: ctx.userId, ...branch(ctx, emp),
  }
  return { claim, changes: { put: { expenseClaims: [claim], audit: [audit(ctx, 'CLAIM_SUBMIT', `${claim.no} ${emp.code} ₹${claim.amount}`)] } } }
}

export function decideClaim(state: DataState, claimId: string, outcome: 'approved' | 'rejected', amount: number | undefined, note: string, ctx: OpCtx): { changes: Changes; decision: HrDecision } {
  const claim = state.expenseClaims?.[claimId]
  if (!claim) throw new OpError('That claim no longer exists.')
  if (statusOf(decisionsByRef(state).get(claimId)) !== 'pending') throw new OpError('That claim has already been answered.')
  const approved = amount ?? claim.amount
  if (outcome === 'approved' && !(approved > 0 && approved <= claim.amount + 0.005)) throw new OpError(`Approve an amount from ₹1 to ₹${claim.amount}.`)
  if (outcome === 'rejected' && !text(note)) throw new OpError('Say why the claim is rejected.')
  const decision: HrDecision = {
    id: decisionId(claimId), kind: 'claim', refId: claimId, decision: outcome, ...(outcome === 'approved' ? { amount: r2(approved) } : {}), note: text(note), decidedBy: ctx.userId, at: ctx.now, ...branch(ctx, claim),
  }
  return { decision, changes: { put: { hrDecisions: [decision], audit: [audit(ctx, outcome === 'approved' ? 'CLAIM_APPROVED' : 'CLAIM_REJECTED', claim.no)] } } }
}

/** Withdraws a claim that has not been reimbursed. */
export function cancelClaim(state: DataState, claimId: string, ctx: OpCtx): { changes: Changes; decision: HrDecision } {
  const claim = state.expenseClaims?.[claimId]
  if (!claim) throw new OpError('That claim no longer exists.')
  const row = claimRows(state).find((r) => r.claim.id === claimId)
  if (!row || (row.status !== 'pending' && row.status !== 'approved')) throw new OpError(`A claim that is ${row?.status ?? 'unknown'} cannot be cancelled.`)
  const decision: HrDecision = { id: cancelId(claimId), kind: 'claim', refId: claimId, decision: 'cancelled', note: '', decidedBy: ctx.userId, at: ctx.now, ...branch(ctx, claim) }
  return { decision, changes: { put: { hrDecisions: [decision], audit: [audit(ctx, 'CLAIM_CANCELLED', claim.no)] } } }
}

/** Pays an approved claim back to the employee. */
export function reimburseClaim(state: DataState, claimId: string, d: { mode: 'cash' | 'bank' | 'upi'; ref?: string }, ctx: OpCtx): { changes: Changes; payout: ClaimPayout } {
  const row = claimRows(state).find((r) => r.claim.id === claimId)
  if (!row) throw new OpError('That claim no longer exists.')
  if (row.status !== 'approved') throw new OpError(row.status === 'paid' ? 'That claim has already been reimbursed.' : 'Only an approved claim can be reimbursed.')
  if (!['cash', 'bank', 'upi'].includes(d.mode)) throw new OpError('Choose how it was paid.')
  const payout: ClaimPayout = {
    id: claimPayoutId(claimId), claimId, employeeId: row.claim.employeeId, amount: row.approved, category: row.claim.category, mode: d.mode, ref: text(d.ref), date: ctx.now, userId: ctx.userId, ...branch(ctx, row.claim),
  }
  return { payout, changes: { put: { claimPayouts: [payout], audit: [audit(ctx, 'CLAIM_REIMBURSED', `${row.claim.no} ₹${payout.amount}`)] } } }
}

