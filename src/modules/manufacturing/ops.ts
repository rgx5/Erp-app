import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { weightedAvg } from '@/domain/pricing'
import { round3 } from '@/domain/qty'
import type { StockMove, Variant } from '@/domain/types'
import { audit, OpError, type OpCtx } from '@/data/ops'
import { applyChanges, listOf, mergeChanges, type Changes, type DataState } from '@/data/state'
import { nextNo } from '../numbering'
import { currentCost, findCycle, goodPerBatch, itemName, recipeFor, requirements, stockUnitOf, tracksStock } from './bom'
import { materialOutstanding, newStages, statusFromStages, statusFromWorkOrder } from './jobs'
import { checksOf, entriesOf, hasIssued, isOpen, progressOf, qualityPosition, shortages, stdMaterialPerUnit, toIssue } from './production'
import { convertQty } from './units'
import type {
  CheckItem, CustomerMaterial, EntryKind, JobKind, JobOrder, MaterialMove, Measurement, ProductionEntry, QcResult, QualityCheck, Recipe, RecipeLine, RejectAction, WoLine, WorkOrder,
} from './types'
import './replication'

// ───────────────────────────── stock ─────────────────────────────

/** Builds stock movements and the item totals they leave (the same arithmetic the server's effect runs). */
class Mover {
  moves: StockMove[] = []
  private stock = new Map<string, number>()
  private patch = new Map<string, Partial<Variant>>()
  constructor(private state: DataState, private ctx: OpCtx) {}

  total(variantId: string) { return this.stock.get(variantId) ?? this.state.variants[variantId]?.stock ?? 0 }

  move(variantId: string, qty: number, ref: string, reason: string) {
    if (!this.state.variants[variantId] || !qty) return
    this.stock.set(variantId, round3(this.total(variantId) + qty))
    this.moves.push({ id: id('mv', this.ctx.now), variantId, qty, type: 'adjust', ref, reason, at: this.ctx.now, userId: this.ctx.userId })
  }

  setCost(variantId: string, p: Partial<Variant>) { this.patch.set(variantId, p) }

  changes(): Changes {
    if (!this.moves.length) return {}
    const ids = new Set([...this.stock.keys(), ...this.patch.keys()])
    const variants = [...ids].map((v) => ({ ...this.state.variants[v], stock: this.total(v), ...(this.patch.get(v) ?? {}) }))
    return { put: { moves: this.moves, variants } }
  }
}

const sumValue = (lines: MaterialMove[]) => round2(lines.reduce((s, l) => s + l.qty * l.cost, 0))

// ───────────────────────────── recipes ─────────────────────────────

export interface RecipeDraft {
  name: string
  outputVariantId: string
  outputQty: number
  yieldPct?: number
  lines: RecipeLine[]
  labourPerBatch?: number
  overheadPerBatch?: number
  checklist?: Array<{ label: string; critical?: boolean; id?: string }>
  notes?: string
  active?: boolean
}

