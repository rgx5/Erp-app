/**
 * Bulk import / export of items. A spreadsheet has one row per variant (size/colour combination); rows that share an item code
 * (or, without one, a name and brand) become one item. Every row is checked against the file and against what is already in the
 * business before anything is written, so the person sees exactly what will happen: created, updated, unchanged, or refused.
 * Pure: reading the file (CSV / Excel) is in sheet.ts, writing the result is `importItems` in ops.ts.
 */
import type { CsvCell } from '@/domain/csv'
import { skuFor } from '@/domain/codes'
import { inr } from '@/domain/money'
import { UNIT_PRESETS } from '@/domain/qty'
import type { Product, Variant } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import { fieldCell, parseFieldValue, activeFields } from './fields'
import type { CustomFieldDef, CustomValue } from './types'

export type ItemField = 'code' | 'name' | 'category' | 'brand' | 'hsn' | 'unit' | 'gst' | 'size' | 'color' | 'sku' | 'barcode' | 'cost' | 'mrp' | 'price' | 'stock' | 'reorder' | 'fabric' | 'season'

/** The columns, in the order an export writes them. `aliases` are the other headings people use for the same thing. */
export const ITEM_COLUMNS: Array<{ field: ItemField; header: string; aliases: string[] }> = [
  { field: 'code', header: 'Item code', aliases: ['code', 'stylecode', 'style', 'itemno', 'productcode', 'itemid'] },
  { field: 'name', header: 'Name', aliases: ['itemname', 'item', 'product', 'productname', 'description', 'title'] },
  { field: 'category', header: 'Category', aliases: ['categoryname', 'group', 'department'] },
  { field: 'brand', header: 'Brand', aliases: ['make', 'manufacturer'] },
  { field: 'hsn', header: 'HSN', aliases: ['hsncode', 'hsnsac', 'sac'] },
  { field: 'unit', header: 'Unit', aliases: ['uom', 'unitofmeasure'] },
  { field: 'gst', header: 'GST %', aliases: ['gst', 'gstrate', 'gstrate%', 'tax', 'tax%', 'taxrate', 'gstpercent'] },
  { field: 'size', header: 'Option 1', aliases: ['size', 'option', 'pack', 'packsize', 'variant', 'strength', 'type'] },
  { field: 'color', header: 'Option 2', aliases: ['colour', 'color', 'flavour', 'flavor', 'shade'] },
  { field: 'sku', header: 'SKU', aliases: ['skucode', 'sku code', 'variantcode'] },
  { field: 'barcode', header: 'Barcode', aliases: ['ean', 'ean13', 'upc', 'barcodeno', 'gtin'] },
  { field: 'cost', header: 'Cost', aliases: ['costprice', 'cost price', 'purchaseprice', 'purchaserate', 'buyprice', 'buyingprice'] },
  { field: 'mrp', header: 'MRP', aliases: ['maxretailprice', 'listprice'] },
  { field: 'price', header: 'Price', aliases: ['sellingprice', 'saleprice', 'sprice', 'rate', 'retailprice', 'sellprice'] },
  { field: 'stock', header: 'Stock', aliases: ['qty', 'quantity', 'openingstock', 'onhand', 'closingstock', 'balance'] },
  { field: 'reorder', header: 'Reorder level', aliases: ['reorderlevel', 'reorder', 'minstock', 'min', 'minimumstock', 'lowstock', 'minqty'] },
  { field: 'fabric', header: 'Attribute 1', aliases: ['attribute1', 'fabric', 'composition', 'material', 'model'] },
  { field: 'season', header: 'Attribute 2', aliases: ['attribute2', 'season', 'warranty', 'shelflife'] },
]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, '')
const ALIAS = new Map<string, ItemField>()
for (const c of ITEM_COLUMNS) {
  ALIAS.set(norm(c.header), c.field)
  ALIAS.set(c.field, c.field)
  for (const a of c.aliases) ALIAS.set(norm(a), c.field)
}

