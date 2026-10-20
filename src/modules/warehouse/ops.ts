import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import { audit, createItem, OpError, updateVariant, type OpCtx } from '@/data/ops'
import { listOf, mergeChanges, type Changes, type DataState } from '@/data/state'
import { nextNo } from '../numbering'
import {
  batchEffects, batchId, incChanges, isMain, locationName, newBatchInit, normBatchNo, normSerial, serialId, StockBook, stockAt, transferProgress, wouldCycle, writeOffTotal, bundleEconomics,
} from './logic'
import type {
  Batch, BatchMove, BatchMoveInput, Bundle, BundleComponent, ItemRule, Location, LocationType, Serial, SerialStatus, Transfer, TransferLine, TransferReceipt, UnitConversion, WriteOff, WriteOffLine, WriteOffReason,
} from './types'
import { MAIN } from './types'
import './replication'

const mkId = (prefix: string, now: number) => id(prefix, now)
const book = (state: DataState, ctx: OpCtx) => new StockBook(state, ctx, mkId)

function mustLocation(state: DataState, locationId: string) {
  if (isMain(locationId)) return
  const l = state.locations[locationId]
  if (!l || !l.active) throw new OpError('That location does not exist (or is switched off).')
}

// ───────────────────────────── locations ─────────────────────────────

export interface LocationDraft { name: string; type: LocationType; parentId?: string; branchId?: string }

export function saveLocation(state: DataState, d: LocationDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; location: Location } {
  const name = d.name.trim()
  if (!name) throw new OpError('Give the location a name.')
  if (name.toLowerCase() === 'main') throw new OpError('“Main” is the built-in location — choose another name.')
  if (listOf(state.locations).some((l) => l.id !== existingId && l.name.toLowerCase() === name.toLowerCase())) throw new OpError(`There is already a location called ${name}.`)
  if (d.parentId && !state.locations[d.parentId]) throw new OpError('The parent location no longer exists.')
  if (existingId && wouldCycle(state.locations, existingId, d.parentId)) throw new OpError('A location cannot sit inside itself.')
  const cur = existingId ? state.locations[existingId] : undefined
  if (existingId && !cur) throw new OpError('That location no longer exists.')
  const location: Location = { id: cur?.id ?? id('loc', ctx.now), name, type: d.type, active: cur?.active ?? true, createdAt: cur?.createdAt ?? ctx.now, ...(d.parentId ? { parentId: d.parentId } : {}), ...(d.branchId ? { branchId: d.branchId } : {}) }
  return { location, changes: { put: { locations: [location], audit: [audit(ctx, cur ? 'LOCATION_EDIT' : 'LOCATION_ADD', name)] } } }
}

/** A location with stock in it cannot be switched off. */
export function setLocationActive(state: DataState, locationId: string, active: boolean, ctx: OpCtx): { changes: Changes } {
  const l = state.locations[locationId]
  if (!l) throw new OpError('That location no longer exists.')
  if (!active && listOf(state.stockLevels).some((s) => s.locationId === locationId && s.qty !== 0)) throw new OpError('Move the stock out of this location before switching it off.')
  return { changes: { put: { locations: [{ ...l, active }], audit: [audit(ctx, 'LOCATION_STATUS', `${l.name} ${active ? 'on' : 'off'}`)] } } }
}

/**
 * Sets how much of an item sits at a location other than main (an opening count for that shelf, or a correction). The total
 * stock changes by the difference — it is stock coming in, or going missing, at that location.
 */
export function setLocationStock(state: DataState, d: { variantId: string; locationId: string; qty: number; reason?: string }, ctx: OpCtx): { changes: Changes; delta: number } {
  if (isMain(d.locationId)) throw new OpError('Main holds whatever is not at another location — change the total stock instead.')
  mustLocation(state, d.locationId)
  const v = state.variants[d.variantId]
  if (!v) throw new OpError('That item no longer exists.')
  if (!(d.qty >= 0) || !Number.isFinite(d.qty)) throw new OpError('Enter how many are at this location (0 or more).')
  const delta = round3(d.qty - stockAt(state, d.variantId, d.locationId))
  if (delta === 0) throw new OpError('That is already the quantity at this location.')
  const b = book(state, ctx)
  b.move(d.variantId, delta, delta > 0 ? 'opening' : 'adjust', 'LOCATION', d.reason?.trim() || `Count at ${locationName(state, d.locationId)}`, d.locationId)
  return { delta, changes: mergeChanges(b.changes(), { put: { audit: [audit(ctx, 'LOCATION_STOCK', `${v.sku} at ${locationName(state, d.locationId)}: ${delta > 0 ? '+' : ''}${delta}`)] } }) }
}