/** Creates or edits a recipe. A recipe may use another recipe's output as a part (multi-level), but never itself. */
export function saveRecipe(state: DataState, d: RecipeDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; recipe: Recipe } {
  const name = d.name.trim()
  if (!name) throw new OpError('Give the recipe a name.')
  if (!state.variants[d.outputVariantId]) throw new OpError('Choose the item this recipe makes.')
  if (!(d.outputQty > 0) || !Number.isFinite(d.outputQty)) throw new OpError('Say how many one batch makes.')
  const yieldPct = d.yieldPct ?? 100
  if (!(yieldPct > 0 && yieldPct <= 100)) throw new OpError('Yield is between 1% and 100%.')
  const cur = existingId ? state.recipes[existingId] : undefined
  if (existingId && !cur) throw new OpError('That recipe no longer exists.')
  if (!d.lines.length) throw new OpError('Add at least one ingredient or part.')
  const seen = new Set<string>()
  const lines: RecipeLine[] = d.lines.map((l) => {
    if (!state.variants[l.variantId]) throw new OpError('One of the ingredients no longer exists.')
    const label = itemName(state, l.variantId)
    if (!(l.qty > 0) || !Number.isFinite(l.qty)) throw new OpError(`Enter how much ${label} one batch needs.`)
    if (!(l.wastagePct >= 0 && l.wastagePct < 100)) throw new OpError(`Wastage for ${label} is between 0% and 99%.`)
    if (l.variantId === d.outputVariantId) throw new OpError('A recipe cannot use the item it makes.')
    if (seen.has(l.variantId)) throw new OpError(`${label} is on the list twice — combine the two lines.`)
    seen.add(l.variantId)
    const unit = l.unit?.trim().toLowerCase() || undefined
    if (convertQty(1, unit ?? stockUnitOf(state, l.variantId), stockUnitOf(state, l.variantId)) === null) throw new OpError(`${label} is counted in ${stockUnitOf(state, l.variantId)}; ${unit} does not convert to it.`)
    return {
      variantId: l.variantId, qty: round3(l.qty), wastagePct: Math.round(l.wastagePct * 100) / 100,
      ...(unit && unit !== stockUnitOf(state, l.variantId) ? { unit } : {}), ...(l.customerSupplied ? { customerSupplied: true } : {}), ...(l.buy ? { buy: true } : {}), ...(l.note?.trim() ? { note: l.note.trim() } : {}),
    }
  })
  const labour = d.labourPerBatch ?? 0, overhead = d.overheadPerBatch ?? 0
  if (labour < 0 || overhead < 0) throw new OpError('Labour and overhead cannot be negative.')
  const checklist: CheckItem[] = (d.checklist ?? []).filter((c) => c.label.trim()).map((c, i) => ({ id: c.id ?? `c${i + 1}-${Math.abs(hash(c.label))}`, label: c.label.trim(), ...(c.critical ? { critical: true } : {}) }))
  const active = d.active ?? cur?.active ?? true
  const all = listOf(state.recipes)
  if (active && all.some((r) => r.id !== existingId && r.active && r.outputVariantId === d.outputVariantId)) throw new OpError('There is already an active recipe for this item — edit it, or switch it off first.')
  const recipe: Recipe = {
    id: cur?.id ?? id('rcp', ctx.now), code: cur?.code ?? nextNo('R-', all.map((r) => r.code), ctx, 3), name, outputVariantId: d.outputVariantId, outputQty: round3(d.outputQty), yieldPct,
    lines, labourPerBatch: round2(labour), overheadPerBatch: round2(overhead), checklist, active, notes: (d.notes ?? '').trim(), createdAt: cur?.createdAt ?? ctx.now, updatedAt: ctx.now,
  }
  const loop = findCycle(all, recipe)
  if (loop) throw new OpError(`That would make a loop: ${loop.map((v) => itemName(state, v)).join(' → ')}.`)
  return { recipe, changes: { put: { recipes: [recipe], audit: [audit(ctx, cur ? 'RECIPE_EDIT' : 'RECIPE_ADD', `${recipe.code} ${name}`)] } } }
}

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }

export function setRecipeActive(state: DataState, recipeId: string, active: boolean, ctx: OpCtx): { changes: Changes } {
  const r = state.recipes[recipeId]
  if (!r) throw new OpError('That recipe no longer exists.')
  if (active && listOf(state.recipes).some((x) => x.id !== recipeId && x.active && x.outputVariantId === r.outputVariantId)) throw new OpError('There is already an active recipe for this item.')
  const next = { ...r, active, updatedAt: ctx.now }
  if (active) { const loop = findCycle(listOf(state.recipes), next); if (loop) throw new OpError('Switching this on would make a loop of recipes.') }
  return { changes: { put: { recipes: [next], audit: [audit(ctx, 'RECIPE_STATUS', `${r.code} ${active ? 'on' : 'off'}`)] } } }
}

export function deleteRecipe(state: DataState, recipeId: string, ctx: OpCtx): { changes: Changes } {
  const r = state.recipes[recipeId]
  if (!r) throw new OpError('That recipe no longer exists.')
  if (listOf(state.workOrders).some((w) => w.recipeId === recipeId)) throw new OpError('Work orders were made from this recipe — switch it off instead.')
  return { changes: { del: { recipes: [recipeId] }, put: { audit: [audit(ctx, 'RECIPE_DELETE', `${r.code} ${r.name}`)] } } }
}

// ───────────────────────────── work orders ─────────────────────────────

export interface WorkOrderDraft { recipeId: string; qty: number; dueDate?: number; notes?: string; jobOrderId?: string; parentId?: string; jobWork?: boolean }

const must = (state: DataState, woId: string): WorkOrder => {
  const w = state.workOrders[woId]
  if (!w) throw new OpError('That work order no longer exists.')
  return w
}

