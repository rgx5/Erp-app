import type {
  AuditLog, Bill, BillItem, Category, Coupon, Customer, DaySession, DiscountType, Expense, ExpenseMode, MoveType, Payment,
  Product, Purchase, Role, StockMove, StoreSettings, Supplier, User, Variant,
} from '@/domain/types'
import { id, pad } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import { costFor, weightedAvg } from '@/domain/pricing'
import { creditNotesFor, planReturn, type ReturnLine } from '@/domain/returns'
import { nextBarcode as pickBarcode } from '@/domain/barcode'
import { skuFor } from '@/domain/codes'
import { computeDayClose } from '@/domain/analytics'
import { listOf, mergeChanges, type Changes, type DataState, type OutboxDraft } from './state'

/** A user-facing refusal ("Nothing selected to return."). Screens show `message` as-is. */
export class OpError extends Error {}

export interface OpCtx {
  now: number
  userId: string
  /** Device series tag for invoice / credit-note numbers in a connected workspace ('' for an offline one). Two tills
   *  numbering from the same series would collide and the server would silently drop one of the bills. */
  series: string
  /** Where this device starts numbering the barcodes it prints, so phones and counters never mint the same code. */
  barcodeBase: number
}

export const localCtx = (userId: string, now = Date.now()): OpCtx => ({ now, userId, series: '', barcodeBase: 1 })

const audit = (ctx: OpCtx, action: string, detail: string): AuditLog => ({ id: id('log', ctx.now), at: ctx.now, userId: ctx.userId, action, detail })
const q = (entity: OutboxDraft['entity'], payload: unknown): OutboxDraft => ({ entity, payload })

/** `undefined` cannot travel as JSON; a cleared field is sent as null so the server clears it too. */
const nullify = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v]))

// ───────────────────────────── numbering ─────────────────────────────

