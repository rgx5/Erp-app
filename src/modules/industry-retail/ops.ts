import { listOf, type Changes, type DataState } from '@/data/state'
import { audit, createItem, OpError, type ItemDraft, type OpCtx } from '@/data/ops'
import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import type { Product, StockMove, Variant } from '@/domain/types'
import { nextNo } from '../numbering'
import { billIdForNo, boqProblem, nextAlterationStatuses, nextBoqStatuses, prescriptionProblem } from './logic'
import type { AlterationJob, AlterationStatus, Boq, BoqLine, BoqStatus, Prescription, RxFlag, SubstituteGroup } from './types'
import './replication'

const branch = (ctx: OpCtx) => (ctx.branchId ? { branchId: ctx.branchId } : {})

// ───────────────────────────── pharmacy: Schedule H flag ─────────────────────────────

/** Flags (or un-flags) an item as Schedule H / H1 — needs a prescription before it is sold. */
export function setRxFlag(state: DataState, productId: string, scheduleH: boolean, note: string, ctx: OpCtx): { changes: Changes } {
  if (!state.products[productId]) throw new OpError('That item no longer exists.')
  const flag: RxFlag = { id: productId, scheduleH, note: note.trim() }
  return { changes: { put: { rxFlags: [flag], audit: [audit(ctx, 'RX_FLAG', `${state.products[productId].name} → ${scheduleH ? 'Schedule H' : 'OTC'}`)] } } }
}

// ───────────────────────────── pharmacy: generic substitutes ─────────────────────────────

/** Sets the substitutes recorded against a branded item (replaces the list; an empty list clears it). */
export function saveSubstitutes(state: DataState, productId: string, subs: string[], ctx: OpCtx): { changes: Changes } {
  const p = state.products[productId]
  if (!p) throw new OpError('That item no longer exists.')
  const clean = [...new Set(subs.filter((s) => s && s !== productId))]
  for (const s of clean) if (!state.products[s]) throw new OpError('One of the substitutes no longer exists.')
  const group: SubstituteGroup = { id: productId, subs: clean }
  return { changes: { put: { substituteGroups: [group], audit: [audit(ctx, 'RX_SUBSTITUTES', `${p.name} → ${clean.length} substitute(s)`)] } } }
}

// ───────────────────────────── pharmacy: prescriptions ─────────────────────────────

export interface PrescriptionDraft {
  patientName: string
  patientPhone: string
  doctorName: string
  doctorRegNo: string
  photo?: string
  itemNames: string[]
  billNo: string
  notes: string
}

export function savePrescription(state: DataState, d: PrescriptionDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; prescription: Prescription } {
  const problem = prescriptionProblem(d)
  if (problem) throw new OpError(problem)
  const billId = billIdForNo(state, d.billNo)
  const base = {
    patientName: d.patientName.trim(), patientPhone: d.patientPhone.trim(), doctorName: d.doctorName.trim(), doctorRegNo: d.doctorRegNo.trim(),
    photo: d.photo, itemNames: d.itemNames.filter((n) => n.trim()), billNo: d.billNo.trim(), notes: d.notes.trim(), ...(billId ? { billId } : {}),
  }
  if (existingId) {
    const cur = state.prescriptions[existingId]
    if (!cur) throw new OpError('That prescription no longer exists.')
    const p: Prescription = { ...cur, ...base }
    return { prescription: p, changes: { put: { prescriptions: [p], audit: [audit(ctx, 'RX_EDIT', p.no)] } } }
  }
  const p: Prescription = { id: id('rx', ctx.now), no: nextNo('RX-', listOf(state.prescriptions).map((x) => x.no), ctx), date: ctx.now, createdBy: ctx.userId, ...branch(ctx), ...base }
  return { prescription: p, changes: { put: { prescriptions: [p], audit: [audit(ctx, 'RX_CREATE', `${p.no} — ${p.patientName}`)] } } }
}

// ───────────────────────────── apparel: size-grid item creation ─────────────────────────────

/** Opening stock per size × colour cell, keyed `"size|colour"` (colour omitted when the item has none). */
export type SizeGrid = Record<string, number>
export const gridKey = (size: string, color: string) => `${size}|${color}`

/**
 * `createItem` gives every size × colour combination the same opening stock; a size grid wants a different quantity per
 * cell. This runs the core operation once with no opening stock, then sets each variant's stock from the grid — all in
 * one transaction, so the item never exists with the wrong stock even for a moment.
 */
export function createItemWithSizeGrid(state: DataState, d: ItemDraft, grid: SizeGrid, ctx: OpCtx): { changes: Changes; product: Product; variants: Variant[] } {
  const base = createItem(state, { ...d, openingStock: 0 }, ctx)
  const moves = gridMoves(base.variants, grid, ctx)
  if (!moves.length) return base
  const stocked = base.variants.map((v) => {
    const qty = grid[gridKey(v.size, v.color)] ?? 0
    return qty > 0 ? { ...v, stock: qty } : v
  })
  const baseMoves = (base.changes.put?.moves as StockMove[] | undefined) ?? []
  return {
    product: base.product, variants: stocked,
    changes: { ...base.changes, put: { ...base.changes.put, variants: stocked, moves: [...baseMoves, ...moves] } },
  }
}

function gridMoves(variants: Variant[], grid: SizeGrid, ctx: OpCtx): StockMove[] {
  const moves: StockMove[] = []
  for (const v of variants) {
    const qty = grid[gridKey(v.size, v.color)] ?? 0
    if (qty > 0) moves.push({ id: id('mv', ctx.now), variantId: v.id, qty, type: 'opening', ref: 'OPENING', reason: 'Opening stock (size grid)', at: ctx.now, userId: ctx.userId })
  }
  return moves
}