function buildWorkOrder(state: DataState, d: WorkOrderDraft, nos: string[], ctx: OpCtx): WorkOrder {
  const r = state.recipes[d.recipeId]
  if (!r) throw new OpError('Choose a recipe.')
  if (!r.active) throw new OpError('That recipe is switched off.')
  if (!(d.qty > 0) || !Number.isFinite(d.qty)) throw new OpError('Say how many to make.')
  if (!state.variants[r.outputVariantId]) throw new OpError('The item this recipe makes no longer exists.')
  const qty = round3(d.qty)
  const lines = requirements(state, r, qty)
  const per = goodPerBatch(r)
  const b = per > 0 ? qty / per : 0
  return {
    id: id('wo', ctx.now), no: nextNo('PRD-', nos, ctx), recipeId: r.id, recipeName: r.name, outputVariantId: r.outputVariantId, qty, status: 'planned', lines, checklist: r.checklist,
    stdMaterialPerUnit: stdMaterialPerUnit(lines, qty), labourPerUnit: qty > 0 ? round2((r.labourPerBatch * b) / qty) : 0, overheadPerUnit: qty > 0 ? round2((r.overheadPerBatch * b) / qty) : 0,
    ...(d.jobWork ? { jobWork: true } : {}), ...(d.jobOrderId ? { jobOrderId: d.jobOrderId } : {}), ...(d.parentId ? { parentId: d.parentId } : {}), ...(d.dueDate ? { dueDate: d.dueDate } : {}),
    notes: (d.notes ?? '').trim(), createdAt: ctx.now, userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
}

/** Plans a work order: the recipe scaled to the quantity (wastage and yield included), costs frozen at today's. No stock moves yet. */
export function planWorkOrder(state: DataState, d: WorkOrderDraft, ctx: OpCtx): { changes: Changes; workOrder: WorkOrder } {
  const workOrder = buildWorkOrder(state, d, listOf(state.workOrders).map((w) => w.no), ctx)
  return { workOrder, changes: { put: { workOrders: [workOrder], audit: [audit(ctx, 'WO_PLAN', `${workOrder.no} ${workOrder.recipeName} × ${workOrder.qty}`)] } } }
}

/** Change a planned order's quantity, due date or notes (the lines are re-scaled from the recipe). */
export function updateWorkOrder(state: DataState, woId: string, d: { qty?: number; dueDate?: number | null; notes?: string }, ctx: OpCtx): { changes: Changes; workOrder: WorkOrder } {
  const w = must(state, woId)
  if (w.status !== 'planned') throw new OpError('Only a planned order can be changed.')
  let next: WorkOrder = { ...w, notes: d.notes !== undefined ? d.notes.trim() : w.notes }
  if (d.dueDate !== undefined) { const { dueDate: _drop, ...rest } = next; next = d.dueDate ? { ...rest, dueDate: d.dueDate } : rest }
  if (d.qty !== undefined && d.qty !== w.qty) {
    const fresh = buildWorkOrder(state, { recipeId: w.recipeId, qty: d.qty, ...(w.jobWork ? { jobWork: true } : {}) }, [], ctx)
    next = { ...next, qty: fresh.qty, lines: fresh.lines, stdMaterialPerUnit: fresh.stdMaterialPerUnit, labourPerUnit: fresh.labourPerUnit, overheadPerUnit: fresh.overheadPerUnit }
  }
  return { workOrder: next, changes: { put: { workOrders: [next], audit: [audit(ctx, 'WO_EDIT', w.no)] } } }
}

function nextEntryNo(state: DataState, ctx: OpCtx) {
  return nextNo('PE-', listOf(state.productionEntries).map((e) => e.no), ctx)
}

function mkEntry(state: DataState, wo: WorkOrder, kind: EntryKind, ctx: OpCtx, over: Partial<ProductionEntry>): ProductionEntry {
  return {
    id: id('pe', ctx.now), no: nextEntryNo(state, ctx), workOrderId: wo.id, kind, date: ctx.now, lines: [], value: 0, goodQty: 0, scrapQty: 0, materialValue: 0, scrapValue: 0,
    labour: 0, overhead: 0, labourStd: 0, overheadStd: 0, varianceValue: 0, note: '', userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}), ...over,
  }
}

const mergeQty = (list: Array<{ variantId: string; qty: number }>) => {
  const out: Array<{ variantId: string; qty: number }> = []
  for (const l of list) {
    if (!(l.qty > 0)) continue
    const x = out.find((o) => o.variantId === l.variantId)
    if (x) x.qty = round3(x.qty + l.qty); else out.push({ variantId: l.variantId, qty: round3(l.qty) })
  }
  return out
}

/** Takes materials off the shelf into the order's work in progress. Customer-supplied material is recorded but not our stock. */
export function issueMaterials(state: DataState, woId: string, lines: Array<{ variantId: string; qty: number }>, ctx: OpCtx, note = ''): { changes: Changes; entry: ProductionEntry } {
  const wo = must(state, woId)
  if (wo.status !== 'in_progress') throw new OpError('Start the work order before issuing material.')
  const want = mergeQty(lines)
  if (!want.length) throw new OpError('Enter how much to issue.')
  const mv = new Mover(state, ctx)
  const rows: MaterialMove[] = []
  for (const l of want) {
    if (!state.variants[l.variantId]) throw new OpError('One of the items no longer exists.')
    const supplied = !!wo.lines.find((x) => x.variantId === l.variantId)?.customerSupplied
    if (supplied) { rows.push({ variantId: l.variantId, qty: l.qty, cost: 0, supplied: true }); continue }
    if (tracksStock(state, l.variantId) && l.qty > mv.total(l.variantId)) throw new OpError(`Only ${mv.total(l.variantId)} of ${itemName(state, l.variantId)} on hand; ${l.qty} needed.`)
    rows.push({ variantId: l.variantId, qty: l.qty, cost: currentCost(state, l.variantId) })
    if (tracksStock(state, l.variantId)) mv.move(l.variantId, -l.qty, wo.no, `Issued to production ${wo.no}`)
  }
  const entry = mkEntry(state, wo, 'issue', ctx, { lines: rows, value: sumValue(rows), note })
  return { entry, changes: mergeChanges(mv.changes(), { put: { productionEntries: [entry], audit: [audit(ctx, 'WO_ISSUE', `${wo.no} ${entry.no} ₹${entry.value}`)] } }) }
}

