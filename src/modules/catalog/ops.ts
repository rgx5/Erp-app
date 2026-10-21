import { nextStyleCode, skuFor } from '@/domain/codes'
import { rulesFromConfig } from '@/domain/catalog'
import { makeBarcode } from '@/domain/barcode'
import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { round3, unitPreset } from '@/domain/qty'
import type { Category, Product, StockMove, Variant } from '@/domain/types'
import { audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type CollMap, type DataState, type OutboxDraft } from '@/data/state'
import type { PurchaseOrder } from '@/modules/purchasing/types'
import { withEffects } from '@/replication/local'
import { nextNo } from '../numbering'
import { activeFields, parseFieldValue } from './fields'
import { previewImport, type ImportPreview } from './import'
import { catalogSettings } from './logic'
import { templateProblem } from './labels'
import {
  CATALOG_SETTINGS_ID, type AttachmentKind, type CatalogSettings, type CustomFieldDef, type CustomFieldType, type CustomValue, type ItemAttachment, type LabelTemplate, type ReorderRule,
} from './types'
import './replication'

const q = (entity: OutboxDraft['entity'], payload: unknown): OutboxDraft => ({ entity, payload })
/** `undefined` cannot travel as JSON; a cleared field is sent as null so the server clears it too. */
const nullify = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v]))

// ───────────────────────────── bulk import ─────────────────────────────

/** Stock a new variant starts with; posted by `postOpeningStock` once the variants exist. */
export interface Opening { variantId: string; qty: number }

export interface ImportResult { changes: Changes; openings: Opening[]; preview: ImportPreview; items: number; created: number; updated: number; unchanged: number; skipped: number }

/**
 * Writes a checked import: new items with their variants (and opening stock), changes to prices / cost / stock of variants that
 * exist, new categories, and custom-field values. Rows the preview refused are skipped; the rest go in together or not at all.
 */
