import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { firstName } from '@/domain/people'
import type { Customer } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import { matchCtx, resolveAudience, segmentMembers } from './segments'
import { daysSinceLast, statsByCustomer, statsOf } from './stats'
import type { Campaign, CampaignSend, Channel } from './types'

/**
 * Campaign messages are built here and opened one at a time in WhatsApp or the messages app, where a person presses send. Sending
 * by itself (a broadcast to hundreds of people with no one touching the phone) needs the WhatsApp Business API or an SMS provider
 * with the shop's own keys — that runs on a server and is not part of this app.
 */

// ───────────────────────────── links ─────────────────────────────

/** A phone number as WhatsApp wants it: digits only with the country code. Ten-digit Indian numbers get 91. Null when it cannot be one. */
export function dialNumber(phone: string | undefined | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length === 10) return `91${d}`
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`
  if (d.length >= 11 && d.length <= 14) return d
  return null
}

export const whatsappLink = (phone: string | undefined | null, text: string): string | null => {
  const n = dialNumber(phone)
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null
}
export const smsLink = (phone: string | undefined | null, text: string): string | null => {
  const n = dialNumber(phone)
  return n ? `sms:+${n}?body=${encodeURIComponent(text)}` : null
}
export const linkFor = (channel: Channel, phone: string | undefined | null, text: string) => (channel === 'sms' ? smsLink(phone, text) : whatsappLink(phone, text))

// ───────────────────────────── templates ─────────────────────────────

export const MERGE_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'name', label: 'Full name' },
  { key: 'firstName', label: 'First name' },
  { key: 'shop', label: 'Shop name' },
  { key: 'points', label: 'Loyalty points' },
  { key: 'credit', label: 'Store credit' },
  { key: 'lastVisit', label: 'Last visit' },
  { key: 'spend', label: 'Spent this year' },
]

export const TEMPLATES: Array<{ id: string; label: string; channel: Channel; text: string }> = [
  { id: 'festival', label: 'Festival greeting', channel: 'whatsapp', text: 'Hello {{firstName}}, wishing you and your family a very happy festival from all of us at {{shop}}! Visit us this week for special festive offers.' },
  { id: 'birthday', label: 'Birthday wish', channel: 'whatsapp', text: 'Happy birthday, {{firstName}}! 🎂 {{shop}} wishes you a wonderful year. Show this message at the store for a little birthday treat.' },
  { id: 'winback', label: 'We miss you', channel: 'whatsapp', text: 'Hello {{firstName}}, it has been a while since your last visit to {{shop}} ({{lastVisit}}). We have new arrivals we think you will like. You also have {{points}} loyalty points waiting.' },
  { id: 'credit', label: 'Use your store credit', channel: 'sms', text: 'Hi {{firstName}}, you have {{credit}} store credit at {{shop}}. Come in and use it on your next purchase.' },
  { id: 'thanks', label: 'Thank you', channel: 'whatsapp', text: 'Thank you for shopping with {{shop}}, {{firstName}}! We value your support.' },
]

/** Fills {{fields}} in a template. A field it does not know is left as typed so the mistake is visible in the preview. */
export function renderTemplate(template: string, fields: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (m, k: string) => (k in fields ? fields[k] : m))
}

/** Merge fields named in a template that this module does not provide. */
export function unknownFields(template: string): string[] {
  const known = new Set(MERGE_FIELDS.map((f) => f.key))
  const bad = new Set<string>()
  for (const m of template.matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)) if (!known.has(m[1])) bad.add(m[1])
  return [...bad]
}

/** The values that fill one customer's message. */
export function fieldsFor(state: DataState, c: Customer, now: number, stats = statsByCustomer(state)): Record<string, string> {
  const s = statsOf(stats, c.id)
  const last = daysSinceLast(s, now)
  return {
    name: c.name,
    firstName: firstName(c.name) || 'there',
    shop: state.store?.name || 'our shop',
    points: String(c.loyaltyPoints ?? 0),
    credit: inr(c.storeCredit ?? 0, 0),
    lastVisit: s.lastAt === null ? 'your first visit' : last === 0 ? 'today' : fmtDate(s.lastAt),
    spend: inr(s.entries.filter((e) => e.at >= now - 365 * 86_400_000).reduce((t, e) => t + e.total, 0), 0),
  }
}

// ───────────────────────────── the audience ─────────────────────────────

export interface Recipient { customer: Customer; text: string; link: string }

export interface Audience {
  /** People who will get the message. */
  recipients: Recipient[]
  noPhone: Customer[]
  optedOut: Customer[]
}

/** Who a campaign goes to: the segment's members with a usable number, who have not asked to be left out; each with their own message. */
export function buildAudience(state: DataState, audience: string, template: string, channel: Channel, now: number): Audience | null {
  const aud = resolveAudience(state, audience)
  if (!aud) return null
  const stats = statsByCustomer(state)
  const members = segmentMembers(state, aud.def, now, matchCtx(state, now, stats))
  const out: Audience = { recipients: [], noPhone: [], optedOut: [] }
  for (const c of members) {
    if (c.optOutMarketing) { out.optedOut.push(c); continue }
    const text = renderTemplate(template, fieldsFor(state, c, now, stats))
    const link = linkFor(channel, c.phone, text)
    if (!link) { out.noPhone.push(c); continue }
    out.recipients.push({ customer: c, text, link })
  }
  return out
}

// ───────────────────────────── progress ─────────────────────────────

export interface CampaignProgress { total: number; sent: number; skipped: number; pending: number; done: boolean; pct: number }

export function sendsOf(state: Pick<DataState, 'crmSends'>, campaignId: string): CampaignSend[] {
  return listOf(state.crmSends ?? {}).filter((s) => s.campaignId === campaignId).sort((a, b) => a.order - b.order)
}

export function campaignProgress(sends: CampaignSend[]): CampaignProgress {
  const sent = sends.filter((s) => s.status === 'sent').length
  const skipped = sends.filter((s) => s.status === 'skipped').length
  const pending = sends.length - sent - skipped
  return { total: sends.length, sent, skipped, pending, done: sends.length > 0 && pending === 0, pct: sends.length ? Math.round(((sent + skipped) / sends.length) * 100) : 0 }
}

/** The next recipient still waiting, in list order. */
export const nextPending = (sends: CampaignSend[]): CampaignSend | null => sends.find((s) => s.status === 'pending') ?? null

export const campaignIsOpen = (c: Campaign, sends: CampaignSend[]) => !c.closedAt && campaignProgress(sends).pending > 0
