import { listOf, type DataState } from '@/data/state'
import { round2 } from '@/domain/money'
import { toCsv, type CsvCell } from '@/domain/csv'
import { fmtDate } from '@/domain/dates'
import type { PostingLine } from '../../postings'
import type { TaxDeduction, TaxDeductionKind } from '../types'

/**
 * TDS deducted from a payment, or TCS collected from a buyer. A tracking and reporting layer on top of the usual
 * payment flow, not a new one: the rate tables below are common starting points — an accountant should confirm the
 * section and rate that applies before relying on them.
 */

export const TDS_SECTIONS: Array<{ section: string; description: string; ratePct: number }> = [
  { section: '194C', description: 'Payments to contractors', ratePct: 1 },
  { section: '194J', description: 'Professional / technical fees', ratePct: 10 },
  { section: '194I', description: 'Rent (land, building, equipment)', ratePct: 10 },
  { section: '194Q', description: 'Purchase of goods (over ₹50L a year)', ratePct: 0.1 },
  { section: '194H', description: 'Commission or brokerage', ratePct: 5 },
  { section: '194A', description: 'Interest other than on securities', ratePct: 10 },
]
export const TCS_SECTIONS: Array<{ section: string; description: string; ratePct: number }> = [
  { section: '206C(1H)', description: 'Sale of goods (over ₹50L a buyer in a year)', ratePct: 0.1 },
]
export const DEFAULT_SECTIONS: Array<{ kind: TaxDeductionKind; section: string; description: string; ratePct: number }> = [
  ...TDS_SECTIONS.map((s) => ({ kind: 'tds' as const, ...s })),
  ...TCS_SECTIONS.map((s) => ({ kind: 'tcs' as const, ...s })),
]

export const TAX_NOTE = 'Sections and rates here are common starting points, not advice — confirm the current rules with your accountant before relying on them.'

/** The tax at a flat rate on a gross amount, and what is left. */
export function computeTax(grossAmount: number, ratePct: number): { taxAmount: number; netAmount: number } {
  const taxAmount = round2((Math.max(0, grossAmount) * Math.max(0, ratePct)) / 100)
  return { taxAmount, netAmount: round2(grossAmount - taxAmount) }
}

export function taxDeductionProblem(d: { grossAmount: number; ratePct: number; partyName: string }): string | null {
  if (!(d.grossAmount > 0)) return 'Enter the gross amount.'
  if (!(d.ratePct >= 0)) return 'The rate cannot be negative.'
  if (!d.partyName?.trim()) return 'Give the name of who this is with.'
  return null
}

/** What a deduction means to the books. TDS: pay the party net of tax, the tax withheld for the government. TCS: the
 *  extra amount collected over the sale is a liability until it is remitted — the sale itself posts from its own bill. */
export function taxDeductionLines(d: Pick<TaxDeduction, 'kind' | 'partyType' | 'partyId' | 'grossAmount' | 'taxAmount' | 'netAmount' | 'mode' | 'section'>): PostingLine[] {
  const tax = Math.max(0, d.taxAmount)
  if (tax <= 0) return []
  const party = d.partyId && d.partyType !== 'other' ? { type: d.partyType, id: d.partyId } : undefined
  if (d.kind === 'tcs') return [{ account: d.mode, debit: tax }, { account: 'tcs_payable', credit: tax }]
  const net = Math.max(0, d.netAmount)
  const payTo: PostingLine = party && party.type === 'supplier' ? { account: 'payables', debit: round2(d.grossAmount), party } : { account: `expense:${d.section || 'Professional fees'}`, debit: round2(d.grossAmount) }
  const lines: PostingLine[] = [payTo]
  if (net > 0) lines.push({ account: d.mode, credit: net })
  lines.push({ account: 'tds_payable', credit: tax })
  return lines
}

// ───────────────────────────── the report ─────────────────────────────

export interface TaxDeductionReport { from: number; to: number; kind: TaxDeductionKind; rows: TaxDeduction[]; totalGross: number; totalTax: number; totalNet: number }

export function taxDeductionReport(state: DataState, kind: TaxDeductionKind, from: number, to: number): TaxDeductionReport {
  const rows = listOf(state.taxDeductions).filter((d) => d.kind === kind && d.date >= from && d.date <= to).sort((a, b) => a.date - b.date)
  return { from, to, kind, rows, totalGross: round2(rows.reduce((s, r) => s + r.grossAmount, 0)), totalTax: round2(rows.reduce((s, r) => s + r.taxAmount, 0)), totalNet: round2(rows.reduce((s, r) => s + r.netAmount, 0)) }
}

export function taxDeductionCsv(r: TaxDeductionReport) {
  const head: CsvCell[] = ['No', 'Date', 'Section', 'Rate %', 'Party', 'PAN', 'Gross', 'Tax', 'Net', 'Challan / certificate']
  const rows = r.rows.map((d): CsvCell[] => [d.no, fmtDate(d.date), d.section, d.ratePct, d.partyName, d.pan ?? '', d.grossAmount, d.taxAmount, d.netAmount, d.challanNo || d.certificateNo || ''])
  rows.push(['', '', '', '', 'Total', '', r.totalGross, r.totalTax, r.totalNet, ''])
  return toCsv([head, ...rows])
}