export function importItems(state: DataState, table: string[][], ctx: OpCtx, opts: { fileName?: string } = {}): ImportResult {
  const defs = listOf(state.customFields ?? {})
  const preview = previewImport(table, state, defs)
  if (preview.fatal) throw new OpError(preview.fatal)
  const todo = preview.rows.filter((r) => r.action === 'create' || r.action === 'update')
  if (!todo.length) throw new OpError(preview.counts.error ? 'No row can be imported — fix the errors shown and try again.' : 'Nothing to change: the file matches what you already have.')

  let seq = 0
  // Ids carry the time to the millisecond; a big file would otherwise mint thousands in the same one.
  const nid = (prefix: string) => id(prefix, ctx.now + seq++)

  const categories: Category[] = []
  const catByName = new Map(listOf(state.categories).map((c) => [c.name.toLowerCase(), c]))
  for (const name of preview.newCategories) {
    const c: Category = { id: nid('cat'), name, group: '' }
    categories.push(c); catByName.set(name.toLowerCase(), c)
  }

  const products: Product[] = []
  const variants: Variant[] = []
  const moves: StockMove[] = []
  const outbox: OutboxDraft[] = []
  const newProduct = new Map<string, Product>()
  const takenSku = new Set(listOf(state.variants).map((v) => v.sku.toUpperCase()))
  const takenCode = new Set(listOf(state.variants).map((v) => v.barcode))
  let counter = ctx.barcodeBase + listOf(state.variants).length
  const freshBarcode = () => {
    for (;;) { const code = makeBarcode(counter++); if (!takenCode.has(code)) return code }
  }
  const openings: Opening[] = []
  const customByProduct = new Map<string, Record<string, CustomValue>>()
  const productPatch = new Map<string, Partial<Product>>()
  const patched = new Map<string, Variant>()
  let created = 0, updated = 0, skipped = 0, unchanged = 0

  for (const row of todo) {
    const d = row.data
    if (row.action === 'update') {
      const v = state.variants[row.variantId!]
      const pr = state.products[row.productId!]
      let next: Variant = patched.get(v.id) ?? v
      if (row.variantPatch) {
        const { stock, ...rest } = row.variantPatch
        next = { ...next, ...rest }
        const wire: Record<string, unknown> = { id: v.id, ...rest }
        if (rest.cost !== undefined && rest.cost > 0 && v.avgCost === undefined) { next.avgCost = rest.cost; wire.avgCost = rest.cost }
        if (rest.price !== undefined && rest.price > 0 && v.unpricedSince) { next.unpricedSince = undefined; wire.unpricedSince = undefined }
        if (stock !== undefined) {
          const move: StockMove = { id: nid('mv'), variantId: v.id, qty: round3(stock - v.stock), type: 'adjust', ref: 'IMPORT', reason: 'Bulk import', at: ctx.now, userId: ctx.userId }
          moves.push(move); outbox.push(q('stockAdjust', move))
        }
        if (Object.keys(wire).length > 1) outbox.push(q('variantUpdate', nullify(wire)))
        patched.set(v.id, next)
      }
      if (row.productPatch && pr) {
        const { categoryName, categoryId, ...rest } = row.productPatch
        const cur = productPatch.get(pr.id) ?? {}
        const cid = categoryName ? catByName.get(categoryName.toLowerCase())?.id : categoryId
        productPatch.set(pr.id, { ...rest, ...(cid ? { categoryId: cid } : {}), ...cur })
      }
      if (Object.keys(d.custom).length && pr) customByProduct.set(pr.id, { ...customByProduct.get(pr.id), ...d.custom })
      updated++
      continue
    }

    // create
    let product = row.productId ? state.products[row.productId] : newProduct.get(row.productKey!)
    if (!product) {
      const cat = d.category ? catByName.get(d.category.toLowerCase()) : undefined
      const rules = rulesFromConfig(cat?.config, { hsn: '', reorder: state.store?.lowStockDefault ?? 3 })
      const unit = d.unit || rules.unit
      const preset = unitPreset(unit)
      const fractional = preset ? preset.fractional : rules.fractional
      const gst = d.gst ?? rules.gstRate
      const styleCode = d.code || nextStyleCode(cat, [...listOf(state.products), ...products])
      product = {
        id: nid('prd'), styleCode, name: d.name, categoryId: cat?.id ?? '', brand: d.brand, fabric: d.fabric, season: d.season, hsn: d.hsn || rules.hsn,
        active: true, createdAt: ctx.now, unit,
        ...(fractional ? { fractional: true, step: preset?.step ?? rules.step } : {}),
        ...(rules.minQty !== undefined ? { minQty: rules.minQty } : {}),
        ...(!rules.trackStock ? { trackStock: false } : {}),
        ...(rules.noDiscount ? { noDiscount: true } : {}),
        ...(gst !== undefined ? { gstRate: gst } : {}),
      }
      products.push(product); newProduct.set(row.productKey!, product)
      outbox.push(q('product', { ...product, variants: [] }))
    }
    const sku = d.sku || skuFor(product.styleCode, d.color, d.size).toUpperCase()
    if (takenSku.has(sku) || (d.barcode && takenCode.has(d.barcode))) { skipped++; continue }
    takenSku.add(sku)
    const barcode = d.barcode || freshBarcode()
    takenCode.add(barcode)
    const cat = state.categories[product.categoryId] ?? catByName.get(d.category.toLowerCase())
    const reorderLevel = d.reorder ?? rulesFromConfig(cat?.config, { hsn: '', reorder: state.store?.lowStockDefault ?? 3 }).reorderLevel
    const price = d.price ?? 0
    const cost = d.cost ?? 0
    const opening = product.trackStock === false ? 0 : d.stock ?? 0
    const v: Variant = {
      id: nid('var'), productId: product.id, sku, barcode, size: d.size, color: d.color, cost, mrp: d.mrp || price, price, stock: 0, reorderLevel,
      ...(cost > 0 ? { avgCost: cost } : {}), ...(price > 0 ? {} : { unpricedSince: ctx.now }),
    }
    outbox.push(q('variant', { ...v, stock: 0 }))
    if (opening > 0) openings.push({ variantId: v.id, qty: round3(opening) })
    variants.push(v)
    if (Object.keys(d.custom).length) customByProduct.set(product.id, { ...customByProduct.get(product.id), ...d.custom })
    created++
  }
  unchanged = preview.counts.same

  const patchedProducts: Product[] = []
  for (const [pid, patch] of productPatch) {
    const cur = state.products[pid]
    if (!cur) continue
    patchedProducts.push({ ...cur, ...patch })
    outbox.push(q('productUpdate', nullify({ id: pid, ...patch })))
  }
  const values: CollMap['customFieldValues'][] = []
  for (const [pid, vals] of customByProduct) {
    values.push({ id: pid, productId: pid, values: { ...(state.customFieldValues?.[pid]?.values ?? {}), ...vals }, updatedAt: ctx.now })
  }
  const items = products.length
  // New variants are written with 0 stock: their opening stock is posted afterwards (`postOpeningStock`), because the server adds every
  // move to the variant and a variant created with its stock *and* an opening move would count twice.
  const base: Changes = {
    put: {
      ...(categories.length ? { categories } : {}),
      products: [...products, ...patchedProducts],
      variants: [...variants, ...patched.values()],
      ...(moves.length ? { moves } : {}),
      ...(values.length ? { customFieldValues: values } : {}),
      audit: [audit(ctx, 'ITEMS_IMPORT', `${opts.fileName ?? 'File'}: ${items} new items (${variants.length} variants), ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`)],
    },
    outbox,
  }
  const changes = moves.length ? withEffects(state, base, ['moves'], ctx.now) : base
  return { changes, openings, preview, items, created, updated, unchanged, skipped }
}