// ───────────────────────────── transfers ─────────────────────────────

export interface TransferDraft { fromId: string; toId: string; lines: TransferLine[]; notes?: string }

const mergeLines = (lines: TransferLine[]) => {
  const out: TransferLine[] = []
  for (const l of lines) {
    if (!(l.qty > 0)) continue
    const x = out.find((o) => o.variantId === l.variantId)
    if (x) x.qty = round3(x.qty + l.qty); else out.push({ variantId: l.variantId, qty: round3(l.qty) })
  }
  return out
}

/** Sends stock from one place to another. It leaves the source now and counts as "in transit" until it is received. */
export function dispatchTransfer(state: DataState, d: TransferDraft, ctx: OpCtx): { changes: Changes; transfer: Transfer } {
  if (d.fromId === d.toId) throw new OpError('Choose two different places.')
  mustLocation(state, d.fromId); mustLocation(state, d.toId)
  const lines = mergeLines(d.lines)
  if (!lines.length) throw new OpError('Add at least one item with a quantity.')
  const no = nextNo('TR-', listOf(state.transfers).map((t) => t.no), ctx)
  const b = book(state, ctx)
  for (const l of lines) {
    const v = state.variants[l.variantId]
    if (!v) throw new OpError('One of the items no longer exists.')
    const have = stockAt(state, l.variantId, d.fromId)
    if (l.qty > have) throw new OpError(`Only ${have} of ${state.products[v.productId]?.name ?? v.sku} at ${locationName(state, d.fromId)}.`)
    b.move(l.variantId, -l.qty, 'transfer', no, `Transfer to ${locationName(state, d.toId)}`, d.fromId)
  }
  const transfer: Transfer = { id: id('tr', ctx.now), no, fromId: d.fromId, toId: d.toId, lines, date: ctx.now, userId: ctx.userId, notes: (d.notes ?? '').trim(), ...(ctx.branchId ? { branchId: ctx.branchId } : {}) }
  return { transfer, changes: mergeChanges(b.changes(), { put: { transfers: [transfer], audit: [audit(ctx, 'TRANSFER_SEND', `${no}: ${locationName(state, d.fromId)} → ${locationName(state, d.toId)}`)] } }) }
}

/**
 * Records what arrived. Receive part now and the rest later, or close the transfer short when the rest is not coming (it is
 * then lost in transit; the books write it off by themselves — see `transferLossPosting`).
 */
export function receiveTransfer(state: DataState, transferId: string, lines: TransferLine[], o: { closed?: boolean; notes?: string }, ctx: OpCtx): { changes: Changes; receipt: TransferReceipt } {
  const t = state.transfers[transferId]
  if (!t) throw new OpError('That transfer no longer exists.')
  const progress = transferProgress(t, listOf(state.transferReceipts))
  if (progress.status === 'received' || progress.status === 'closed_short') throw new OpError('This transfer is already complete.')
  const got = mergeLines(lines)
  if (!got.length && !o.closed) throw new OpError('Enter what arrived.')
  const b = book(state, ctx)
  for (const l of got) {
    const row = progress.lines.find((x) => x.variantId === l.variantId)
    if (!row) throw new OpError('That item is not on this transfer.')
    if (l.qty > row.outstanding) throw new OpError(`Only ${row.outstanding} of that item are still on the way.`)
    b.move(l.variantId, l.qty, 'transfer', t.no, `Transfer from ${locationName(state, t.fromId)}`, t.toId)
  }
  const lost = o.closed ? progress.lines.map((l) => ({ variantId: l.variantId, qty: Math.max(0, round3(l.outstanding - (got.find((x) => x.variantId === l.variantId)?.qty ?? 0))) })) : []
  const short = lost.reduce((s, l) => s + l.qty, 0)
  const lossValue = round2(lost.reduce((s, l) => s + l.qty * (state.variants[l.variantId]?.avgCost ?? state.variants[l.variantId]?.cost ?? 0), 0))
  const receipt: TransferReceipt = { id: id('trr', ctx.now), transferId, lines: got, date: ctx.now, userId: ctx.userId, closed: !!o.closed, ...(o.closed && lossValue > 0 ? { lossValue } : {}), notes: (o.notes ?? '').trim() }
  return { receipt, changes: mergeChanges(b.changes(), { put: { transferReceipts: [receipt], audit: [audit(ctx, 'TRANSFER_RECEIVE', `${t.no}${o.closed ? ` closed${short ? `, ${round3(short)} short` : ''}` : ''}`)] } }) }
}

