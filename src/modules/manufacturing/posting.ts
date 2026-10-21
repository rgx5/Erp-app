import { round2 } from '@/domain/money'
import { expenseAccount, type Posting, type PostingLine } from '@/modules/postings'
import type { ProductionEntry } from './types'

/** The expense account factory overheads absorbed into stock are credited to. */
export const OVERHEAD_ACCOUNT = expenseAccount('Factory overheads')

const dr = (account: string, amount: number): PostingLine[] => (amount > 0 ? [{ account, debit: round2(amount) }] : [])
const cr = (account: string, amount: number): PostingLine[] => (amount > 0 ? [{ account, credit: round2(amount) }] : [])

/**
 * What a production entry means to the books. Materials move through **work in progress**; finished goods leave it at standard
 * cost; what is lost is an expense of the period.
 *
 *   issue    Dr work in progress,  Cr inventory                      raw material leaves the shelf
 *   return   Dr inventory,         Cr work in progress               unused material comes back
 *   receipt  Dr inventory (or cost of goods, for job work)           good units at material + labour + overhead
 *            Dr stock adjustments                                    scrapped units (a loss)
 *            Cr work in progress (material), Cr salaries (labour absorbed), Cr factory overheads (overhead absorbed)
 *   close    Dr stock adjustments, Cr work in progress               used more than standard (negative: the reverse)
 */
export function productionPosting(e: ProductionEntry): Posting | null {
  let lines: PostingLine[] = []
  let memo = ''
  if (e.kind === 'issue') { lines = [...dr('wip', e.value), ...cr('inventory', e.value)]; memo = `Materials issued · ${e.no}` }
  else if (e.kind === 'return') { lines = [...dr('inventory', e.value), ...cr('wip', e.value)]; memo = `Materials returned · ${e.no}` }
  else if (e.kind === 'receipt') {
    const finished = round2(e.materialValue + e.labour + e.overhead)
    lines = [
      ...dr(e.toExpense ? 'cogs' : 'inventory', finished), ...dr('stock_adjustments', e.scrapValue),
      ...cr('wip', round2(e.materialValue + e.scrapValue)), ...cr('salaries', e.labour), ...cr(OVERHEAD_ACCOUNT, e.overhead),
    ]
    memo = `${e.toExpense ? 'Job work completed' : 'Finished goods received'} · ${e.no}`
  } else {
    const v = round2(e.varianceValue)
    lines = v > 0 ? [...dr('stock_adjustments', v), ...cr('wip', v)] : [...dr('wip', -v), ...cr('stock_adjustments', -v)]
    memo = `Production variance · ${e.no}`
  }
  if (lines.length < 2) return null
  return { date: e.date, memo, lines, ...(e.branchId ? { branchId: e.branchId } : {}) }
}
