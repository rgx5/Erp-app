import * as XLSX from 'xlsx'
import type { CsvCell } from '@/domain/csv'

/** The comma, semicolon or tab that separates the cells of a CSV (Excel in some regions saves with semicolons). */
function delimiterOf(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  let inQ = false
  const n: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  for (const ch of first) {
    if (ch === '"') inQ = !inQ
    else if (!inQ && ch in n) n[ch]++
  }
  return n[';'] > n[','] && n[';'] >= n['\t'] ? ';' : n['\t'] > n[','] ? '\t' : ','
}

/** RFC 4180 CSV into rows of cells. Handles quotes, doubled quotes, line breaks inside quotes, a byte-order mark and blank lines. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '')
  const d = delimiterOf(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQ = false
  const endCell = () => { row.push(cell); cell = '' }
  const endRow = () => { endCell(); if (row.some((c) => c.trim() !== '')) rows.push(row); row = [] }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else inQ = false } else cell += ch
    } else if (ch === '"' && cell === '') inQ = true
    else if (ch === d) endCell()
    else if (ch === '\n') endRow()
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow() } else cell += ch
  }
  if (cell !== '' || row.length) endRow()
  return rows.map((r) => r.map((c) => c.trim()))
}

export type TableKind = 'csv' | 'xlsx'

export const kindOfFile = (name: string): TableKind => (/\.(xlsx|xlsm|xls|ods)$/i.test(name) ? 'xlsx' : 'csv')

/** The first sheet of a workbook, or a CSV, as rows of text. Dates and numbers come out the way the sheet shows them. */
export function readTable(data: string | Uint8Array, kind: TableKind): string[][] {
  if (kind === 'csv') {
    if (typeof data !== 'string') throw new Error('A CSV file must be read as text.')
    return parseCsv(data)
  }
  const wb = typeof data === 'string' ? XLSX.read(data, { type: 'string' }) : XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false })
  return raw.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some((c) => c !== ''))
}

/** Rows into an .xlsx workbook (one sheet). */
export function toXlsx(rows: CsvCell[][], sheetName = 'Items'): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : c))))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
