import { id } from '@/domain/ids'
import { OpError, type OpCtx } from '@/data/ops'
import type { DataState } from '@/data/state'
import type { LandedCost, PurchaseInvoice, PurchaseReturn, SupplierPayment } from './types'

type Reversible = { purchaseInvoices: PurchaseInvoice; purchaseReturns: PurchaseReturn; supplierPayments: SupplierPayment; landedCosts: LandedCost }
export type ReversibleColl = keyof Reversible

const PREFIX: Record<ReversibleColl, string> = { purchaseInvoices: 'pi_', purchaseReturns: 'dn_', supplierPayments: 'sp_', landedCosts: 'lc_' }
const WORD: Record<ReversibleColl, string> = { purchaseInvoices: 'invoice', purchaseReturns: 'debit note', supplierPayments: 'payment', landedCosts: 'landed cost' }

/**
 * The reversal of a posted document: the same document under a new id and number, dated now, that names the original. Refuses a
 * document that is itself a reversal, or has been reversed already. Callers add what else must be undone (stock, item costs).
 */
export function reversalOf<K extends ReversibleColl>(state: DataState, coll: K, docId: string, note: string, ctx: OpCtx): { original: Reversible[K]; doc: Reversible[K] } {
  const original = (state[coll] as Record<string, Reversible[K]>)[docId]
  if (!original) throw new OpError(`That ${WORD[coll]} no longer exists.`)
  if (original.reverses) throw new OpError(`That is already a reversal of another ${WORD[coll]}.`)
  const docs = Object.values(state[coll] as Record<string, Reversible[K]>)
  if (docs.some((d) => d.reverses === docId)) throw new OpError(`This ${WORD[coll]} has already been cancelled.`)
  const doc = { ...original, id: id(PREFIX[coll], ctx.now), no: `${original.no}-R`, reverses: docId, date: ctx.now, userId: ctx.userId, note: note.trim() || `Cancels ${original.no}`, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) }
  return { original, doc }
}
