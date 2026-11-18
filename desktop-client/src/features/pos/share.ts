import type { PosSaleResult } from '@/api/schemas'
import { formatInr } from '@/domain/format'

/** Digits only; a 10-digit Indian mobile number gets the 91 country code. Anything else that is not 8 to 15 digits is rejected. */
export function whatsappNumber(input: string): string | null {
  const d = input.replace(/\D/g, '')
  const full = d.length === 10 ? `91${d}` : d.length === 11 && d.startsWith('0') ? `91${d.slice(1)}` : d
  return full.length >= 8 && full.length <= 15 ? full : null
}
/** A plain-text receipt: every amount is the server's, only laid out. */
export function receiptText(sale: PosSaleResult, shop: string): string {
  const doc = sale.invoice ?? sale.creditNote
  if (!doc) return ''
  const rows = doc.lines.map((l) => `${l.description} x${Number(l.quantity)}  ${formatInr(l.lineTotal)}`)
  return [`*${shop}*`, `${doc.documentType === 'credit_note' ? 'Credit note' : 'Invoice'} ${doc.invoiceNo}`, ...rows, `*Total ${formatInr(doc.grandTotal)}*`, 'Thank you!'].join('\n')
}
export const whatsappUrl = (phone: string, text: string): string | null => { const n = whatsappNumber(phone); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null }
