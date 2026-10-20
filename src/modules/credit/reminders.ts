import { fmtDayShort } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { firstName } from '@/domain/people'
import type { DataState } from '@/data/state'
import { agingReport, creditStatus, daysOverdue, receivables, type Receivables } from './logic'
import { upiLink } from './upi'

/**
 * Words to send, and the links that open the right app with them. Nothing is sent from here: WhatsApp / the messages app opens
 * with the text filled in and the person presses send. (Sending automatically needs the WhatsApp Business API or an SMS gateway —
 * that is a server integration, not something a phone can do.)
 */

/** A phone number as WhatsApp wants it: digits only with the country code. Ten-digit Indian numbers get 91. Null when it cannot be one. */
export function whatsappNumber(phone: string | undefined | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length === 10) return `91${d}`
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`
  if (d.length >= 11 && d.length <= 14) return d
  return null
}

export const whatsappUrl = (phone: string | undefined | null, text: string): string | null => {
  const n = whatsappNumber(phone)
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null
}
export const smsUrl = (phone: string | undefined | null, text: string): string | null => {
  const n = whatsappNumber(phone)
  return n ? `sms:+${n}?body=${encodeURIComponent(text)}` : null
}

export type ReminderTone = 'polite' | 'firm'

export interface Reminder {
  customerId: string
  name: string
  phone: string
  /** Everything they still owe. */
  total: number
  /** The part past its due date. */
  overdue: number
  oldestDaysOverdue: number
  text: string
  /** The `upi://pay` link in the text, when the shop has a UPI id. */
  upi: string | null
  whatsapp: string | null
  sms: string | null
}

export interface ReminderOpts { tone?: ReminderTone; upiId?: string; payeeName?: string }

/** The reminder wording for one customer. Returns null when they owe nothing. */
export function reminderText(i: { shop: string; name: string; total: number; overdue: number; days: number; billNo?: string; dueDate?: number; tone: ReminderTone; upi?: string | null }): string {
  const who = firstName(i.name) || 'there'
  const pay = i.upi ? `\nPay by UPI: ${i.upi}` : ''
  const late = i.overdue > 0
  if (i.tone === 'firm' && late) {
    return `Dear ${i.name || 'customer'}, ${inr(i.overdue, 0)} on your account with ${i.shop} is overdue by ${i.days} day${i.days === 1 ? '' : 's'}${i.billNo ? ` (bill ${i.billNo}${i.dueDate ? `, due ${fmtDayShort(i.dueDate)}` : ''})` : ''}. Your total outstanding is ${inr(i.total, 0)}. Please clear it today or call us.${pay}\nThank you — ${i.shop}`
  }
  if (late) {
    return `Hello ${who}, a gentle reminder from ${i.shop}: ${inr(i.total, 0)} is pending on your account${i.billNo && i.dueDate ? ` (bill ${i.billNo} was due on ${fmtDayShort(i.dueDate)})` : ''}. Please pay when you can.${pay}\nThank you! — ${i.shop}`
  }
  return `Hello ${who}, this is ${i.shop}. A note that ${inr(i.total, 0)} on your account falls due soon. You can pay at the shop or by UPI.${pay}\nThank you! — ${i.shop}`
}

/** The reminder for one customer, worked out from the documents. */
export function buildReminder(state: DataState, customerId: string, asOf: number, opts: ReminderOpts = {}, rec: Receivables = receivables(state)): Reminder | null {
  const customer = state.customers[customerId]
  const row = agingReport(state, asOf, rec).rows.find((r) => r.customerId === customerId)
  if (!customer || !row) return null
  const cfg = state.creditSettings?.credit
  const tone = opts.tone ?? cfg?.reminderTone ?? 'polite'
  const vpa = (opts.upiId ?? cfg?.upiId ?? '').trim()
  const shop = state.store?.name || 'our shop'
  const overdue = round2(row.total - row.buckets.notDue)
  const open = (rec.byCustomer[customerId]?.bills ?? []).filter((b) => b.outstanding > 0).sort((a, b) => a.dueDate - b.dueDate)[0]
  const upi = vpa ? upiLink({ vpa, name: opts.payeeName ?? cfg?.payeeName ?? shop, amount: row.total, note: `Dues ${customer.name}`.slice(0, 50) }) : null
  const text = reminderText({ shop, name: customer.name, total: row.total, overdue, days: Math.max(0, open ? daysOverdue(open.dueDate, asOf) : 0), billNo: open?.no, dueDate: open?.dueDate, tone, upi })
  return {
    customerId, name: customer.name, phone: customer.phone, total: row.total, overdue, oldestDaysOverdue: row.oldestDaysOverdue,
    text, upi, whatsapp: whatsappUrl(customer.phone, text), sms: smsUrl(customer.phone, text),
  }
}

/** Everyone who is past their due date, biggest overdue first — the list the reminder screen works through. */
export function reminderQueue(state: DataState, asOf: number, opts: ReminderOpts = {}): Reminder[] {
  const rec = receivables(state)
  const out: Reminder[] = []
  for (const r of agingReport(state, asOf, rec).rows) {
    if (r.total - r.buckets.notDue <= 0) continue
    const m = buildReminder(state, r.customerId, asOf, opts, rec)
    if (m) out.push(m)
  }
  return out.sort((a, b) => b.overdue - a.overdue)
}

// ───────────────────────────── payment requests ─────────────────────────────

export interface PaymentRequest {
  amount: number
  /** The `upi://pay` link — also what the QR code holds. Null until the shop has set its UPI id. */
  upi: string | null
  /** Text for sharing: the amount, what it is for, and the link. */
  text: string
  whatsapp: string | null
  sms: string | null
}

/**
 * A payment request for an amount: the UPI deep link (any UPI app opens it; it is also the QR code's content) and share links. This
 * is a *UPI link*, not a hosted gateway checkout: the phone can build it but cannot see whether the payer paid — whoever is at the
 * counter confirms the money arrived (the UPI app of the shop shows it), then records it. A gateway page with automatic settlement
 * (Razorpay, PhonePe…) needs the gateway's server and keys, which is outside this app.
 */
export function paymentRequest(state: DataState, i: { amount: number; note: string; ref?: string; phone?: string }): PaymentRequest {
  const cfg = state.creditSettings?.credit
  const vpa = (cfg?.upiId ?? '').trim()
  const shop = state.store?.name || 'our shop'
  const amount = round2(i.amount)
  const upi = vpa && amount > 0 ? upiLink({ vpa, name: cfg?.payeeName || shop, amount, note: i.note, ...(i.ref ? { ref: i.ref } : {}) }) : null
  const text = `${shop}: please pay ${inr(amount, 0)} for ${i.note}.${upi ? `\nPay by UPI: ${upi}` : ''}`
  return { amount, upi, text, whatsapp: whatsappUrl(i.phone, text), sms: smsUrl(i.phone, text) }
}

/** The request for what a customer owes now. */
export function dueRequest(state: DataState, customerId: string, asOf: number): PaymentRequest | null {
  const c = state.customers[customerId]
  const s = creditStatus(state, customerId, asOf)
  if (!c || s.owed <= 0) return null
  return paymentRequest(state, { amount: s.owed, note: `dues of ${c.name}`, phone: c.phone })
}
