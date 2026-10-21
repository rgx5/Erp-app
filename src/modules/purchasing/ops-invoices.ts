import { id } from '@/domain/ids'
import { invoiceCheck } from '@/domain/purchasing'
import { round2 } from '@/domain/money'
import { audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { withEffects } from '@/replication/local'
import { nextNo } from '../numbering'
import { buildInvoiceLines, isInterState, itcFor, taxTotals, type InvoiceLineDraft } from './itc'
import { reversalOf } from './ops-reverse'
import { live } from './reversal'
import type { InvoiceBasis, ItcBlock, PurchaseInvoice } from './types'
import './replication'

export interface InvoiceDraft {
  supplierId: string
  /** The number on the supplier's invoice. */
  invoiceNo: string
  invoiceDate: number
  dueDate?: number
  kind: 'goods' | 'services'
  /** For services: what it was for ('Repairs'). */
  head?: string
  /** The goods receipt this invoice is for (goods only). */
  purchaseId?: string
  lines: InvoiceLineDraft[]
  /** Left out: worked out from the supplier's GSTIN and yours. */
  interState?: boolean
  blocked?: ItcBlock
  /** The total printed on the invoice; the lines must come to it (within ₹1), and any difference becomes the round-off. */
  printedTotal?: number
  note?: string
}

/**
 * Captures a supplier's tax invoice with its GST. Credit (ITC) is worked out from the supplier's GSTIN, your own registration,
 * the block you pick and the claim deadline. An invoice that names a goods receipt does not add a second debt: when the receipt
 * was entered at the invoice total only the tax is moved out of stock; when it was entered before tax the tax is added to what
 * is owed.
 */
export function recordPurchaseInvoice(state: DataState, d: InvoiceDraft, ctx: OpCtx): { changes: Changes; invoice: PurchaseInvoice } {
  const supplier = state.suppliers[d.supplierId]
  if (!supplier) throw new OpError('Choose a supplier.')
  const invoiceNo = d.invoiceNo.trim()
  if (!invoiceNo) throw new OpError('Write the invoice number printed on the supplier’s invoice.')
  if (!(d.invoiceDate > 0) || d.invoiceDate > ctx.now + 86_400_000) throw new OpError('The invoice date cannot be in the future.')
  if (live(listOf(state.purchaseInvoices)).some((i) => i.supplierId === d.supplierId && i.invoiceNo.toLowerCase() === invoiceNo.toLowerCase())) {
    throw new OpError(`Invoice ${invoiceNo} from ${supplier.name} is already entered — entering it twice would claim its credit twice.`)
  }
  if (!d.lines.length) throw new OpError('Add at least one line to the invoice.')
  for (const l of d.lines) {
    if (!(l.taxable > 0)) throw new OpError('Every line needs an amount before tax.')
    if (!(l.rate >= 0 && l.rate <= 40)) throw new OpError('A GST rate is a percentage from 0 to 40.')
  }
  if (d.kind === 'services' && d.purchaseId) throw new OpError('Only goods can be tied to a goods receipt.')
  // A GSTIN that does not check out is allowed: the invoice is recorded, credit just cannot be claimed (the reason is on it).
  const gstin = supplier.gstin.trim().toUpperCase()

  const interState = d.interState ?? isInterState(state.store, gstin)
  const lines = buildInvoiceLines(d.lines, interState)
  const t = taxTotals(lines)
  const sum = round2(t.taxable + t.tax)
  let roundOff = 0
  if (d.printedTotal !== undefined && d.printedTotal > 0) {
    const check = invoiceCheck(sum, d.printedTotal)
    if (check && !check.ok) throw new OpError(`The lines come to ₹${sum} but the invoice says ₹${d.printedTotal} — check the amounts and rates.`)
    roundOff = round2(d.printedTotal - sum)
  }
  const total = round2(sum + roundOff)

  let basis: InvoiceBasis = 'standalone'
  let payable = total
  if (d.purchaseId) {
    const grn = state.purchases[d.purchaseId]
    if (!grn) throw new OpError('That goods receipt no longer exists.')
    if (grn.supplierId !== d.supplierId) throw new OpError('That receipt is from a different supplier.')
    if (live(listOf(state.purchaseInvoices)).some((i) => i.purchaseId === d.purchaseId)) throw new OpError(`${grn.no} already has an invoice entered against it.`)
    if (Math.abs(grn.total - total) <= 1) { basis = 'receipt-gross'; payable = 0 }
    else if (Math.abs(grn.total - t.taxable) <= 1) { basis = 'receipt-net'; payable = round2(total - grn.total) }
    else throw new OpError(`${grn.no} is ₹${grn.total} but the invoice is ₹${total} (₹${t.taxable} before tax). Correct one of them, or leave the invoice unlinked.`)
  }

  const blocked = d.blocked ?? 'none'
  const itc = itcFor({ supplierGstin: gstin, storeRegistration: state.store?.registrationType, blocked, cgst: t.cgst, sgst: t.sgst, igst: t.igst, invoiceDate: d.invoiceDate, asOf: ctx.now })
  const invoice: PurchaseInvoice = {
    id: id('pi_', ctx.now), no: nextNo('PI-', listOf(state.purchaseInvoices).map((i) => i.no), ctx), supplierId: d.supplierId, invoiceNo, invoiceDate: d.invoiceDate,
    ...(d.dueDate ? { dueDate: d.dueDate } : {}), supplierGstin: gstin, interState, kind: d.kind, head: (d.head ?? '').trim(), ...(d.purchaseId ? { purchaseId: d.purchaseId } : {}), basis, lines,
    taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff, total, payable, blocked, itc, note: (d.note ?? '').trim(),
    date: ctx.now, userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  const claim = itc.eligible ? round2(itc.cgst + itc.sgst + itc.igst) : 0
  const base: Changes = { put: { purchaseInvoices: [invoice], audit: [audit(ctx, 'PURCHASE_INVOICE', `${invoice.no} — ${supplier.name} ${invoiceNo} ₹${total}, credit ₹${claim}`)] } }
  return { invoice, changes: withEffects(state, base, ['purchaseInvoices'], ctx.now) }
}

/** Cancels an invoice entered by mistake: its credit and what it added to what is owed are taken back. */
export function reversePurchaseInvoice(state: DataState, invoiceId: string, note: string, ctx: OpCtx): { changes: Changes; invoice: PurchaseInvoice } {
  const { original, doc } = reversalOf(state, 'purchaseInvoices', invoiceId, note, ctx)
  const base: Changes = { put: { purchaseInvoices: [doc], audit: [audit(ctx, 'PURCHASE_INVOICE_REVERSED', `${original.no} — ${original.invoiceNo} cancelled${note.trim() ? ` (${note.trim()})` : ''}`)] } }
  return { invoice: doc, changes: withEffects(state, base, ['purchaseInvoices'], ctx.now) }
}
