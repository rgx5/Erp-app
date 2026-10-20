// The pure hooks of the pricing module: cart adjusters, the bill check and the receipt lines. No React, so tests load it directly.
import { inr } from '@/domain/money'
import type { Bill } from '@/domain/types'
import { OpError } from '@/data/ops'
import type { DataState } from '@/data/state'
import { registerBillHook, registerCartAdjuster, registerReceiptExtra, type CartCtx } from '../registry'
import { taxInconsistency } from './b2b'
import { adjustBreaks, adjustListPrices, listForCart, metaOf, tierOf } from './prices'
import { applyPromotions } from './promotions'
import { eInvoiceId, ewayId } from './types'
import './replication'

export const PRICING = 'pricing'

registerCartAdjuster({ id: 'pricing.lists', order: 10, adjust: (lines, c: CartCtx) => adjustListPrices(lines, c.state, listForCart(c.state, c.customerId, c.extras)) })
registerCartAdjuster({ id: 'pricing.breaks', order: 20, adjust: (lines, c) => adjustBreaks(lines, c.state, listForCart(c.state, c.customerId, c.extras)) })
registerCartAdjuster({
  id: 'pricing.promotions', order: 30,
  adjust: (lines, c) => applyPromotions(lines, c.state, Date.now(), { retail: tierOf(listForCart(c.state, c.customerId, c.extras)) === 'retail' }),
})

// A bill that says it is an IGST bill, or a bill of supply, must have been priced that way. The check only covers bills that went
// through the GST section of checkout (they carry `ext.pricing`), so other modules' invoices are never held up by it.
registerBillHook({
  id: PRICING,
  beforeSave: ({ state, bill }) => {
    const customer = bill.customerId ? state.customers[bill.customerId] : undefined
    const problem = taxInconsistency(bill, state.store, customer)
    if (problem) throw new OpError(problem)
  },
})

const lineNote = (it: Bill['items'][number]): string | null => {
  const m = metaOf(it)
  const parts: string[] = []
  if (m.promos?.length) parts.push(m.promos.map((p) => `${p.name} −${inr(p.amount, 0)}`).join(', '))
  if (m.breakId && m.basePrice !== undefined && m.basePrice > it.price) parts.push(`Quantity price (was ${inr(m.basePrice, 0)})`)
  return parts.join(' · ') || null
}

/** The IRN and acknowledgement, and the e-way bill number, as lines for the printed invoice. */
export function eDocLines(bill: Bill, state: DataState): string[] {
  const out: string[] = []
  const e = state.eInvoices?.[eInvoiceId(bill.id)]
  if (e?.status === 'registered' && e.irn) {
    out.push(`IRN: ${e.irn}`)
    out.push(`Ack No: ${e.ackNo}${e.ackDate ? ` · Ack Date: ${e.ackDate}` : ''}`)
  }
  const w = state.ewayBills?.[ewayId(bill.id)]
  if (w?.status === 'generated' && w.ewbNo) out.push(`E-way bill: ${w.ewbNo}${w.validUpto ? ` · valid till ${w.validUpto}` : ''}`)
  return out
}

registerReceiptExtra({
  id: PRICING,
  item: (it) => lineNote(it),
  footer: (bill, state) => eDocLines(bill, state),
  qr: (bill, state) => {
    const e = state.eInvoices?.[eInvoiceId(bill.id)]
    return e?.status === 'registered' && e.signedQr ? e.signedQr : null
  },
})