// ───────────────────────────── batches ─────────────────────────────

export type { BatchMoveInput }

/** Batch movements plus what they do to the batches' quantities (the same arithmetic the server runs). */
export function batchChanges(state: DataState, moves: BatchMoveInput[], ctx: OpCtx): Changes {
  if (!moves.length) return {}
  const docs: BatchMove[] = moves.map((m) => ({ id: mkId('bm', ctx.now), at: ctx.now, userId: ctx.userId, ...m }))
  return mergeChanges({ put: { batchMoves: docs } }, incChanges(state, docs.flatMap(batchEffects)))
}

export interface BatchDraft { variantId: string; batchNo: string; qty: number; mfgDate?: number; expiry?: number; cost?: number; locationId?: string }

/**
 * Gives stock you already hold a batch number and expiry (the opening batches when you start using the module). The item's total
 * stock does not change — this only says which batch it belongs to.
 */
export function addOpeningBatch(state: DataState, d: BatchDraft, ctx: OpCtx): { changes: Changes; batchId: string } {
  const v = state.variants[d.variantId]
  if (!v) throw new OpError('Choose the item.')
  const no = normBatchNo(d.batchNo)
  if (!no) throw new OpError('Enter the batch number.')
  if (!(d.qty > 0)) throw new OpError('Enter how many are in this batch.')
  if (d.mfgDate && d.expiry && d.expiry < d.mfgDate) throw new OpError('The expiry date is before the manufacturing date.')
  const bid = batchId(d.variantId, no)
  const init = newBatchInit(d.variantId, no, { receivedAt: ctx.now, ...(d.mfgDate ? { mfgDate: d.mfgDate } : {}), ...(d.expiry ? { expiry: d.expiry } : {}), ...(d.cost ? { cost: d.cost } : {}), ...(d.locationId && !isMain(d.locationId) ? { locationId: d.locationId } : {}) })
  const changes = mergeChanges(batchChanges(state, [{ batchId: bid, variantId: d.variantId, qty: round3(d.qty), reason: 'opening', ref: 'OPENING', batch: init }], ctx), { put: { audit: [audit(ctx, 'BATCH_ADD', `${v.sku} batch ${no} × ${d.qty}`)] } })
  return { changes, batchId: bid }
}

/** Corrects a batch's quantity (a count showed a difference). Item totals are not touched. */
export function adjustBatch(state: DataState, bid: string, delta: number, reason: string, ctx: OpCtx): { changes: Changes } {
  const b = state.batches[bid]
  if (!b) throw new OpError('That batch no longer exists.')
  if (!delta || !Number.isFinite(delta)) throw new OpError('Enter how many to add or remove.')
  if (round3(b.qty + delta) < 0) throw new OpError('A batch cannot go below zero.')
  return { changes: mergeChanges(batchChanges(state, [{ batchId: bid, variantId: b.variantId, qty: round3(delta), reason: 'adjust', ref: reason.trim() || 'ADJUST', batch: undefined }], ctx), { put: { audit: [audit(ctx, 'BATCH_ADJUST', `${b.batchNo}: ${delta > 0 ? '+' : ''}${delta}${reason ? ` — ${reason}` : ''}`)] } }) }
}

// ───────────────────────────── item rules & unit conversions ─────────────────────────────

