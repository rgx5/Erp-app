import { registerPostingRule } from '@/modules/postings'
import type { FoodTip } from './types'

/**
 * A tip is money the shop holds for staff, not revenue — it never touches the bill's own total (see `hooks.ts`), so the
 * books need their own entry for it: cash/UPI/card in, a liability out (owed to the staff it belongs to).
 */
registerPostingRule<FoodTip>('foodTips', (t) => ({
  date: t.date,
  memo: `Tip${t.waiterId ? ` for ${t.waiterId}` : ''}${t.billId ? ' with a bill' : ''}`,
  lines: [
    { account: t.mode, debit: t.amount },
    { account: 'tips_payable', credit: t.amount, ...(t.waiterId ? { party: { type: 'employee' as const, id: t.waiterId } } : {}) },
  ],
}))
