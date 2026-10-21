import { listOf, type DataState } from '@/data/state'
import { isCreditNote } from '@/domain/receipt'
import type { Employee, IncentivePlan, YM } from '../types'
import { buildIndex, employeeMonth, employedIn } from './select'
import { firstOf, lastOf, monthBounds } from './ymd'

const r2 = (n: number) => Math.round(n * 100) / 100

export interface StaffSales { sales: number; bills: number; pieces: number }

/**
 * What each signed-in user sold in a period, from the bills alone: an item counts for whoever sold it (its `soldBy`, else the
 * bill's salesperson, else the cashier); sales are the value without GST and returns subtract.
 */
export function salesByUser(state: DataState, from: number, to: number): Map<string, StaffSales> {
  const out = new Map<string, StaffSales & { ids: Set<string> }>()
  for (const b of listOf(state.bills)) {
    if (b.status === 'held' || b.date < from || b.date > to) continue
    const sign = isCreditNote(b) ? -1 : 1
    for (const i of b.items) {
      const uid = i.soldBy ?? b.soldBy ?? b.cashierId
      const row = out.get(uid) ?? { sales: 0, bills: 0, pieces: 0, ids: new Set<string>() }
      row.sales += i.taxable * sign
      row.pieces += i.qty * sign
      if (sign > 0) row.ids.add(b.id)
      out.set(uid, row)
    }
  }
  return new Map([...out].map(([k, v]) => [k, { sales: r2(v.sales), bills: v.ids.size, pieces: Math.round(v.pieces * 1000) / 1000 }]))
}

export const targetId = (employeeId: string, month: YM) => `${employeeId}_${month}`
export const incentiveAdjustmentId = (employeeId: string, month: YM) => `adj_inc_${month}_${employeeId}`

/** The month's target for a person: the one set here, else the one the sales module holds for their sign-in user. */
export function targetFor(state: DataState, employee: Pick<Employee, 'id' | 'userId'>, month: YM): number {
  const own = state.hrTargets?.[targetId(employee.id, month)]
  if (own) return own.amount
  const salesTargets = (state as unknown as { salesTargets?: Record<string, { staffId: string; month: string; amount: number }> }).salesTargets
  if (!salesTargets || !employee.userId) return 0
  return r2(Object.values(salesTargets).filter((t) => t.staffId === employee.userId && t.month === month).reduce((s, t) => s + t.amount, 0))
}

/** A person's own plan beats the plan for everyone. */
export function planFor(plans: IncentivePlan[], employeeId: string): IncentivePlan | undefined {
  const live = plans.filter((p) => p.active)
  return live.find((p) => p.employeeId === employeeId) ?? live.find((p) => !p.employeeId)
}

export interface IncentiveResult { ratePct: number; commission: number; bonus: number; amount: number; capped: boolean }

export function incentiveFor(plan: IncentivePlan, sales: number, target: number): IncentiveResult {
  const zero = { ratePct: 0, commission: 0, bonus: 0, amount: 0, capped: false }
  if (!(sales > 0) || sales < plan.minSales) return zero
  const achievement = target > 0 ? (sales / target) * 100 : null
  let ratePct = plan.baseRatePct
  if (achievement !== null) for (const s of [...plan.slabs].sort((a, b) => a.minAchievementPct - b.minAchievementPct)) if (achievement >= s.minAchievementPct) ratePct = s.ratePct
  const commission = r2((sales * ratePct) / 100)
  const bonus = target > 0 && sales >= target ? plan.bonusAtTarget : 0
  let amount = r2(commission + bonus)
  let capped = false
  if (plan.cap > 0 && amount > plan.cap) { amount = plan.cap; capped = true }
  return { ratePct, commission, bonus, amount, capped }
}

export interface ScorecardRow {
  employee: Employee
  sales: number
  bills: number
  pieces: number
  target: number
  achievementPct: number | null
  plan?: IncentivePlan
  incentive: IncentiveResult
  /** The incentive is already in a payroll adjustment for the month. */
  posted: boolean
  /** Days worked (or on paid leave) out of the days they were expected. */
  attendancePct: number | null
  lateCount: number
}

/** Targets, sales, incentive and attendance of everyone employed in a month. */
export function scorecards(state: DataState, month: YM, now: number): ScorecardRow[] {
  const [from, to] = monthBounds(month)
  const sales = salesByUser(state, from, to)
  const plans = listOf(state.incentivePlans ?? {})
  const idx = buildIndex(state)
  return employedIn(state, firstOf(month), lastOf(month)).map((employee) => {
    const mine = employee.userId ? sales.get(employee.userId) : undefined
    const total = mine?.sales ?? 0
    const target = targetFor(state, employee, month)
    const plan = planFor(plans, employee.id)
    const { summary } = employeeMonth(state, idx, employee, month, now)
    const expected = summary.employedDays - summary.holidayDays - summary.weekoffDays - summary.futureDays
    const attended = summary.presentDays + summary.paidLeaveDays
    return {
      employee, sales: total, bills: mine?.bills ?? 0, pieces: mine?.pieces ?? 0, target,
      achievementPct: target > 0 ? r2((total / target) * 100) : null,
      plan, incentive: plan ? incentiveFor(plan, total, target) : { ratePct: 0, commission: 0, bonus: 0, amount: 0, capped: false },
      posted: !!state.payAdjustments?.[incentiveAdjustmentId(employee.id, month)],
      attendancePct: expected > 0 ? r2((Math.min(attended, expected) / expected) * 100) : null,
      lateCount: summary.lateCount,
    }
  }).sort((a, b) => b.sales - a.sales || a.employee.name.localeCompare(b.employee.name))
}
