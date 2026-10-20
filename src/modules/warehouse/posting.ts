import type { Posting } from '@/modules/postings'
import { round2 } from '@/domain/money'
import type { TransferReceipt, WriteOff } from './types'

/** Stock written off is an expense of the period: Dr stock adjustments, Cr inventory, at cost. */
export function writeOffPosting(w: WriteOff): Posting | null {
  const amount = round2(w.lines.reduce((s, l) => s + l.qty * l.cost, 0))
  if (!(amount > 0)) return null
  return { date: w.date, memo: `Write-off ${w.no}`, lines: [{ account: 'stock_adjustments', debit: amount }, { account: 'inventory', credit: amount }], ...(w.branchId ? { branchId: w.branchId } : {}) }
}

/**
 * A transfer closed with stock that never arrived: the stock left the sender when it was dispatched and will not come back,
 * so its cost is a loss of the period (Dr stock adjustments, Cr inventory). Transfers that arrive in full post nothing —
 * stock moving between your own places is not a financial event.
 */
export function transferLossPosting(r: TransferReceipt): Posting | null {
  const amount = round2(r.lossValue ?? 0)
  if (!r.closed || !(amount > 0)) return null
  return { date: r.date, memo: 'Stock lost in transit', lines: [{ account: 'stock_adjustments', debit: amount }, { account: 'inventory', credit: amount }] }
}
