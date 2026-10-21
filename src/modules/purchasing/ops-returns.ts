import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import { adjustStock, audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, mergeChanges, type Changes, type DataState } from '@/data/state'
import { withEffects } from '@/replication/local'
import { nextNo } from '../numbering'
import { isInterState } from './itc'
import { PAY_MODES } from './ops-payables'
import { reversalOf } from './ops-reverse'
import { returnableQty, returnTotals } from './returns'
import { live } from './reversal'
import type { PayMode, PurchaseReturn, ReturnReason } from './types'
import './replication'

export interface ReturnDraft {
  supplierId: string
  /** The receipt the goods came in on; limits what can go back. */
  purchaseId?: string
  invoiceId?: string
  reason: ReturnReason
  note?: string
  items: Array<{ variantId: string; qty: number; /** Left out: the receipt's cost, else the item's average cost. */ cost?: number; /** GST % the supplier charged. */ rate: number }>
  /** Left out: credit is taken back when the invoice it was claimed on was eligible. */
  itcReversed?: boolean
  interState?: boolean
  /** Money the supplier handed back at once. */
  refund?: number
  refundMode?: PayMode
  date?: number
}

/**
 * Sends goods back to a supplier: stock goes down, a numbered debit note cuts what we owe (less any cash the supplier returned),
 * and the GST is either taken back out of input credit or comes out of the stock cost.
 */
export function recordPurchaseReturn(state: DataState, d: ReturnDraft, ctx: OpCtx): { changes: Changes; debitNote: PurchaseReturn } {
  const supplier = state.suppliers[d.supplierId]
  if (!supplier) throw new OpError('Choose a supplier.')
  const grn = d.purchaseId ? state.purchases[d.purchaseId] : undefined
  if (d.purchaseId && !grn) throw new OpError('That goods receipt no longer exists.')
  if (grn && grn.supplierId !== d.supplierId) throw new OpError('That receipt is from a different supplier.')
  const invoice = d.invoiceId ? state.purchaseInvoices[d.invoiceId] : live(listOf(state.purchaseInvoices)).find((i) => !!d.purchaseId && i.purchaseId === d.purchaseId)
  if (d.invoiceId && !invoice) throw new OpError('That invoice no longer exists.')
  if (invoice && invoice.supplierId !== d.supplierId) throw new OpError('That invoice is from a different supplier.')
  if (!d.items.length) throw new OpError('Choose the goods being sent back.')
  const back = grn ? returnableQty(state, grn.id) : null

  const items: PurchaseReturn['items'] = []
  for (const l of d.items) {
    const v = state.variants[l.variantId]
    if (!v) throw new OpError('One of the items no longer exists.')
    if (!(l.qty > 0)) throw new OpError('Every line needs a quantity.')
    if (items.some((i) => i.variantId === l.variantId)) throw new OpError('Each item can appear once — add the quantities together.')
    if (!(l.rate >= 0 && l.rate <= 40)) throw new OpError('A GST rate is a percentage from 0 to 40.')
    if (round3(v.stock - l.qty) < 0) throw new OpError(`Only ${v.stock} of ${v.sku} are in stock.`)
    if (back && round3(l.qty - (back[l.variantId] ?? 0)) > 0) throw new OpError(`${grn!.no} only has ${back[l.variantId] ?? 0} of ${v.sku} left to send back.`)
    const cost = l.cost ?? grn?.items.find((i) => i.variantId === l.variantId)?.cost ?? v.avgCost ?? v.cost
    if (!(cost >= 0)) throw new OpError('A cost cannot be negative.')
    items.push({ variantId: l.variantId, qty: l.qty, cost: round2(cost), rate: l.rate })
  }
  const interState = d.interState ?? invoice?.interState ?? isInterState(state.store, supplier.gstin)
  const t = returnTotals(items, interState)
  if (!(t.total > 0)) throw new OpError('The goods have no value — enter their cost.')
  const refund = round2(d.refund ?? 0)
  if (refund < 0 || refund > t.total) throw new OpError('The money handed back cannot be more than the debit note.')
  if (refund > 0 && !PAY_MODES.includes(d.refundMode as PayMode)) throw new OpError('Say how the supplier handed the money back.')

  const debitNote: PurchaseReturn = {
    id: id('dn_', ctx.now), no: nextNo('DN-', listOf(state.purchaseReturns).map((r) => r.no), ctx), supplierId: d.supplierId, ...(d.purchaseId ? { purchaseId: d.purchaseId } : {}),
    ...(invoice ? { invoiceId: invoice.id } : {}), date: d.date ?? ctx.now, reason: d.reason, note: (d.note ?? '').trim(), items, ...t,
    itcReversed: d.itcReversed ?? !!invoice?.itc.eligible, interState, refund, ...(refund > 0 ? { refundMode: d.refundMode } : {}), userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  const stock = items.map((i) => adjustStock(state, i.variantId, -i.qty, 'return', debitNote.no, `Returned to ${supplier.name}`, ctx).changes)
  const moved = mergeChanges(...stock)
  const base: Changes = mergeChanges({ put: { purchaseReturns: [debitNote], audit: [audit(ctx, 'PURCHASE_RETURN', `${debitNote.no} — ${supplier.name} ₹${t.total}`)] } }, { put: moved.put })
  return { debitNote, changes: withEffects(state, base, ['purchaseReturns'], ctx.now) }
}

/** Cancels a debit note: the goods come back into stock and the amount is owed again. */
export function reversePurchaseReturn(state: DataState, returnId: string, note: string, ctx: OpCtx): { changes: Changes; debitNote: PurchaseReturn } {
  const { original, doc } = reversalOf(state, 'purchaseReturns', returnId, note, ctx)
  const stock = original.items.filter((i) => state.variants[i.variantId]).map((i) => adjustStock(state, i.variantId, i.qty, 'return', doc.no, `Debit note ${original.no} cancelled`, ctx).changes)
  const moved = mergeChanges(...stock)
  const base: Changes = mergeChanges({ put: { purchaseReturns: [doc], audit: [audit(ctx, 'PURCHASE_RETURN_REVERSED', `${original.no} cancelled`)] } }, { put: moved.put })
  return { debitNote: doc, changes: withEffects(state, base, ['purchaseReturns'], ctx.now) }
}
