import type { BillItem, StockMove } from '@/domain/types'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import { listOf, type Changes, type DataState } from '@/data/state'
import type { Effect } from '@/replication/registry'
import type { Doc } from '@/replication/types'
import type {
  Batch, BatchInit, BatchMove, Bundle, ItemRule, Location, Serial, StockLevel, Transfer, TransferLine, TransferReceipt, UnitConversion, WriteOff, WriteOffReason,
} from './types'
import { MAIN } from './types'

const DAY = 86_400_000
const clean = (n: number) => Math.round(n * 10_000) / 10_000

// ───────────────────────────── ids ─────────────────────────────

const slug = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '')
/** "Oxford Shirt · M / Navy" — what a screen calls a variant. */
export function variantName(state: DataState, variantId: string): string {
  const v = state.variants[variantId]
  if (!v) return 'Item'
  const opts = [v.size, v.color].filter(Boolean).join(' / ')
  return `${state.products[v.productId]?.name ?? 'Item'}${opts ? ` · ${opts}` : ''}`
}

export const normBatchNo = (s: string) => s.trim().toUpperCase()
export const normSerial = (s: string) => s.trim().toUpperCase()

/** The same batch number of the same item is the same batch, whichever phone receives it. */
export const batchId = (variantId: string, batchNo: string) => `bt_${variantId}_${slug(batchNo)}`
export const serialId = (variantId: string, serial: string) => `sr_${variantId}_${slug(serial)}`
export const levelId = (variantId: string, locationId: string) => `${variantId}@${locationId}`
export const isMain = (locationId?: string | null) => !locationId || locationId === MAIN

// ───────────────────────────── locations & levels ─────────────────────────────

/**
 * What a stock movement does to the per-location levels: a movement that names a location other than main changes that
 * location's level. (Main is the remainder, so it needs no stored number.) The server runs exactly this; so does the phone.
 */
export function levelEffects(move: Pick<StockMove, 'variantId' | 'qty' | 'locationId'>): Effect[] {
  if (isMain(move.locationId)) return []
  const loc = move.locationId!
  const init: Doc = { id: levelId(move.variantId, loc), variantId: move.variantId, locationId: loc, qty: 0 }
  return [{ kind: 'inc', coll: 'stockLevels', id: init.id, field: 'qty', by: move.qty, init }]
}

/** Applies a list of effects to the phone's own copy of the documents (the same arithmetic the server does). */
export function incChanges(state: DataState, effects: Effect[]): Changes {
  const puts: Record<string, Record<string, Doc>> = {}
  const cur = (coll: string, id: string) => puts[coll]?.[id] ?? (state as unknown as Record<string, Record<string, Doc>>)[coll]?.[id]
  for (const e of effects) {
    if (e.kind !== 'inc') continue
    let doc = cur(e.coll, e.id)
    if (!doc) { if (!e.init) continue; doc = { ...e.init } }
    let v = clean((typeof doc[e.field] === 'number' ? (doc[e.field] as number) : 0) + e.by)
    if (e.min !== undefined && v < e.min) v = e.min
    ;(puts[e.coll] ??= {})[e.id] = { ...doc, [e.field]: v }
  }
  const out: Changes = {}
  for (const [coll, docs] of Object.entries(puts)) { out.put ??= {}; (out.put as Record<string, unknown[]>)[coll] = Object.values(docs) }
  return out
}

/** The levels at every non-main location for one variant. */
export const levelsOf = (state: DataState, variantId: string): StockLevel[] => listOf(state.stockLevels).filter((l) => l.variantId === variantId)

/** On hand at a location. Main = the variant's total minus everything held elsewhere. */
export function stockAt(state: DataState, variantId: string, locationId: string = MAIN): number {
  if (isMain(locationId)) {
    const total = state.variants[variantId]?.stock ?? 0
    return round3(total - levelsOf(state, variantId).reduce((s, l) => s + l.qty, 0))
  }
  return round3(state.stockLevels[levelId(variantId, locationId)]?.qty ?? 0)
}

