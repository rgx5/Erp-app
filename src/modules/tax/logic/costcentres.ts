import { listOf, type DataState } from '@/data/state'
import { round2 } from '@/domain/money'
import { toCsv, type CsvCell } from '@/domain/csv'
import { buildLedger } from '@/modules/accounting/ledger'
import type { CostCentre } from '../types'

/**
 * Cost centres tag any document — a voucher, an expense, a depreciation run, anything that posts — without touching
 * that document's own module. The tag is a side table keyed by `sourceColl` + `sourceId`; reporting joins it to the
 * ledger the same way the ledger already joins a posting back to its document.
 */

const tagKey = (coll: string, id: string) => `${coll}:${id}`

/** The cost centre a document is tagged with, or null when it has none. */
export function costCentreOf(state: DataState, sourceColl: string, sourceId: string): string | null {
  const t = listOf(state.costCentreTags).find((x) => x.sourceColl === sourceColl && x.sourceId === sourceId)
  return t?.costCentreId ?? null
}

export interface CostCentreRow { costCentre: CostCentre | null; debit: number; credit: number; net: number }

/** Every posting in the period, split by the cost centre its source document is tagged with ("Untagged" otherwise). */
export function costCentreReport(state: DataState, from: number, to: number): CostCentreRow[] {
  const tags = new Map(listOf(state.costCentreTags).map((t) => [tagKey(t.sourceColl, t.sourceId), t.costCentreId]))
  const centres = new Map(listOf(state.costCentres).map((c) => [c.id, c]))
  const l = buildLedger(state, { from, to })
  const totals = new Map<string, { debit: number; credit: number }>()
  for (const p of l.postings) {
    const key = p.sourceColl && p.sourceId ? tags.get(tagKey(p.sourceColl, p.sourceId)) ?? '' : ''
    const t = totals.get(key) ?? { debit: 0, credit: 0 }
    for (const line of p.lines) { t.debit = round2(t.debit + line.debit); t.credit = round2(t.credit + line.credit) }
    totals.set(key, t)
  }
  return [...totals.entries()].map(([id, t]) => ({ costCentre: centres.get(id) ?? null, debit: t.debit, credit: t.credit, net: round2(t.debit - t.credit) }))
    .sort((a, b) => (a.costCentre?.name ?? 'Untagged').localeCompare(b.costCentre?.name ?? 'Untagged'))
}

export function costCentreReportCsv(rows: CostCentreRow[]) {
  const head: CsvCell[] = ['Cost centre', 'Debit', 'Credit', 'Net']
  return toCsv([head, ...rows.map((r): CsvCell[] => [r.costCentre?.name ?? 'Untagged', r.debit, r.credit, r.net])])
}
