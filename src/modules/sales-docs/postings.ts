import { registerPostingRule, type PostingLine } from '@/modules/postings'
import type { CashMove, OrderPayment } from './types'

const MONEY: Record<string, string> = { cash: 'cash', upi: 'upi', card: 'card', bank: 'bank' }

/**
 * What the documents of this module mean to the books.
 *   • An advance is money received for goods not yet delivered — a liability to the customer: Dr cash / bank / UPI / card, Cr advances received.
 *   • A refund of an advance is the same in reverse.
 *   • Applying an advance to a bill is not posted here: the bill carries a payment line with mode 'advance', and the accounting
 *     module's rule for bills debits advances received for it (so the liability is released exactly once, with the sale).
 *   • Cash put into / taken out of the drawer outside a sale is parked in suspense until an accountant reclassifies it.
 */
registerPostingRule<OrderPayment>('orderPayments', (p) => {
  if (p.kind === 'applied') return null
  const money = MONEY[p.mode]
  if (!money) return null
  const party = { type: 'customer' as const, id: p.customerId }
  const held: PostingLine = p.kind === 'advance' ? { account: 'advances_received', credit: p.amount, party } : { account: 'advances_received', debit: p.amount, party }
  const cash: PostingLine = p.kind === 'advance' ? { account: money, debit: p.amount } : { account: money, credit: p.amount }
  return { date: p.date, memo: `${p.kind === 'advance' ? 'Advance received' : 'Advance refunded'}${p.ref ? ` · ${p.ref}` : ''}`, lines: [cash, held], ...(p.branchId ? { branchId: p.branchId } : {}) }
})

registerPostingRule<CashMove>('cashMoves', (m) => ({
  date: m.date,
  memo: `Cash ${m.kind === 'in' ? 'in' : 'out'} · ${m.reason}`,
  lines: m.kind === 'in' ? [{ account: 'cash', debit: m.amount }, { account: 'suspense', credit: m.amount }] : [{ account: 'suspense', debit: m.amount }, { account: 'cash', credit: m.amount }],
  ...(m.branchId ? { branchId: m.branchId } : {}),
}))