export interface LocationStock { locationId: string; name: string; qty: number }
export function stockByLocation(state: DataState, variantId: string): LocationStock[] {
  const out: LocationStock[] = [{ locationId: MAIN, name: 'Main', qty: stockAt(state, variantId) }]
  for (const l of levelsOf(state, variantId)) if (l.qty !== 0) out.push({ locationId: l.locationId, name: state.locations[l.locationId]?.name ?? 'Unknown location', qty: round3(l.qty) })
  return out
}

export const locationName = (state: DataState, id: string) => (isMain(id) ? 'Main' : state.locations[id]?.name ?? 'Unknown location')

/** Every active location, main first, with the path of its parents ("Warehouse › Shelf A"). */
export function locationOptions(state: DataState): Array<{ id: string; label: string }> {
  const path = (l: Location): string => (l.parentId && state.locations[l.parentId] && l.parentId !== l.id ? `${path(state.locations[l.parentId])} › ${l.name}` : l.name)
  return [{ id: MAIN, label: 'Main' }, ...listOf(state.locations).filter((l) => l.active).map((l) => ({ id: l.id, label: path(l) })).sort((a, b) => a.label.localeCompare(b.label))]
}

/** A location may not become its own ancestor. */
export function wouldCycle(locations: Record<string, Location>, id: string, parentId: string | undefined): boolean {
  for (let p = parentId, n = 0; p && n < 50; p = locations[p]?.parentId, n++) if (p === id) return true
  return false
}

// ───────────────────────────── batches & expiry ─────────────────────────────

/** What a batch movement does to the batch: its quantity changes, and the first movement brings the batch into being. */
export function batchEffects(m: BatchMove): Effect[] {
  const init: Doc | undefined = m.batch ? { id: m.batchId, ...m.batch, qty: 0 } : undefined
  return [{ kind: 'inc', coll: 'batches', id: m.batchId, field: 'qty', by: m.qty, ...(init ? { init } : {}) }]
}

export const isExpired = (b: Pick<Batch, 'expiry'>, now: number) => !!b.expiry && b.expiry < startOfDay(now)
export const daysToExpiry = (b: Pick<Batch, 'expiry'>, now: number) => (b.expiry ? Math.floor((b.expiry - startOfDay(now)) / DAY) : null)
const startOfDay = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }

export const batchesOf = (state: DataState, variantId: string): Batch[] => listOf(state.batches).filter((b) => b.variantId === variantId)
export const liveBatches = (state: DataState, variantId: string): Batch[] => batchesOf(state, variantId).filter((b) => b.qty > 0)

export interface Allocation { batchId: string; qty: number }

/**
 * First-expiry-first-out: take from the batch that expires soonest (no expiry date goes last, then oldest first). Expired
 * batches are skipped unless `allowExpired`. A preferred batch (picked at the counter) is used first. `short` is what no
 * batch could cover — the rest of the sale simply has no batch.
 */
export function allocateFefo(batches: Batch[], qty: number, o: { now: number; preferId?: string; allowExpired?: boolean }): { alloc: Allocation[]; short: number } {
  const usable = batches.filter((b) => b.qty > 0 && (o.allowExpired || !isExpired(b, o.now)))
  const rank = (b: Batch) => (b.id === o.preferId ? -1 : 0)
  usable.sort((a, b) => rank(a) - rank(b) || (a.expiry ?? Infinity) - (b.expiry ?? Infinity) || a.receivedAt - b.receivedAt)
  const alloc: Allocation[] = []
  let left = round3(qty)
  for (const b of usable) {
    if (left <= 0) break
    const take = round3(Math.min(left, b.qty))
    if (take > 0) { alloc.push({ batchId: b.id, qty: take }); left = round3(left - take) }
  }
  return { alloc, short: Math.max(0, left) }
}

/** Stock exists in batches, but every batch with stock has expired. */
export const onlyExpiredLeft = (batches: Batch[], now: number) => {
  const have = batches.filter((b) => b.qty > 0)
  return have.length > 0 && have.every((b) => isExpired(b, now))
}

export interface ExpiryRow { batch: Batch; name: string; days: number | null; value: number }

