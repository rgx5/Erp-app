import { parseCsv } from '../masterdata/csv'
import { isSqlite, readSqlite } from './sqlite'
import { readJson, readXml } from './structured'
import { isZip, readZip } from './zip'
import { readXlsx } from './xlsx'

/** Rows of text; the first row is the header. */
export interface Grid { name: string; rows: string[][] }
/** One table in a file, ready for mapping. */
export interface SourceTable { name: string; columns: string[]; rows: string[][] }
export interface ImportSource { format: string; tables: SourceTable[] }

export const MAX_FILE_BYTES = 300 * 1024 * 1024
export const FORMATS_NOTE = 'CSV, TSV or text, Excel (.xlsx), JSON, XML, SQLite databases (including Vyapar .vyb backups) and zip files holding any of these'

/** Text as written by Windows programs: UTF-8, UTF-16 (with a byte-order mark), or the old Windows-1252 code page. */
export function decodeText(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2))
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { return new TextDecoder('windows-1252').decode(b) }
}

/** Comma, semicolon, tab or pipe: whichever splits the first lines into the same number of columns, most often. */
export function detectDelimiter(text: string): string {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 10)
  let best = ','; let bestScore = 0
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => parseCsv(l, d)[0]?.length ?? 1)
    const first = counts[0] ?? 1
    const score = first > 1 ? counts.filter((c) => c === first).length * first : 0
    if (score > bestScore) { best = d; bestScore = score }
  }
  return best
}

const str = (v: string | number | null): string => (v === null ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15)))) : v)

function tableOf(g: Grid): SourceTable | null {
  const [head, ...body] = g.rows
  if (!head || body.length === 0) return null
  const used = new Map<string, number>()
  const columns = head.map((h, i) => { const base = h.trim() || `Column ${i + 1}`; const n = (used.get(base) ?? 0) + 1; used.set(base, n); return n === 1 ? base : `${base} (${n})` })
  return { name: g.name, columns, rows: body.map((r) => columns.map((_, i) => (r[i] ?? '').trim())) }
}

async function readBytes(name: string, bytes: Uint8Array, depth: number): Promise<ImportSource> {
  if (bytes.length === 0) throw new Error('The file is empty.')
  if (isSqlite(bytes)) {
    const tables = readSqlite(bytes).filter((t) => t.rows.length > 0).map((t) => ({ name: t.name, columns: t.columns, rows: t.rows.map((r) => r.map(str)) }))
    return { format: /\.vyb$/i.test(name) ? 'Vyapar backup' : 'SQLite database', tables }
  }
  if (isZip(bytes)) {
    const entries = readZip(bytes)
    if (entries.some((e) => e.name === 'xl/workbook.xml')) return { format: 'Excel workbook', tables: (await readXlsx(entries)).flatMap((g) => tableOf(g) ?? []) }
    if (depth > 0) throw new Error('A zip file inside a zip file is not supported.')
    const tables: SourceTable[] = []; let format = 'Zip file'
    const inner = entries.filter((e) => !/(^|\/)(__MACOSX|\.)/.test(e.name) && e.size > 0)
    for (const e of inner) {
      try { const s = await readBytes(e.name, await e.read(), depth + 1); format = inner.length === 1 ? s.format : format; tables.push(...s.tables.map((t) => ({ ...t, name: inner.length > 1 ? `${e.name} · ${t.name}` : t.name }))) } catch { /* a file in the zip that is not data (a picture, a note) */ }
    }
    return { format, tables }
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new Error('This is an old Excel (.xls) file. Open it in Excel and save it as .xlsx or CSV, then choose that file.')
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) throw new Error('This is a PDF. Import needs a data file: CSV, Excel, JSON, XML or a backup file.')
  const text = decodeText(bytes); const head = text.replace(/^﻿/, '').trimStart()
  if (head.startsWith('{') || head.startsWith('[')) { try { return { format: 'JSON', tables: readJson(text).flatMap((g) => tableOf(g) ?? []) } } catch (e) { if (!/\.(csv|txt|tsv)$/i.test(name)) throw e } }
  if (head.startsWith('<')) return { format: 'XML', tables: readXml(text).flatMap((g) => tableOf(g) ?? []) }
  const delimiter = detectDelimiter(text)
  const t = tableOf({ name: name.replace(/\.[^.]+$/, '') || 'File', rows: parseCsv(text, delimiter) })
  return { format: delimiter === '\t' ? 'Tab-separated text' : delimiter === ';' ? 'Semicolon-separated text' : delimiter === '|' ? 'Pipe-separated text' : 'CSV', tables: t ? [t] : [] }
}

/** Reads any supported data file into tables of text. The kind of file is recognised from its contents, not only its name. */
export async function readImportFile(name: string, bytes: Uint8Array): Promise<ImportSource> {
  if (bytes.length > MAX_FILE_BYTES) throw new Error('This file is larger than 300 MB. Export a smaller part of it.')
  const s = await readBytes(name, bytes, 0)
  if (s.tables.length === 0) throw new Error('No rows of data were found in this file.')
  return s
}