/** Highest trailing number among bill numbers that start with `prefix`. */
function maxSuffix(numbers: string[], prefix: string): number {
  let max = 0
  for (const n of numbers) {
    if (!n.startsWith(prefix)) continue
    const m = /^(\d+)$/.exec(n.slice(prefix.length))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

export function invoicePrefix(store: StoreSettings, series: string) {
  return store.invoicePrefix + (series ? `${series}-` : '')
}

/**
 * The next invoice number. Offline workspaces use the store's own counter (as at the counter); a connected phone numbers
 * from its own series so it can never clash with a bill rung up on another device.
 */
export function nextInvoiceNo(state: DataState, ctx: OpCtx): { no: string; counter?: number } {
  const store = state.store
  if (!store) throw new OpError('The business is not set up yet.')
  const prefix = invoicePrefix(store, ctx.series)
  const taken = listOf(state.bills).map((b) => b.no)
  const floor = ctx.series ? 1 : Math.max(1, store.nextInvoiceNo)
  const n = Math.max(floor, maxSuffix(taken, prefix) + 1)
  return { no: `${prefix}${pad(n, 4)}`, ...(ctx.series ? {} : { counter: n + 1 }) }
}

/** Credit notes have their own series (CN-0001…), so returns never leave gaps in the invoice numbers. */
export function nextCreditNoteNo(state: DataState, ctx: OpCtx): string {
  const prefix = `CN-${ctx.series ? ctx.series + '-' : ''}`
  const nums = listOf(state.bills).filter((b) => !!b.refundOfBillId).map((b) => b.no)
  return `${prefix}${pad(maxSuffix(nums, prefix) + 1, 4)}`
}

export function nextGrnNo(state: DataState, ctx: OpCtx): string {
  const prefix = `GRN-${ctx.series ? ctx.series + '-' : ''}`
  return `${prefix}${pad(maxSuffix(listOf(state.purchases).map((p) => p.no), prefix) + 1, 4)}`
}

export function nextItemBarcode(state: DataState, ctx: OpCtx, extraTaken: string[] = []): string {
  const taken = new Set([...listOf(state.variants).map((v) => v.barcode), ...extraTaken])
  return pickBarcode(taken, ctx.barcodeBase + listOf(state.variants).length)
}

// ───────────────────────────── stock ─────────────────────────────

export const tracksStock = (state: DataState, variantId: string) => {
  const v = state.variants[variantId]
  const p = v ? state.products[v.productId] : undefined
  return p?.trackStock !== false
}

interface StockEdit { variants: Map<string, Variant>; moves: StockMove[] }

function stockEdit(): StockEdit { return { variants: new Map(), moves: [] } }

/** Every stock change goes through here so the ledger and the on-hand number never drift. */
function moveStock(state: DataState, ctx: OpCtx, edit: StockEdit, variantId: string, qty: number, type: MoveType, ref: string, reason: string, userId = ctx.userId) {
  const v = edit.variants.get(variantId) ?? state.variants[variantId]
  if (!v) return
  edit.variants.set(variantId, { ...v, stock: round3(v.stock + qty) })
  edit.moves.push({ id: id('mv', ctx.now), variantId, qty, type, ref, reason, at: ctx.now, userId })
}

const stockChanges = (e: StockEdit): Changes => ({ put: { variants: [...e.variants.values()], moves: e.moves } })

// ───────────────────────────── selling ─────────────────────────────

export type BillInput = Omit<Bill, 'id' | 'no'> & { no?: string }

export interface UnpricedSale { variantId: string; sku: string; name: string; price: number; qty: number; save: boolean; mrp: number }

/**
 * Saves a bill. A finished bill takes its stock off the shelf, moves the customer's loyalty points and store credit,
 * is logged, and is queued for the server. A parked ('held') bill is just remembered on this phone — it is not final,
 * so nothing else happens and it never leaves the device.
 */
export function saveBill(state: DataState, input: BillInput, ctx: OpCtx, opts: { heldId?: string; unpriced?: UnpricedSale[] } = {}): { changes: Changes; bill: Bill } {
  const held = input.status === 'held'
  let no = input.no
  let counter: number | undefined
  if (!no) {
    if (held) no = `HOLD-${new Date(ctx.now).toTimeString().slice(0, 5).replace(':', '')}`
    else ({ no, counter } = nextInvoiceNo(state, ctx))
  }
  const bill: Bill = { ...input, no: no!, id: id('bill', ctx.now) }
  const parts: Changes[] = [{ put: { bills: [bill] }, ...(opts.heldId ? { del: { bills: [opts.heldId] } } : {}) }]
  if (counter) parts.push({ store: { nextInvoiceNo: counter } })

  if (!held) {
    const edit = stockEdit()
    for (const item of bill.items) {
      if (tracksStock(state, item.variantId)) moveStock(state, ctx, edit, item.variantId, -item.qty, 'sale', bill.no, 'Sale', bill.cashierId)
    }
    parts.push(stockChanges(edit))
    // Local copy only: the server applies the same loyalty/credit change when it receives the bill.
    const c = bill.customerId ? state.customers[bill.customerId] : undefined
    if (c) {
      parts.push({ put: { customers: [{ ...c, loyaltyPoints: round2(c.loyaltyPoints + bill.loyaltyEarned - bill.loyaltyRedeemed), storeCredit: round2(c.storeCredit - bill.creditUsed) }] } })
    }
    const logs: AuditLog[] = [audit(ctx, 'BILL_CREATE', `${bill.no} — ₹${bill.total}`)]
    // Items sold without a system price: every one is logged (who, item, price), and a manager can keep the price.
    const keep: { id: string; price: number; mrp: number }[] = []
    for (const l of opts.unpriced ?? []) {
      logs.push(audit(ctx, 'UNPRICED_SALE', `${bill.no}: ${l.sku} (${l.name}) sold at ₹${l.price}${l.qty !== 1 ? ` × ${l.qty}` : ''} — price was not set in the system`))
      if (l.save) keep.push({ id: l.variantId, price: l.price, mrp: Math.max(l.mrp, l.price) })
    }
    parts.push({ put: { audit: logs }, outbox: [q('bill', bill)] })
    if (keep.length) parts.push(priceVariants(state, keep, ctx, `Saved from sale ${bill.no}`).changes)
  }
  return { changes: mergeChanges(...parts), bill }
}

export function deleteHeldBill(state: DataState, billId: string, ctx: OpCtx): Changes {
  const b = state.bills[billId]
  if (!b || b.status !== 'held') return {}
  return { del: { bills: [billId] }, put: { audit: [audit(ctx, 'HELD_BILL_DISCARD', b.no)] } }
}

/**
 * Returns items against an existing bill: puts stock back, creates a negative "credit note" bill with its own CN-
 * number series, takes back the loyalty points those goods earned, and refunds as cash or store credit.
 */
export function processReturn(
  state: DataState, originalId: string, lines: ReturnLine[], refundMode: 'cash' | 'credit', ctx: OpCtx, reason = '',
): { changes: Changes; creditNote: Bill } {
  const original = state.bills[originalId]
  if (!original) throw new OpError('Original bill not found.')
  if (refundMode === 'credit' && !original.customerId) {
    throw new OpError('Attach a customer to the sale before refunding as store credit — a walk-in bill has nobody to hold the credit.')
  }
  const prior = creditNotesFor(listOf(state.bills), originalId)
  const plan = planReturn(original, prior, lines)
  if (!plan) throw new OpError('Nothing selected to return.')

  const store = state.store
  const windowDays = store?.returnWindowDays ?? 0
  const ageDays = Math.floor((ctx.now - original.date) / 86_400_000)
  const late = windowDays > 0 && ageDays > windowDays
  const why = [reason.trim(), late ? `OUTSIDE ${windowDays}-DAY WINDOW (${ageDays} days old)` : ''].filter(Boolean).join(' · ')

  const creditNote: Bill = {
    id: id('bill', ctx.now), no: nextCreditNoteNo(state, ctx), date: ctx.now, customerId: original.customerId,
    items: plan.items,
    grossMrp: round2(plan.items.reduce((s, i) => s + i.mrp * i.qty, 0)),
    itemDiscount: round2(plan.items.reduce((s, i) => s + i.discountAmount, 0)),
    billDiscountType: 'amt', billDiscountValue: 0, billDiscount: 0, coupon: '',
    subtotal: plan.subtotal,
    taxableTotal: round2(plan.items.reduce((s, i) => s + i.taxable, 0)),
    cgstTotal: round2(plan.items.reduce((s, i) => s + i.cgst, 0)),
    sgstTotal: round2(plan.items.reduce((s, i) => s + i.sgst, 0)),
    taxTotal: round2(plan.items.reduce((s, i) => s + i.cgst + i.sgst, 0)),
    roundOff: plan.roundOff, total: -plan.total,
    payments: [{ mode: refundMode === 'cash' ? 'cash' : 'credit', amount: -plan.total }],
    paid: -plan.total, changeDue: 0, loyaltyEarned: -plan.loyaltyReverse, loyaltyRedeemed: 0, creditUsed: 0,
    cashierId: ctx.userId, soldBy: original.soldBy, status: 'returned', refundOfBillId: original.id, refundAmount: plan.total,
    notes: `Return against ${original.no}${why ? ` · ${why}` : ''}`,
  }

  const updatedItems = original.items.map((it) => {
    const r = plan.items.find((x) => x.variantId === it.variantId)
    return r ? { ...it, returnedQty: round3(it.returnedQty + r.qty) } : it
  })
  const edit = stockEdit()
  for (const r of plan.items) {
    if (tracksStock(state, r.variantId)) moveStock(state, ctx, edit, r.variantId, r.qty, 'return', creditNote.no, `Return vs ${original.no}`)
  }
  const parts: Changes[] = [
    { put: { bills: [creditNote, { ...original, items: updatedItems, status: plan.complete ? 'returned' : 'partial-return' }] } },
    stockChanges(edit),
  ]
  const c = original.customerId ? state.customers[original.customerId] : undefined
  if (c) {
    parts.push({ put: { customers: [{ ...c,
      storeCredit: refundMode === 'credit' ? round2(c.storeCredit + plan.total) : c.storeCredit,
      loyaltyPoints: Math.max(0, c.loyaltyPoints - plan.loyaltyReverse) }] } })
  }
  parts.push({
    put: { audit: [audit(ctx, 'RETURN', `${creditNote.no} against ${original.no} — ${refundMode === 'cash' ? 'cash refund' : 'store credit'} ₹${plan.total}`
      + (plan.loyaltyReverse ? `, ${plan.loyaltyReverse} points taken back` : '') + (why ? ` — ${why}` : ''))] },
    outbox: [q('billReturn', creditNote)],
  })
  return { changes: mergeChanges(...parts), creditNote }
}

// ───────────────────────────── buying ─────────────────────────────

export function receivePurchase(state: DataState, p: Omit<Purchase, 'id' | 'no' | 'userId'>, ctx: OpCtx): { changes: Changes; purchase: Purchase } {
  if (!state.suppliers[p.supplierId]) throw new OpError('Choose a supplier.')
  if (!p.items.length) throw new OpError('Add at least one item to the receipt.')
  const purchase: Purchase = { ...p, id: id('po', ctx.now), no: nextGrnNo(state, ctx), userId: ctx.userId }
  const edit = stockEdit()
  const costChanges: string[] = []
  const variantUpdates: OutboxDraft[] = []
  const basis = state.store?.costBasis

  for (const it of purchase.items) {
    const v = state.variants[it.variantId]
    moveStock(state, ctx, edit, it.variantId, it.qty, 'purchase', purchase.no, 'Goods received')
    if (!v || it.cost <= 0) continue
    // Latest cost is what this receipt paid; the average blends it with the stock already on hand.
    const oldAvg = v.avgCost ?? v.cost
    const avgCost = weightedAvg(v.stock, oldAvg, it.qty, it.cost)
    if (it.cost !== v.cost || avgCost !== v.avgCost) {
      const cur = edit.variants.get(it.variantId) ?? v
      edit.variants.set(it.variantId, { ...cur, cost: it.cost, avgCost })
      variantUpdates.push(q('variantUpdate', { id: v.id, cost: it.cost, avgCost }))
    }
    if (v.cost > 0 && it.cost !== v.cost) costChanges.push(`${v.sku} ₹${v.cost} → ₹${it.cost} (avg ₹${avgCost})`)
  }
  void basis
  const logs = [audit(ctx, 'PURCHASE', `${purchase.no} — ₹${purchase.total}`)]
  if (costChanges.length) logs.push(audit(ctx, 'COST_CHANGE', `${purchase.no}: ${costChanges.join('; ')}`))
  return {
    purchase,
    changes: mergeChanges({ put: { purchases: [purchase], audit: logs }, outbox: [q('purchase', purchase), ...variantUpdates] }, stockChanges(edit)),
  }
}

/** Gives items a selling price (and MRP): the "price later" step after receiving stock. Logs what changed. */
export function priceVariants(state: DataState, rows: { id: string; price: number; mrp: number }[], ctx: OpCtx, note = 'Priced after receiving'): { changes: Changes } {
  const put: Variant[] = []
  const outbox: OutboxDraft[] = []
  const logs: AuditLog[] = []
  for (const r of rows) {
    const v = state.variants[r.id]
    if (!v) continue
    put.push({ ...v, price: r.price, mrp: r.mrp, unpricedSince: undefined })
    outbox.push(q('variantUpdate', nullify({ id: r.id, price: r.price, mrp: r.mrp, unpricedSince: undefined })))
    logs.push(audit(ctx, 'PRICE_SET', `${v.sku}: price ${v.price > 0 ? `₹${v.price} → ` : ''}₹${r.price}, MRP ₹${r.mrp} — ${note}`))
  }
  return { changes: { put: { variants: put, audit: logs }, outbox } }
}

/** A signed stock change with a ledger row (adjustment, count correction…). */
export function adjustStock(state: DataState, variantId: string, delta: number, type: MoveType, ref: string, reason: string, ctx: OpCtx): { changes: Changes } {
  const v = state.variants[variantId]
  if (!v) throw new OpError('That item no longer exists.')
  if (round3(v.stock + delta) < 0 && type === 'adjust') throw new OpError('Stock cannot go below zero.')
  const edit = stockEdit()
  moveStock(state, ctx, edit, variantId, delta, type, ref, reason)
  const move = edit.moves[0]
  return { changes: mergeChanges(stockChanges(edit), { outbox: [q('stockAdjust', move)] }) }
}

/** Posts a whole physical count in one go. */
export function postCount(state: DataState, rows: Array<{ variantId: string; variance: number }>, ctx: OpCtx): Changes {
  const parts: Changes[] = []
  for (const r of rows) {
    if (r.variance === 0) continue
    parts.push(adjustStock(state, r.variantId, r.variance, 'audit', 'AUDIT', 'Physical count correction', ctx).changes)
  }
  return mergeChanges(...parts)
}

// ───────────────────────────── catalogue ─────────────────────────────

export interface ItemDraft {
  name: string
  styleCode: string
  categoryId: string
  brand: string
  fabric: string
  season: string
  hsn: string
  /** First option axis (sizes, packs…); `['']` for a single item. */
  sizes: string[]
  /** Second option axis (colours…); `['']` when there is none. */
  colors: string[]
  cost: number
  mrp: number
  price: number
  unit?: string
  fractional?: boolean
  step?: number
  minQty?: number
  trackStock?: boolean
  noDiscount?: boolean
  gstRate?: number
  reorderLevel?: number
  /** Opening stock for every variant. */
  openingStock?: number
}

/**
 * Creates an item and one barcoded variant (0 stock unless an opening stock is given) for every option combination.
 * A price of 0 is allowed: the variants are then "waiting for a price" until someone sets one.
 */
export function createItem(state: DataState, d: ItemDraft, ctx: OpCtx): { changes: Changes; product: Product; variants: Variant[] } {
  const styleCode = d.styleCode.trim().toUpperCase()
  if (!d.name.trim()) throw new OpError('Give the item a name.')
  if (listOf(state.products).some((p) => p.styleCode.toUpperCase() === styleCode)) throw new OpError(`Item code ${styleCode} is already used.`)
  const product: Product = {
    id: id('prd', ctx.now), styleCode, name: d.name.trim(), categoryId: d.categoryId, brand: d.brand.trim(),
    fabric: d.fabric.trim(), season: d.season.trim(), hsn: d.hsn.trim(), active: true, createdAt: ctx.now, unit: d.unit ?? 'pc',
    ...(d.fractional !== undefined ? { fractional: d.fractional } : {}),
    ...(d.step !== undefined ? { step: d.step } : {}),
    ...(d.minQty !== undefined ? { minQty: d.minQty } : {}),
    ...(d.trackStock === false ? { trackStock: false } : {}),
    ...(d.noDiscount ? { noDiscount: true } : {}),
    ...(d.gstRate !== undefined ? { gstRate: d.gstRate } : {}),
  }
  const variants: Variant[] = []
  const used: string[] = []
  const edit = stockEdit()
  const opening = d.trackStock === false ? 0 : (d.openingStock ?? 0)
  for (const color of d.colors) {
    for (const size of d.sizes) {
      const barcode = nextItemBarcode(state, ctx, used)
      used.push(barcode)
      const v: Variant = {
        id: id('var', ctx.now), productId: product.id, sku: skuFor(product.styleCode, color, size), barcode, size, color,
        cost: d.cost, mrp: d.mrp || d.price, price: d.price, stock: 0, reorderLevel: d.reorderLevel ?? 3,
        ...(d.cost > 0 ? { avgCost: d.cost } : {}),
        ...(d.price > 0 ? {} : { unpricedSince: ctx.now }),
      }
      variants.push(v)
    }
  }
  if (new Set(variants.map((v) => v.sku)).size !== variants.length) throw new OpError('Two options would get the same code — make them different.')
  const taken = new Set(listOf(state.variants).map((v) => v.sku))
  const clash = variants.find((v) => taken.has(v.sku))
  if (clash) throw new OpError(`The code ${clash.sku} already exists on another item.`)

  // Variants carry their opening stock via the ledger (an 'opening' move), exactly like stock typed in at setup.
  const withStock = variants.map((v) => {
    if (opening > 0) {
      edit.moves.push({ id: id('mv', ctx.now), variantId: v.id, qty: opening, type: 'opening', ref: 'OPENING', reason: 'Opening stock', at: ctx.now, userId: ctx.userId })
      return { ...v, stock: round3(opening) }
    }
    return v
  })
  const outbox: OutboxDraft[] = [q('product', { ...product, variants: [] }), ...withStock.map((v) => q('variant', { ...v, stock: 0 }))]
  // Opening stock reaches the server as a stock adjustment, not as part of the variant row.
  for (const m of edit.moves) outbox.push(q('stockAdjust', m))
  return {
    product, variants: withStock,
    changes: { put: { products: [product], variants: withStock, moves: edit.moves, audit: [audit(ctx, 'ITEM_CREATE', `${product.styleCode} — ${product.name} (${withStock.length} variants)`)] }, outbox },
  }
}

/** Adds option combinations to an item that already exists (a new size, a new colour). */
export function addVariants(state: DataState, productId: string, sizes: string[], colors: string[], ctx: OpCtx): { changes: Changes; made: number } {
  const p = state.products[productId]
  if (!p) throw new OpError('That item no longer exists.')
  const existing = listOf(state.variants).filter((v) => v.productId === productId)
  const base = existing[0]
  const have = new Set(existing.map((v) => `${v.color}|${v.size}`))
  const used: string[] = []
  const made: Variant[] = []
  for (const color of colors) {
    for (const size of sizes) {
      if (have.has(`${color}|${size}`)) continue
      const barcode = nextItemBarcode(state, ctx, used)
      used.push(barcode)
      made.push({
        id: id('var', ctx.now), productId, sku: skuFor(p.styleCode, color, size), barcode, size, color,
        cost: base?.cost ?? 0, mrp: base?.mrp ?? 0, price: base?.price ?? 0, stock: 0, reorderLevel: base?.reorderLevel ?? 3,
        ...(base && base.cost > 0 ? { avgCost: base.cost } : {}),
        ...(!(base && base.price > 0) ? { unpricedSince: ctx.now } : {}),
      })
    }
  }
  return { made: made.length, changes: { put: { variants: made }, outbox: made.map((v) => q('variant', v)) } }
}

type VariantPatch = Partial<Pick<Variant, 'sku' | 'barcode' | 'size' | 'color' | 'cost' | 'mrp' | 'price' | 'reorderLevel'>>

/** Edits one variant's own fields. Stock is never edited here — it moves through the ledger. */
export function updateVariant(state: DataState, variantId: string, patch: VariantPatch, ctx: OpCtx): { changes: Changes } {
  const v = state.variants[variantId]
  if (!v) throw new OpError('That item no longer exists.')
  const next: Variant = { ...v, ...patch }
  const extra: Partial<Variant> = {}
  // Giving an unpriced item a price clears its "waiting for a price" flag.
  if (patch.price !== undefined && patch.price > 0 && v.unpricedSince) { next.unpricedSince = undefined; extra.unpricedSince = undefined }
  if (patch.cost !== undefined && patch.cost > 0 && v.avgCost === undefined) next.avgCost = patch.cost
  const wire = nullify({ id: variantId, ...patch, ...extra, ...(next.avgCost !== v.avgCost ? { avgCost: next.avgCost } : {}) })
  const logs = [] as AuditLog[]
  if (patch.price !== undefined && patch.price !== v.price) logs.push(audit(ctx, 'PRICE_SET', `${v.sku}: price ₹${v.price} → ₹${patch.price}`))
  return { changes: { put: { variants: [next], audit: logs }, outbox: [q('variantUpdate', wire)] } }
}

/** Sets the same price / MRP / cost / reorder level on every variant of an item. */
export function setAllVariants(state: DataState, productId: string, field: 'price' | 'mrp' | 'cost' | 'reorderLevel', value: number, ctx: OpCtx): { changes: Changes; count: number } {
  const parts: Changes[] = []
  const vs = listOf(state.variants).filter((v) => v.productId === productId)
  for (const v of vs) parts.push(updateVariant(state, v.id, { [field]: value } as VariantPatch, ctx).changes)
  return { changes: mergeChanges(...parts), count: vs.length }
}

type ProductPatch = Partial<Pick<Product, 'name' | 'styleCode' | 'categoryId' | 'brand' | 'fabric' | 'season' | 'hsn' | 'active' | 'gstRate' | 'noDiscount' | 'minQty' | 'step'>>

export function updateProduct(state: DataState, productId: string, patch: ProductPatch, ctx: OpCtx): { changes: Changes } {
  const p = state.products[productId]
  if (!p) throw new OpError('That item no longer exists.')
  if (patch.styleCode !== undefined) {
    const code = patch.styleCode.trim().toUpperCase()
    if (listOf(state.products).some((x) => x.id !== productId && x.styleCode.toUpperCase() === code)) throw new OpError(`Item code ${code} is already used.`)
    patch = { ...patch, styleCode: code }
  }
  const next: Product = { ...p, ...patch }
  if (patch.gstRate === undefined && 'gstRate' in patch) delete next.gstRate
  return { changes: { put: { products: [next], audit: [audit(ctx, 'ITEM_EDIT', `${p.styleCode} — ${Object.keys(patch).join(', ')}`)] }, outbox: [q('productUpdate', nullify({ id: productId, ...patch }))] } }
}

/** Whether an item has any history; one with none can be deleted outright, others are archived instead. */
export function hasHistory(state: DataState, productId: string): boolean {
  const ids = new Set(listOf(state.variants).filter((v) => v.productId === productId).map((v) => v.id))
  if (listOf(state.bills).some((b) => b.items.some((i) => ids.has(i.variantId)))) return true
  if (listOf(state.purchases).some((p) => p.items.some((i) => ids.has(i.variantId)))) return true
  return listOf(state.moves).some((m) => ids.has(m.variantId) && m.type !== 'opening')
}

export function deleteProduct(state: DataState, productId: string, ctx: OpCtx): { changes: Changes } {
  const p = state.products[productId]
  if (!p) return { changes: {} }
  if (hasHistory(state, productId)) throw new OpError('This item has sales or stock history — archive it instead.')
  const vids = listOf(state.variants).filter((v) => v.productId === productId).map((v) => v.id)
  const moves = listOf(state.moves).filter((m) => vids.includes(m.variantId)).map((m) => m.id)
  return { changes: { del: { products: [productId], variants: vids, moves }, put: { audit: [audit(ctx, 'ITEM_DELETE', `${p.styleCode} — ${p.name}`)] }, outbox: [q('productDelete', { id: productId })] } }
}

// ───────────────────────────── categories ─────────────────────────────

export function saveCategory(state: DataState, c: Omit<Category, 'id'> & { id?: string }, ctx: OpCtx): { changes: Changes; category: Category } {
  const name = c.name.trim()
  if (!name) throw new OpError('Give the category a name.')
  const category: Category = { ...c, name, id: c.id ?? id('cat', ctx.now) }
  if (!c.id && listOf(state.categories).some((x) => x.name.toLowerCase() === name.toLowerCase() && x.group === c.group)) {
    throw new OpError(`There is already a ${name} category in ${c.group || 'that group'}.`)
  }
  return { category, changes: { put: { categories: [category] }, outbox: [q('category', category)] } }
}

export function deleteCategory(state: DataState, categoryId: string): { changes: Changes } {
  if (listOf(state.products).some((p) => p.categoryId === categoryId)) throw new OpError('This category still has items in it.')
  return { changes: { del: { categories: [categoryId] }, outbox: [q('categoryDelete', { id: categoryId })] } }
}

// ───────────────────────────── people ─────────────────────────────

export type CustomerDraft = Omit<Customer, 'id' | 'createdAt' | 'loyaltyPoints' | 'storeCredit'> & Partial<Pick<Customer, 'loyaltyPoints' | 'storeCredit'>>

const PHONE = /^\d{10}$/

export function saveCustomer(state: DataState, d: CustomerDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; customer: Customer } {
  if (!PHONE.test(d.phone)) throw new OpError('Enter a valid 10-digit mobile number.')
  const dupe = listOf(state.customers).find((c) => c.phone === d.phone && c.id !== existingId)
  if (dupe) throw new OpError(`${dupe.name || 'Another customer'} already uses this number.`)
  if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) throw new OpError("That email address doesn't look right.")
  if (existingId) {
    const cur = state.customers[existingId]
    if (!cur) throw new OpError('That customer no longer exists.')
    const next: Customer = { ...cur, ...d, name: d.name.trim() || 'Customer' }
    const diff: Record<string, unknown> = {}
    for (const k of Object.keys(d) as Array<keyof CustomerDraft>) if (next[k] !== cur[k]) diff[k] = next[k]
    if (next.name !== cur.name) diff.name = next.name
    return { customer: next, changes: { put: { customers: [next] }, ...(Object.keys(diff).length ? { outbox: [q('customerUpdate', { id: existingId, ...diff })] } : {}) } }
  }
  const customer: Customer = { loyaltyPoints: 0, storeCredit: 0, ...d, name: d.name.trim() || 'Customer', id: id('cus', ctx.now), createdAt: ctx.now }
  return { customer, changes: { put: { customers: [customer] }, outbox: [q('customer', customer)] } }
}

export type SupplierDraft = Omit<Supplier, 'id'>

export function saveSupplier(state: DataState, d: SupplierDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; supplier: Supplier } {
  const name = d.name.trim()
  if (!name) throw new OpError('Supplier name is required.')
  if (listOf(state.suppliers).some((s) => s.id !== existingId && s.name.toLowerCase() === name.toLowerCase())) throw new OpError('You already have a supplier with this name.')
  if (d.gstin && !/^[0-9A-Z]{15}$/.test(d.gstin.toUpperCase())) throw new OpError('GSTIN must be 15 characters.')
  if (existingId) {
    const cur = state.suppliers[existingId]
    if (!cur) throw new OpError('That supplier no longer exists.')
    const next = { ...cur, ...d, name, gstin: d.gstin.toUpperCase() }
    return { supplier: next, changes: { put: { suppliers: [next] }, outbox: [q('supplierUpdate', { id: existingId, name, phone: d.phone, gstin: next.gstin, address: d.address, openingBalance: d.openingBalance })] } }
  }
  const supplier: Supplier = { ...d, name, gstin: d.gstin.toUpperCase(), id: id('sup', ctx.now) }
  return { supplier, changes: { put: { suppliers: [supplier] }, outbox: [q('supplier', supplier)] } }
}

export interface StaffDraft { name: string; role: Role; code?: string; active: boolean }

/**
 * Adds or edits a staff member. In an offline workspace the PIN is stored as a hash; in a connected one the server
 * hashes it, so the real digits are sent once and never kept on the phone.
 */
export function saveStaff(state: DataState, d: StaffDraft, existingId: string | undefined, pin: { hash?: string; plain?: string }, ctx: OpCtx): { changes: Changes; user: User } {
  const name = d.name.trim()
  if (!name) throw new OpError('Name is required.')
  const code = d.code?.trim() || undefined
  if (code && listOf(state.users).some((u) => u.id !== existingId && u.code === code)) throw new OpError(`Staff number ${code} is already taken.`)
  const owners = listOf(state.users).filter((u) => u.role === 'owner' && u.active && u.id !== existingId)
  if ((d.role !== 'owner' || !d.active) && existingId && state.users[existingId]?.role === 'owner' && !owners.length) {
    throw new OpError('There must be at least one active owner.')
  }
  if (existingId) {
    const cur = state.users[existingId]
    if (!cur) throw new OpError('That person no longer exists.')
    const next: User = { ...cur, name, role: d.role, active: d.active, code, ...(pin.hash ? { pin: pin.hash } : {}) }
    return { user: next, changes: { put: { users: [next], audit: [audit(ctx, 'STAFF_EDIT', `${name} (${d.role})`)] },
      outbox: [q('userUpdate', { id: existingId, name, role: d.role, active: d.active, code: code ?? null, ...(pin.plain ? { pin: pin.plain } : {}) })] } }
  }
  const user: User = { id: id('usr', ctx.now), name, role: d.role, active: d.active, code, ...(pin.hash ? { pin: pin.hash } : {}) }
  return { user, changes: { put: { users: [user], audit: [audit(ctx, 'STAFF_ADD', `${name} (${d.role})`)] },
    outbox: [q('user', { id: user.id, name, role: d.role, active: d.active, code: code ?? null, ...(pin.plain ? { pin: pin.plain } : {}) })] } }
}

export type CouponDraft = { code: string; type: DiscountType; value: number; minBill: number; expiresAt?: number; maxUses: number; active: boolean }

export function saveCoupon(state: DataState, d: CouponDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; coupon: Coupon } {
  const code = d.code.trim().toUpperCase().replace(/\s+/g, '')
  if (!code) throw new OpError('Enter a coupon code.')
  if (!(d.value > 0)) throw new OpError('Enter the discount.')
  if (d.type === 'pct' && d.value > 100) throw new OpError('A percentage cannot be over 100.')
  if (listOf(state.coupons).some((c) => c.id !== existingId && c.code === code)) throw new OpError('A coupon with that code already exists.')
  if (existingId) {
    const cur = state.coupons[existingId]
    if (!cur) throw new OpError('That coupon no longer exists.')
    const next: Coupon = { ...cur, ...d, code }
    return { coupon: next, changes: { put: { coupons: [next] }, outbox: [q('couponUpdate', nullify({ id: existingId, code, type: d.type, value: d.value, minBill: d.minBill, expiresAt: d.expiresAt, maxUses: d.maxUses, active: d.active }))] } }
  }
  const coupon: Coupon = { ...d, code, id: id('cpn', ctx.now), createdAt: ctx.now }
  return { coupon, changes: { put: { coupons: [coupon] }, outbox: [q('coupon', coupon)] } }
}

// ───────────────────────────── money ─────────────────────────────

export interface ExpenseDraft { date: number; category: string; amount: number; mode: ExpenseMode; vendor: string; note: string; recurring: boolean }

export function addExpense(d: ExpenseDraft, ctx: OpCtx): { changes: Changes; expense: Expense } {
  if (!(d.amount > 0)) throw new OpError('Enter the amount.')
  const expense: Expense = { ...d, amount: round2(d.amount), id: id('exp', ctx.now), userId: ctx.userId }
  return { expense, changes: { put: { expenses: [expense] }, outbox: [q('expense', expense)] } }
}

/** Editing and deleting an expense is for offline workspaces only — the server keeps expenses as a permanent record. */
export function editExpense(state: DataState, expenseId: string, d: ExpenseDraft): { changes: Changes } {
  const cur = state.expenses[expenseId]
  if (!cur) throw new OpError('That expense no longer exists.')
  if (!(d.amount > 0)) throw new OpError('Enter the amount.')
  return { changes: { put: { expenses: [{ ...cur, ...d, amount: round2(d.amount) }] } } }
}
export const removeExpense = (expenseId: string): Changes => ({ del: { expenses: [expenseId] } })

export function openDay(state: DataState, openingCash: number, ctx: OpCtx): { changes: Changes; session: DaySession } {
  if (!(openingCash >= 0) || !Number.isFinite(openingCash)) throw new OpError('Enter the cash in the drawer to open the day (0 if empty).')
  const open = listOf(state.sessions).find((s) => !s.closedAt)
  if (open) throw new OpError('A day is already open.')
  const session: DaySession = { id: id('ses', ctx.now), openedAt: ctx.now, openedBy: ctx.userId, openingCash: round2(openingCash) }
  return { session, changes: { put: { sessions: [session] }, outbox: [q('session', session)] } }
}

export function closeDay(state: DataState, sessionId: string, counted: number, ctx: OpCtx): { changes: Changes; session: DaySession } {
  const cur = state.sessions[sessionId]
  if (!cur || cur.closedAt) throw new OpError('No open day to close.')
  const fig = computeDayClose(listOf(state.bills), listOf(state.expenses), cur, ctx.now)
  const session: DaySession = { ...cur, closedAt: ctx.now, closedBy: ctx.userId, countedCash: round2(counted), expectedCash: fig.expected, variance: round2(counted - fig.expected) }
  return {
    session,
    changes: { put: { sessions: [session], audit: [audit(ctx, 'DAY_CLOSE', `Expected ₹${fig.expected}, counted ₹${round2(counted)}`)] },
      outbox: [q('sessionUpdate', { id: sessionId, closedAt: session.closedAt, closedBy: session.closedBy, countedCash: session.countedCash, expectedCash: session.expectedCash, variance: session.variance })] },
  }
}

// ───────────────────────────── settings ─────────────────────────────

/** Settings the server stores. Everything else on this phone (theme, lock…) stays local. */
export function updateSettings(patch: Partial<StoreSettings>, ctx: OpCtx): Changes {
  const { id: _id, plan: _plan, ...rest } = patch
  void _id; void _plan
  if (!Object.keys(rest).length) return {}
  return { store: rest, put: { audit: [audit(ctx, 'SETTINGS', Object.keys(rest).join(', '))] }, outbox: [q('storeUpdate', rest)] }
}

// ───────────────────────────── helpers for screens ─────────────────────────────

/** Items with the cost basis applied — what a line costs us. */
export const unitCost = (state: DataState, v: Pick<Variant, 'cost' | 'avgCost'>) => costFor(v, state.store?.costBasis)

export type { BillItem, Payment }
