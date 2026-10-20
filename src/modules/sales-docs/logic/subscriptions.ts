import { endOfDay, startOfDay } from '@/domain/dates'
import { listOf, type DataState } from '@/data/state'
import type { Frequency, Subscription } from '../types'

export const FREQUENCY_LABEL: Record<Frequency, string> = { monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' }
const MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, yearly: 12 }

/**
 * One period after `from`, keeping the day of the month where it exists and clamping to the month's last day where it does
 * not (31 Jan → 28 Feb → 31 Mar when `anchorDay` is kept by the caller).
 */
export function addPeriod(from: number, freq: Frequency, anchorDay?: number): number {
  const d = new Date(from)
  const day = anchorDay ?? d.getDate()
  const target = new Date(d.getFullYear(), d.getMonth() + MONTHS[freq], 1, d.getHours(), d.getMinutes(), 0, 0)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, last))
  return target.getTime()
}

/** Every invoice date that has fallen due up to `now` (at most `cap`, so a long-neglected plan cannot flood the books). */
export function periodsDue(sub: Pick<Subscription, 'nextDate' | 'endDate' | 'frequency' | 'active' | 'startDate'>, now: number, cap = 12): number[] {
  if (!sub.active) return []
  const out: number[] = []
  const anchor = new Date(sub.startDate).getDate()
  let d = sub.nextDate
  while (startOfDay(d) <= endOfDay(now) && out.length < cap) {
    if (sub.endDate && startOfDay(d) > endOfDay(sub.endDate)) break
    out.push(d)
    d = addPeriod(d, sub.frequency, anchor)
  }
  return out
}

/** The date after the ones generated: where the schedule continues. */
export function nextAfter(sub: Pick<Subscription, 'nextDate' | 'frequency' | 'startDate'>, generated: number): number {
  const anchor = new Date(sub.startDate).getDate()
  let d = sub.nextDate
  for (let i = 0; i < generated; i++) d = addPeriod(d, sub.frequency, anchor)
  return d
}

/** Subscriptions with at least one invoice due, with the dates. */
export function dueSubscriptions(state: DataState, now: number): Array<{ sub: Subscription; dates: number[] }> {
  const out: Array<{ sub: Subscription; dates: number[] }> = []
  for (const sub of listOf(state.subscriptions)) {
    const dates = periodsDue(sub, now)
    if (dates.length) out.push({ sub, dates })
  }
  return out.sort((a, b) => a.dates[0] - b.dates[0])
}

/** The next few invoice dates, for the schedule on a plan's page. */
export function scheduleAhead(sub: Pick<Subscription, 'nextDate' | 'endDate' | 'frequency' | 'startDate'>, n = 6): number[] {
  const out: number[] = []
  const anchor = new Date(sub.startDate).getDate()
  let d = sub.nextDate
  while (out.length < n && !(sub.endDate && startOfDay(d) > endOfDay(sub.endDate))) { out.push(d); d = addPeriod(d, sub.frequency, anchor) }
  return out
}
