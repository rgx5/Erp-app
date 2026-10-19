import { barcodeBits } from './barcode'
import { inr } from './money'
import { esc } from './receipt'

export interface LabelItem {
  name: string
  /** "M / Navy" or empty. */
  variant: string
  sku: string
  barcode: string
  price: number
  mrp: number
  /** How many labels to print. */
  copies: number
}

export interface LabelOptions {
  store: string
  /** Label size in millimetres. */
  widthMm: number
  heightMm: number
  /** Labels per row on the sheet. */
  perRow: number
  showMrp: boolean
  showStore: boolean
}

export const DEFAULT_LABEL: LabelOptions = { store: '', widthMm: 62, heightMm: 36, perRow: 3, showMrp: true, showStore: true }

/** The bars of a code as an SVG string — drawn from the pattern, so no barcode library is needed and it prints crisply. */
export function barcodeSvg(code: string, widthMm: number, heightMm: number): string {
  const { bits } = barcodeBits(code)
  const quiet = 10
  const total = bits.length + quiet * 2
  let rects = ''
  for (let i = 0; i < bits.length;) {
    if (bits[i] === '1') {
      let j = i
      while (j < bits.length && bits[j] === '1') j++
      rects += `<rect x="${i + quiet}" y="0" width="${j - i}" height="100" />`
      i = j
    } else i++
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 100" preserveAspectRatio="none" width="${widthMm}mm" height="${heightMm}mm" shape-rendering="crispEdges" fill="#000">${rects}</svg>`
}

/** A printable sheet of price labels, one per piece. */
export function labelsHtml(items: LabelItem[], o: LabelOptions = DEFAULT_LABEL): string {
  const cells: string[] = []
  for (const it of items) {
    let bars: string
    try { bars = barcodeSvg(it.barcode, o.widthMm - 10, o.heightMm * 0.34) } catch { bars = '' }
    const cell = `<div class="l">
      ${o.showStore && o.store ? `<div class="s">${esc(o.store)}</div>` : ''}
      <div class="n">${esc(it.name)}</div>${it.variant ? `<div class="v">${esc(it.variant)}</div>` : ''}
      <div class="b">${bars}</div><div class="c">${esc(it.barcode)}</div>
      <div class="p">${o.showMrp && it.mrp > it.price ? `<span class="m">MRP ${esc(inr(it.mrp, 0))}</span> ` : ''}<b>${esc(inr(it.price, 0))}</b></div></div>`
    for (let i = 0; i < Math.max(1, Math.floor(it.copies)); i++) cells.push(cell)
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:8mm}*{box-sizing:border-box}body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#000}
    .sheet{display:grid;grid-template-columns:repeat(${o.perRow},${o.widthMm}mm);gap:2mm 2mm}
    .l{width:${o.widthMm}mm;height:${o.heightMm}mm;padding:1.5mm 2mm;border:0.2mm dashed #bbb;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;line-height:1.15}
    .s{font-size:6pt;letter-spacing:.4pt;text-transform:uppercase;color:#444}.n{font-size:8pt;font-weight:700;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .v{font-size:7pt;color:#333}.b{margin-top:1mm}.b svg{display:block}.c{font-size:6pt;letter-spacing:.8pt}.p{font-size:10pt;margin-top:.5mm}.m{font-size:7pt;text-decoration:line-through;color:#444}
  </style></head><body><div class="sheet">${cells.join('')}</div></body></html>`
}
