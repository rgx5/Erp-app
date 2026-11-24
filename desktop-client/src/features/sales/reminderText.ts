export const DEFAULT_TEMPLATE = 'Dear {name}, a gentle reminder from {shop}: {amount} is overdue ({oldest}). Please pay at your earliest convenience.{upi} Thank you.'
const KEY = 'onesync.reminderTemplate'
export const loadTemplate = (): string => { try { return localStorage.getItem(KEY) || DEFAULT_TEMPLATE } catch { return DEFAULT_TEMPLATE } }
export const saveTemplate = (t: string): void => { try { localStorage.setItem(KEY, t) } catch { /* not remembered */ } }

/** The message for one customer: the template with their name, what is overdue, how long, and where to pay filled in. */
export function reminderText(template: string, v: { name: string; shop: string; amount: string; oldest: string; upiId?: string | null }): string {
  return template
    .replaceAll('{name}', v.name).replaceAll('{shop}', v.shop).replaceAll('{amount}', v.amount).replaceAll('{oldest}', v.oldest)
    .replaceAll('{upi}', v.upiId ? ` You can pay by UPI to ${v.upiId}.` : '')
}

/** How long the oldest unpaid invoice has been overdue, in words, from the ageing buckets. */
export function oldestOverdue(b: { days1to30: string; days31to60: string; days61to90: string; over90: string }): string {
  if (Number(b.over90) > 0) return 'over 90 days'
  if (Number(b.days61to90) > 0) return '61 to 90 days'
  if (Number(b.days31to60) > 0) return '31 to 60 days'
  return 'up to 30 days'
}
export const overdueOf = (b: { days1to30: string; days31to60: string; days61to90: string; over90: string }): number => Number(b.days1to30) + Number(b.days31to60) + Number(b.days61to90) + Number(b.over90)
