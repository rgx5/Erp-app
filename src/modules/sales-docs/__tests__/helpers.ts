import { baseState, ctx, NOW } from '@/data/__tests__/helpers'
import { applyChanges, type Changes, type DataState } from '@/data/state'
import { loadVariantViews } from '@/domain/views'
import { registerBillHook } from '@/modules/registry'
import { salesDocsBillHook } from '../billhook'
import { docLineFor } from '../logic/lines'
import '../replication'

export { baseState, ctx, NOW }

/** The module's bill hook is registered by the app's UI file; tests register it directly. */
export const installBillHook = () => registerBillHook(salesDocsBillHook)

/** A document line for a variant of the base state. */
export function dl(s: DataState, variantId: string, qty = 1, over: Record<string, unknown> = {}) {
  const v = loadVariantViews(Object.values(s.products), Object.values(s.variants)).find((x) => x.id === variantId)!
  return { ...docLineFor(v, s.store?.costBasis, qty), ...over }
}

export const commit = (s: DataState, r: { changes: Changes } | Changes): DataState => applyChanges(s, 'changes' in r ? r.changes : r)

/** A state with a second variant priced so totals are easy to read. */
export function shop(): DataState {
  const s = baseState()
  return s
}
