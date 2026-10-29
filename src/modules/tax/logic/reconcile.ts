import { round2 } from '@/domain/money'

/**
 * Bank statement import and payment-gateway settlement matching. Both are "a CSV comes in, suggested matches come
 * out": the shop confirms them on screen before anything is marked reconciled — nothing here writes to the books.
 */

// ───────────────────────────── reading a CSV ─────────────────────────────

/** Splits CSV text into rows of cells, handling quoted cells (commas, quotes and line breaks inside them). */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', inQuotes = false
  const src = text.replace(/\r\n/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false }
      else cell += ch
      continue
    }
    if (ch === '"') { inQuotes = true; continue }
    if (ch === ',') { row.push(cell); cell = ''; continue }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    cell += ch
  }
  row.push(cell); rows.push(row)
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function findCol(headers: string[], ...names: string[]): number {
  const wanted = names.map(norm)
  for (let i = 0; i < headers.length; i++) if (wanted.includes(norm(headers[i]))) return i
  for (let i = 0; i < headers.length; i++) if (wanted.some((w) => norm(headers[i]).includes(w))) return i
  return -1
}

/** "12/10/2026", "12-10-2026", "2026-10-12", "12 Oct 2026" — the date formats Indian bank statements export. */
export function parseStatementDate(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime()
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s)
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12).getTime()
  const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
  m = /^(\d{1,2})\s+([a-zA-Z]{3,})\s+(\d{4})/.exec(s)
  if (m) { const mon = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mon !== undefined) return new Date(Number(m[3]), mon, Number(m[1]), 12).getTime() }
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

const money = (raw: string | undefined) => { const n = Number((raw ?? '').replace(/[,₹\s]/g, '')); return Number.isFinite(n) ? n : 0 }

export interface StatementRow {
  date: number
  description: string
  ref: string
  /** Signed: +ve money received, −ve money paid. For a gateway settlement this is the net amount credited. */
  amount: number
  /** Gateway settlements only: the sale total before the gateway's fee. */
  gross?: number
  fee?: number
}
export interface ParsedStatement { rows: StatementRow[]; skipped: number }

/** A bank statement: Date, Narration/Description, a Debit+Credit pair or a single signed Amount, and a reference. */
export function parseBankStatement(text: string): ParsedStatement {
  const grid = parseCsvRows(text)
  if (grid.length < 2) return { rows: [], skipped: grid.length }
  const [head, ...body] = grid
  const dateCol = findCol(head, 'date', 'txn date', 'value date', 'transaction date')
  const descCol = findCol(head, 'narration', 'description', 'particulars', 'details', 'remarks')
  const debitCol = findCol(head, 'withdrawal amt', 'debit', 'withdrawal')
  const creditCol = findCol(head, 'deposit amt', 'credit', 'deposit')
  const amountCol = findCol(head, 'amount')
  const refCol = findCol(head, 'chq ref no', 'reference', 'ref no', 'cheque no', 'utr', 'ref')
  const rows: StatementRow[] = []
  let skipped = 0
  for (const r of body) {
    const date = dateCol >= 0 ? parseStatementDate(r[dateCol] ?? '') : null
    if (date === null) { skipped++; continue }
    let amount: number
    if (debitCol >= 0 || creditCol >= 0) amount = round2(money(r[creditCol]) - money(r[debitCol]))
    else if (amountCol >= 0) amount = round2(money(r[amountCol]))
    else { skipped++; continue }
    if (!amount) { skipped++; continue }
    rows.push({ date, description: (descCol >= 0 ? r[descCol] : '') ?? '', ref: (refCol >= 0 ? r[refCol] : '') ?? '', amount })
  }
  return { rows, skipped }
}