/** The average cost the order paid per unit of an item it has had issued. */
function issueCost(entries: ProductionEntry[], variantId: string): number {
  let q = 0, v = 0
  for (const e of entries) if (e.kind === 'issue') for (const l of e.lines) if (l.variantId === variantId) { q += l.qty; v += l.qty * l.cost }
  return q > 0 ? v / q : 0
}

/** Puts unused material back on the shelf (at the cost it was issued at). */
export function returnMaterials(state: DataState, woId: string, lines: Array<{ variantId: string; qty: number }>, ctx: OpCtx, note = ''): { changes: Changes; entry: ProductionEntry } {
  const wo = must(state, woId)
  if (wo.status !== 'in_progress') throw new OpError('Material can only be returned while the order is in progress.')
  const want = mergeQty(lines)
  if (!want.length) throw new OpError('Enter how much to return.')
  const entries = entriesOf(state, woId)
  const p = progressOf(wo, entries)
  const mv = new Mover(state, ctx)
  const rows: MaterialMove[] = []
  for (const l of want) {
    const held = p.net.get(l.variantId) ?? 0
    if (l.qty > held) throw new OpError(`Only ${held} of ${itemName(state, l.variantId)} is with this order.`)
    const supplied = !!wo.lines.find((x) => x.variantId === l.variantId)?.customerSupplied
    if (supplied) { rows.push({ variantId: l.variantId, qty: l.qty, cost: 0, supplied: true }); continue }
    rows.push({ variantId: l.variantId, qty: l.qty, cost: round2(issueCost(entries, l.variantId)) })
    if (tracksStock(state, l.variantId)) mv.move(l.variantId, l.qty, wo.no, `Returned from production ${wo.no}`)
  }
  const entry = mkEntry(state, wo, 'return', ctx, { lines: rows, value: sumValue(rows), note })
  return { entry, changes: mergeChanges(mv.changes(), { put: { productionEntries: [entry], audit: [audit(ctx, 'WO_RETURN', `${wo.no} ${entry.no} ₹${entry.value}`)] } }) }
}

/** Moves the order from planned to in progress, refreshes its costs to today's, and (by default) issues all the material it needs. */
export function startWorkOrder(state: DataState, woId: string, ctx: OpCtx, o: { issueNow?: boolean } = {}): { changes: Changes; workOrder: WorkOrder } {
  const wo = must(state, woId)
  if (wo.status !== 'planned') throw new OpError('This order has already been started.')
  const lines: WoLine[] = wo.lines.map((l) => ({ ...l, unitCost: l.customerSupplied ? 0 : currentCost(state, l.variantId) }))
  const started: WorkOrder = { ...wo, lines, stdMaterialPerUnit: stdMaterialPerUnit(lines, wo.qty), status: 'in_progress', startedAt: ctx.now }
  const s = applyChanges(state, { put: { workOrders: [started] } })
  const parts: Changes[] = [{ put: { workOrders: [started], audit: [audit(ctx, 'WO_START', wo.no)] } }, jobSync(s, started, ctx)]
  if (o.issueNow !== false) {
    const need = toIssue(started, progressOf(started, []))
    if (need.length) {
      const miss = shortages(s, started, progressOf(started, []))
      if (miss.length) throw new OpError(`Not enough ${itemName(state, miss[0].variantId)}: ${miss[0].have} on hand, ${miss[0].need} needed.`)
      parts.push(issueMaterials(s, woId, need, ctx).changes)
    }
  }
  return { workOrder: started, changes: mergeChanges(...parts) }
}

export interface QualityDraft {
  results: Array<{ itemId: string; pass: boolean; note?: string }>
  qtyChecked: number
  /** How many of the units checked are rejected (all of them when a critical point failed). */
  qtyRejected?: number
  rejectAction?: RejectAction
  recheck?: boolean
  notes?: string
}

