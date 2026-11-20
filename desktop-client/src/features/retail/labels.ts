import JsBarcode from 'jsbarcode'
import { formatInr } from '@/domain/format'

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

export interface LabelItem { code: string; name: string; barcode: string; price: string | null; copies: number }
export interface LabelSize { id: string; name: string; widthMm: number; heightMm: number; perRow: number }
export const LABEL_SIZES: LabelSize[] = [
  { id: '50x25', name: '50 × 25 mm roll', widthMm: 50, heightMm: 25, perRow: 1 },
  { id: '38x25', name: '38 × 25 mm roll', widthMm: 38, heightMm: 25, perRow: 1 },
  { id: 'a4-3x8', name: 'A4 sheet, 3 × 8 (64 × 34 mm)', widthMm: 64, heightMm: 34, perRow: 3 },
]

/** The check digit that completes the first 12 digits of an EAN-13. */
const ean13Check = (d12: string): number => (10 - (d12.split('').reduce((sum, ch, i) => sum + Number(ch) * (i % 2 === 0 ? 1 : 3), 0) % 10)) % 10
export const isEan13 = (v: string): boolean => /^\d{13}$/.test(v) && ean13Check(v.slice(0, 12)) === Number(v[12])
/** A new in-store barcode: a valid EAN-13 starting with 2, the range reserved worldwide for numbers a shop makes itself, so it can never clash with a manufacturer's code. */
export function generateEan13(): string {
  const r = crypto.getRandomValues(new Uint32Array(2))
  const body = `2${String((r[0] ?? 0) % 100000).padStart(5, '0')}${String((r[1] ?? 0) % 1000000).padStart(6, '0')}`
  return body + ean13Check(body)
}

/** A barcode as an SVG string (Code 128 reads any letters and digits, so item codes work as well as EAN numbers). */
export function barcodeSvg(value: string, heightPx = 34): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, value, { format: isEan13(value) ? 'EAN13' : 'CODE128', displayValue: false, height: heightPx, margin: 0, width: 1.4, background: 'transparent' })
  svg.setAttribute('style', 'max-width:100%;height:auto')
  return svg.outerHTML
}

/** Price labels as one self-contained page. Each label: name, price, barcode with its number. Nothing is calculated here; the price is shown as given. */
export function labelsHtml(items: LabelItem[], size: LabelSize, shop: string): string {
  const cells = items.flatMap((i) => Array.from({ length: Math.max(1, i.copies) }, () => i)).map((i) => `
    <div class="l"><div class="n">${esc(i.name)}</div>${i.price ? `<div class="p">${esc(formatInr(i.price))}</div>` : ''}<div class="b">${barcodeSvg(i.barcode)}<div class="t">${esc(i.barcode)}</div></div></div>`).join('')
  const sheet = size.perRow > 1
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels ${esc(shop)}</title>
<style>@page{size:${sheet ? 'A4' : `${size.widthMm}mm ${size.heightMm}mm`};margin:${sheet ? '10mm 6mm' : '0'}}
body{margin:0;font:9px/1.2 system-ui,sans-serif;color:#000}
.grid{display:${sheet ? 'grid' : 'block'};${sheet ? `grid-template-columns:repeat(${size.perRow},${size.widthMm}mm);gap:0 2mm;` : ''}}
.l{box-sizing:border-box;width:${size.widthMm}mm;height:${size.heightMm}mm;padding:1.5mm 2mm;overflow:hidden;page-break-inside:avoid;${sheet ? '' : 'page-break-after:always;'}display:flex;flex-direction:column;justify-content:space-between}
.n{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.p{font-size:13px;font-weight:700}.b{text-align:center}.t{font-size:8px;letter-spacing:.06em}</style></head><body><div class="grid">${cells}</div></body></html>`
}
