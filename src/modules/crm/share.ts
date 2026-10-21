import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { firstName } from '@/domain/people'
import type { Bill } from '@/domain/types'

/**
 * A shareable invoice link comes from a Kosh server: POST /share { coll: 'bills', id } answers { token, url }, and anyone who opens
 * GET /p/:token sees the invoice as a web page, no sign-in. Without a Kosh server there is no page to link to — the screens hide
 * the feature then. The link is only as private as its token: anyone who has it can read that one invoice.
 */

/** What this module needs from the Kosh client (`createKoshApi(...)`): its address and the plain call. */
export interface ShareApi {
  base: string
  raw: (method: string, path: string, body?: unknown) => Promise<Response>
}

export interface ShareLink { token: string; url: string }

/** The address people open: the server may answer with a full address or just the path. */
export function absoluteUrl(base: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return `${base.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
}

/** Checks the server's answer and makes the address complete. Throws a sentence a shopkeeper can read. */
export function parseShare(body: unknown, base: string): ShareLink {
  const b = (body ?? {}) as { token?: unknown; url?: unknown }
  const token = typeof b.token === 'string' ? b.token : ''
  if (!token) throw new Error('The server did not return a link. Try again.')
  const url = typeof b.url === 'string' && b.url ? absoluteUrl(base, b.url) : absoluteUrl(base, `/p/${token}`)
  return { token, url }
}

/** Asks the server for a public link to a bill. */
export async function requestShareLink(api: ShareApi, billId: string): Promise<ShareLink> {
  const res = await api.raw('POST', '/share', { coll: 'bills', id: billId })
  let body: unknown = null
  try { body = await res.json() } catch { /* an error page */ }
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `The server could not make the link (${res.status}).`)
  return parseShare(body, api.base)
}

/** The words sent with the link. */
export function invoiceMessage(shop: string, bill: Pick<Bill, 'no' | 'date' | 'total'>, url: string, customerName?: string): string {
  const who = firstName(customerName)
  return `${who ? `Hello ${who}, y` : 'Y'}our invoice ${bill.no} from ${shop} dated ${fmtDate(bill.date)} for ${inr(bill.total, 0)} is ready. View it here: ${url}`
}
