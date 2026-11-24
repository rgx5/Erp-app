/** A small CSV reader and writer (RFC 4180 quoting): enough for import and export of master data without a library. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

/** A cell that starts with = + @ (or - and then a non-number) would be run as a formula by a spreadsheet, so it is prefixed with an apostrophe. */
const safe = (v: string): string => (/^[=+@]/.test(v) || /^-[^0-9.]/.test(v) ? `'${v}` : v)
export const toCsv = (header: string[], rows: string[][]): string => [header, ...rows].map((r) => r.map((c) => { const v = safe(c ?? ''); return /[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v }).join(',')).join('\r\n') + '\r\n'

/** Rows as objects keyed by the header (case and spacing insensitive). */
export function asRecords(rows: string[][]): { header: string[]; records: Record<string, string>[] } {
  const [head = [], ...body] = rows
  const header = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ''))
  return { header, records: body.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) }
}

export function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