/** Posts the opening stock of variants an import just created: one ledger move each, applied on the phone as the server will apply it. */
export function postOpeningStock(state: DataState, rows: Opening[], ctx: OpCtx): { changes: Changes } {
  const moves: StockMove[] = []
  const outbox: OutboxDraft[] = []
  rows.forEach((r, i) => {
    if (!state.variants[r.variantId] || !(r.qty > 0)) return
    const move: StockMove = { id: id('mv', ctx.now + i), variantId: r.variantId, qty: round3(r.qty), type: 'opening', ref: 'OPENING', reason: 'Opening stock (import)', at: ctx.now, userId: ctx.userId }
    moves.push(move); outbox.push(q('stockAdjust', move))
  })
  if (!moves.length) return { changes: {} }
  return { changes: withEffects(state, { put: { moves }, outbox }, ['moves'], ctx.now) }
}

// ───────────────────────────── custom fields ─────────────────────────────

export interface FieldDraft { label: string; type: CustomFieldType; options: string[]; required: boolean; active: boolean }

export function saveCustomField(state: DataState, d: FieldDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; field: CustomFieldDef } {
  const label = d.label.trim()
  if (!label) throw new OpError('Give the field a name.')
  if (label.length > 40) throw new OpError('Keep the field name under 40 characters.')
  const all = listOf(state.customFields ?? {})
  if (all.some((f) => f.id !== existingId && f.label.toLowerCase() === label.toLowerCase())) throw new OpError(`There is already a field called ${label}.`)
  const options = [...new Set(d.options.map((o) => o.trim()).filter(Boolean))]
  if (d.type === 'choice' && options.length < 2) throw new OpError('A choice field needs at least two choices.')
  const cur = existingId ? state.customFields?.[existingId] : undefined
  if (existingId && !cur) throw new OpError('That field no longer exists.')
  if (cur && cur.type !== d.type && listOf(state.customFieldValues ?? {}).some((v) => v.values[cur.id] !== undefined)) {
    throw new OpError('Items already have values in this field, so its type cannot change. Add a new field instead.')
  }
  const field: CustomFieldDef = {
    id: cur?.id ?? id('cf', ctx.now), label, type: d.type, options: d.type === 'choice' ? options : [], required: d.required, active: d.active,
    order: cur?.order ?? all.reduce((m, f) => Math.max(m, f.order), 0) + 1, createdAt: cur?.createdAt ?? ctx.now,
  }
  return { field, changes: { put: { customFields: [field], audit: [audit(ctx, cur ? 'FIELD_EDIT' : 'FIELD_ADD', `${label} (${d.type})`)] } } }
}

/** Removes a field definition and the values items had in it. */
export function deleteCustomField(state: DataState, fieldId: string, ctx: OpCtx): { changes: Changes } {
  const f = state.customFields?.[fieldId]
  if (!f) throw new OpError('That field no longer exists.')
  const docs = listOf(state.customFieldValues ?? {}).filter((v) => v.values[fieldId] !== undefined).map((v) => {
    const { [fieldId]: _gone, ...rest } = v.values
    void _gone
    return { ...v, values: rest, updatedAt: ctx.now }
  })
  return { changes: { del: { customFields: [fieldId] }, put: { ...(docs.length ? { customFieldValues: docs } : {}), audit: [audit(ctx, 'FIELD_DELETE', f.label)] } } }
}

