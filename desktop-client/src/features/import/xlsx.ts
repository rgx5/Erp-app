import { readZip, type ZipEntry } from './zip'
import type { Grid } from './readers'

const td = new TextDecoder()
const parse = (bytes: Uint8Array): Document => new DOMParser().parseFromString(td.decode(bytes), 'application/xml')
const kids = (el: Element, name: string): Element[] => Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === name)

const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])
const letters = (ref: string): number => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }

/** A spreadsheet's serial date as 2026-04-15 (or with the time when there is one). */
export function serialToDate(serial: number): string {
  const ms = Math.round((serial - 25_569) * 86_400_000); const d = new Date(ms)
  const day = d.toISOString().slice(0, 10)
  return serial % 1 === 0 ? day : `${day} ${d.toISOString().slice(11, 19)}`
}

/** The sheets of an .xlsx workbook as grids of text. Dates are recognised from the cell styles and written as dates. */
export async function readXlsx(entries: ZipEntry[]): Promise<Grid[]> {
  const get = async (name: string): Promise<Uint8Array | null> => { const e = entries.find((x) => x.name.toLowerCase() === name.toLowerCase()); return e ? e.read() : null }
  const wbBytes = await get('xl/workbook.xml'); if (!wbBytes) throw new Error('This spreadsheet has no sheets.')
  const wb = parse(wbBytes).documentElement
  const relBytes = await get('xl/_rels/workbook.xml.rels')
  const rels = new Map<string, string>(); if (relBytes) for (const r of kids(parse(relBytes).documentElement, 'Relationship')) rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '')
  const sharedBytes = await get('xl/sharedStrings.xml')
  const shared = sharedBytes ? kids(parse(sharedBytes).documentElement, 'si').map((si) => kids(si, 't').map((t) => t.textContent ?? '').join('')) : []
  // which cell styles are dates
  const dateStyle: boolean[] = []
  const stBytes = await get('xl/styles.xml')
  if (stBytes) {
    const st = parse(stBytes).documentElement
    const custom = new Map<number, string>(); for (const nf of kids(st, 'numFmt')) custom.set(Number(nf.getAttribute('numFmtId')), nf.getAttribute('formatCode') ?? '')
    const xfs = kids(st, 'cellXfs')[0]
    if (xfs) for (const xf of Array.from(xfs.children)) { const id = Number(xf.getAttribute('numFmtId') ?? 0); const code = custom.get(id); dateStyle.push(code !== undefined ? /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) : BUILTIN_DATES.has(id)) }
  }
  const grids: Grid[] = []
  for (const sheet of kids(wb, 'sheet')) {
    const target = rels.get(sheet.getAttribute('r:id') ?? sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '') ?? ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const bytes = await get(path); if (!bytes) continue
    const rows: string[][] = []
    for (const row of kids(parse(bytes).documentElement, 'row')) {
      const r: string[] = []
      for (const c of Array.from(row.children).filter((e) => e.localName === 'c')) {
        const at = c.getAttribute('r'); const i = at ? letters(at) : r.length
        const t = c.getAttribute('t'); const v = Array.from(c.children).find((e) => e.localName === 'v')?.textContent ?? ''
        let value = v
        if (t === 's') value = shared[Number(v)] ?? ''
        else if (t === 'inlineStr') value = kids(c, 't').map((x) => x.textContent ?? '').join('')
        else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
        else if (t !== 'str' && t !== 'e' && v !== '' && dateStyle[Number(c.getAttribute('s') ?? -1)]) value = serialToDate(Number(v))
        while (r.length < i) r.push('')
        r[i] = value
      }
      if (r.some((x) => x.trim() !== '')) rows.push(r)
    }
    if (rows.length) grids.push({ name: sheet.getAttribute('name') ?? `Sheet ${grids.length + 1}`, rows })
  }
  return grids
}
export { readZip }
