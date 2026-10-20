import type { Bill, BillItem, StockMove } from '@/domain/types'
import { registerCollectionMeta, type CollectionMeta, type Effect } from './registry'
import type { Doc } from './types'

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** A stock movement changes the variant's on-hand number. Everything that moves stock (a sale, a receipt, a count) posts one. */
export const moveEffects = (m: StockMove): Effect[] => [{ kind: 'inc', coll: 'variants', id: m.variantId, field: 'stock', by: m.qty }]

/**
 * A posted bill moves the customer's points and store credit. A credit note (a return) takes points back, credits the
 * customer when the refund is store credit, and marks what was returned on the original bill — exactly what the app does
 * locally, defined once.
 */
export function billEffects(b: Bill): Effect[] {
  const out: Effect[] = []
  const isReturn = !!b.refundOfBillId
  if (b.customerId) {
    if (!isReturn) {
      const points = (b.loyaltyEarned || 0) - (b.loyaltyRedeemed || 0)
      if (points) out.push({ kind: 'inc', coll: 'customers', id: b.customerId, field: 'loyaltyPoints', by: points })
      if (b.creditUsed) out.push({ kind: 'inc', coll: 'customers', id: b.customerId, field: 'storeCredit', by: -b.creditUsed })
    } else {
      if (b.loyaltyEarned) out.push({ kind: 'inc', coll: 'customers', id: b.customerId, field: 'loyaltyPoints', by: b.loyaltyEarned, min: 0 })
      if (b.payments[0]?.mode === 'credit') out.push({ kind: 'inc', coll: 'customers', id: b.customerId, field: 'storeCredit', by: -b.total })
    }
  }
  if (isReturn) {
    out.push({
      kind: 'update', coll: 'bills', id: b.refundOfBillId!,
      fn: (orig: Doc) => {
        const items = (orig.items as BillItem[]).map((it) => {
          const r = b.items.find((x) => x.variantId === it.variantId)
          return r ? { ...it, returnedQty: round3(it.returnedQty + r.qty) } : it
        })
        return { items, status: items.every((i) => round3(i.returnedQty) >= i.qty) ? 'returned' : 'partial-return' }
      },
    })
  }
  return out
}

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)

export const CORE_COLLECTIONS: CollectionMeta[] = [
  { name: 'settings', kind: 'master', perm: 'settings', readPerm: 'any' },
  { name: 'users', kind: 'managed', perm: 'settings', readPerm: 'any' },
  { name: 'categories', kind: 'master', perm: 'inventory', readPerm: 'any' },
  { name: 'products', kind: 'master', perm: 'inventory', readPerm: 'any' },
  { name: 'variants', kind: 'master', perm: ['inventory', 'purchases'], readPerm: 'any', owned: ['stock'] },
  { name: 'customers', kind: 'master', perm: ['customers', 'pos'], readPerm: 'any', owned: ['loyaltyPoints', 'storeCredit'] },
  { name: 'coupons', kind: 'master', perm: 'settings', readPerm: 'any' },
  { name: 'suppliers', kind: 'master', perm: 'purchases' },
  { name: 'purchases', kind: 'ledger', perm: 'purchases' },
  {
    name: 'bills', kind: 'ledger', perm: 'pos', patchable: ['notes'],
    validate: (d) => (Array.isArray(d.items) && finite(d.total) ? null : 'A bill needs its lines and a total'),
    effects: (d) => billEffects(d as unknown as Bill),
  },
  {
    name: 'moves', kind: 'ledger', perm: ['stock', 'pos', 'purchases', 'inventory'], readPerm: 'stock',
    validate: (d) => (typeof d.variantId === 'string' && finite(d.qty) ? null : 'A stock movement needs a variant and a quantity'),
    effects: (d) => moveEffects(d as unknown as StockMove),
  },
  { name: 'expenses', kind: 'master', perm: 'expenses' },
  { name: 'sessions', kind: 'master', perm: 'reports' },
  { name: 'audit', kind: 'ledger', perm: 'any', readPerm: 'settings' },
]

registerCollectionMeta(...CORE_COLLECTIONS)