/** Records an inspection against the order's checklist. Units that pass can be received into stock; rejects are scrapped or reworked. */
export function recordQuality(state: DataState, woId: string, d: QualityDraft, ctx: OpCtx): { changes: Changes; check: QualityCheck } {
  const wo = must(state, woId)
  if (wo.status !== 'in_progress') throw new OpError('Inspections are recorded while the order is in progress.')
  if (!wo.checklist.length) throw new OpError('This recipe has no quality checklist — add one to the recipe first.')
  if (!(d.qtyChecked > 0) || !Number.isFinite(d.qtyChecked)) throw new OpError('Enter how many units you checked.')
  const results: QcResult[] = wo.checklist.map((c) => {
    const r = d.results.find((x) => x.itemId === c.id)
    if (!r) throw new OpError(`Mark “${c.label}” as pass or fail.`)
    return { itemId: c.id, label: c.label, pass: r.pass, ...(r.note?.trim() ? { note: r.note.trim() } : {}) }
  })
  const failed = results.filter((r) => !r.pass)
  const critical = failed.some((r) => wo.checklist.find((c) => c.id === r.itemId)?.critical)
  const checked = round3(d.qtyChecked)
  const rejected = critical ? checked : round3(d.qtyRejected ?? 0)
  if (rejected < 0 || rejected > checked) throw new OpError('Rejected units cannot be more than the units checked.')
  if (failed.length && rejected === 0) throw new OpError('Some points failed — say how many units are rejected.')
  if (rejected > 0 && !d.rejectAction) throw new OpError('Choose what happens to the rejected units: scrap or rework.')
  const pos = qualityPosition(checksOf(state, woId), entriesOf(state, woId))
  if (d.recheck && checked > pos.rework) throw new OpError(`Only ${pos.rework} units are waiting after rework.`)
  const check: QualityCheck = {
    id: id('qc', ctx.now), no: nextNo('QC-', listOf(state.qualityChecks).map((q) => q.no), ctx), workOrderId: woId, date: ctx.now, ...(d.recheck ? { recheck: true } : {}), results,
    qtyChecked: checked, qtyPassed: round3(checked - rejected), qtyRejected: rejected, ...(rejected > 0 ? { rejectAction: d.rejectAction } : {}), notes: (d.notes ?? '').trim(),
    userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  return { check, changes: { put: { qualityChecks: [check], audit: [audit(ctx, 'WO_QC', `${wo.no} ${check.no}: ${check.qtyPassed} passed, ${check.qtyRejected} rejected`)] } } }
}

export interface ReceiptDraft { goodQty: number; scrapQty?: number; labour?: number; overhead?: number; note?: string }

/**
 * Receives finished goods into stock (or, for job work, records them as done) and writes off what was scrapped. Material leaves work
 * in progress at the standard cost; labour and overhead are absorbed at standard unless the actual amounts are given.
 */
export function receiveOutput(state: DataState, woId: string, d: ReceiptDraft, ctx: OpCtx): { changes: Changes; entry: ProductionEntry } {
  const wo = must(state, woId)
  if (wo.status !== 'in_progress') throw new OpError('Start the work order before receiving goods.')
  const good = round3(d.goodQty), scrap = round3(d.scrapQty ?? 0)
  if (good < 0 || scrap < 0 || !Number.isFinite(good + scrap)) throw new OpError('Quantities cannot be negative.')
  if (good + scrap <= 0) throw new OpError('Enter how many good (or scrapped) units there are.')
  const entries = entriesOf(state, woId)
  const p = progressOf(wo, entries)
  if (!hasIssued(wo, p)) throw new OpError('Issue the materials first.')
  if (good > p.remaining) throw new OpError(`Only ${p.remaining} are left to make on this order.`)
  if (wo.checklist.length) {
    const pos = qualityPosition(checksOf(state, woId), entries)
    if (good > pos.availableGood) throw new OpError(pos.passed ? `Only ${pos.availableGood} units have passed inspection and are not yet received.` : 'Inspect the units before receiving them.')
    if (scrap > pos.pendingScrap) throw new OpError(`Only ${pos.pendingScrap} units were rejected for scrap.`)
  }
  const materialValue = round2(good * wo.stdMaterialPerUnit), scrapValue = round2(scrap * wo.stdMaterialPerUnit)
  const labourStd = round2(good * wo.labourPerUnit), overheadStd = round2(good * wo.overheadPerUnit)
  const labour = d.labour ?? labourStd, overhead = d.overhead ?? overheadStd
  if (labour < 0 || overhead < 0) throw new OpError('Labour and overhead cannot be negative.')
  const mv = new Mover(state, ctx)
  const stocked = !wo.jobWork && tracksStock(state, wo.outputVariantId)
  if (stocked && good > 0) {
    const v = state.variants[wo.outputVariantId]
    const unit = round2((materialValue + round2(labour) + round2(overhead)) / good)
    mv.move(wo.outputVariantId, good, wo.no, `Produced ${wo.no}`)
    if (unit > 0) mv.setCost(wo.outputVariantId, { cost: unit, avgCost: weightedAvg(v.stock, v.avgCost ?? v.cost, good, unit) })
  }
  const entry = mkEntry(state, wo, 'receipt', ctx, {
    goodQty: good, scrapQty: scrap, materialValue, scrapValue, labour: round2(labour), overhead: round2(overhead), labourStd, overheadStd, note: (d.note ?? '').trim(), ...(wo.jobWork ? { toExpense: true } : {}),
  })
  return { entry, changes: mergeChanges(mv.changes(), { put: { productionEntries: [entry], audit: [audit(ctx, 'WO_RECEIVE', `${wo.no} ${entry.no}: ${good} good${scrap ? `, ${scrap} scrap` : ''}`)] } }) }
}

/** Finishes the order: whatever was issued but not accounted for by the output is the production variance, and it is booked. */
export function closeWorkOrder(state: DataState, woId: string, ctx: OpCtx): { changes: Changes; workOrder: WorkOrder; variance: number } {
  const wo = must(state, woId)
  if (wo.status !== 'in_progress') throw new OpError('Only an order in progress can be closed.')
  const entries = entriesOf(state, woId)
  const p = progressOf(wo, entries)
  if (p.goodQty + p.scrapQty <= 0) throw new OpError('Nothing was received on this order — receive the goods, or cancel the order.')
  if (wo.checklist.length && qualityPosition(checksOf(state, woId), entries).rework > 0) throw new OpError('Some units are waiting after rework — re-inspect them first.')
  const variance = p.wipValue
  const entry = mkEntry(state, wo, 'close', ctx, { varianceValue: variance })
  const done: WorkOrder = { ...wo, status: 'done', doneAt: ctx.now }
  const s = applyChanges(state, { put: { workOrders: [done] } })
  return { workOrder: done, variance, changes: mergeChanges({ put: { workOrders: [done], productionEntries: [entry], audit: [audit(ctx, 'WO_DONE', `${wo.no}: ${p.goodQty} good, variance ₹${variance}`)] } }, jobSync(s, done, ctx)) }
}

export interface CompleteDraft { goodQty: number; scrapQty?: number; returns?: Array<{ variantId: string; qty: number }>; labour?: number; overhead?: number }

/** The usual finish in one go: unused material back to the shelf, goods received, order closed. */
export function completeWorkOrder(state: DataState, woId: string, d: CompleteDraft, ctx: OpCtx): { changes: Changes; workOrder: WorkOrder; variance: number } {
  const parts: Changes[] = []
  let s = state
  const step = <R extends { changes: Changes }>(r: R): R => { parts.push(r.changes); s = applyChanges(s, r.changes); return r }
  if (d.returns?.some((l) => l.qty > 0)) step(returnMaterials(s, woId, d.returns, ctx))
  step(receiveOutput(s, woId, { goodQty: d.goodQty, scrapQty: d.scrapQty, labour: d.labour, overhead: d.overhead }, ctx))
  const closed = step(closeWorkOrder(s, woId, ctx))
  return { workOrder: closed.workOrder, variance: closed.variance, changes: mergeChanges(...parts) }
}

/** Cancels an order. One on the floor sends its unused material back to the shelf; one that already produced goods must be completed. */
export function cancelWorkOrder(state: DataState, woId: string, ctx: OpCtx): { changes: Changes; workOrder: WorkOrder } {
  const wo = must(state, woId)
  if (!isOpen(wo)) throw new OpError('This order is already finished.')
  if (listOf(state.workOrders).some((c) => c.parentId === woId && isOpen(c))) throw new OpError('Cancel or finish the orders made for its parts first.')
  const parts: Changes[] = []
  let s = state
  if (wo.status === 'in_progress') {
    const p = progressOf(wo, entriesOf(state, woId))
    if (p.goodQty + p.scrapQty > 0) throw new OpError('Goods were already received on this order — complete it instead.')
    const back = [...p.net.entries()].filter(([, q]) => q > 0).map(([variantId, qty]) => ({ variantId, qty }))
    if (back.length) { const r = returnMaterials(state, woId, back, ctx, 'Order cancelled'); parts.push(r.changes); s = applyChanges(s, r.changes) }
  }
  const cancelled: WorkOrder = { ...wo, status: 'cancelled' }
  s = applyChanges(s, { put: { workOrders: [cancelled] } })
  parts.push({ put: { workOrders: [cancelled], audit: [audit(ctx, 'WO_CANCEL', wo.no)] } }, jobSync(s, cancelled, ctx))
  return { workOrder: cancelled, changes: mergeChanges(...parts) }
}

/**
 * For a part the shelf cannot cover and that has a recipe of its own, plans an order to make the shortfall (multi-level:
 * the part's order is linked to this one). Parts with no recipe have to be bought.
 */
export function planShortfallOrders(state: DataState, woId: string, ctx: OpCtx): { changes: Changes; orders: WorkOrder[]; toBuy: Array<{ variantId: string; qty: number }> } {
  const wo = must(state, woId)
  if (!isOpen(wo)) throw new OpError('This order is already finished.')
  const miss = shortages(state, wo, progressOf(wo, entriesOf(state, woId)))
  const nos = listOf(state.workOrders).map((w) => w.no)
  const orders: WorkOrder[] = []
  const toBuy: Array<{ variantId: string; qty: number }> = []
  const open = listOf(state.workOrders).filter((c) => c.parentId === woId && isOpen(c))
  for (const m of miss) {
    const r = recipeFor(state, m.variantId)
    const line = wo.lines.find((l) => l.variantId === m.variantId)
    const buyLine = state.recipes[wo.recipeId]?.lines.find((l) => l.variantId === m.variantId)?.buy
    if (!r || buyLine || !line) { toBuy.push({ variantId: m.variantId, qty: m.short }); continue }
    const already = open.filter((c) => c.outputVariantId === m.variantId).reduce((s, c) => s + c.qty, 0)
    const qty = round3(m.short - already)
    if (qty <= 0) continue
    const child = buildWorkOrder(state, { recipeId: r.id, qty, parentId: woId, ...(wo.dueDate ? { dueDate: wo.dueDate } : {}), notes: `For ${wo.no}` }, nos, ctx)
    nos.push(child.no)
    orders.push({ ...child, id: `${child.id}${orders.length}` })
  }
  if (!orders.length && !toBuy.length) throw new OpError('Nothing is short.')
  return { orders, toBuy, changes: orders.length ? { put: { workOrders: orders, audit: [audit(ctx, 'WO_PLAN_PARTS', `${wo.no}: ${orders.map((o) => o.no).join(', ')}`)] } } : {} }
}

// ───────────────────────────── job orders ─────────────────────────────

/** A job's status follows its work order. */
function jobSync(state: DataState, wo: WorkOrder, ctx: OpCtx): Changes {
  void ctx
  if (!wo.jobOrderId) return {}
  const j = state.jobOrders[wo.jobOrderId]
  if (!j) return {}
  const status = statusFromWorkOrder(j, wo)
  return status === j.status ? {} : { put: { jobOrders: [{ ...j, status }] } }
}

export interface JobDraft {
  kind: JobKind
  customerId: string
  title: string
  qty?: number
  charge?: number
  dueDate?: number
  measurements?: Measurement[]
  stages?: string[]
  /** Make a work order from this recipe for the job. */
  recipeId?: string
  salesOrderId?: string
  notes?: string
}

export function createJobOrder(state: DataState, d: JobDraft, ctx: OpCtx): { changes: Changes; job: JobOrder; workOrder?: WorkOrder } {
  if (!state.customers[d.customerId]) throw new OpError('Choose the customer.')
  const title = d.title.trim()
  if (!title) throw new OpError('Say what is to be made.')
  const qty = d.qty ?? 1
  if (!(qty > 0)) throw new OpError('Say how many.')
  if ((d.charge ?? 0) < 0) throw new OpError('The charge cannot be negative.')
  const jobId = id('job', ctx.now)
  let wo: WorkOrder | undefined
  if (d.recipeId) wo = buildWorkOrder(state, { recipeId: d.recipeId, qty, ...(d.dueDate ? { dueDate: d.dueDate } : {}), jobOrderId: jobId, jobWork: d.kind === 'job_work', notes: title }, listOf(state.workOrders).map((w) => w.no), ctx)
  const job: JobOrder = {
    id: jobId, no: nextNo('JOB-', listOf(state.jobOrders).map((j) => j.no), ctx), kind: d.kind, customerId: d.customerId, title, qty: round3(qty), charge: round2(d.charge ?? 0),
    ...(d.dueDate ? { dueDate: d.dueDate } : {}), measurements: (d.measurements ?? []).filter((m) => m.label.trim() && m.value.trim()).map((m) => ({ label: m.label.trim(), value: m.value.trim() })),
    stages: newStages(d.stages ?? []), materials: [], ...(d.recipeId ? { recipeId: d.recipeId } : {}), ...(wo ? { workOrderId: wo.id } : {}), ...(d.salesOrderId ? { salesOrderId: d.salesOrderId } : {}),
    status: 'received', notes: (d.notes ?? '').trim(), createdAt: ctx.now, createdBy: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  return { job, ...(wo ? { workOrder: wo } : {}), changes: { put: { jobOrders: [job], ...(wo ? { workOrders: [wo] } : {}), audit: [audit(ctx, 'JOB_ADD', `${job.no} ${title}`)] } } }
}

const mustJob = (state: DataState, jobId: string): JobOrder => {
  const j = state.jobOrders[jobId]
  if (!j) throw new OpError('That job no longer exists.')
  return j
}

/** Ticks (or un-ticks) a stage of the job. With no work order, the stages alone say when the job is ready. */
export function setJobStage(state: DataState, jobId: string, index: number, done: boolean, ctx: OpCtx): { changes: Changes; job: JobOrder } {
  const j = mustJob(state, jobId)
  if (j.status === 'delivered' || j.status === 'cancelled') throw new OpError('This job is finished.')
  if (!j.stages[index]) throw new OpError('That stage does not exist.')
  const stages = j.stages.map((s, i) => {
    if (i !== index) return s
    const { doneAt: _d, ...rest } = s
    return done ? { ...rest, doneAt: ctx.now } : rest
  })
  const next: JobOrder = { ...j, stages }
  if (!j.workOrderId) next.status = statusFromStages(next)
  return { job: next, changes: { put: { jobOrders: [next], audit: [audit(ctx, 'JOB_STAGE', `${j.no} ${j.stages[index].name} ${done ? 'done' : 'reopened'}`)] } } }
}

export function receiveCustomerMaterial(state: DataState, jobId: string, d: { description: string; unit?: string; qty: number }, ctx: OpCtx): { changes: Changes; job: JobOrder } {
  const j = mustJob(state, jobId)
  if (j.status === 'delivered' || j.status === 'cancelled') throw new OpError('This job is finished.')
  const description = d.description.trim()
  if (!description) throw new OpError('Say what material the customer brought.')
  if (!(d.qty > 0)) throw new OpError('Enter how much was received.')
  const unit = d.unit?.trim() || 'pc'
  const row = j.materials.find((m) => m.description.toLowerCase() === description.toLowerCase() && m.unit === unit)
  const materials: CustomerMaterial[] = row
    ? j.materials.map((m) => (m === row ? { ...m, received: round3(m.received + d.qty) } : m))
    : [...j.materials, { id: id('cm', ctx.now), description, unit, received: round3(d.qty), used: 0, returned: 0 }]
  const next = { ...j, materials }
  return { job: next, changes: { put: { jobOrders: [next], audit: [audit(ctx, 'JOB_MATERIAL_IN', `${j.no} ${description} × ${d.qty} ${unit}`)] } } }
}

/** Records material used up (`use`) or handed back (`return`). Only what is with us can go. */
export function settleCustomerMaterial(state: DataState, jobId: string, materialId: string, kind: 'use' | 'return', qty: number, ctx: OpCtx): { changes: Changes; job: JobOrder } {
  const j = mustJob(state, jobId)
  const m = j.materials.find((x) => x.id === materialId)
  if (!m) throw new OpError('That material is not on this job.')
  if (!(qty > 0)) throw new OpError('Enter a quantity.')
  if (qty > materialOutstanding(m)) throw new OpError(`Only ${materialOutstanding(m)} ${m.unit} of ${m.description} is with us.`)
  const next = { ...j, materials: j.materials.map((x) => (x === m ? { ...x, ...(kind === 'use' ? { used: round3(x.used + qty) } : { returned: round3(x.returned + qty) }) } : x)) }
  return { job: next, changes: { put: { jobOrders: [next], audit: [audit(ctx, kind === 'use' ? 'JOB_MATERIAL_USED' : 'JOB_MATERIAL_BACK', `${j.no} ${m.description} × ${qty}`)] } } }
}

/** Hands the finished job over. Job work cannot go while the customer's material is still with us. */
export function deliverJob(state: DataState, jobId: string, o: { billId?: string }, ctx: OpCtx): { changes: Changes; job: JobOrder } {
  const j = mustJob(state, jobId)
  if (j.status !== 'ready') throw new OpError('The job is not ready yet.')
  const left = j.materials.find((m) => materialOutstanding(m) > 0)
  if (j.kind === 'job_work' && left) throw new OpError(`Return or record the use of ${left.description} first — ${materialOutstanding(left)} ${left.unit} is still with us.`)
  if (o.billId && !state.bills[o.billId]) throw new OpError('That bill does not exist.')
  const next: JobOrder = { ...j, status: 'delivered', deliveredAt: ctx.now, ...(o.billId ? { billId: o.billId } : {}) }
  return { job: next, changes: { put: { jobOrders: [next], audit: [audit(ctx, 'JOB_DELIVER', j.no)] } } }
}

export function cancelJob(state: DataState, jobId: string, ctx: OpCtx): { changes: Changes; job: JobOrder } {
  const j = mustJob(state, jobId)
  if (j.status === 'delivered' || j.status === 'cancelled') throw new OpError('This job is finished.')
  const wo = j.workOrderId ? state.workOrders[j.workOrderId] : undefined
  if (wo && isOpen(wo)) throw new OpError(`Cancel the work order ${wo.no} first.`)
  const left = j.materials.find((m) => materialOutstanding(m) > 0)
  if (left) throw new OpError(`Give ${left.description} back to the customer first.`)
  const next: JobOrder = { ...j, status: 'cancelled' }
  return { job: next, changes: { put: { jobOrders: [next], audit: [audit(ctx, 'JOB_CANCEL', j.no)] } } }
}

/** Gives a job without a work order one, from a recipe. */
export function linkJobToRecipe(state: DataState, jobId: string, recipeId: string, ctx: OpCtx): { changes: Changes; workOrder: WorkOrder; job: JobOrder } {
  const j = mustJob(state, jobId)
  if (j.workOrderId) throw new OpError('This job already has a work order.')
  if (j.status === 'delivered' || j.status === 'cancelled') throw new OpError('This job is finished.')
  const wo = buildWorkOrder(state, { recipeId, qty: j.qty, ...(j.dueDate ? { dueDate: j.dueDate } : {}), jobOrderId: j.id, jobWork: j.kind === 'job_work', notes: j.title }, listOf(state.workOrders).map((w) => w.no), ctx)
  const job = { ...j, recipeId, workOrderId: wo.id }
  return { job, workOrder: wo, changes: { put: { jobOrders: [job], workOrders: [wo], audit: [audit(ctx, 'JOB_LINK', `${j.no} → ${wo.no}`)] } } }
}
