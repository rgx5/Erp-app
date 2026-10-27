import { baseState, ctx, NOW } from '@/data/__tests__/helpers'
import { gstinCheckChar } from '@/domain/gst'
import { receivePurchase } from '@/data/ops'
import { applyChanges, type DataState } from '@/data/state'
import type { Supplier, User } from '@/domain/types'

export const DAY = 86_400_000
export const gstin = (first14: string) => first14 + gstinCheckChar(first14)
export const MY_GSTIN = gstin('27AAAAA0000A1Z')
export const MAHA_SUPPLIER = gstin('27BBBBB1111B1Z')
export const GUJ_SUPPLIER = gstin('24CCCCC2222C1Z')

export const manager: User = { id: 'u_mgr', name: 'Mira', role: 'manager', active: true, code: '03' }

/** A registered business in Maharashtra with a manager, and one supplier in the same state. */
export function purchasingState(over: { supplier?: Partial<Supplier> } = {}): DataState {
  const s = baseState({ store: { gstin: MY_GSTIN, registrationType: 'regular' } })
  s.users = { ...s.users, [manager.id]: manager }
  s.suppliers = { s1: { ...s.suppliers.s1, gstin: MAHA_SUPPLIER, phone: '9876500000', ...over.supplier }, s2: { id: 's2', name: 'Far Weavers', phone: '', gstin: GUJ_SUPPLIER, address: '', openingBalance: 0 } }
  return s
}

/** Goods received: v1 ×10 at 400 (₹4,000) and v2 ×5 at 410 (₹2,050). */
export function withReceipt(s: DataState, over: { paid?: number; at?: number; supplierId?: string; total?: number } = {}) {
  const at = over.at ?? NOW
  const r = receivePurchase(s, {
    supplierId: over.supplierId ?? 's1', date: at, invoiceRef: 'B-77', items: [{ variantId: 'v1', qty: 10, cost: 400 }, { variantId: 'v2', qty: 5, cost: 410 }],
    total: over.total ?? 6050, paid: over.paid ?? 0, notes: '',
  }, ctx({ now: at }))
  return { state: applyChanges(s, r.changes), purchase: r.purchase }
}