/** Saves what was typed into an item's custom fields (field id → text). An empty text clears the value. */
export function setCustomValues(state: DataState, productId: string, raw: Record<string, string>, ctx: OpCtx): { changes: Changes } {
  const p = state.products[productId]
  if (!p) throw new OpError('That item no longer exists.')
  const cur = state.customFieldValues?.[productId]
  const values: Record<string, CustomValue> = { ...(cur?.values ?? {}) }
  for (const def of activeFields(listOf(state.customFields ?? {}))) {
    if (!(def.id in raw)) continue
    const parsed = parseFieldValue(def, raw[def.id])
    if (parsed.error) throw new OpError(parsed.error)
    if (parsed.value === undefined) {
      if (def.required) throw new OpError(`${def.label} is required.`)
      delete values[def.id]
    } else values[def.id] = parsed.value
  }
  const same = JSON.stringify(values) === JSON.stringify(cur?.values ?? {})
  if (same) return { changes: {} }
  if (!Object.keys(values).length && cur) return { changes: { del: { customFieldValues: [productId] }, put: { audit: [audit(ctx, 'ITEM_FIELDS', p.styleCode)] } } }
  return { changes: { put: { customFieldValues: [{ id: productId, productId, values, updatedAt: ctx.now }], audit: [audit(ctx, 'ITEM_FIELDS', `${p.styleCode} — ${p.name}`)] } } }
}

// ───────────────────────────── photos & attachments ─────────────────────────────