/** Batches that have stock and are expired or expire within `windowDays` (use Infinity for all), soonest first. */
export function expiryReport(state: DataState, now: number, windowDays: number): ExpiryRow[] {
  const rows: ExpiryRow[] = []
  for (const b of listOf(state.batches)) {
    if (b.qty <= 0 || !b.expiry) continue
    const days = daysToExpiry(b, now)
    if (days === null || days > windowDays) continue
    const v = state.variants[b.variantId]
    rows.push({ batch: b, name: variantName(state, b.variantId), days, value: round2(b.qty * (b.cost ?? v?.avgCost ?? v?.cost ?? 0)) })
  }
  return rows.sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
}

export const expiredValue = (rows: ExpiryRow[]) => round2(rows.filter((r) => (r.days ?? 1) < 0).reduce((s, r) => s + r.value, 0))

/** Every batch with stock, grouped by item: how much of each, and when it expires. */
export function batchWise(state: DataState): Array<{ variantId: string; name: string; total: number; batches: Batch[] }> {
  const by = new Map<string, Batch[]>()
  for (const b of listOf(state.batches)) if (b.qty > 0) by.set(b.variantId, [...(by.get(b.variantId) ?? []), b])
  return [...by.entries()].map(([variantId, batches]) => {
    const v = state.variants[variantId]
    return { variantId, name: variantName(state, variantId), total: round3(batches.reduce((s, b) => s + b.qty, 0)), batches: batches.sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity)) }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/** A batch for a movement that brings it in. */
export const newBatchInit = (variantId: string, batchNo: string, o: Omit<BatchInit, 'variantId' | 'batchNo'>): BatchInit => ({ variantId, batchNo: normBatchNo(batchNo), ...o })

// ───────────────────────────── serials & warranty ─────────────────────────────

export function addMonths(ms: number, months: number): number {
  const d = new Date(ms)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return d.getTime()
}

export const warrantyUntil = (soldAt: number, months: number | undefined) => (months && months > 0 ? addMonths(soldAt, months) : undefined)

export type WarrantyState = { kind: 'none' } | { kind: 'active'; days: number } | { kind: 'expired'; days: number }
export function warrantyState(s: Pick<Serial, 'warrantyUntil' | 'status'>, now: number): WarrantyState {
  if (!s.warrantyUntil || s.status !== 'sold') return { kind: 'none' }
  const days = Math.ceil((s.warrantyUntil - now) / DAY)
  return days >= 0 ? { kind: 'active', days } : { kind: 'expired', days: -days }
}

export const serialsOfBill = (state: DataState, billId: string): Serial[] => listOf(state.serials).filter((s) => s.billId === billId)

/** Finds serials by what was typed or scanned: the whole serial, or the end of it (the last digits of an IMEI). */
export function findSerials(state: DataState, text: string): Serial[] {
  const n = normSerial(text)
  if (n.length < 3) return []
  const all = listOf(state.serials)
  const exact = all.filter((s) => normSerial(s.serial) === n)
  return exact.length ? exact : all.filter((s) => normSerial(s.serial).endsWith(n) || normSerial(s.serial).includes(n)).slice(0, 30)
}

export const ruleFor = (state: DataState, variantId: string): ItemRule | undefined => {
  const v = state.variants[variantId]
  return v ? state.itemRules[v.productId] : undefined
}

// ───────────────────────────── transfers ─────────────────────────────

export type TransferStatus = 'in_transit' | 'partial' | 'received' | 'closed_short'

export interface TransferProgress {
  status: TransferStatus
  /** Per variant: sent, received so far, still on the way (zero once the transfer is closed). */
  lines: Array<{ variantId: string; sent: number; received: number; outstanding: number; lost: number }>
  outstandingTotal: number
}

export function transferProgress(transfer: Transfer, receipts: TransferReceipt[]): TransferProgress {
  const mine = receipts.filter((r) => r.transferId === transfer.id)
  const closed = mine.some((r) => r.closed)
  const lines = transfer.lines.map((l) => {
    const received = round3(mine.reduce((s, r) => s + r.lines.filter((x) => x.variantId === l.variantId).reduce((a, x) => a + x.qty, 0), 0))
    const left = Math.max(0, round3(l.qty - received))
    return { variantId: l.variantId, sent: l.qty, received, outstanding: closed ? 0 : left, lost: closed ? left : 0 }
  })
  const outstandingTotal = round3(lines.reduce((s, l) => s + l.outstanding, 0))
  const got = lines.reduce((s, l) => s + l.received, 0)
  const status: TransferStatus = closed ? (lines.some((l) => l.lost > 0) ? 'closed_short' : 'received') : outstandingTotal === 0 ? 'received' : got > 0 ? 'partial' : 'in_transit'
  return { status, lines, outstandingTotal }
}

export const transferIsOpen = (p: TransferProgress) => p.status === 'in_transit' || p.status === 'partial'

export function openTransfers(state: DataState): Array<{ transfer: Transfer; progress: TransferProgress }> {
  const receipts = listOf(state.transferReceipts)
  return listOf(state.transfers).map((t) => ({ transfer: t, progress: transferProgress(t, receipts) })).filter((x) => transferIsOpen(x.progress)).sort((a, b) => a.transfer.date - b.transfer.date)
}

export const STATUS_LABEL: Record<TransferStatus, string> = { in_transit: 'In transit', partial: 'Part received', received: 'Received', closed_short: 'Closed short' }

export const linesTotalQty = (lines: TransferLine[]) => round3(lines.reduce((s, l) => s + l.qty, 0))

// ───────────────────────────── unit conversions ─────────────────────────────

export const conversionsOf = (state: DataState, productId: string): UnitConversion[] => listOf(state.unitConversions).filter((c) => c.productId === productId)

/** n of the bigger unit → how many base units. */
export const toBase = (conv: Pick<UnitConversion, 'factor'>, n: number) => round3(n * conv.factor)

/** A number of base units as whole bigger units plus a remainder: 40 pieces at 12 per box → 3 box + 4 pc. */
export function fromBase(base: number, conv: Pick<UnitConversion, 'factor'>): { big: number; rest: number } {
  const sign = base < 0 ? -1 : 1
  const abs = Math.abs(base)
  const big = Math.floor(round3(abs / conv.factor))
  return { big: sign * big, rest: sign * round3(abs - big * conv.factor) }
}

/** "3 box + 4 pc" (or just "40 pc" when there is no conversion or less than one box). */
export function formatUnits(base: number, baseLabel: string, conv?: Pick<UnitConversion, 'factor' | 'unit'>): string {
  const n = (x: number) => String(round3(x))
  if (!conv || conv.factor <= 1 || Math.abs(base) < conv.factor) return `${n(base)} ${baseLabel}`
  const { big, rest } = fromBase(base, conv)
  return rest ? `${big} ${conv.unit} + ${n(rest)} ${baseLabel}` : `${big} ${conv.unit}`
}

// ───────────────────────────── bundles / kits ─────────────────────────────

export const bundleOf = (state: DataState, variantId: string): Bundle | undefined => listOf(state.bundles).find((b) => b.variantId === variantId && b.active)
export const kitsContaining = (state: DataState, variantId: string): Bundle[] => listOf(state.bundles).filter((b) => b.active && b.components.some((c) => c.variantId === variantId))

/** What the components of a kit cost, and the margin on its price. */
export function bundleEconomics(state: DataState, components: Array<{ variantId: string; qty: number }>, price: number) {
  const cost = round2(components.reduce((s, c) => { const v = state.variants[c.variantId]; return s + c.qty * (v?.avgCost ?? v?.cost ?? 0) }, 0))
  const separately = round2(components.reduce((s, c) => s + c.qty * (state.variants[c.variantId]?.price ?? 0), 0))
  return { cost, separately, margin: price > 0 ? round2(((price - cost) / price) * 100) : 0, saving: round2(separately - price) }
}

export interface Consumption { variantId: string; qty: number; viaKit?: string; itemIndex: number }

/** What a bill takes off the shelves: each plain line, and the components of each kit line. */
export function consumptionOf(state: DataState, items: BillItem[]): Consumption[] {
  const out: Consumption[] = []
  items.forEach((it, itemIndex) => {
    const kit = bundleOf(state, it.variantId)
    if (kit) { for (const c of kit.components) out.push({ variantId: c.variantId, qty: round3(c.qty * it.qty), viaKit: it.variantId, itemIndex }) }
    else out.push({ variantId: it.variantId, qty: it.qty, itemIndex })
  })
  return out
}

// ───────────────────────────── bills: what this module keeps on them ─────────────────────────────

/** What the sell screen attaches to a bill line (`BillItem.ext.warehouse`). */
export interface LineExt {
  /** The batch the seller picked; first-expiry-first-out fills in the rest. */
  batchId?: string
  /** A manager agreed to sell stock that is past its date. */
  allowExpired?: boolean
  /** Serial / IMEI numbers sold on this line (one per unit). */
  serials?: string[]
  /** Take the stock from this location instead of main. */
  locationId?: string
  /** Sold as whole packs of a bigger unit ("2 box"): the pack price applies to those. */
  packs?: { unit: string; n: number }
}

export const lineExt = (it: { ext?: Record<string, unknown> }): LineExt => ((it.ext?.warehouse as LineExt | undefined) ?? {})

/** What the goods-receipt screen attaches to a purchase (`Purchase.ext.warehouse`). */
export interface ReceiptLineExt { batchNo?: string; mfgDate?: number; expiry?: number; serials?: string[] }
export interface ReceiptExt { locationId?: string; lines?: Record<string, ReceiptLineExt> }
export const receiptExt = (p: { ext?: Record<string, unknown> }): ReceiptExt => ((p.ext?.warehouse as ReceiptExt | undefined) ?? {})

/** Batch movements of one bill, newest last. */
export const batchMovesOfBill = (state: DataState, billId: string): BatchMove[] =>
  listOf(state.batchMoves).filter((m) => m.billId === billId).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))