/** A payment-gateway settlement report: Date, Order/Txn ref, Gross amount, Fee (optional), Net amount credited. */
export function parseGatewaySettlement(text: string): ParsedStatement {
  const grid = parseCsvRows(text)
  if (grid.length < 2) return { rows: [], skipped: grid.length }
  const [head, ...body] = grid
  const dateCol = findCol(head, 'settlement date', 'date', 'txn date')
  const refCol = findCol(head, 'order id', 'order ref', 'txn id', 'reference', 'ref')
  const grossCol = findCol(head, 'gross amount', 'gross', 'transaction amount', 'amount')
  const feeCol = findCol(head, 'fee', 'commission', 'charges', 'mdr')
  const netCol = findCol(head, 'net amount', 'net', 'settlement amount', 'payout amount')
  const rows: StatementRow[] = []
  let skipped = 0
  for (const r of body) {
    const date = dateCol >= 0 ? parseStatementDate(r[dateCol] ?? '') : null
    const gross = grossCol >= 0 ? money(r[grossCol]) : 0
    if (date === null || !gross) { skipped++; continue }
    const fee = feeCol >= 0 ? money(r[feeCol]) : 0
    const net = netCol >= 0 ? money(r[netCol]) : round2(gross - fee)
    rows.push({ date, description: 'Settlement', ref: (refCol >= 0 ? r[refCol] : '') ?? '', amount: round2(net), gross: round2(gross), fee: round2(fee) })
  }
  return { rows, skipped }
}

// ───────────────────────────── suggesting matches ─────────────────────────────

export interface MatchCandidate {
  key: string
  date: number
  /** Signed the same way as the statement row: +ve in, −ve out. */
  amount: number
  label: string
  ref?: string
}
export interface MatchSuggestion {
  rowIndex: number
  row: StatementRow
  candidate: MatchCandidate | null
  /** 0–1: how sure the suggestion is. The screen still asks a person to confirm it either way. */
  confidence: number
  reason: string
}

const DAY = 86_400_000

/**
 * For each statement row, the best unreconciled candidate (an amount match within a date window), greedily —
 * exact amount-and-day matches are taken first so two close amounts do not steal each other's rows.
 */
export function suggestMatches(rows: StatementRow[], candidates: MatchCandidate[], opts: { dateWindowDays?: number; amountTolerance?: number } = {}): MatchSuggestion[] {
  const windowMs = (opts.dateWindowDays ?? 5) * DAY
  const tol = opts.amountTolerance ?? 0.01
  const used = new Set<string>()
  const score = (row: StatementRow, c: MatchCandidate): number | null => {
    if (Math.abs(row.amount - c.amount) > tol) return null
    const dayDiff = Math.abs(row.date - c.date) / DAY
    if (row.date - c.date > windowMs || c.date - row.date > windowMs) return null
    const refHit = !!(row.ref && c.ref && (row.ref.toLowerCase().includes(c.ref.toLowerCase()) || c.ref.toLowerCase().includes(row.ref.toLowerCase())))
    let s = 0.7 - Math.min(dayDiff, 5) * 0.08
    if (dayDiff === 0) s += 0.1
    if (refHit) s += 0.2
    return round2(Math.min(0.98, Math.max(0.3, s)))
  }
  const order = rows.map((row, rowIndex) => ({ row, rowIndex })).sort((a, b) => a.row.date - b.row.date)
  const out: MatchSuggestion[] = []
  for (const { row, rowIndex } of order) {
    let best: { c: MatchCandidate; s: number } | null = null
    for (const c of candidates) {
      if (used.has(c.key)) continue
      const s = score(row, c)
      if (s !== null && (!best || s > best.s)) best = { c, s }
    }
    if (best) { used.add(best.c.key); out.push({ rowIndex, row, candidate: best.c, confidence: best.s, reason: best.s >= 0.9 ? 'Amount and date match' : best.s >= 0.6 ? 'Amount matches, date is close' : 'Amount matches within the window' }) }
    else out.push({ rowIndex, row, candidate: null, confidence: 0, reason: 'No unreconciled entry at this amount' })
  }
  return out.sort((a, b) => a.rowIndex - b.rowIndex)
}
