import { inr, round2 } from '@/domain/money'
import { fmtDate } from '@/domain/dates'
import { esc } from '@/domain/receipt'
import type { CsvCell } from '@/domain/csv'
import type { AccountLedger, BalanceSheet, DayBookDay, Ledger, PartyLedger, ProfitAndLoss, TrialBalance } from './ledger'
import { onNormalSide } from './ledger'

/** A statement as plain rows: the screen, the CSV and the printed page are all made from one of these. */
export interface Table {
  title: string
  subtitle?: string
  columns: Array<{ label: string; align?: 'left' | 'right' }>
  rows: CsvCell[][]
  /** Rows shown in bold (totals). Indexes into `rows`. */
  bold?: number[]
}

const money = (n: number) => round2(n)
export const period = (from?: number, to?: number) => (from !== undefined && to !== undefined ? `${fmtDate(from)} – ${fmtDate(to)}` : to !== undefined ? `As at ${fmtDate(to)}` : '')

export function trialBalanceTable(tb: TrialBalance, from?: number, to?: number): Table {
  const rows: CsvCell[][] = tb.rows.map((r) => [r.account.code, r.account.name, r.closing > 0 ? money(r.closing) : '', r.closing < 0 ? money(-r.closing) : ''])
  if (tb.openingDifference) rows.push(['', 'Opening balance difference', tb.openingDifference > 0 ? money(tb.openingDifference) : '', tb.openingDifference < 0 ? money(-tb.openingDifference) : ''])
  rows.push(['', 'Total', money(tb.totalDebit), money(tb.totalCredit)])
  return { title: 'Trial balance', subtitle: period(from, to), columns: [{ label: 'Code' }, { label: 'Account' }, { label: 'Debit', align: 'right' }, { label: 'Credit', align: 'right' }], rows, bold: [rows.length - 1] }
}

export function profitAndLossTable(p: ProfitAndLoss, from?: number, to?: number): Table {
  const rows: CsvCell[][] = []
  const bold: number[] = []
  const line = (label: string, amount: number, strong = false) => { rows.push([label, money(amount)]); if (strong) bold.push(rows.length - 1) }
  for (const r of p.income) line(r.account.name, r.amount)
  line('Total income', p.totalIncome, true)
  for (const r of p.costOfSales) line(r.account.name, r.amount)
  line('Cost of sales', p.totalCostOfSales, true)
  line('Gross profit', p.grossProfit, true)
  for (const r of p.expenses) line(r.account.name, r.amount)
  line('Total expenses', p.totalExpenses, true)
  line('Net profit', p.netProfit, true)
  line('Profit before cost of goods', p.profitBeforeCogs)
  return { title: 'Profit & loss', subtitle: period(from, to), columns: [{ label: 'Account' }, { label: 'Amount', align: 'right' }], rows, bold }
}

export function balanceSheetTable(b: BalanceSheet, to?: number): Table {
  const rows: CsvCell[][] = []
  const bold: number[] = []
  const head = (label: string) => { rows.push([label, '']); bold.push(rows.length - 1) }
  head('Assets')
  for (const r of b.assets) rows.push([r.account.name, money(r.amount)])
  rows.push(['Total assets', money(b.totalAssets)]); bold.push(rows.length - 1)
  head('Liabilities')
  for (const r of b.liabilities) rows.push([r.account.name, money(r.amount)])
  rows.push(['Total liabilities', money(b.totalLiabilities)]); bold.push(rows.length - 1)
  head('Equity')
  for (const r of b.equity) rows.push([r.account.name, money(r.amount)])
  rows.push(['Profit not yet closed into equity', money(b.currentEarnings)])
  if (b.openingDifference) rows.push(['Opening balance difference', money(b.openingDifference)])
  rows.push(['Total equity', money(b.totalEquity)]); bold.push(rows.length - 1)
  rows.push(['Liabilities + equity', money(b.totalLiabilities + b.totalEquity)]); bold.push(rows.length - 1)
  return { title: 'Balance sheet', subtitle: period(undefined, to), columns: [{ label: 'Account' }, { label: 'Amount', align: 'right' }], rows, bold }
}