/**
 * A return gives `qty` of a variant back: put it into the batches the sale took it from, in the order it took it, skipping what
 * earlier returns already restored. Read from the batch ledger — the truth — not from anything stored on the bill.
 */
export function restorePlan(state: DataState, billId: string, variantId: string, qty: number, viaKit?: string): Allocation[] {
  const mine = batchMovesOfBill(state, billId).filter((m) => m.variantId === variantId && (m.viaKit ?? undefined) === (viaKit ?? undefined))
  const free = new Map<string, number>()
  for (const m of mine) {
    if (m.reason === 'sale') free.set(m.batchId, round3((free.get(m.batchId) ?? 0) - m.qty))
    else if (m.reason === 'return') free.set(m.batchId, round3((free.get(m.batchId) ?? 0) - m.qty))
  }
  const out: Allocation[] = []
  let left = round3(qty)
  // The order the sale took them in (soonest expiry first), so a part return refills the batch that was emptied first.
  const order = [...free.entries()].sort(([a], [b]) => (state.batches[a]?.expiry ?? Infinity) - (state.batches[b]?.expiry ?? Infinity) || (state.batches[a]?.receivedAt ?? 0) - (state.batches[b]?.receivedAt ?? 0))
  for (const [bid, avail] of order) {
    if (left <= 0) break
    const take = Math.min(left, Math.max(0, avail))
    if (take > 0) { out.push({ batchId: bid, qty: take }); left = round3(left - take) }
  }
  return out
}

