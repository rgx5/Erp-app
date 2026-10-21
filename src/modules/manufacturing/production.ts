import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import { listOf, type DataState } from '@/data/state'
import { tracksStock } from './bom'
import type { ProductionEntry, QualityCheck, WoLine, WoStatus, WorkOrder } from './types'

export const WO_LABEL: Record<WoStatus, string> = { planned: 'Planned', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' }

export const entriesOf = (state: DataState, workOrderId: string): ProductionEntry[] =>
  listOf(state.productionEntries).filter((e) => e.workOrderId === workOrderId).sort((a, b) => a.date - b.date || a.no.localeCompare(b.no))

export const checksOf = (state: DataState, workOrderId: string): QualityCheck[] =>
  listOf(state.qualityChecks).filter((q) => q.workOrderId === workOrderId).sort((a, b) => a.date - b.date || a.no.localeCompare(b.no))

// ───────────────────────────── quality position ─────────────────────────────

export interface QualityPosition {
  /** Units that passed inspection (including re-inspected rework). */
  passed: number
  /** Units rejected and to be scrapped. */
  rejectedScrap: number
  /** Units sent back for rework and not yet re-inspected. */
  rework: number
  /** Passed units not yet received into stock. */
  availableGood: number
  /** Rejected-for-scrap units not yet written off. */
  pendingScrap: number
}

export function qualityPosition(checks: QualityCheck[], entries: ProductionEntry[]): QualityPosition {
  let passed = 0, scrapRej = 0, reworkRej = 0, rechecked = 0
  for (const q of checks) {
    passed += q.qtyPassed
    if (q.rejectAction === 'scrap') scrapRej += q.qtyRejected
    else if (q.rejectAction === 'rework') reworkRej += q.qtyRejected
    if (q.recheck) rechecked += q.qtyChecked
  }
  let good = 0, scrapped = 0
  for (const e of entries) if (e.kind === 'receipt') { good += e.goodQty; scrapped += e.scrapQty }
  return {
    passed: round3(passed), rejectedScrap: round3(scrapRej), rework: round3(Math.max(0, reworkRej - rechecked)),
    availableGood: round3(passed - good), pendingScrap: round3(scrapRej - scrapped),
  }
}

// ───────────────────────────── progress ─────────────────────────────

export interface Progress {
  /** Net quantity put into the order per item (issued − returned), customer's material included. */
  net: Map<string, number>
  issuedValue: number
  returnedValue: number
  goodQty: number
  scrapQty: number
  /** Standard material cost already moved out of work in progress (good units and scrap). */
  relievedValue: number
  scrapValue: number
  labour: number
  overhead: number
  labourStd: number
  overheadStd: number
  varianceValue: number
  /** What is still sitting in work in progress (materials at cost). */
  wipValue: number
  /** Good units still to make. */
  remaining: number
  closed: boolean
}

export function progressOf(wo: WorkOrder, entries: ProductionEntry[]): Progress {
  const net = new Map<string, number>()
  const p: Progress = {
    net, issuedValue: 0, returnedValue: 0, goodQty: 0, scrapQty: 0, relievedValue: 0, scrapValue: 0, labour: 0, overhead: 0, labourStd: 0, overheadStd: 0,
    varianceValue: 0, wipValue: 0, remaining: 0, closed: false,
  }
  for (const e of entries) {
    if (e.kind === 'issue') { p.issuedValue += e.value; for (const l of e.lines) net.set(l.variantId, round3((net.get(l.variantId) ?? 0) + l.qty)) }
    else if (e.kind === 'return') { p.returnedValue += e.value; for (const l of e.lines) net.set(l.variantId, round3((net.get(l.variantId) ?? 0) - l.qty)) }
    else if (e.kind === 'receipt') {
      p.goodQty += e.goodQty; p.scrapQty += e.scrapQty; p.relievedValue += e.materialValue + e.scrapValue; p.scrapValue += e.scrapValue
      p.labour += e.labour; p.overhead += e.overhead; p.labourStd += e.labourStd; p.overheadStd += e.overheadStd
    } else { p.varianceValue += e.varianceValue; p.closed = true }
  }
  p.issuedValue = round2(p.issuedValue); p.returnedValue = round2(p.returnedValue); p.relievedValue = round2(p.relievedValue); p.scrapValue = round2(p.scrapValue)
  p.labour = round2(p.labour); p.overhead = round2(p.overhead); p.labourStd = round2(p.labourStd); p.overheadStd = round2(p.overheadStd); p.varianceValue = round2(p.varianceValue)
  p.goodQty = round3(p.goodQty); p.scrapQty = round3(p.scrapQty)
  p.wipValue = round2(p.issuedValue - p.returnedValue - p.relievedValue - p.varianceValue)
  p.remaining = round3(Math.max(0, wo.qty - p.goodQty))
  return p
}

/** Whether our own materials have been put into the order (job work with only the customer's material needs none). */
export function hasIssued(wo: WorkOrder, p: Progress): boolean {
  const own = wo.lines.filter((l) => !l.customerSupplied)
  return !own.length || p.issuedValue > 0 || [...p.net.values()].some((q) => q > 0)
}

// ───────────────────────────── materials ─────────────────────────────

export interface MaterialRow {
  variantId: string
  customerSupplied: boolean
  /** On the order (with wastage). */
  planned: number
  /** Needed for the output so far, with no wastage allowed. */
  baseline: number
  /** What the recipe allows for the output so far, wastage included. */
  allowed: number
  /** Net put into the order. */
  actual: number
  /** actual − allowed: positive = used more than allowed. */
  over: number
  /** Actual wastage % over the no-wastage need (null until something is made). */
  wastagePct: number | null
  plannedWastagePct: number
  unitCost: number
}

/** Planned against actual, per material: what the order asked for, what went in, what the output should have used. */
export function materialRows(wo: WorkOrder, p: Progress): MaterialRow[] {
  const made = p.goodQty + p.scrapQty
  const rows: MaterialRow[] = wo.lines.map((l) => ({
    variantId: l.variantId, customerSupplied: !!l.customerSupplied, planned: l.qty,
    baseline: wo.qty > 0 ? round3((l.baseQty * made) / wo.qty) : 0, allowed: wo.qty > 0 ? round3((l.qty * made) / wo.qty) : 0,
    actual: round3(p.net.get(l.variantId) ?? 0), over: 0, wastagePct: null, plannedWastagePct: l.wastagePct, unitCost: l.unitCost,
  }))
  for (const [variantId, q] of p.net) {
    if (!rows.some((r) => r.variantId === variantId)) rows.push({ variantId, customerSupplied: false, planned: 0, baseline: 0, allowed: 0, actual: round3(q), over: 0, wastagePct: null, plannedWastagePct: 0, unitCost: 0 })
  }
  for (const r of rows) {
    r.over = round3(r.actual - r.allowed)
    r.wastagePct = r.baseline > 0 ? Math.round(((r.actual - r.baseline) / r.baseline) * 1000) / 10 : null
  }
  return rows
}

/** What is still to be issued to cover the order's lines (own materials only). */
export function toIssue(wo: WorkOrder, p: Progress): Array<{ variantId: string; qty: number }> {
  return wo.lines.filter((l) => !l.customerSupplied).map((l) => ({ variantId: l.variantId, qty: round3(Math.max(0, l.qty - (p.net.get(l.variantId) ?? 0))) })).filter((l) => l.qty > 0)
}

export interface Shortage { variantId: string; need: number; have: number; short: number }

/** Own materials the shelf cannot cover for what is still to be issued. */
export function shortages(state: DataState, wo: WorkOrder, p: Progress): Shortage[] {
  const out: Shortage[] = []
  for (const l of toIssue(wo, p)) {
    if (!tracksStock(state, l.variantId)) continue
    const have = state.variants[l.variantId]?.stock ?? 0
    if (have < l.qty) out.push({ variantId: l.variantId, need: l.qty, have, short: round3(l.qty - have) })
  }
  return out
}

/** Standard material cost of one good unit from lines (own material only). */
export const stdMaterialPerUnit = (lines: WoLine[], qty: number): number =>
  qty > 0 ? round2(lines.filter((l) => !l.customerSupplied).reduce((s, l) => s + l.qty * l.unitCost, 0) / qty) : 0

// ───────────────────────────── lists ─────────────────────────────

export const isOpen = (wo: WorkOrder) => wo.status === 'planned' || wo.status === 'in_progress'
export const isLate = (wo: WorkOrder, now: number) => isOpen(wo) && !!wo.dueDate && wo.dueDate < now

export const openWorkOrders = (state: DataState) => listOf(state.workOrders).filter(isOpen).sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) || a.createdAt - b.createdAt)

export function workOrderCounts(state: DataState, now: number) {
  const all = listOf(state.workOrders)
  return { planned: all.filter((w) => w.status === 'planned').length, inProgress: all.filter((w) => w.status === 'in_progress').length, late: all.filter((w) => isLate(w, now)).length }
}
