import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { withEffects } from '@/replication/local'
import { nextNo } from '../numbering'
import { settingsOf } from './approvals'
import { allocateOldestFirst, payables } from './payables'
import { reversalOf } from './ops-reverse'
import type { PayMode, PurchaseSettings, SupplierPayment, SupplierTerms } from './types'
import './replication'

export const PAY_MODES: PayMode[] = ['cash', 'upi', 'card', 'bank', 'cheque']
const cleanMode = (m: string): PayMode => {
  if (!PAY_MODES.includes(m as PayMode)) throw new OpError('Choose how the money was paid.')
  return m as PayMode
}
const days = (n: number, what: string) => {
  if (!Number.isInteger(n) || n < 0 || n > 365) throw new OpError(`${what} must be a whole number from 0 to 365.`)
  return n
}

// ───────────────────────────── terms and settings ─────────────────────────────

/** How many days a supplier gives us to pay. */
export function saveSupplierTerms(state: DataState, supplierId: string, d: { creditDays: number; notes: string }, ctx: OpCtx): { changes: Changes; terms: SupplierTerms } {
  const s = state.suppliers[supplierId]
  if (!s) throw new OpError('That supplier no longer exists.')
  const terms: SupplierTerms = { id: supplierId, supplierId, creditDays: days(d.creditDays, 'Days to pay'), notes: d.notes.trim() }
  return { terms, changes: { put: { supplierTerms: [terms], audit: [audit(ctx, 'SUPPLIER_TERMS', `${s.name}: ${terms.creditDays} days to pay`)] } } }
}

export function savePurchaseSettings(state: DataState, patch: Partial<Omit<PurchaseSettings, 'id'>>, ctx: OpCtx): { changes: Changes; settings: PurchaseSettings } {
  const cur = settingsOf(state)
  const next: PurchaseSettings = { ...cur, ...patch, limits: { ...(patch.limits ?? cur.limits) }, id: 'purchasing' }
  if (!(next.approvalAbove >= 0)) throw new OpError('The approval threshold cannot be negative.')
  for (const [role, limit] of Object.entries(next.limits)) {
    if (!(limit >= 0)) throw new OpError(`The limit for ${role} cannot be negative.`)
    if (role === 'owner') delete next.limits[role]
  }
  next.defaultDays = days(next.defaultDays, 'Days to pay')
  next.remindDays = days(next.remindDays, 'Days of warning')
  next.approvalAbove = round2(next.approvalAbove)
  return { settings: next, changes: { put: { purchaseSettings: [next], audit: [audit(ctx, 'PURCHASE_SETTINGS', Object.keys(patch).join(', '))] } } }
}

// ───────────────────────────── paying suppliers ─────────────────────────────

export interface PaymentDraft {
  supplierId: string
  amount: number
  mode: PayMode
  ref?: string
  date?: number
  /** Which receipts / invoices it settles; leave out to settle the oldest first. */
  allocations?: Array<{ ref: string; amount: number }>
  note?: string
}

/** Records money paid to a supplier, settles their oldest dues with it (or the ones chosen) and keeps any excess as an advance. */
export function paySupplier(state: DataState, d: PaymentDraft, ctx: OpCtx): { changes: Changes; payment: SupplierPayment } {
  const supplier = state.suppliers[d.supplierId]
  if (!supplier) throw new OpError('Choose a supplier.')
  const amount = round2(d.amount)
  if (!(amount > 0)) throw new OpError('Enter the amount paid.')
  const mode = cleanMode(d.mode)
  const open = payables(state).bySupplier[d.supplierId]?.docs.filter((x) => x.outstanding > 0) ?? []

  let allocations: SupplierPayment['allocations']
  let advance: number
  if (d.allocations) {
    allocations = []
    for (const a of d.allocations) {
      const doc = open.find((x) => x.ref === a.ref)
      if (!doc) throw new OpError('One of those bills is not owed to this supplier, or is already settled.')
      const amt = round2(a.amount)
      if (!(amt > 0)) continue
      if (amt > doc.outstanding + 0.001) throw new OpError(`${doc.no} only has ₹${doc.outstanding} outstanding.`)
      allocations.push({ ref: a.ref, amount: amt })
    }
    const used = round2(allocations.reduce((s, a) => s + a.amount, 0))
    if (used > amount + 0.001) throw new OpError('You have allocated more than was paid.')
    advance = round2(amount - used)
  } else ({ allocations, advance } = allocateOldestFirst(open, amount))

  const payment: SupplierPayment = {
    id: id('sp_', ctx.now), no: nextNo('SP-', listOf(state.supplierPayments).map((p) => p.no), ctx), supplierId: d.supplierId, amount, mode, ref: (d.ref ?? '').trim(),
    date: d.date ?? ctx.now, allocations, advance, note: (d.note ?? '').trim(), userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  const base: Changes = { put: { supplierPayments: [payment], audit: [audit(ctx, 'SUPPLIER_PAYMENT', `${payment.no} — ${supplier.name} ₹${amount} by ${mode}${advance ? ` (₹${advance} advance)` : ''}`)] } }
  return { payment, changes: withEffects(state, base, ['supplierPayments'], ctx.now) }
}

/** Cancels a payment (a bounced cheque, a wrong entry): what it settled becomes owed again. */
export function reversePayment(state: DataState, paymentId: string, note: string, ctx: OpCtx): { changes: Changes; payment: SupplierPayment } {
  const { original, doc } = reversalOf(state, 'supplierPayments', paymentId, note, ctx)
  const base: Changes = { put: { supplierPayments: [doc], audit: [audit(ctx, 'SUPPLIER_PAYMENT_REVERSED', `${original.no} — ₹${original.amount} cancelled${note.trim() ? ` (${note.trim()})` : ''}`)] } }
  return { payment: doc, changes: withEffects(state, base, ['supplierPayments'], ctx.now) }
}
