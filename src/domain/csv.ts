/**
 * CSV for reports (RFC 4180): cells containing a comma, quote or line break are quoted, quotes are doubled, rows end in
 * CRLF. Text that a spreadsheet could read as a formula (=, +, @ …) is prefixed with an apostrophe so a customer or item
 * name can never run anything when the file is opened.
 */

export type CsvCell = string | number | boolean | null | undefined

const FORMULA_START = /^[=+@\t\r]/
const NUMBERISH = /^-?\d[\d,]*(\.\d+)?$/

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  let s = v
  if (FORMULA_START.test(s) || (s.startsWith('-') && !NUMBERISH.test(s))) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (rows: CsvCell[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + (rows.length ? '\r\n' : '')

/** A file name that is safe on every phone: "Sales 01 Oct – 19 Oct" → "sales-01-oct-19-oct". */
export const csvFileName = (title: string, ext = 'csv') => `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report'}.${ext}`