// ───────────────────────────── write-offs ─────────────────────────────

export const writeOffTotal = (lines: Array<{ qty: number; cost: number }>) => round2(lines.reduce((s, l) => s + l.qty * l.cost, 0))
export const REASON_LABEL: Record<WriteOffReason, string> = { damage: 'Damaged', expiry: 'Expired', sample: 'Sample / free', theft: 'Lost / theft' }

/** Value lost at cost, by reason, for write-offs in a period. */
export function lossesByReason(writeOffs: WriteOff[], from: number, to: number): Array<{ reason: WriteOffReason; count: number; total: number }> {
  const m = new Map<WriteOffReason, { count: number; total: number }>()
  for (const w of writeOffs) {
    if (w.date < from || w.date > to) continue
    const cur = m.get(w.reason) ?? { count: 0, total: 0 }
    m.set(w.reason, { count: cur.count + 1, total: round2(cur.total + w.total) })
  }
  return [...m.entries()].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.total - a.total)
}

// ───────────────────────────── stock books (moves + the variants they change) ─────────────────────────────

/**
 * Collects the stock movements an operation makes, and the variants' new totals, the way the core ops do. A hook that runs
 * beside a core operation (a sale already took its own stock off) tells the book so with `offset`, so the totals it puts
 * back are right and do not undo the core operation's.
 */
