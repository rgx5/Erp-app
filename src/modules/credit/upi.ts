import { round2 } from '@/domain/money'

export interface UpiInput {
  /** The shop's UPI id: shop@bank. */
  vpa: string
  /** The name shown to the payer. */
  name: string
  /** Rupees; leave out for an open amount. */
  amount?: number
  /** What it is for ("Bill INV-0042"). */
  note?: string
  /** A reference the shop can match later (the bill number). */
  ref?: string
}

/**
 * A UPI payment link (the `upi://pay` deep link every UPI app understands, and the text inside a payment QR code). Amounts are
 * written with two decimals, text is percent-encoded. The app cannot tell whether the payer completed the payment — the person at
 * the counter confirms it.
 */
export function upiLink(i: UpiInput): string {
  const q: string[] = [`pa=${encodeURIComponent(i.vpa.trim())}`, `pn=${encodeURIComponent(i.name.trim() || i.vpa.trim())}`]
  if (i.amount !== undefined && i.amount > 0) q.push(`am=${round2(i.amount).toFixed(2)}`)
  q.push('cu=INR')
  if (i.note?.trim()) q.push(`tn=${encodeURIComponent(i.note.trim().slice(0, 50))}`)
  if (i.ref?.trim()) q.push(`tr=${encodeURIComponent(i.ref.trim().slice(0, 35))}`)
  return `upi://pay?${q.join('&')}`
}

export const isUpiId = (s: string) => /^[\w.\-]{2,}@[A-Za-z][\w.\-]{1,}$/.test(s.trim())
