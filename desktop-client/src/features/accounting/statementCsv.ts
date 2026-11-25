import { asRecords, parseCsv } from '@/features/masterdata/csv'
import { compare, fromUnits, isValid, toUnits } from '@/domain/money'

export interface ParsedLine { date: string; description: string; reference?: string; amount: string }
export interface ParsedStatement { lines: ParsedLine[]; errors: string[] }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number | string): string => String(n).padStart(2, '0')
const year = (y: string): string => (y.length === 2 ? `${Number(y) >= 70 ? '19' : '20'}${y}` : y)
/** Accepts 2026-04-30, 30/04/2026, 30-04-26, 30 Apr 2026, 30-Apr-26 and a spreadsheet's 2026-04-30 10:00:00. */
export function parseBankDate(v: string): string | null {
  const s = v.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s)
  if (m) return `${year(m[3] as string)}-${pad(m[2] as string)}-${pad(m[1] as string)}`
  m = /^(\d{1,2})[ /-]([A-Za-z]{3})[a-z]*[ /,-]+(\d{2}|\d{4})$/.exec(s)
  const mi = m ? MONTHS.indexOf((m[2] as string).toLowerCase()) : -1
  return m && mi >= 0 ? `${year(m[3] as string)}-${pad(mi + 1)}-${pad(m[1] as string)}` : null
}
const num = (v: string | undefined): string => (v ?? '').replace(/[,\s₹]/g, '')

/**
 * Reads a bank's CSV export. Needs Date and Description; the money is either one signed Amount column (deposits positive,
 * withdrawals negative) or separate Withdrawal/Debit and Deposit/Credit columns.
 */
export function parseStatementCsv(text: string): ParsedStatement {
  const { header, records } = asRecords(parseCsv(text))
  const find = (...names: string[]): string | undefined => header.find((h) => names.includes(h))
  const dateCol = find('date', 'txndate', 'transactiondate', 'valuedate')
  const descCol = find('description', 'narration', 'particulars', 'details')
  const refCol = find('reference', 'ref', 'chqrefno', 'chequeno', 'utr')
  const amountCol = find('amount')
  const outCol = find('withdrawal', 'withdrawals', 'debit', 'dr')
  const inCol = find('deposit', 'deposits', 'credit', 'cr')
  const errors: string[] = []
  if (!dateCol || !descCol || (!amountCol && !(outCol && inCol))) return { lines: [], errors: ['The file needs Date and Description columns, and either an Amount column or Withdrawal and Deposit columns.'] }
  const lines: ParsedLine[] = []
  records.forEach((r, i) => {
    const row = i + 2
    const date = parseBankDate(r[dateCol] ?? '')
    if (!date) { errors.push(`Row ${row}: the date "${r[dateCol] ?? ''}" is not recognised.`); return }
    let amount: string
    if (amountCol) amount = num(r[amountCol])
    else { const o = num(r[outCol!]); const c = num(r[inCol!]); amount = o && !c ? `-${o}` : c && !o ? c : '' }
    if (!isValid(amount) || compare(amount, '0') === 0) { errors.push(`Row ${row}: the amount is missing or not a number.`); return }
    const ref = refCol ? (r[refCol] ?? '').trim() : ''
    lines.push({ date, description: (r[descCol] ?? '').trim().slice(0, 500) || '(no description)', ...(ref ? { reference: ref.slice(0, 100) } : {}), amount: fromUnits(toUnits(amount)) })
  })
  return { lines, errors }
}
