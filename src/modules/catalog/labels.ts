/**
 * Label templates: the size of a label, what it shows, and whether it has bars or a QR code. Builds on the core barcode label printing
 * (`@/domain/labels`): the bars come from the same `barcodeSvg`, and a template's output is an HTML sheet for `printHtml`.
 */
import { barcodeSvg, type LabelItem } from '@/domain/labels'
import { inr } from '@/domain/money'
import { qrSvg } from '@/domain/qrSvg'
import { esc } from '@/domain/receipt'
import type { LabelField, LabelTemplate } from './types'

export const LABEL_FIELDS: Array<{ field: LabelField; label: string }> = [
  { field: 'store', label: 'Shop name' },
  { field: 'name', label: 'Item name' },
  { field: 'variant', label: 'Size / colour' },
  { field: 'brand', label: 'Brand' },
  { field: 'sku', label: 'SKU' },
  { field: 'barcodeText', label: 'Barcode number' },
  { field: 'hsn', label: 'HSN' },
  { field: 'mrp', label: 'MRP (struck through)' },
  { field: 'price', label: 'Price' },
]

const preset = (id: string, name: string, widthMm: number, heightMm: number, perRow: number, paper: LabelTemplate['paper'], fields: LabelField[], code: LabelTemplate['code'], qrText = '{barcode}'): LabelTemplate =>
  ({ id, name, widthMm, heightMm, perRow, paper, fields, code, qrText, createdAt: 0 })

/** Ready-made templates (not stored: copy one to change it). The first is exactly what the Items screen has always printed. */
export const LABEL_PRESETS: LabelTemplate[] = [
  preset('preset:shelf', 'Shelf label 62 × 36 mm (A4, 3 across)', 62, 36, 3, 'sheet', ['store', 'name', 'variant', 'barcodeText', 'mrp', 'price'], 'bars'),
  preset('preset:small', 'Small tag 38 × 25 mm (A4, 5 across)', 38, 25, 5, 'sheet', ['name', 'variant', 'price'], 'bars'),
  preset('preset:roll', 'Roll label 50 × 30 mm (thermal printer)', 50, 30, 1, 'roll', ['name', 'variant', 'barcodeText', 'mrp', 'price'], 'bars'),
  preset('preset:qr', 'QR label 50 × 30 mm (thermal printer)', 50, 30, 1, 'roll', ['name', 'variant', 'sku', 'price'], 'qr', '{barcode}'),
  preset('preset:big', 'Big label 100 × 50 mm (roll)', 100, 50, 1, 'roll', ['store', 'name', 'variant', 'brand', 'sku', 'barcodeText', 'hsn', 'mrp', 'price'], 'bars'),
]

export const allTemplates = (stored: LabelTemplate[]): LabelTemplate[] => [...LABEL_PRESETS, ...[...stored].sort((a, b) => a.name.localeCompare(b.name))]
export const findTemplate = (stored: LabelTemplate[], id: string | undefined): LabelTemplate => allTemplates(stored).find((t) => t.id === id) ?? LABEL_PRESETS[0]

export interface TemplateItem extends LabelItem { brand?: string; hsn?: string }

/** The text a QR code holds: the template's text with {barcode} {sku} {name} {price} filled in. */
export const qrPayload = (t: Pick<LabelTemplate, 'qrText'>, it: Pick<TemplateItem, 'barcode' | 'sku' | 'name' | 'price'>) =>
  (t.qrText || '{barcode}').replace(/\{(barcode|sku|name|price)\}/g, (_, k: 'barcode' | 'sku' | 'name' | 'price') => String(it[k]))

/** Validates a template's size and fields before it is saved. */
export function templateProblem(t: Pick<LabelTemplate, 'name' | 'widthMm' | 'heightMm' | 'perRow' | 'fields' | 'code'>): string | null {
  if (!t.name.trim()) return 'Give the label template a name.'
  if (!(t.widthMm >= 15 && t.widthMm <= 210)) return 'The label width must be between 15 and 210 mm.'
  if (!(t.heightMm >= 10 && t.heightMm <= 297)) return 'The label height must be between 10 and 297 mm.'
  if (!Number.isInteger(t.perRow) || t.perRow < 1 || t.perRow > 12) return 'Labels per row must be a whole number from 1 to 12.'
  if (t.perRow * t.widthMm > 200 && t.perRow > 1) return `${t.perRow} labels of ${t.widthMm} mm do not fit across an A4 sheet.`
  if (!t.fields.length && t.code === 'none') return 'Choose at least one thing for the label to show.'
  return null
}