// ───────────────────────────── apparel: alteration jobs ─────────────────────────────

export interface AlterationDraft {
  customerId?: string | null
  partyName: string
  partyPhone: string
  itemDesc: string
  notes: string
  dueDate: number
  charge: number
  billNo?: string
}

function checkAlteration(d: Pick<AlterationDraft, 'itemDesc' | 'dueDate' | 'charge'>) {
  if (!d.itemDesc.trim()) throw new OpError('Say what needs altering.')
  if (!(d.dueDate > 0)) throw new OpError('Give it a due date.')
  if (d.charge < 0) throw new OpError('The charge cannot be negative.')
}

export function saveAlterationJob(state: DataState, d: AlterationDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; job: AlterationJob } {
  checkAlteration(d)
  const customer = d.customerId ? state.customers[d.customerId] : undefined
  const partyName = (customer?.name ?? d.partyName).trim()
  if (!partyName) throw new OpError('Say who it is for.')
  const billId = d.billNo ? billIdForNo(state, d.billNo) : undefined
  const base = {
    customerId: d.customerId ?? null, partyName, partyPhone: (customer?.phone ?? d.partyPhone).trim(), itemDesc: d.itemDesc.trim(),
    notes: d.notes.trim(), dueDate: d.dueDate, charge: round2(d.charge), billNo: (d.billNo ?? '').trim(), ...(billId ? { billId } : {}),
  }
  if (existingId) {
    const cur = state.alterationJobs[existingId]
    if (!cur) throw new OpError('That job no longer exists.')
    const j: AlterationJob = { ...cur, ...base }
    return { job: j, changes: { put: { alterationJobs: [j], audit: [audit(ctx, 'ALTERATION_EDIT', j.no)] } } }
  }
  const j: AlterationJob = {
    id: id('alt', ctx.now), no: nextNo('ALT-', listOf(state.alterationJobs).map((x) => x.no), ctx), date: ctx.now, status: 'received', userId: ctx.userId, ...branch(ctx), ...base,
  }
  return { job: j, changes: { put: { alterationJobs: [j], audit: [audit(ctx, 'ALTERATION_CREATE', `${j.no} — ${j.itemDesc}`)] } } }
}

export function setAlterationStatus(state: DataState, jobId: string, to: AlterationStatus, ctx: OpCtx): { changes: Changes; job: AlterationJob } {
  const cur = state.alterationJobs[jobId]
  if (!cur) throw new OpError('That job no longer exists.')
  if (!nextAlterationStatuses(cur.status).includes(to)) throw new OpError(`A ${cur.status.replace('_', ' ')} job cannot become ${to.replace('_', ' ')}.`)
  const j: AlterationJob = { ...cur, status: to }
  return { job: j, changes: { put: { alterationJobs: [j], audit: [audit(ctx, 'ALTERATION_STATUS', `${cur.no} → ${to}`)] } } }
}

// ───────────────────────────── hardware: BOQ ─────────────────────────────

export interface BoqDraft {
  projectName: string
  customerId?: string | null
  partyName: string
  partyPhone: string
  items: BoqLine[]
  notes: string
}

export function saveBoq(state: DataState, d: BoqDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; boq: Boq } {
  const problem = boqProblem(d.projectName, d.items)
  if (problem) throw new OpError(problem)
  const customer = d.customerId ? state.customers[d.customerId] : undefined
  const base = {
    projectName: d.projectName.trim(), customerId: d.customerId ?? null, partyName: (customer?.name ?? d.partyName).trim(),
    partyPhone: (customer?.phone ?? d.partyPhone).trim(), items: d.items, notes: d.notes.trim(),
  }
  if (existingId) {
    const cur = state.boqs[existingId]
    if (!cur) throw new OpError('That BOQ no longer exists.')
    if (cur.status === 'closed') throw new OpError('A closed BOQ cannot be changed.')
    const b: Boq = { ...cur, ...base }
    return { boq: b, changes: { put: { boqs: [b], audit: [audit(ctx, 'BOQ_EDIT', b.no)] } } }
  }
  const b: Boq = {
    id: id('boq', ctx.now), no: nextNo('BOQ-', listOf(state.boqs).map((x) => x.no), ctx), date: ctx.now, status: 'draft', convertedRef: '', createdBy: ctx.userId, ...branch(ctx), ...base,
  }
  return { boq: b, changes: { put: { boqs: [b], audit: [audit(ctx, 'BOQ_CREATE', `${b.no} — ${b.projectName}`)] } } }
}

/** Moves a BOQ along; `converted` records which sales / purchase order it became (typed by hand — see `types.ts`). */
export function setBoqStatus(state: DataState, boqId: string, to: BoqStatus, ctx: OpCtx, convertedRef?: string): { changes: Changes; boq: Boq } {
  const cur = state.boqs[boqId]
  if (!cur) throw new OpError('That BOQ no longer exists.')
  if (!nextBoqStatuses(cur.status).includes(to)) throw new OpError(`A ${cur.status} BOQ cannot become ${to}.`)
  if (to === 'converted' && !convertedRef?.trim()) throw new OpError('Say which order or quotation this became.')
  const b: Boq = { ...cur, status: to, ...(to === 'converted' ? { convertedRef: convertedRef!.trim(), convertedAt: ctx.now } : {}) }
  return { boq: b, changes: { put: { boqs: [b], audit: [audit(ctx, 'BOQ_STATUS', `${cur.no} → ${to}`)] } } }
}
