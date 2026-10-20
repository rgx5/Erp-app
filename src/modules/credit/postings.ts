import { registerPostingRule, type AccountKey, type Posting } from '@/modules/postings'
import type { Collection, CollectionMode, CreditTopup, GiftCardTxn } from './types'

/**
 * What this module's documents mean to the books. Sales on account and gift cards *spent* are already booked by the sale itself
 * (the bill's tender lines: 'due' → receivables, 'giftcard' → gift cards); these rules cover the money that moves without a sale.
 *
 *   • A collection: Dr cash / bank / UPI / card, Cr receivables (the customer). An advance (money beyond what was owed) credits
 *     the same account, so the customer's balance goes negative — exactly what `dueBalance` holds.
 *   • A gift card sold or recharged: Dr the money received, Cr gift cards (a liability to the card holder).
 *   • Money put back on a card ('refund'): Dr suspense, Cr gift cards — an accountant reclassifies it (a return that refunds onto a
 *     card is not otherwise booked).
 *   • A store-credit top-up: Dr the money received, Cr store credit (the customer).
 */
const MONEY: Record<CollectionMode, AccountKey> = { cash: 'cash', upi: 'upi', card: 'card', bank: 'bank', cheque: 'bank' }

export function collectionPosting(c: Collection): Posting | null {
  if (!(c.amount > 0)) return null
  return {
    date: c.date, memo: `Collection ${c.no}${c.ref ? ` · ${c.ref}` : ''}`,
    lines: [{ account: MONEY[c.mode] ?? 'cash', debit: c.amount }, { account: 'receivables', credit: c.amount, party: { type: 'customer', id: c.customerId } }],
    ...(c.branchId ? { branchId: c.branchId } : {}),
  }
}

export function giftCardTxnPosting(t: GiftCardTxn): Posting | null {
  if (t.type === 'redeem' || !(t.amount > 0)) return null // spending is booked by the bill
  const money: AccountKey = t.type === 'issue' ? MONEY[t.mode ?? 'cash'] ?? 'cash' : 'suspense'
  return {
    date: t.date, memo: t.type === 'issue' ? `Gift card sold · ${t.note}` : `Gift card refund · ${t.note}`,
    lines: [{ account: money, debit: t.amount }, { account: 'gift_cards', credit: t.amount }],
    ...(t.branchId ? { branchId: t.branchId } : {}),
  }
}

export function topupPosting(t: CreditTopup): Posting | null {
  if (!(t.amount > 0)) return null
  return {
    date: t.date, memo: `Store-credit top-up ${t.no}`,
    lines: [{ account: MONEY[t.mode] ?? 'cash', debit: t.amount }, { account: 'store_credit', credit: t.amount, party: { type: 'customer', id: t.customerId } }],
    ...(t.branchId ? { branchId: t.branchId } : {}),
  }
}

registerPostingRule<Collection>('collections', (c) => collectionPosting(c))
registerPostingRule<GiftCardTxn>('giftCardTxns', (t) => giftCardTxnPosting(t))
registerPostingRule<CreditTopup>('creditTopups', (t) => topupPosting(t))
