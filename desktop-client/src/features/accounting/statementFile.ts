import { compare, fromUnits, isValid, toUnits } from '@/domain/money'
import { norm } from '@/features/import/mapping'
import { readImportFile, type SourceTable } from '@/features/import/readers'
import { parseBankDate, type ParsedLine, type ParsedStatement } from './statementCsv'

export interface StatementRead extends ParsedStatement { format: string; opening?: string; closing?: string }

const money = (v: string): string => v.replace(/[,\s₹]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/(cr|dr)$/i, (m) => (m.toLowerCase() === 'dr' ? '' : ''))
const clean = (v: string): string => (isValid(v) ? fromUnits(toUnits(v)) : '')

// ---- OFX / QFX ---------------------------------------------------------------------------------------------------------------
function tag(block: string, name: string): string | undefined { const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block); return m?.[1]?.trim() }
export function parseOfx(text: string): StatementRead {
  const lines: ParsedLine[] = []; const errors: string[] = []
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  blocks.forEach((b, i) => {
    const d = tag(b, 'DTPOSTED'); const amt = clean(money(tag(b, 'TRNAMT') ?? ''))
    const date = d && /^\d{8}/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null
    if (!date || !amt || compare(amt, '0') === 0) { errors.push(`Transaction ${i + 1}: the date or amount is missing.`); return }
    const ref = tag(b, 'CHECKNUM') ?? tag(b, 'FITID')
    lines.push({ date, description: (tag(b, 'MEMO') ?? tag(b, 'NAME') ?? '(no description)').slice(0, 500), ...(ref ? { reference: ref.slice(0, 100) } : {}), amount: amt })
  })
  const bal = /<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|$)/i.exec(text)?.[1]
  const closing = bal ? clean(money(tag(bal, 'BALAMT') ?? '')) : ''
  const net = lines.reduce((s, l) => fromUnits(toUnits(s) + toUnits(l.amount)), '0')
  return { format: 'OFX', lines, errors, ...(closing ? { closing, opening: fromUnits(toUnits(closing) - toUnits(net)) } : {}) }
}

// ---- QIF ---------------------------------------------------------------------------------------------------------------------
export function parseQif(text: string): StatementRead {
  const lines: ParsedLine[] = []; const errors: string[] = []
  let cur: { d?: string; t?: string; p?: string; n?: string; m?: string } = {}
  const flush = (i: number): void => {
    if (!cur.d && !cur.t) return
    const date = parseBankDate(cur.d ?? ''); const amt = clean(money(cur.t ?? ''))
    if (!date || !amt || compare(amt, '0') === 0) errors.push(`Entry ${i}: the date or amount is missing.`)
    else lines.push({ date, description: (cur.p ?? cur.m ?? '(no description)').slice(0, 500), ...(cur.n ? { reference: cur.n.slice(0, 100) } : {}), amount: amt })
    cur = {}
  }
  let i = 0
  for (const l of text.split(/\r?\n/)) {
    if (l.startsWith('^')) { flush(++i); continue }
    const k = l[0]; const v = l.slice(1).trim()
    if (k === 'D') cur.d = v.replace(/'/g, '/'); else if (k === 'T' || k === 'U') cur.t = v; else if (k === 'P') cur.p = v; else if (k === 'N') cur.n = v; else if (k === 'M') cur.m = v
  }
  flush(++i)
  return { format: 'QIF', lines, errors }
}

// ---- MT940 -------------------------------------------------------------------------------------------------------------------
const mtAmount = (s: string): string => s.replace(',', '.')
export function parseMt940(text: string): StatementRead {
  const lines: ParsedLine[] = []; const errors: string[] = []
  let opening: string | undefined; let closing: string | undefined
  const rows = text.split(/\r?\n/)
  const bal = (v: string): string => { const m = /^([CD])\d{6}[A-Z]{3}([\d,]+)/.exec(v); return m ? clean(`${m[1] === 'D' ? '-' : ''}${mtAmount(m[2] as string)}`) : '' }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as string
    if (r.startsWith(':60F:') || r.startsWith(':60M:')) opening ??= bal(r.slice(5))
    else if (r.startsWith(':62F:') || r.startsWith(':62M:')) closing = bal(r.slice(5))
    else if (r.startsWith(':61:')) {
      const m = /^:61:(\d{2})(\d{2})(\d{2})(?:\d{4})?(R?[CD])[A-Z]?([\d,]+)N[A-Z0-9]{3}([^/\r\n]*)(?:\/\/(.*))?/.exec(r)
      if (!m) { errors.push(`Line ${i + 1}: a transaction line is not in MT940 form.`); continue }
      const yy = Number(m[1]); const amt = clean(`${(m[4] as string).endsWith('D') ? '-' : ''}${mtAmount(m[5] as string)}`)
      let narr = ''; let j = i + 1
      while (j < rows.length && !(rows[j] as string).startsWith(':')) j++
      if ((rows[j] ?? '').startsWith(':86:')) { narr = (rows[j] as string).slice(4); j++; while (j < rows.length && !(rows[j] as string).startsWith(':') && !(rows[j] as string).startsWith('-')) narr += ' ' + rows[j++] }
      const ref = ((m[6] as string) || (m[7] as string) || '').trim()
      if (!amt || compare(amt, '0') === 0) { errors.push(`Line ${i + 1}: the amount is missing.`); continue }
      lines.push({ date: `${yy >= 70 ? 19 : 20}${m[1]}-${m[2]}-${m[3]}`, description: (narr.trim() || '(no description)').slice(0, 500), ...(ref ? { reference: ref.slice(0, 100) } : {}), amount: amt })
    }
  }
  return { format: 'MT940', lines, errors, ...(opening ? { opening } : {}), ...(closing ? { closing } : {}) }
}