export const MAX_ATTACHMENTS = 20
const safeName = (n: string) => n.replace(/[\\/:*?"<>|\r\n]+/g, '-').trim().slice(0, 80) || 'file'

export interface AttachmentDraft { productId: string; kind: AttachmentKind; name: string; uri: string; mime: string; size: number }

export function addAttachment(state: DataState, d: AttachmentDraft, ctx: OpCtx): { changes: Changes; attachment: ItemAttachment } {
  const p = state.products[d.productId]
  if (!p) throw new OpError('That item no longer exists.')
  if (!d.uri) throw new OpError('No file was chosen.')
  const mine = listOf(state.itemAttachments ?? {}).filter((a) => a.productId === d.productId)
  if (mine.length >= MAX_ATTACHMENTS) throw new OpError(`An item can have up to ${MAX_ATTACHMENTS} photos and files.`)
  const attachment: ItemAttachment = {
    id: id('att', ctx.now), productId: d.productId, kind: d.kind, name: safeName(d.name), uri: d.uri, mime: d.mime || (d.kind === 'photo' ? 'image/jpeg' : 'application/octet-stream'),
    size: Math.max(0, Math.round(d.size || 0)), addedAt: ctx.now, addedBy: ctx.userId,
    ...(d.kind === 'photo' && !mine.some((a) => a.kind === 'photo') ? { primary: true } : {}),
  }
  return { attachment, changes: { put: { itemAttachments: [attachment], audit: [audit(ctx, 'ITEM_ATTACH', `${p.styleCode}: ${attachment.name}`)] } } }
}

export function removeAttachment(state: DataState, attachmentId: string, ctx: OpCtx): { changes: Changes; removed: ItemAttachment } {
  const a = state.itemAttachments?.[attachmentId]
  if (!a) throw new OpError('That file is already gone.')
  const promote = a.primary ? listOf(state.itemAttachments ?? {}).filter((x) => x.productId === a.productId && x.kind === 'photo' && x.id !== a.id).sort((x, y) => x.addedAt - y.addedAt)[0] : undefined
  return {
    removed: a,
    changes: { del: { itemAttachments: [a.id] }, put: { ...(promote ? { itemAttachments: [{ ...promote, primary: true }] } : {}), audit: [audit(ctx, 'ITEM_DETACH', a.name)] } },
  }
}

/** Makes one photo the item's main picture. */
export function setPrimaryPhoto(state: DataState, attachmentId: string): { changes: Changes } {
  const a = state.itemAttachments?.[attachmentId]
  if (!a || a.kind !== 'photo') throw new OpError('Choose a photo.')
  const changed = listOf(state.itemAttachments ?? {}).filter((x) => x.productId === a.productId && x.kind === 'photo' && (x.id === a.id ? !x.primary : x.primary))
    .map((x) => ({ ...x, primary: x.id === a.id }))
  return { changes: changed.length ? { put: { itemAttachments: changed } } : {} }
}

/** Records that a file has been uploaded to the server (POST /files). */
export function markUploaded(state: DataState, attachmentId: string, remote: { id: string; url: string }, ctx: OpCtx): { changes: Changes } {
  const a = state.itemAttachments?.[attachmentId]
  if (!a) throw new OpError('That file is already gone.')
  return { changes: { put: { itemAttachments: [{ ...a, remoteId: remote.id, remoteUrl: remote.url, uploadedAt: ctx.now }] } } }
}

// ───────────────────────────── label templates ─────────────────────────────

export type TemplateDraft = Omit<LabelTemplate, 'id' | 'createdAt'>

export function saveLabelTemplate(state: DataState, d: TemplateDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; template: LabelTemplate } {
  const bad = templateProblem(d)
  if (bad) throw new OpError(bad)
  const name = d.name.trim()
  if (listOf(state.labelTemplates ?? {}).some((t) => t.id !== existingId && t.name.toLowerCase() === name.toLowerCase())) throw new OpError(`There is already a label called ${name}.`)
  const cur = existingId ? state.labelTemplates?.[existingId] : undefined
  if (existingId && !cur) throw new OpError('That label no longer exists.')
  const template: LabelTemplate = { ...d, name, id: cur?.id ?? id('lbl', ctx.now), createdAt: cur?.createdAt ?? ctx.now }
  return { template, changes: { put: { labelTemplates: [template] } } }
}

export function deleteLabelTemplate(state: DataState, templateId: string): { changes: Changes } {
  if (!state.labelTemplates?.[templateId]) throw new OpError('That label no longer exists.')
  const s = state.catalogSettings?.[CATALOG_SETTINGS_ID]
  return { changes: { del: { labelTemplates: [templateId] }, ...(s?.labelTemplateId === templateId ? { put: { catalogSettings: [{ ...s, labelTemplateId: undefined }] } } : {}) } }
}

// ───────────────────────────── settings & rules ─────────────────────────────

const whole = (n: number, lo: number, hi: number, what: string) => {
  if (!Number.isInteger(n) || n < lo || n > hi) throw new OpError(`${what} must be a whole number from ${lo} to ${hi}.`)
}

export function saveCatalogSettings(state: DataState, patch: Partial<Omit<CatalogSettings, 'id'>>, ctx: OpCtx): { changes: Changes; settings: CatalogSettings } {
  const next: CatalogSettings = { ...catalogSettings(state), ...patch, id: CATALOG_SETTINGS_ID }
  whole(next.leadDays, 0, 120, 'Delivery time')
  whole(next.safetyDays, 0, 60, 'Safety days')
  whole(next.coverDays, 1, 365, 'Days to cover')
  whole(next.windowDays, 14, 365, 'Days of history')
  whole(next.deadDays, 30, 720, 'Days for dead stock')
  if (next.defaultSupplierId && !state.suppliers[next.defaultSupplierId]) throw new OpError('That supplier no longer exists.')
  if (!next.defaultSupplierId) delete next.defaultSupplierId
  if (!next.labelTemplateId) delete next.labelTemplateId
  return { settings: next, changes: { put: { catalogSettings: [next], audit: [audit(ctx, 'CATALOG_SETTINGS', 'Reorder and forecast settings changed')] } } }
}

export interface RuleDraft { supplierId?: string; min?: number; max?: number; moq?: number }

/** Per-variant ordering rules. A rule with nothing in it is removed. */
export function saveReorderRule(state: DataState, variantId: string, d: RuleDraft, ctx: OpCtx): { changes: Changes } {
  const v = state.variants[variantId]
  if (!v) throw new OpError('That item no longer exists.')
  if (d.supplierId && !state.suppliers[d.supplierId]) throw new OpError('That supplier no longer exists.')
  for (const [k, n] of [['Reorder level', d.min], ['Order-up-to level', d.max], ['Pack size', d.moq]] as const) {
    if (n !== undefined && !(n >= 0)) throw new OpError(`${k} cannot be negative.`)
  }
  if (d.min !== undefined && d.max !== undefined && d.max <= d.min) throw new OpError('The order-up-to level must be higher than the reorder level.')
  const rule: ReorderRule = {
    id: variantId, variantId,
    ...(d.supplierId ? { supplierId: d.supplierId } : {}), ...(d.min !== undefined ? { min: d.min } : {}),
    ...(d.max !== undefined ? { max: d.max } : {}), ...(d.moq ? { moq: d.moq } : {}),
  }
  const empty = Object.keys(rule).length === 2
  const had = !!state.reorderRules?.[variantId]
  if (empty) return { changes: had ? { del: { reorderRules: [variantId] } } : {} }
  return { changes: { put: { reorderRules: [rule], audit: [audit(ctx, 'REORDER_RULE', v.sku)] } } }
}

// ───────────────────────────── auto-reorder → draft purchase orders ─────────────────────────────

export interface DraftOrderInput { supplierId: string; items: Array<{ variantId: string; qty: number; cost: number }>; notes?: string }

/**
 * Turns reorder suggestions into draft purchase orders (one per supplier) in the purchasing module's own collection. They are drafts:
 * nothing goes to a supplier until someone opens the order and sends it.
 */
export function createDraftOrders(state: DataState, inputs: DraftOrderInput[], ctx: OpCtx): { changes: Changes; orders: PurchaseOrder[] } {
  if (!inputs.length) throw new OpError('Choose something to order.')
  const taken = listOf(state.purchaseOrders ?? {}).map((o) => o.no)
  const orders: PurchaseOrder[] = []
  inputs.forEach((inp, n) => {
    const sup = state.suppliers[inp.supplierId]
    if (!sup) throw new OpError('Choose a supplier for every order.')
    const items: PurchaseOrder['items'] = []
    for (const l of inp.items) {
      if (!state.variants[l.variantId]) throw new OpError('One of the items no longer exists.')
      if (!(l.qty > 0)) throw new OpError(`Every line needs a quantity (${sup.name}).`)
      if (!(l.cost >= 0)) throw new OpError('A cost cannot be negative.')
      const dup = items.find((i) => i.variantId === l.variantId)
      if (dup) dup.qty = round3(dup.qty + l.qty)
      else items.push({ variantId: l.variantId, qty: round3(l.qty), cost: round2(l.cost), receivedQty: 0 })
    }
    if (!items.length) throw new OpError(`There is nothing to order from ${sup.name}.`)
    const no = nextNo('PO-', taken, ctx)
    taken.push(no)
    orders.push({
      id: id('po_', ctx.now + n), no, supplierId: inp.supplierId, date: ctx.now, status: 'draft', items,
      total: round2(items.reduce((s, i) => s + i.qty * i.cost, 0)), notes: (inp.notes ?? 'Made from the reorder suggestions').trim(), createdBy: ctx.userId,
      ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
    })
  })
  return { orders, changes: { put: { purchaseOrders: orders, audit: orders.map((o) => audit(ctx, 'PO_AUTO', `${o.no} — ₹${o.total} (draft from reorder suggestions)`)) } } }
}

/** Sets reorder levels (and the order-up-to level) from the forecast's min–max suggestions. */
export function applyMinMax(state: DataState, rows: Array<{ variantId: string; min: number; max: number }>, ctx: OpCtx): { changes: Changes; count: number } {
  if (!rows.length) throw new OpError('Choose the items to update.')
  const variants: Variant[] = []
  const rules: ReorderRule[] = []
  const outbox: OutboxDraft[] = []
  for (const r of rows) {
    const v = state.variants[r.variantId]
    if (!v) continue
    if (!(r.min >= 0) || !(r.max > r.min)) throw new OpError(`The levels for ${v.sku} do not make sense.`)
    variants.push({ ...v, reorderLevel: r.min })
    outbox.push(q('variantUpdate', { id: v.id, reorderLevel: r.min }))
    const { min: _min, ...rest } = state.reorderRules?.[v.id] ?? { id: v.id, variantId: v.id }
    void _min
    rules.push({ ...rest, max: r.max })
  }
  return { count: variants.length, changes: { put: { variants, reorderRules: rules, audit: [audit(ctx, 'MINMAX_APPLY', `${variants.length} items — reorder levels set from the forecast`)] }, outbox } }
}
