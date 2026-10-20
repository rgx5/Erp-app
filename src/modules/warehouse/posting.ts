import type { Posting } from '@/modules/postings'
import { round2 } from '@/domain/money'
import type { WriteOff } from './types'

/** Stock written off is an expense of the period: Dr stock adjustments, Cr inventory, at cost. */
export function writeOffPosting(w: WriteOff): Posting | null {
  const amount = round2(w.lines.reduce((s, l) => s + l.qty * l.cost, 0))
  if (!(amount > 0)) return null
  return { date: w.date, memo: `Write-off ${w.no}`, lines: [{ account: 'stock_adjustments', debit: amount }, { account: 'inventory', credit: amount }], ...(w.branchId ? { branchId: w.branchId } : {}) }
}