// ---- tables (CSV, Excel, JSON, XML, database) ---------------------------------------------------------------------------------
const DATE_H = ['date', 'txndate', 'transactiondate', 'valuedate', 'postingdate', 'tranddate', 'trandate', 'bookingdate']
const DESC_H = ['description', 'narration', 'particulars', 'details', 'transactiondetails', 'remarks', 'transactionremarks', 'memo', 'name']
const REF_H = ['reference', 'ref', 'refno', 'chqrefno', 'chequeno', 'chqno', 'utr', 'transactionid', 'txnid', 'instrumentno', 'chequerefno']
const OUT_H = ['withdrawal', 'withdrawals', 'withdrawalamt', 'withdrawalamount', 'debit', 'debitamount', 'dr', 'paidout', 'withdrawalamtinr']
const IN_H = ['deposit', 'deposits', 'depositamt', 'depositamount', 'credit', 'creditamount', 'cr', 'paidin', 'depositamtinr']
const BAL_H = ['balance', 'closingbalance', 'runningbalance', 'availablebalance', 'balanceamt']
const hit = (cols: string[], names: string[]): number => cols.findIndex((c) => names.includes(norm(c)))

/** Banks put their name, the account number and a summary above the table. The header is the first row with a date column and a description column. */
function headerRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) { const c = rows[i] as string[]; if (hit(c, DATE_H) >= 0 && hit(c, DESC_H) >= 0 && (hit(c, ['amount', 'amt']) >= 0 || (hit(c, OUT_H) >= 0 && hit(c, IN_H) >= 0))) return i }
  return -1
}

export function parseStatementTable(t: SourceTable): StatementRead {
  const all = [t.columns, ...t.rows]
  const h = headerRow(all)
  if (h < 0) return { format: 'Table', lines: [], errors: ['The file needs Date and Description columns, and either an Amount column or Withdrawal and Deposit columns.'] }
  const cols = all[h] as string[]; const body = all.slice(h + 1)
  const d = hit(cols, DATE_H); const n = hit(cols, DESC_H); const r = hit(cols, REF_H); const a = hit(cols, ['amount', 'amt']); const o = hit(cols, OUT_H); const c = hit(cols, IN_H); const b = hit(cols, BAL_H)
  const lines: ParsedLine[] = []; const errors: string[] = []; const balances: string[] = []
  body.forEach((row, i) => {
    if (row.every((x) => !x.trim())) return
    const date = parseBankDate(row[d] ?? '')
    if (!date) { if (/^\d{1,4}[ /.-]/.test((row[d] ?? '').trim())) errors.push(`Row ${h + i + 2}: the date "${row[d]}" is not recognised.`); return } // text under the table (totals, notes) is skipped
    let amount = ''
    if (a >= 0) { const raw = row[a] ?? ''; amount = money(raw); if (/dr$/i.test(raw.trim())) amount = `-${amount.replace('-', '')} `.trim() }
    else { const out = money(row[o] ?? ''); const inn = money(row[c] ?? ''); const ov = isValid(out) && compare(out, '0') !== 0; const iv = isValid(inn) && compare(inn, '0') !== 0; amount = ov && !iv ? `-${out.replace('-', '')}` : iv && !ov ? inn : '' }
    amount = clean(amount)
    if (!amount || compare(amount, '0') === 0) { errors.push(`Row ${h + i + 2}: the amount is missing or not a number.`); return }
    const ref = r >= 0 ? (row[r] ?? '').trim() : ''
    lines.push({ date, description: (row[n] ?? '').trim().slice(0, 500) || '(no description)', ...(ref && ref !== '0' ? { reference: ref.slice(0, 100) } : {}), amount })
    if (b >= 0) balances.push(clean(money(row[b] ?? '')))
  })
  const out: StatementRead = { format: 'Table', lines, errors }
  const lastBal = [...balances].reverse().find(Boolean)
  if (lastBal && lines.length) { out.closing = lastBal; const firstBal = balances.find(Boolean); const first = lines[balances.findIndex(Boolean)]; if (firstBal && first) out.opening = fromUnits(toUnits(firstBal) - toUnits(first.amount)) }
  return out
}

/** Any bank file: OFX/QFX, QIF, MT940, or a table in CSV, Excel, JSON, XML or a zip. */
export async function readStatementFile(name: string, bytes: Uint8Array): Promise<StatementRead> {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2000))
  const text = (): string => new TextDecoder('utf-8').decode(bytes)
  if (/<OFX>|OFXHEADER|<STMTTRN>/i.test(head) || /\.(ofx|qfx)$/i.test(name)) return parseOfx(text())
  if (/^!Type:/im.test(head) || /\.qif$/i.test(name)) return parseQif(text())
  if (/^:20:|:61:/m.test(head) || /\.(mt940|sta|940)$/i.test(name)) return parseMt940(text())
  const src = await readImportFile(name, bytes)
  let best: StatementRead = { format: src.format, lines: [], errors: ['No bank transactions were found in this file.'] }
  for (const t of src.tables) { const r = parseStatementTable(t); if (r.lines.length > best.lines.length) best = { ...r, format: src.format } }
  if (best.lines.length === 0 && src.tables[0]) best = { ...parseStatementTable(src.tables[0]), format: src.format }
  return best
}