export function saveItemRule(state: DataState, productId: string, patch: Partial<Omit<ItemRule, 'id'>>, ctx: OpCtx): { changes: Changes } {
  const p = state.products[productId]
  if (!p) throw new OpError('That item no longer exists.')
  if (patch.warrantyMonths !== undefined && !(patch.warrantyMonths >= 0 && Number.isInteger(patch.warrantyMonths))) throw new OpError('Warranty is a whole number of months.')
  const next: ItemRule = { ...(state.itemRules[productId] ?? { id: productId }), ...patch, id: productId }
  const empty = !next.trackSerial && !next.trackBatch && !next.warrantyMonths
  const log = audit(ctx, 'ITEM_RULE', `${p.styleCode}: ${[next.trackSerial && 'serials', next.trackBatch && 'batches', next.warrantyMonths && `${next.warrantyMonths}-month warranty`].filter(Boolean).join(', ') || 'none'}`)
  return { changes: empty ? { del: { itemRules: state.itemRules[productId] ? [productId] : [] }, put: { audit: [log] } } : { put: { itemRules: [next], audit: [log] } } }
}

export interface ConversionDraft { productId: string; unit: string; factor: number; price?: number }

export function saveUnitConversion(state: DataState, d: ConversionDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; conversion: UnitConversion } {
  if (!state.products[d.productId]) throw new OpError('Choose the item.')
  const unit = d.unit.trim().toLowerCase()
  if (!unit) throw new OpError('Name the bigger unit (box, carton, strip…).')
  if (!(d.factor > 1) || !Number.isFinite(d.factor)) throw new OpError('One of the bigger unit must hold more than one base unit.')
  if (listOf(state.unitConversions).some((c) => c.id !== existingId && c.productId === d.productId && c.unit === unit)) throw new OpError(`${unit} is already set up for this item.`)
  const conversion: UnitConversion = { id: existingId ?? id('uc', ctx.now), productId: d.productId, unit, factor: round3(d.factor), ...(d.price && d.price > 0 ? { price: round2(d.price) } : {}) }
  return { conversion, changes: { put: { unitConversions: [conversion], audit: [audit(ctx, 'UNIT_CONVERSION', `${state.products[d.productId].styleCode}: 1 ${unit} = ${conversion.factor}`)] } } }
}

export function deleteUnitConversion(state: DataState, conversionId: string, ctx: OpCtx): { changes: Changes } {
  const c = state.unitConversions[conversionId]
  if (!c) throw new OpError('That conversion no longer exists.')
  return { changes: { del: { unitConversions: [conversionId] }, put: { audit: [audit(ctx, 'UNIT_CONVERSION_DELETE', c.unit)] } } }
}

// ───────────────────────────── bundles ─────────────────────────────

export interface BundleDraft { name: string; categoryId: string; components: BundleComponent[]; price: number }

function cleanComponents(state: DataState, list: BundleComponent[]): BundleComponent[] {
  const out: BundleComponent[] = []
  for (const c of list) {
    if (!(c.qty > 0)) continue
    if (!state.variants[c.variantId]) throw new OpError('One of the components no longer exists.')
    const x = out.find((o) => o.variantId === c.variantId)
    if (x) x.qty = round3(x.qty + c.qty); else out.push({ variantId: c.variantId, qty: round3(c.qty) })
  }
  if (out.length < 1) throw new OpError('A kit needs at least one component.')
  return out
}