export class StockBook {
  moves: StockMove[] = []
  private stock = new Map<string, number>()
  private base = new Map<string, number>()
  constructor(private state: DataState, private ctx: { now: number; userId: string }, private mkId: (prefix: string, now: number) => string) {}

  /** The core operation already changed this variant's total by `delta` (no movement is made here). */
  offset(variantId: string, delta: number) { this.base.set(variantId, round3((this.base.get(variantId) ?? 0) + delta)) }

  total(variantId: string) { return this.stock.get(variantId) ?? round3((this.state.variants[variantId]?.stock ?? 0) + (this.base.get(variantId) ?? 0)) }

  move(variantId: string, qty: number, type: StockMove['type'], ref: string, reason: string, locationId?: string) {
    if (!this.state.variants[variantId]) return
    this.stock.set(variantId, round3(this.total(variantId) + qty))
    this.moves.push({ id: this.mkId('mv', this.ctx.now), variantId, qty, type, ref, reason, at: this.ctx.now, userId: this.ctx.userId, ...(isMain(locationId) ? {} : { locationId }) })
  }

  /** Takes `qty` out of `from` and puts it into `to` (either may be main): the item's total does not change. */
  relocate(variantId: string, qty: number, from: string | undefined, to: string | undefined, ref: string, reason: string) {
    this.move(variantId, -qty, 'transfer', ref, reason, from)
    this.move(variantId, qty, 'transfer', ref, reason, to)
  }

  /** The changes: the movements, the variants' new totals, and the per-location levels they imply. */
  changes(): Changes {
    if (!this.moves.length) return {}
    const variants = [...this.stock.entries()].map(([id, stock]) => ({ ...this.state.variants[id], stock }))
    const levels = incChanges(this.state, this.moves.flatMap(levelEffects))
    return { put: { moves: this.moves, variants, ...(levels.put ?? {}) } }
  }
}

// ───────────────────────────── kits, packs and prices ─────────────────────────────

/** The kit sold as this variant, active or not (a return of an old sale must still find it). */
export const kitOf = (state: DataState, variantId: string): Bundle | undefined => listOf(state.bundles).find((b) => b.variantId === variantId)