function cell(it: TemplateItem, t: LabelTemplate, store: string): string {
  const has = (f: LabelField) => t.fields.includes(f)
  const small = t.heightMm < 28
  const pad = 2 // mm of white space inside the label
  let code = ''
  if (t.code === 'bars') {
    try { code = `<div class="b">${barcodeSvg(it.barcode, t.widthMm - 2 * pad - 2, Math.max(5, t.heightMm * (small ? 0.3 : 0.34)))}</div>` } catch { code = '' }
  } else if (t.code === 'qr') {
    const size = Math.max(10, Math.min(t.heightMm - 2 * pad, t.widthMm * 0.45))
    code = `<div class="q">${qrSvg(qrPayload(t, it), 160).replace(/width="160" height="160"/, `width="${size}mm" height="${size}mm"`)}</div>`
  }
  const lines = [
    has('store') && store ? `<div class="s">${esc(store)}</div>` : '',
    has('name') ? `<div class="n">${esc(it.name)}</div>` : '',
    has('variant') && it.variant ? `<div class="v">${esc(it.variant)}</div>` : '',
    has('brand') && it.brand ? `<div class="v">${esc(it.brand)}</div>` : '',
    has('sku') ? `<div class="c">${esc(it.sku)}</div>` : '',
    has('hsn') && it.hsn ? `<div class="c">HSN ${esc(it.hsn)}</div>` : '',
  ].join('')
  const num = has('barcodeText') ? `<div class="c">${esc(it.barcode)}</div>` : ''
  const price = has('price') || has('mrp')
    ? `<div class="p">${has('mrp') && it.mrp > it.price ? `<span class="m">MRP ${esc(inr(it.mrp, 0))}</span> ` : ''}${has('price') ? `<b>${esc(inr(it.price, 0))}</b>` : ''}</div>` : ''
  return t.code === 'qr'
    ? `<div class="l row">${code}<div class="t">${lines}${num}${price}</div></div>`
    : `<div class="l">${lines}${code}${num}${price}</div>`
}

/** A printable sheet (or roll) of labels, one per copy, in the template's layout. */
export function labelSheetHtml(items: TemplateItem[], t: LabelTemplate, store: string): string {
  const cells: string[] = []
  for (const it of items) {
    const c = cell(it, t, store)
    for (let i = 0; i < Math.max(1, Math.floor(it.copies)); i++) cells.push(c)
  }
  const roll = t.paper === 'roll'
  const fs = t.heightMm < 28 ? 0.85 : 1
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:${roll ? `${t.widthMm}mm ${t.heightMm}mm` : 'A4'};margin:${roll ? '0' : '8mm'}}*{box-sizing:border-box}body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#000}
    .sheet{${roll ? '' : `display:grid;grid-template-columns:repeat(${t.perRow},${t.widthMm}mm);gap:2mm 2mm`}}
    .l{width:${t.widthMm}mm;height:${t.heightMm}mm;padding:1.5mm 2mm;${roll ? 'page-break-after:always;' : 'border:0.2mm dashed #bbb;'}overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;line-height:1.15}
    .l.row{flex-direction:row;gap:2mm;text-align:left}.l.row .t{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start}
    .s{font-size:${6 * fs}pt;letter-spacing:.4pt;text-transform:uppercase;color:#444}.n{font-size:${8 * fs}pt;font-weight:700;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .v{font-size:${7 * fs}pt;color:#333}.b{margin-top:1mm}.b svg,.q svg{display:block}.c{font-size:${6 * fs}pt;letter-spacing:.8pt}.p{font-size:${10 * fs}pt;margin-top:.5mm}.m{font-size:${7 * fs}pt;text-decoration:line-through;color:#444}
  </style></head><body><div class="sheet">${cells.join('')}</div></body></html>`
}
