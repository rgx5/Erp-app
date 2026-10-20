import { can } from '@/domain/permissions'
import { onAccountOf } from '@/domain/checkout'
import { fmtDayShort } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { OpError } from '@/data/ops'
import type { Changes, DataState } from '@/data/state'
import type { BillHook, BillHookCtx } from '../registry'
import { cardProblem, checkGiftCard, giftCodeOf } from './giftcards'
import { dueDateOf, netDue, receivables } from './logic'
import { redemptionsFor } from './ops'
import './replication'

/** The credit data a bill carries (`bill.ext.credit`): when it is due, and whether a manager allowed it past the limit. */
export interface CreditExt { dueDate?: number; override?: boolean; /** The gift card code the checkout panel was given, used for a gift-card payment that has no reference of its own. */ giftCode?: string }
export const creditExt = (bill: { ext?: Record<string, unknown> }): CreditExt => (bill.ext?.credit as CreditExt | undefined) ?? {}

/** Refuses a bill that puts too much on account, on account for someone who may not, or spends a gift card that cannot pay. */
export function checkBill({ state, ctx, bill }: BillHookCtx): void {
  const due = onAccountOf(bill.payments)
  if (due > 0) {
    if (!bill.customerId) throw new OpError('Choose a customer to put this on account.')
    const customer = state.customers[bill.customerId]
    const terms = state.customerTerms?.[bill.customerId]
    if (terms?.blocked) throw new OpError(`${customer?.name ?? 'This customer'} is not allowed to buy on account.`)
    const limit = terms?.creditLimit ?? 0
    if (limit > 0) {
      const after = round2(netDue(receivables(state), bill.customerId) + due)
      if (after > limit + 0.001) {
        const mayOverride = can(state.users[ctx.userId]?.role, 'bigDiscount')
        if (!(creditExt(bill).override && mayOverride)) {
          throw new OpError(`This would take ${customer?.name ?? 'the customer'}'s account to ${inr(after, 0)} — ${inr(round2(after - limit), 0)} over the ${inr(limit, 0)} limit.${mayOverride ? '' : ' Ask a manager.'}`)
        }
      }
    }
  }
  const spend = new Map<string, number>()
  for (const p of bill.payments) {
    if (p.mode !== 'giftcard') continue
    const code = giftCodeOf(bill, p)
    spend.set(code, round2((spend.get(code) ?? 0) + p.amount))
  }
  for (const [code, amount] of spend) {
    const why = cardProblem(state, code, amount, bill.date)
    if (why) throw new OpError(code ? `Gift card ${code}: ${why}.` : 'Enter the gift card code.')
  }
}

/**
 * What a saved bill adds: the gift-card redemptions it paid with, and — when part of it went on account — the customer's updated
 * balance (the same arithmetic the server runs from the bill, so the phone is right before it has synced).
 */
export function afterBill({ state, ctx, bill }: BillHookCtx): Changes | null {
  const out: Changes = {}
  const txns = redemptionsFor(state, bill, ctx)
  if (txns.length) out.put = { giftCardTxns: txns }
  const due = onAccountOf(bill.payments)
  const c = bill.customerId ? state.customers[bill.customerId] : undefined
  if (c && due) {
    out.put = { ...out.put, customers: [{ ...c, loyaltyPoints: round2(c.loyaltyPoints + bill.loyaltyEarned - bill.loyaltyRedeemed), storeCredit: round2(c.storeCredit - bill.creditUsed), dueBalance: round2((c.dueBalance ?? 0) + due) }] }
  }
  return out.put ? out : null
}

/** Footer lines for a printed bill: what is on account and when it is due, and gift cards used. */
export function receiptLines(bill: BillHookCtx['bill'], state: DataState): string[] {
  const lines: string[] = []
  const due = onAccountOf(bill.payments)
  if (due > 0) lines.push(`On account ${inr(due, 0)} — please pay by ${fmtDayShort(dueDateOf(state, bill))}`)
  for (const p of bill.payments) {
    if (p.mode !== 'giftcard') continue
    const last4 = giftCodeOf(bill, p).slice(-4)
    lines.push(`Gift card${last4 ? ` …${last4}` : ''} used ${inr(p.amount, 0)}`)
  }
  return lines
}

/** The bill hook (registered by index.tsx; the tests register it directly). */
export const creditBillHook: BillHook = { id: 'credit', beforeSave: checkBill, onSave: afterBill }

export { checkGiftCard }
