import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import { listOf, type DataState } from '@/data/state'
import { entriesOf, materialRows, progressOf } from './production'

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)

// ───────────────────────────── cost & variance ─────────────────────────────

export interface CostRow {
  workOrderId: string
  no: string
  outputVariantId: string
  doneAt: number
  planned: number
  good: number
  scrap: number
  /** Material that actually went in (net), labour and overhead actually charged. */
  material: number
  labour: number
  overhead: number
  actualTotal: number
  /** Cost of one good unit, actual and standard. */
  actualPerUnit: number
  standardPerUnit: number
  /** actual − standard for the units made; positive = cost more than it should have. */
  materialVariance: number
  labourVariance: number
  overheadVariance: number
  variance: number
}

export interface CostReport { rows: CostRow[]; good: number; actualTotal: number; variance: number }

/** Cost per unit and variance of the work orders finished in the period (job work included: its cost is the cost of the job). */
export function productionCostReport(state: DataState, from: number, to: number): CostReport {
  const rows: CostRow[] = []
  for (const wo of listOf(state.workOrders)) {
    if (wo.status !== 'done' || !wo.doneAt || wo.doneAt < from || wo.doneAt > to) continue
    const p = progressOf(wo, entriesOf(state, wo.id))
    const material = round2(p.issuedValue - p.returnedValue)
    const actualTotal = round2(material + p.labour + p.overhead)
    const std = round2(p.relievedValue + p.labourStd + p.overheadStd)
    const materialVariance = round2(p.varianceValue)
    const labourVariance = round2(p.labour - p.labourStd)
    const overheadVariance = round2(p.overhead - p.overheadStd)
    rows.push({
      workOrderId: wo.id, no: wo.no, outputVariantId: wo.outputVariantId, doneAt: wo.doneAt, planned: wo.qty, good: p.goodQty, scrap: p.scrapQty,
      material, labour: p.labour, overhead: p.overhead, actualTotal,
      actualPerUnit: p.goodQty > 0 ? round2(actualTotal / p.goodQty) : 0, standardPerUnit: p.goodQty > 0 ? round2(std / p.goodQty) : 0,
      materialVariance, labourVariance, overheadVariance, variance: round2(materialVariance + labourVariance + overheadVariance),
    })
  }
  rows.sort((a, b) => b.doneAt - a.doneAt)
  return { rows, good: round3(rows.reduce((s, r) => s + r.good, 0)), actualTotal: round2(rows.reduce((s, r) => s + r.actualTotal, 0)), variance: round2(rows.reduce((s, r) => s + r.variance, 0)) }
}

// ───────────────────────────── yield & wastage ─────────────────────────────

export interface YieldRow {
  outputVariantId: string
  orders: number
  planned: number
  good: number
  scrap: number
  /** Good units ÷ units wanted. */
  yieldPct: number | null
  /** Good units ÷ units made (good + scrap). */
  qualityPct: number | null
}

export interface WastageRow {
  variantId: string
  /** What the output made should have used with no wastage, what the recipe allowed, and what really went in. */
  baseline: number
  allowed: number
  actual: number
  /** Actual wastage % over the baseline. */
  wastagePct: number | null
  plannedWastagePct: number | null
  /** actual − allowed. */
  over: number
}

export interface YieldReport { yields: YieldRow[]; wastage: WastageRow[] }

/** Planned against actual output per item, and the wastage per material, over the orders finished in the period. */
export function yieldReport(state: DataState, from: number, to: number): YieldReport {
  const by = new Map<string, YieldRow>()
  const mat = new Map<string, { baseline: number; allowed: number; actual: number; planned: number[] }>()
  for (const wo of listOf(state.workOrders)) {
    if (wo.status !== 'done' || !wo.doneAt || wo.doneAt < from || wo.doneAt > to) continue
    const p = progressOf(wo, entriesOf(state, wo.id))
    const y = by.get(wo.outputVariantId) ?? { outputVariantId: wo.outputVariantId, orders: 0, planned: 0, good: 0, scrap: 0, yieldPct: null, qualityPct: null }
    y.orders++; y.planned = round3(y.planned + wo.qty); y.good = round3(y.good + p.goodQty); y.scrap = round3(y.scrap + p.scrapQty)
    by.set(wo.outputVariantId, y)
    for (const r of materialRows(wo, p)) {
      if (r.customerSupplied) continue
      const m = mat.get(r.variantId) ?? { baseline: 0, allowed: 0, actual: 0, planned: [] }
      m.baseline += r.baseline; m.allowed += r.allowed; m.actual += r.actual
      if (r.baseline > 0) m.planned.push(r.plannedWastagePct)
      mat.set(r.variantId, m)
    }
  }
  const yields = [...by.values()].map((y) => ({ ...y, yieldPct: pct(y.good, y.planned), qualityPct: pct(y.good, y.good + y.scrap) })).sort((a, b) => b.planned - a.planned)
  const wastage = [...mat.entries()].map(([variantId, m]): WastageRow => ({
    variantId, baseline: round3(m.baseline), allowed: round3(m.allowed), actual: round3(m.actual),
    wastagePct: m.baseline > 0 ? Math.round(((m.actual - m.baseline) / m.baseline) * 1000) / 10 : null,
    plannedWastagePct: m.planned.length ? Math.round((m.planned.reduce((s, x) => s + x, 0) / m.planned.length) * 10) / 10 : null,
    over: round3(m.actual - m.allowed),
  })).sort((a, b) => b.over - a.over)
  return { yields, wastage }
}

// ───────────────────────────── work in progress ─────────────────────────────

export interface WipRow { workOrderId: string; no: string; outputVariantId: string; qty: number; good: number; remaining: number; wipValue: number; startedAt?: number; dueDate?: number }

/** Orders on the floor and the material cost sitting in them. */
export function wipReport(state: DataState): { rows: WipRow[]; total: number } {
  const rows: WipRow[] = []
  for (const wo of listOf(state.workOrders)) {
    if (wo.status !== 'in_progress') continue
    const p = progressOf(wo, entriesOf(state, wo.id))
    rows.push({ workOrderId: wo.id, no: wo.no, outputVariantId: wo.outputVariantId, qty: wo.qty, good: p.goodQty, remaining: p.remaining, wipValue: p.wipValue, ...(wo.startedAt ? { startedAt: wo.startedAt } : {}), ...(wo.dueDate ? { dueDate: wo.dueDate } : {}) })
  }
  rows.sort((a, b) => b.wipValue - a.wipValue)
  return { rows, total: round2(rows.reduce((s, r) => s + r.wipValue, 0)) }
}

/** Whole-business production figures for a period (for tiles). */
export function productionSummary(state: DataState, from: number, to: number) {
  const cost = productionCostReport(state, from, to)
  const y = yieldReport(state, from, to)
  const planned = y.yields.reduce((s, r) => s + r.planned, 0)
  const scrap = y.yields.reduce((s, r) => s + r.scrap, 0)
  const wip = wipReport(state)
  return { orders: cost.rows.length, good: cost.good, scrap: round3(scrap), yieldPct: pct(cost.good, planned), variance: cost.variance, wip: wip.total, cost: cost.actualTotal }
}