/** Text the exporter prefixed with an apostrophe so a spreadsheet would not run it as a formula. */
const unescapeCell = (s: string) => (/^'[=+@\-\t\r]/.test(s) ? s.slice(1) : s)

export interface ItemRowData {
  code: string
  name: string
  category: string
  brand: string
  hsn: string
  unit: string
  gst?: number
  size: string
  color: string
  sku: string
  barcode: string
  cost?: number
  mrp?: number
  price?: number
  stock?: number
  reorder?: number
  fabric: string
  season: string
  /** Custom field values, by field id. */
  custom: Record<string, CustomValue>
}

export type ImportAction = 'create' | 'update' | 'same' | 'error'

export interface ImportRow {
  /** The row's number in the file (the heading is row 1). */
  line: number
  action: ImportAction
  errors: string[]
  warnings: string[]
  data: ItemRowData
  /** The variant this row updates (found by SKU, barcode, or item + options). */
  variantId?: string
  /** The product this row belongs to, when it already exists. */
  productId?: string
  /** Rows with the same key become one new item. */
  productKey?: string
  /** What an update changes, in words. */
  changes: string[]
  variantPatch?: Partial<Pick<Variant, 'cost' | 'mrp' | 'price' | 'reorderLevel' | 'stock'>>
  productPatch?: Partial<Pick<Product, 'name' | 'brand' | 'hsn' | 'fabric' | 'season' | 'gstRate'>> & { categoryName?: string; categoryId?: string }
}

export interface ImportPreview {
  /** Set when the file cannot be imported at all. */
  fatal?: string
  rows: ImportRow[]
  /** Headings the importer did not understand (ignored). */
  ignored: string[]
  /** Categories that do not exist yet and will be created. */
  newCategories: string[]
  counts: { create: number; update: number; same: number; error: number; warnings: number; items: number }
}

const emptyData = (): ItemRowData => ({ code: '', name: '', category: '', brand: '', hsn: '', unit: '', size: '', color: '', sku: '', barcode: '', fabric: '', season: '', custom: {} })
const fatal = (message: string): ImportPreview => ({ fatal: message, rows: [], ignored: [], newCategories: [], counts: { create: 0, update: 0, same: 0, error: 0, warnings: 0, items: 0 } })

export function mapColumns(header: string[], defs: CustomFieldDef[]) {
  const cols: Partial<Record<ItemField, number>> = {}
  const custom: Array<{ def: CustomFieldDef; col: number }> = []
  const ignored: string[] = []
  const byLabel = new Map(activeFields(defs).map((d) => [norm(d.label), d]))
  header.forEach((h, i) => {
    const key = norm(unescapeCell(h))
    if (!key) return
    const f = ALIAS.get(key)
    if (f && cols[f] === undefined) { cols[f] = i; return }
    const d = byLabel.get(key)
    if (d && !custom.some((x) => x.def.id === d.id)) { custom.push({ def: d, col: i }); return }
    ignored.push(h)
  })
  return { cols, custom, ignored }
}

/** "Piece", "pcs", "M" → the unit codes the app knows; anything else is kept as the shop's own label. */
export function normUnit(raw: string): string {
  const t = raw.trim().toLowerCase()
  if (!t) return ''
  const hit = UNIT_PRESETS.find((u) => u.code === t || u.label.toLowerCase() === t || u.short.toLowerCase() === t || `${u.code}s` === t || `${u.short.toLowerCase()}s` === t)
  return hit ? hit.code : t.slice(0, 12)
}

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const money = (n: number) => inr(n, 2)

export function previewImport(table: string[][], state: DataState, defs: CustomFieldDef[] = []): ImportPreview {
  if (table.length < 2) return fatal('The file has no rows to import. The first row must be the column headings.')
  const { cols, custom, ignored } = mapColumns(table[0], defs)
  if (cols.name === undefined && cols.sku === undefined && cols.barcode === undefined && cols.code === undefined) {
    return fatal('Could not find a Name, Item code, SKU or Barcode column in the first row. Download the template to see the headings.')
  }

  const products = listOf(state.products)
  const variants = listOf(state.variants)
  const prodByCode = new Map(products.map((p) => [p.styleCode.toUpperCase(), p]))
  const prodByName = new Map<string, Product>()
  for (const p of products) { const k = `${p.name.toLowerCase()}|${p.brand.toLowerCase()}`; if (!prodByName.has(k)) prodByName.set(k, p) }
  const varsOf = new Map<string, Variant[]>()
  for (const v of variants) { const l = varsOf.get(v.productId); if (l) l.push(v); else varsOf.set(v.productId, [v]) }
  const bySku = new Map(variants.map((v) => [v.sku.toUpperCase(), v]))
  const byBarcode = new Map(variants.filter((v) => v.barcode).map((v) => [v.barcode, v]))
  const catByName = new Map(listOf(state.categories).map((c) => [c.name.toLowerCase(), c]))

  const seenVariant = new Set<string>()
  const seenSku = new Set<string>()
  const seenBarcode = new Set<string>()
  const seenOption = new Set<string>()
  const newCats = new Map<string, string>()
  const rows: ImportRow[] = []

  for (let r = 1; r < table.length; r++) {
    const cells = table[r]
    if (!cells.some((c) => String(c ?? '').trim() !== '')) continue
    const errors: string[] = []
    const warnings: string[] = []
    const text = (f: ItemField) => (cols[f] === undefined ? '' : unescapeCell(String(cells[cols[f]!] ?? '')).trim())
    const num = (f: ItemField, label: string, max = Infinity): number | undefined => {
      const raw = text(f)
      if (raw === '') return undefined
      const n = Number(raw.replace(/[₹,%\s]/g, '').replace(/^rs\.?/i, ''))
      if (!Number.isFinite(n)) { errors.push(`${label} “${raw}” is not a number`); return undefined }
      if (n < 0) { errors.push(`${label} cannot be negative`); return undefined }
      if (n > max) { errors.push(`${label} ${n} is too large`); return undefined }
      return n
    }
    const d: ItemRowData = {
      ...emptyData(), code: text('code').toUpperCase(), name: text('name'), category: text('category'), brand: text('brand'), hsn: text('hsn'),
      unit: normUnit(text('unit')), size: text('size'), color: text('color'), sku: text('sku').toUpperCase(), barcode: text('barcode'),
      fabric: text('fabric'), season: text('season'),
      gst: num('gst', 'GST %', 100), cost: num('cost', 'Cost'), mrp: num('mrp', 'MRP'), price: num('price', 'Price'), stock: num('stock', 'Stock'), reorder: num('reorder', 'Reorder level'),
    }
    for (const { def, col } of custom) {
      const p = parseFieldValue(def, unescapeCell(String(cells[col] ?? '')))
      if (p.error) errors.push(p.error); else if (p.value !== undefined) d.custom[def.id] = p.value
    }
    if (d.hsn && !/^\d{4,8}$/.test(d.hsn)) warnings.push(`HSN “${d.hsn}” is not 4 to 8 digits`)
    if (d.price !== undefined && d.mrp !== undefined && d.mrp > 0 && d.mrp < d.price) warnings.push('MRP is below the selling price')
    if (d.price !== undefined && d.cost !== undefined && d.price > 0 && d.price < d.cost) warnings.push('Selling price is below cost')

    // Which variant is this row about?
    const vs = d.sku ? bySku.get(d.sku) : undefined
    const vb = d.barcode ? byBarcode.get(d.barcode) : undefined
    let existing = vs ?? vb
    if (vs && vb && vs.id !== vb.id) errors.push(`SKU ${d.sku} and barcode ${d.barcode} belong to different items`)
    else if (!vs && vb && d.sku) errors.push(`Barcode ${d.barcode} already belongs to ${vb.sku}, not ${d.sku}`)
    let product: Product | undefined = existing ? state.products[existing.productId] : undefined
    if (!existing) {
      product = d.code ? prodByCode.get(d.code) : d.name ? prodByName.get(`${d.name.toLowerCase()}|${d.brand.toLowerCase()}`) : undefined
      const same = product ? (varsOf.get(product.id) ?? []).find((v) => eq(v.size, d.size) && eq(v.color, d.color)) : undefined
      if (same) {
        if ((d.sku && d.sku !== same.sku.toUpperCase()) || (d.barcode && d.barcode !== same.barcode)) errors.push(`${product!.name} already has this option as ${same.sku} — use that SKU to update it`)
        else existing = same
      }
    }

    const row: ImportRow = { line: r + 1, action: 'create', errors, warnings, data: d, changes: [] }

    if (existing) {
      row.variantId = existing.id
      row.productId = existing.productId
      if (seenVariant.has(existing.id)) errors.push(`${existing.sku} appears twice in the file`)
      seenVariant.add(existing.id)
      if (d.barcode && existing.barcode && d.barcode !== existing.barcode) warnings.push('Barcode is not changed on an existing item')
      if (d.sku && d.sku !== existing.sku.toUpperCase()) warnings.push('SKU is not changed on an existing item')
      if (d.unit && product && d.unit !== (product.unit ?? 'pc')) warnings.push('Unit is not changed on an existing item')
      if (d.code && product && d.code !== product.styleCode.toUpperCase()) warnings.push('Item code is not changed on an existing item')
      const vp: NonNullable<ImportRow['variantPatch']> = {}
      const say = (label: string, from: number, to: number, isMoney = true) => row.changes.push(`${label} ${isMoney ? money(from) : from} → ${isMoney ? money(to) : to}`)
      if (d.cost !== undefined && d.cost !== existing.cost) { vp.cost = d.cost; say('Cost', existing.cost, d.cost) }
      if (d.mrp !== undefined && d.mrp !== existing.mrp) { vp.mrp = d.mrp; say('MRP', existing.mrp, d.mrp) }
      if (d.price !== undefined && d.price !== existing.price) { vp.price = d.price; say('Price', existing.price, d.price) }
      if (d.reorder !== undefined && d.reorder !== existing.reorderLevel) { vp.reorderLevel = d.reorder; say('Reorder level', existing.reorderLevel, d.reorder, false) }
      if (d.stock !== undefined && product?.trackStock !== false && d.stock !== existing.stock) { vp.stock = d.stock; say('Stock', existing.stock, d.stock, false) }
      const pp: NonNullable<ImportRow['productPatch']> = {}
      if (product) {
        if (d.name && d.name !== product.name) { pp.name = d.name; row.changes.push(`Name “${product.name}” → “${d.name}”`) }
        if (d.brand && d.brand !== product.brand) { pp.brand = d.brand; row.changes.push(`Brand → ${d.brand}`) }
        if (d.hsn && d.hsn !== product.hsn) { pp.hsn = d.hsn; row.changes.push(`HSN → ${d.hsn}`) }
        if (d.fabric && d.fabric !== product.fabric) { pp.fabric = d.fabric; row.changes.push(`Attribute 1 → ${d.fabric}`) }
        if (d.season && d.season !== product.season) { pp.season = d.season; row.changes.push(`Attribute 2 → ${d.season}`) }
        if (d.gst !== undefined && d.gst !== product.gstRate) { pp.gstRate = d.gst; row.changes.push(`GST → ${d.gst}%`) }
        if (d.category) {
          const cat = catByName.get(d.category.toLowerCase())
          if (!cat) { if (!newCats.has(d.category.toLowerCase())) newCats.set(d.category.toLowerCase(), d.category); pp.categoryName = d.category; row.changes.push(`Category → ${d.category} (new)`) }
          else if (cat.id !== product.categoryId) { pp.categoryId = cat.id; row.changes.push(`Category → ${cat.name}`) }
        }
      }
      for (const [fid, v] of Object.entries(d.custom)) row.changes.push(`${defs.find((x) => x.id === fid)?.label ?? 'Field'} → ${String(v)}`)
      if (Object.keys(vp).length) row.variantPatch = vp
      if (Object.keys(pp).length) row.productPatch = pp
    } else {
      // A new variant, of a new item or of an item that exists.
      row.productId = product?.id
      const key = product ? `p:${product.id}` : d.code ? `c:${d.code}` : `n:${d.name.toLowerCase()}|${d.brand.toLowerCase()}`
      row.productKey = key
      if (!product && !d.name) errors.push('Name is missing')
      if (!product && !d.name && !d.code && !d.sku && !d.barcode) errors.push('The row has nothing to identify the item')
      const opt = `${key}|${d.size.toLowerCase()}|${d.color.toLowerCase()}`
      if (seenOption.has(opt)) errors.push('Another row has the same item and options — each size / colour must appear once')
      seenOption.add(opt)
      if (d.sku) {
        if (seenSku.has(d.sku)) errors.push(`SKU ${d.sku} appears twice in the file`)
        seenSku.add(d.sku)
      } else if (d.code || product) {
        const auto = skuFor(product?.styleCode ?? d.code, d.color, d.size).toUpperCase()
        if (bySku.has(auto) || seenSku.has(auto)) errors.push(`The code ${auto} is already used — give this row its own SKU`)
        seenSku.add(auto)
      }
      if (d.barcode) {
        if (seenBarcode.has(d.barcode)) errors.push(`Barcode ${d.barcode} appears twice in the file`)
        seenBarcode.add(d.barcode)
      }
      if (!product) {
        if (d.category && !catByName.has(d.category.toLowerCase())) { if (!newCats.has(d.category.toLowerCase())) newCats.set(d.category.toLowerCase(), d.category); warnings.push(`Category “${d.category}” will be created`) }
        if (!d.category) warnings.push('No category — the item will be uncategorised')
        const cfg = catByName.get(d.category.toLowerCase())?.config
        if (d.unit === '' && cfg?.unit) d.unit = cfg.unit
      }
      if (!(d.price && d.price > 0)) warnings.push('No selling price — it will wait in the price-later list')
      if (d.stock !== undefined && product?.trackStock === false) warnings.push('This item does not track stock; the stock figure is ignored')
      for (const def of activeFields(defs)) if (def.required && !custom.some((c) => c.def.id === def.id)) { warnings.push(`${def.label} is required but the file has no such column`); break }
    }
    row.action = errors.length ? 'error' : existing ? (row.changes.length ? 'update' : 'same') : 'create'
    rows.push(row)
  }

  const counts = { create: 0, update: 0, same: 0, error: 0, warnings: 0, items: 0 }
  for (const r of rows) { counts[r.action]++; if (r.warnings.length) counts.warnings++ }
  counts.items = new Set(rows.filter((r) => r.action === 'create' && r.productKey).map((r) => r.productKey)).size
  return { rows, ignored, newCategories: [...newCats.values()], counts }
}

/** The rows of an export: a heading row, then one row per variant — the same columns an import reads, so a file can go round. */
export function exportRows(state: DataState, defs: CustomFieldDef[] = [], opts: { archived?: boolean } = {}): CsvCell[][] {
  const fields = activeFields(defs)
  const head: CsvCell[] = [...ITEM_COLUMNS.map((c) => c.header), ...fields.map((f) => f.label)]
  const out: CsvCell[][] = [head]
  const products = listOf(state.products).filter((p) => opts.archived || p.active !== false).sort((a, b) => a.styleCode.localeCompare(b.styleCode))
  for (const p of products) {
    const vs = listOf(state.variants).filter((v) => v.productId === p.id).sort((a, b) => a.sku.localeCompare(b.sku))
    const vals = state.customFieldValues?.[p.id]?.values ?? {}
    for (const v of vs) {
      out.push([
        p.styleCode, p.name, state.categories[p.categoryId]?.name ?? '', p.brand, p.hsn, p.unit ?? 'pc', p.gstRate ?? '', v.size, v.color, v.sku, v.barcode,
        v.cost, v.mrp, v.price, v.stock, v.reorderLevel, p.fabric, p.season,
        ...fields.map((f) => fieldCell(f, vals[f.id])),
      ])
    }
  }
  return out
}

/** A one-line example file: the headings plus two sample rows, so people see what to fill in. */
export const templateRows = (): CsvCell[][] => [
  ITEM_COLUMNS.map((c) => c.header),
  ['KU-101', 'Cotton Kurta', 'Kurtas', 'Fab India', '6104', 'pc', 5, 'M', 'Blue', '', '', 450, 999, 799, 10, 3, 'Cotton', 'Summer'],
  ['KU-101', 'Cotton Kurta', 'Kurtas', 'Fab India', '6104', 'pc', 5, 'L', 'Blue', '', '', 450, 999, 799, 6, 3, 'Cotton', 'Summer'],
]
