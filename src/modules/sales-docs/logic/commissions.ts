import { isCreditNote } from '@/domain/receipt'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import { listOf, type DataState } from '@/data/state'
import type { CommissionRule } from '../types'

export interface CommissionLine { ruleId: string; ruleName: string; base: number; rate: number; amount: number }

export interface StaffCommission {
  staffId: string
  name: string
  bills: number
  pieces: number
  /** Sales value excluding GST, net of returns. */
  sales: number
  /** The target for the period (sum of the monthly targets it covers); 0 when none is set. */
  target: number
  /** sales ÷ target, in %, or null without a target. */
  achievementPct: number | null
  commission: number
  lines: CommissionLine[]
}

export interface CommissionReport { from: number; to: number; rows: StaffCommission[]; totalSales: number; totalCommission: number }

const monthKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

/** `YYYY-MM` of every month a period touches. */
export function monthsIn(from: number, to: number): string[] {
  const out: string[] = []
  const d = new Date(from); d.setDate(1); d.setHours(0, 0, 0, 0)
  while (d.getTime() <= to && out.length < 36) { out.push(monthKey(d.getTime())); d.setMonth(d.getMonth() + 1) }
  return out
}

/** The most specific rule that applies to a sale of this item by this person: a rule for the item beats one for its category beats "everything", and a rule for the person beats one for everyone. */
export function ruleFor(rules: CommissionRule[], staffId: string, productId: string | undefined, categoryId: string | undefined): CommissionRule | null {
  let best: { r: CommissionRule; score: number } | null = null
  for (const r of rules) {
    if (!r.active) continue
    if (r.staffId && r.staffId !== staffId) continue
    let score: number
    if (r.scope === 'item') { if (!productId || r.productId !== productId) continue; score = 3 }
    else if (r.scope === 'category') { if (!categoryId || r.categoryId !== categoryId) continue; score = 2 }
    else score = 1
    if (r.staffId) score += 10
    if (!best || score > best.score) best = { r, score }
  }
  return best?.r ?? null
}

/** The rate a rule pays once the person has reached `achievementPct` of their target (the highest slab reached; else the base rate). */
export function rateFor(rule: CommissionRule, achievementPct: number | null): number {
  if (rule.basis !== 'pct' || achievementPct === null || !rule.slabs?.length) return rule.rate
  let rate = rule.rate
  for (const s of [...rule.slabs].sort((a, b) => a.minAchievementPct - b.minAchievementPct)) if (achievementPct >= s.minAchievementPct) rate = s.rate
  return rate
}

/**
 * What each salesperson sold in a period, how that compares with their target, and the commission it earns — from the bills
 * alone (each item counts for whoever sold it; returns subtract). Pure: the numbers a payout in the HR module would use.
 */
export function commissionReport(state: DataState, from: number, to: number): CommissionReport {
  const rules = listOf(state.commissionRules)
  const months = new Set(monthsIn(from, to))
  const targets = new Map<string, number>()
  for (const t of listOf(state.salesTargets)) if (months.has(t.month)) targets.set(t.staffId, round2((targets.get(t.staffId) ?? 0) + t.amount))

  interface Row { bills: Set<string>; pieces: number; sales: number; items: Array<{ productId?: string; categoryId?: string; taxable: number; qty: number }> }
  const staff = new Map<string, Row>()
  for (const b of listOf(state.bills)) {
    if (b.status === 'held' || b.date < from || b.date > to) continue
    const sign = isCreditNote(b) ? -1 : 1
    for (const i of b.items) {
      const sid = i.soldBy ?? b.soldBy ?? b.cashierId
      const row = staff.get(sid) ?? { bills: new Set<string>(), pieces: 0, sales: 0, items: [] }
      const productId = state.variants[i.variantId]?.productId
      row.items.push({ productId, categoryId: productId ? state.products[productId]?.categoryId : undefined, taxable: i.taxable * sign, qty: i.qty * sign })
      row.sales += i.taxable * sign
      row.pieces += i.qty * sign
      if (sign > 0) row.bills.add(b.id)
      staff.set(sid, row)
    }
  }

  const rows: StaffCommission[] = []
  for (const [sid, row] of staff) {
    const sales = round2(row.sales)
    const target = targets.get(sid) ?? 0
    const achievementPct = target > 0 ? round2((sales / target) * 100) : null
    const lines = new Map<string, CommissionLine>()
    for (const it of row.items) {
      const rule = ruleFor(rules, sid, it.productId, it.categoryId)
      if (!rule) continue
      const rate = rateFor(rule, achievementPct)
      const base = rule.basis === 'pct' ? it.taxable : it.qty
      const amount = rule.basis === 'pct' ? (it.taxable * rate) / 100 : it.qty * rate
      const key = `${rule.id}@${rate}`
      const cur = lines.get(key) ?? { ruleId: rule.id, ruleName: rule.name, base: 0, rate, amount: 0 }
      cur.base += base; cur.amount += amount
      lines.set(key, cur)
    }
    const detail = [...lines.values()].map((l) => ({ ...l, base: round2(l.base), amount: round2(l.amount) }))
    rows.push({
      staffId: sid, name: state.users[sid]?.name ?? 'Former staff', bills: row.bills.size, pieces: round3(row.pieces), sales, target, achievementPct,
      commission: round2(detail.reduce((s, l) => s + l.amount, 0)), lines: detail,
    })
  }
  // Someone with a target but no sales yet still belongs in the report.
  for (const [sid, target] of targets) if (!staff.has(sid)) rows.push({ staffId: sid, name: state.users[sid]?.name ?? 'Former staff', bills: 0, pieces: 0, sales: 0, target, achievementPct: 0, commission: 0, lines: [] })
  rows.sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name))
  return { from, to, rows, totalSales: round2(rows.reduce((s, r) => s + r.sales, 0)), totalCommission: round2(rows.reduce((s, r) => s + r.commission, 0)) }
}

/** The report as CSV rows (one line per person, then the rule breakdown). */
export function commissionCsvRows(rep: CommissionReport): Array<Array<string | number>> {
  const out: Array<Array<string | number>> = [['Salesperson', 'Bills', 'Pieces', 'Sales (excl. GST)', 'Target', 'Achieved %', 'Commission']]
  for (const r of rep.rows) out.push([r.name, r.bills, r.pieces, r.sales, r.target || '', r.achievementPct ?? '', r.commission])
  out.push(['Total', '', '', rep.totalSales, '', '', rep.totalCommission])
  out.push([])
  out.push(['Salesperson', 'Rule', 'Base', 'Rate', 'Amount'])
  for (const r of rep.rows) for (const l of r.lines) out.push([r.name, l.ruleName, l.base, l.rate, l.amount])
  return out
}
