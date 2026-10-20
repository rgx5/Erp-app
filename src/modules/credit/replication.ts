import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { onAccountOf } from '@/domain/checkout'
import type { Bill } from '@/domain/types'
import { addEffects, addOwnedFields, registerCollectionMeta, type Effect } from '@/replication/registry'
import type { Collection, CreditTopup } from './types'
import './types'
import './postings'

// Who may do what. The cashier takes payments on account and sells gift cards; terms and settings are for managers.
registerPermission('collections', ['manager', 'cashier'])
registerPermission('credit', ['manager'])

registerCollections(['customerTerms', 'collections', 'giftCards', 'giftCardTxns', 'creditTopups', 'creditSettings'])

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
// A counter user needs to see the account of the customer in front of them, and the cards they are asked to accept.
const COUNTER = ['pos', 'collections', 'customers', 'credit', 'reports']

registerCollectionMeta(
  { name: 'customerTerms', kind: 'master', perm: 'credit', readPerm: COUNTER },
  { name: 'creditSettings', kind: 'master', perm: 'credit', readPerm: 'any' },
  {
    name: 'collections', kind: 'ledger', perm: 'collections', readPerm: COUNTER, branched: true,
    validate: (d) => (typeof d.customerId === 'string' && finite(d.amount) && (d.amount as number) > 0 && Array.isArray(d.allocations) ? null : 'A collection needs a customer, an amount and its allocations'),
    effects: (d) => collectionEffects(d as unknown as Collection),
  },
  { name: 'giftCards', kind: 'master', perm: ['collections', 'credit'], readPerm: ['pos', 'collections', 'credit'] },
  {
    name: 'giftCardTxns', kind: 'ledger', perm: ['collections', 'pos'], readPerm: ['pos', 'collections', 'credit'], branched: true,
    validate: (d) => (typeof d.cardId === 'string' && finite(d.amount) && (d.amount as number) > 0 ? null : 'A gift-card entry needs a card and a positive amount'),
  },
  {
    name: 'creditTopups', kind: 'ledger', perm: 'collections', readPerm: ['collections', 'reports'], branched: true,
    validate: (d) => (typeof d.customerId === 'string' && finite(d.amount) && (d.amount as number) > 0 ? null : 'A top-up needs a customer and an amount'),
    effects: (d) => topupEffects(d as unknown as CreditTopup),
  },
)

// The server keeps each customer's net balance, so a till that has not downloaded every bill still knows it.
addOwnedFields('customers', ['dueBalance'])

/** A collection takes its amount off what the customer owes (an unallocated part becomes an advance: a negative balance). */
export function collectionEffects(c: Collection): Effect[] {
  return [{ kind: 'inc', coll: 'customers', id: c.customerId, field: 'dueBalance', by: -c.amount }]
}

/** Paying in for store credit adds that credit to the customer. */
export function topupEffects(t: CreditTopup): Effect[] {
  return [{ kind: 'inc', coll: 'customers', id: t.customerId, field: 'storeCredit', by: t.amount }]
}

/** A bill puts money on account (+); a credit note that reduces dues takes it off (−). */
export function dueEffects(b: Bill): Effect[] {
  const by = onAccountOf(b.payments)
  return b.customerId && by ? [{ kind: 'inc', coll: 'customers', id: b.customerId, field: 'dueBalance', by }] : []
}
addEffects('bills', (doc) => dueEffects(doc as unknown as Bill))