/** How many kits the components on hand could make. */
export function kitAvailable(state: DataState, kit: Bundle): number {
  let n = Infinity
  for (const c of kit.components) {
    const v = state.variants[c.variantId]
    if (!v || state.products[v.productId]?.trackStock === false) continue
    n = Math.min(n, Math.floor(round3(v.stock / c.qty)))
  }
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

/** Price of one base unit when sold in packs of `conv`: the pack price spread over the pack. */
export const packUnitPrice = (conv: Pick<UnitConversion, 'factor' | 'price'>, basePrice: number) => (conv.price ? conv.price / conv.factor : basePrice)

/**
 * The per-unit price of a line that is partly sold in packs: whole packs at the pack price, the rest at the unit price,
 * averaged over the quantity (the cart prices per unit). Returns the line's own price when no pack price applies.
 */
export function blendedPrice(line: { price: number; qty: number }, conv: Pick<UnitConversion, 'factor' | 'price'> | undefined, packs: number): number {
  if (!conv?.price || line.qty <= 0) return line.price
  const n = Math.max(0, Math.min(Math.floor(packs), Math.floor(round3(line.qty / conv.factor))))
  if (!n) return line.price
  const total = n * conv.price + (line.qty - n * conv.factor) * line.price
  return round2(total / line.qty)
}

// ───────────────────────────── reports ─────────────────────────────

export interface LocationRow { locationId: string; name: string; type: string; items: number; units: number; value: number }

const costOf = (state: DataState, variantId: string) => { const v = state.variants[variantId]; return v?.avgCost ?? v?.cost ?? 0 }

/** Every location with how many items and units it holds and what they cost. Main is the remainder. */
export function locationSummary(state: DataState): LocationRow[] {
  const rows = new Map<string, LocationRow>()
  const row = (locationId: string): LocationRow => {
    let r = rows.get(locationId)
    if (!r) { r = { locationId, name: locationName(state, locationId), type: isMain(locationId) ? 'warehouse' : state.locations[locationId]?.type ?? 'warehouse', items: 0, units: 0, value: 0 }; rows.set(locationId, r) }
    return r
  }
  row(MAIN)
  for (const l of listOf(state.locations)) if (l.active) row(l.id)
  for (const v of listOf(state.variants)) {
    if (state.products[v.productId]?.trackStock === false) continue
    const add = (loc: string, qty: number) => { if (qty > 0) { const r = row(loc); r.items += 1; r.units = round3(r.units + qty); r.value = round2(r.value + qty * costOf(state, v.id)) } }
    add(MAIN, stockAt(state, v.id))
    for (const l of levelsOf(state, v.id)) add(l.locationId, l.qty)
  }
  return [...rows.values()].sort((a, b) => (isMain(a.locationId) ? -1 : isMain(b.locationId) ? 1 : a.name.localeCompare(b.name)))
}

export interface StockRow { variantId: string; name: string; sku: string; qty: number; value: number }

/** What sits at one location. */
export function stockAtLocationRows(state: DataState, locationId: string): StockRow[] {
  const out: StockRow[] = []
  for (const v of listOf(state.variants)) {
    if (state.products[v.productId]?.trackStock === false) continue
    const qty = stockAt(state, v.id, locationId)
    if (qty > 0) out.push({ variantId: v.id, name: variantName(state, v.id), sku: v.sku, qty, value: round2(qty * costOf(state, v.id)) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Expiring-soon summary for the Home screen: how many batches, how much value, and whether some are already past their date. */
export function expirySummary(state: DataState, now: number, windowDays = 30): { expired: number; soon: number; value: number } {
  const rows = expiryReport(state, now, windowDays)
  return { expired: rows.filter((r) => (r.days ?? 1) < 0).length, soon: rows.filter((r) => (r.days ?? -1) >= 0).length, value: round2(rows.reduce((s, r) => s + r.value, 0)) }
}

export interface SerialView {
  serial: Serial
  name: string
  warranty: WarrantyState
  customer?: string
  billNo?: string
  supplier?: string
}

/** Everything the warranty look-up shows for one unit. */
export function serialView(state: DataState, s: Serial, now: number): SerialView {
  return {
    serial: s, name: variantName(state, s.variantId), warranty: warrantyState(s, now),
    ...(s.customerId && state.customers[s.customerId] ? { customer: state.customers[s.customerId].name } : {}),
    ...(s.billNo ? { billNo: s.billNo } : {}),
    ...(s.supplierId && state.suppliers[s.supplierId] ? { supplier: state.suppliers[s.supplierId].name } : {}),
  }
}

/** A serial that can be sold: on the shelf, or brought back and put on the shelf again. */
export const serialAvailable = (s: Pick<Serial, 'status'> | undefined) => !!s && (s.status === 'in_stock' || s.status === 'returned')

/** Serial numbers on the shelf for an item (for pickers). */
export const serialsInStock = (state: DataState, variantId: string): Serial[] =>
  listOf(state.serials).filter((s) => s.variantId === variantId && serialAvailable(s)).sort((a, b) => a.serial.localeCompare(b.serial))

/** Expired batches with stock, as a write-off draft (reason: expiry), ready for `postWriteOff`. */
export function expiredWriteOffLines(state: DataState, now: number): Array<{ variantId: string; qty: number; batchId: string }> {
  return listOf(state.batches).filter((b) => b.qty > 0 && isExpired(b, now)).map((b) => ({ variantId: b.variantId, qty: b.qty, batchId: b.id }))
}

/** The value a transfer closed short has lost, at the items' cost (what the books write off). */
export function transferLossValue(state: DataState, transfer: Transfer, receipts: TransferReceipt[]): number {
  const p = transferProgress(transfer, receipts)
  return round2(p.lines.reduce((s, l) => s + l.lost * costOf(state, l.variantId), 0))
}