/** Creates a kit: a no-stock item you sell, whose components come off the shelf when it is sold. */
export function createBundle(state: DataState, d: BundleDraft, ctx: OpCtx): { changes: Changes; bundle: Bundle } {
  const name = d.name.trim()
  if (!name) throw new OpError('Give the kit a name.')
  if (!(d.price > 0)) throw new OpError('Set the kit’s selling price.')
  const components = cleanComponents(state, d.components)
  for (const c of components) if (bundleKitOf(state, c.variantId)) throw new OpError('A kit cannot contain another kit.')
  let n = listOf(state.bundles).length + 1
  let styleCode = `KIT-${String(n).padStart(3, '0')}`
  while (listOf(state.products).some((p) => p.styleCode === styleCode)) styleCode = `KIT-${String(++n).padStart(3, '0')}`
  const econ = bundleEconomics(state, components, d.price)
  const made = createItem(state, { name, styleCode, categoryId: d.categoryId, brand: '', fabric: '', season: '', hsn: '', sizes: [''], colors: [''], cost: econ.cost, mrp: Math.max(d.price, econ.separately), price: d.price, trackStock: false }, ctx)
  const bundle: Bundle = { id: id('bun', ctx.now), variantId: made.variants[0].id, name, components, price: round2(d.price), active: true, createdAt: ctx.now }
  const changes = mergeChanges(made.changes, { put: { bundles: [bundle], audit: [audit(ctx, 'BUNDLE_ADD', `${name} — ${components.length} components`)] } })
  delete changes.outbox
  return { bundle, changes }
}

const bundleKitOf = (state: DataState, variantId: string) => listOf(state.bundles).find((b) => b.active && b.variantId === variantId)

export function updateBundle(state: DataState, bundleId: string, d: { name?: string; components?: BundleComponent[]; price?: number; active?: boolean }, ctx: OpCtx): { changes: Changes; bundle: Bundle } {
  const cur = state.bundles[bundleId]
  if (!cur) throw new OpError('That kit no longer exists.')
  const components = d.components ? cleanComponents(state, d.components) : cur.components
  for (const c of components) if (bundleKitOf(state, c.variantId) && c.variantId !== cur.variantId) throw new OpError('A kit cannot contain another kit.')
  const price = d.price ?? cur.price
  if (!(price > 0)) throw new OpError('Set the kit’s selling price.')
  const bundle: Bundle = { ...cur, name: (d.name ?? cur.name).trim() || cur.name, components, price: round2(price), active: d.active ?? cur.active }
  const parts: Changes[] = [{ put: { bundles: [bundle], audit: [audit(ctx, 'BUNDLE_EDIT', bundle.name)] } }]
  if (state.variants[cur.variantId]) {
    const econ = bundleEconomics(state, components, bundle.price)
    const up = updateVariant(state, cur.variantId, { price: bundle.price, cost: econ.cost, mrp: Math.max(bundle.price, econ.separately) }, ctx).changes
    delete up.outbox
    parts.push(up)
    // A kit that is off is hidden from the counter (it would otherwise sell without taking its parts off the shelf).
    const prod = state.products[state.variants[cur.variantId].productId]
    if (prod && prod.active !== bundle.active) parts.push({ put: { products: [{ ...prod, active: bundle.active }] } })
  }
  return { bundle, changes: mergeChanges(...parts) }
}

// ───────────────────────────── serials ─────────────────────────────

/** Puts a serial number into the system for an item you already hold (no stock change). */
export function registerSerial(state: DataState, d: { variantId: string; serial: string; warrantyMonths?: number }, ctx: OpCtx): { changes: Changes; serial: Serial } {
  const v = state.variants[d.variantId]
  if (!v) throw new OpError('Choose the item.')
  const serial = d.serial.trim()
  if (serial.length < 3) throw new OpError('Enter the serial number.')
  const sid = serialId(d.variantId, serial)
  const cur = state.serials[sid]
  if (cur && cur.status === 'in_stock') throw new OpError(`${serial} is already in stock.`)
  const doc: Serial = { id: sid, variantId: d.variantId, serial: normSerial(serial), status: 'in_stock', receivedAt: ctx.now, ...(d.warrantyMonths ? { warrantyMonths: d.warrantyMonths } : {}), history: [...(cur?.history ?? []), { at: ctx.now, status: 'in_stock', ref: 'MANUAL' }] }
  return { serial: doc, changes: { put: { serials: [doc], audit: [audit(ctx, 'SERIAL_ADD', `${v.sku} ${doc.serial}`)] } } }
}

