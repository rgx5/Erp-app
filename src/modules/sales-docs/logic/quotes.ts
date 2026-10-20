import { endOfDay, fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import { variantLabel } from '@/domain/codes'
import type { StoreSettings } from '@/domain/types'
import type { Quotation, QuoteStatus } from '../types'
import { docTotals } from './lines'

export const DEFAULT_VALIDITY_DAYS = 15
export const DEFAULT_TERMS = 'Prices are valid until the date shown. Goods are subject to availability. Payment as agreed.'

/** Past its last day and not already settled either way. */
export const isExpired = (q: Pick<Quotation, 'status' | 'validUntil'>, now: number) =>
  (q.status === 'draft' || q.status === 'sent' || q.status === 'accepted' || q.status === 'expired') && endOfDay(q.validUntil) < now

/** What to show: a quotation whose date has passed reads "expired" without anyone having to touch it. */
export const effectiveStatus = (q: Pick<Quotation, 'status' | 'validUntil'>, now: number): QuoteStatus => (isExpired(q, now) ? 'expired' : q.status)

export const QUOTE_LABEL: Record<QuoteStatus, string> = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', rejected: 'Rejected', expired: 'Expired', converted: 'Billed' }

/** Drafts and sent quotations can still be changed; once accepted, rejected or billed they are a record. */
export const canEditQuote = (q: Pick<Quotation, 'status'>) => q.status === 'draft' || q.status === 'sent'
export const canConvertQuote = (q: Pick<Quotation, 'status'>) => q.status !== 'converted' && q.status !== 'rejected'

export const daysLeft = (q: Pick<Quotation, 'validUntil'>, now: number) => Math.ceil((endOfDay(q.validUntil) - now) / 86_400_000)

/** The WhatsApp message for a quotation. */
export function quotationText(q: Quotation, store: Pick<StoreSettings, 'name' | 'phone' | 'slabs' | 'priceIncludesTax'>): string {
  const t = docTotals(q.items, q.billDiscountType, q.billDiscountValue, store)
  const lines: string[] = [`*${store.name}*`, `Quotation ${q.no} · ${fmtDate(q.date)}`]
  if (q.partyName) lines.push(`Hi ${q.partyName.split(' ')[0]},`)
  lines.push('')
  for (const i of q.items) {
    const lbl = variantLabel(i.size, i.color)
    lines.push(`• ${i.name}${lbl ? ` (${lbl})` : ''} × ${fmtQty(i.qty)}${i.unit && i.unit !== 'pc' ? ` ${i.unit}` : ''} — ${inr(i.price * i.qty, 0)}`)
  }
  lines.push('')
  if (t.billDiscount + t.itemDiscount > 0) lines.push(`Discount: ${inr(t.billDiscount + t.itemDiscount, 0)}`)
  lines.push(`*Total: ${inr(t.total, 0)}*${store.priceIncludesTax ? ' (GST included)' : ' + GST'}`)
  lines.push(`Valid until ${fmtDate(q.validUntil)}`)
  if (q.notes) lines.push(q.notes)
  if (store.phone) lines.push(`📞 ${store.phone}`)
  return lines.join('\n')
}