export function accountLedgerTable(a: AccountLedger, from?: number, to?: number): Table {
  const rows: CsvCell[][] = [['', 'Opening balance', '', '', '', money(a.opening)]]
  for (const r of a.rows) rows.push([fmtDate(r.date), r.memo, r.particulars, r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '', money(r.balance)])
  rows.push(['', 'Closing balance', '', '', '', money(a.closing)])
  return {
    title: `${a.account.code} ${a.account.name}`, subtitle: period(from, to),
    columns: [{ label: 'Date' }, { label: 'Entry' }, { label: 'Particulars' }, { label: 'Debit', align: 'right' }, { label: 'Credit', align: 'right' }, { label: 'Balance (Dr +)', align: 'right' }], rows, bold: [0, rows.length - 1],
  }
}

export function partyLedgerTable(p: PartyLedger, name: string, from?: number, to?: number): Table {
  const owes = p.type === 'supplier' ? 'We owe' : 'Owes us'
  const rows: CsvCell[][] = [['', 'Opening balance', '', '', '', money(p.opening)]]
  for (const r of p.rows) rows.push([fmtDate(r.date), r.memo, r.particulars, r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '', money(r.balance)])
  rows.push(['', 'Closing balance', '', '', '', money(p.closing)])
  return { title: name, subtitle: `${period(from, to)}${period(from, to) ? ' · ' : ''}${owes}`, columns: [{ label: 'Date' }, { label: 'Entry' }, { label: 'Particulars' }, { label: 'Debit', align: 'right' }, { label: 'Credit', align: 'right' }, { label: owes, align: 'right' }], rows, bold: [0, rows.length - 1] }
}

export function dayBookTable(days: DayBookDay[], l: Ledger, from?: number, to?: number): Table {
  const rows: CsvCell[][] = []
  for (const d of [...days].reverse()) {
    for (const p of d.postings) {
      for (const line of p.lines) rows.push([fmtDate(p.date), p.memo, l.byId.get(line.accountId)?.name ?? '', line.debit ? money(line.debit) : '', line.credit ? money(line.credit) : ''])
    }
  }
  return { title: 'Day book', subtitle: period(from, to), columns: [{ label: 'Date' }, { label: 'Entry' }, { label: 'Account' }, { label: 'Debit', align: 'right' }, { label: 'Credit', align: 'right' }], rows }
}

export const toCsvRows = (t: Table): CsvCell[][] => [t.columns.map((c) => c.label), ...t.rows]

/** A printable page (A4) for a statement. */
export function tableHtml(store: string, t: Table): string {
  const bold = new Set(t.bold ?? [])
  const head = t.columns.map((c) => `<th class="${c.align === 'right' ? 'r' : ''}">${esc(c.label)}</th>`).join('')
  const body = t.rows.map((r, i) => `<tr class="${bold.has(i) ? 'b' : ''}">${r.map((v, k) => `<td class="${t.columns[k]?.align === 'right' ? 'r' : ''}">${typeof v === 'number' ? esc(inr(v, 2)) : esc(v === null || v === undefined ? '' : String(v))}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  @page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;font-size:12px}
  h1{font-size:18px;margin:0}h2{font-size:14px;margin:2px 0 0;font-weight:600}.sub{color:#555;margin:2px 0 12px}
  table{width:100%;border-collapse:collapse}th,td{padding:5px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{background:#f2f2f2;font-size:11px;color:#333}
  .r{text-align:right;font-variant-numeric:tabular-nums}.b td{font-weight:700;background:#fafafa}
  </style></head><body><h1>${esc(store)}</h1><h2>${esc(t.title)}</h2><div class="sub">${esc(t.subtitle ?? '')}</div>
  <table><tr>${head}</tr>${body}</table></body></html>`
}

void onNormalSide