/** A customer brought the unit back and it is back on the shelf (stock itself comes back through the return). */
export function setSerialStatus(state: DataState, serialIdValue: string, status: SerialStatus, ref: string, ctx: OpCtx): { changes: Changes } {
  const s = state.serials[serialIdValue]
  if (!s) throw new OpError('That serial number is not in the system.')
  if (s.status === status) throw new OpError('It already has that status.')
  const next: Serial = { ...s, status, history: [...s.history, { at: ctx.now, status, ref }], ...(status === 'in_stock' ? { billId: undefined, billNo: undefined, customerId: undefined, soldAt: undefined, warrantyUntil: undefined } : {}) }
  return { changes: { put: { serials: [next], audit: [audit(ctx, 'SERIAL_STATUS', `${s.serial} → ${status}`)] } } }
}

// ───────────────────────────── write-offs ─────────────────────────────

export interface WriteOffDraft { reason: WriteOffReason; lines: Array<{ variantId: string; qty: number; batchId?: string; serial?: string; locationId?: string }>; notes?: string }

/**
 * Takes damaged, expired, sampled or stolen stock off the books at cost. Each line leaves the stock (at its location), the batch and
 * the serial if named; the loss is posted to the books by the accounting rule for write-offs.
 */
export function postWriteOff(state: DataState, d: WriteOffDraft, ctx: OpCtx): { changes: Changes; writeOff: WriteOff } {
  if (!d.lines.length) throw new OpError('Add at least one item.')
  const no = nextNo('WO-', listOf(state.writeOffs).map((w) => w.no), ctx)
  const b = book(state, ctx)
  const lines: WriteOffLine[] = []
  const batchMoves: BatchMoveInput[] = []
  const serialPuts: Serial[] = []
  for (const l of d.lines) {
    const v = state.variants[l.variantId]
    if (!v) throw new OpError('One of the items no longer exists.')
    if (!(l.qty > 0)) throw new OpError('Every line needs a quantity.')
    const loc = l.locationId ?? MAIN
    mustLocation(state, loc)
    const have = stockAt(state, l.variantId, loc)
    const tracked = state.products[v.productId]?.trackStock !== false
    if (state.itemRules[v.productId]?.trackSerial && !l.serial) throw new OpError(`Choose the serial number of ${state.products[v.productId]?.name ?? v.sku} (one unit per line).`)
    if (l.serial && l.qty !== 1) throw new OpError('A serial number is one unit — use one line for each.')
    if (tracked && l.qty > have) throw new OpError(`Only ${have} of ${state.products[v.productId]?.name ?? v.sku} at ${locationName(state, loc)}.`)
    if (l.batchId) {
      const batch = state.batches[l.batchId]
      if (!batch || batch.variantId !== l.variantId) throw new OpError('That batch is not for this item.')
      if (l.qty > batch.qty) throw new OpError(`Batch ${batch.batchNo} only has ${batch.qty}.`)
      batchMoves.push({ batchId: l.batchId, variantId: l.variantId, qty: -l.qty, reason: 'writeoff', ref: no })
    }
    if (l.serial) {
      const sr = state.serials[serialId(l.variantId, l.serial)]
      if (!sr || sr.status !== 'in_stock') throw new OpError(`${l.serial} is not in stock.`)
      serialPuts.push({ ...sr, status: 'written_off', history: [...sr.history, { at: ctx.now, status: 'written_off', ref: no }] })
    }
    if (tracked) b.move(l.variantId, -l.qty, 'adjust', no, `Write-off: ${d.reason}`, l.locationId)
    lines.push({ variantId: l.variantId, qty: l.qty, cost: round2(v.avgCost ?? v.cost), ...(l.batchId ? { batchId: l.batchId } : {}), ...(l.serial ? { serial: l.serial } : {}), ...(l.locationId && !isMain(l.locationId) ? { locationId: l.locationId } : {}) })
  }
  const writeOff: WriteOff = { id: id('wo', ctx.now), no, date: ctx.now, reason: d.reason, lines, total: writeOffTotal(lines), notes: (d.notes ?? '').trim(), userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) }
  const changes = mergeChanges(b.changes(), batchChanges(state, batchMoves, ctx), { put: { writeOffs: [writeOff], ...(serialPuts.length ? { serials: serialPuts } : {}), audit: [audit(ctx, 'WRITE_OFF', `${no} ${d.reason} — ₹${writeOff.total}`)] } })
  return { writeOff, changes }
}

export type { Batch }
