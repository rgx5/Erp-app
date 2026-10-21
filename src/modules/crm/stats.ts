import { DAY } from '@/domain/dates'
import { round2 } from '@/domain/money'
import type { Bill } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import type { CrmSettings, MembershipTier } from './types'

/** What one customer's bills add up to. A return (credit note) takes its value off the spend and is not an order. */
export interface CustomerStats {
  customerId: string
  /** Net spend over all time. */
  spend: number
  orders: number
  firstAt: number | null
  lastAt: number | null
  /** Each bill, so a window (the last 90 days) can be summed without another pass. */
  entries: Array<{ at: number; total: number; sale: boolean }>
}

const isSale = (b: Bill) => !b.refundOfBillId && b.total >= 0

/** Everyone's purchase figures in one pass over the bills. Parked bills do not count. */
export function statsByCustomer(state: Pick<DataState, 'bills'>): Map<string, CustomerStats> {
  const out = new Map<string, CustomerStats>()
  for (const b of listOf(state.bills)) {
    if (!b.customerId || b.status === 'held') continue
    let s = out.get(b.customerId)
    if (!s) { s = { customerId: b.customerId, spend: 0, orders: 0, firstAt: null, lastAt: null, entries: [] }; out.set(b.customerId, s) }
    const sale = isSale(b)
    s.entries.push({ at: b.date, total: b.total, sale })
    s.spend += b.total
    if (sale) {
      s.orders += 1
      s.firstAt = s.firstAt === null ? b.date : Math.min(s.firstAt, b.date)
      s.lastAt = s.lastAt === null ? b.date : Math.max(s.lastAt, b.date)
    }
  }
  for (const s of out.values()) s.spend = round2(s.spend)
  return out
}

const NONE = (id: string): CustomerStats => ({ customerId: id, spend: 0, orders: 0, firstAt: null, lastAt: null, entries: [] })
export const statsOf = (m: Map<string, CustomerStats>, id: string): CustomerStats => m.get(id) ?? NONE(id)

/** Spend over the last `days` days (all time when omitted). */
export function spendIn(s: CustomerStats, now: number, days?: number): number {
  if (days === undefined) return s.spend
  const from = now - days * DAY
  return round2(s.entries.reduce((t, e) => (e.at >= from && e.at <= now ? t + e.total : t), 0))
}

/** Number of purchases over the last `days` days (all time when omitted). */
export function ordersIn(s: CustomerStats, now: number, days?: number): number {
  if (days === undefined) return s.orders
  const from = now - days * DAY
  return s.entries.filter((e) => e.sale && e.at >= from && e.at <= now).length
}

/** Whole days since the last purchase, or null when there has been none. */
export const daysSinceLast = (s: CustomerStats, now: number): number | null => (s.lastAt === null ? null : Math.max(0, Math.floor((now - s.lastAt) / DAY)))

/** The highest tier whose spend threshold the customer has reached (tiers are matched lowest-first, but may be given in any order). */
export function tierFor(spend: number, tiers: MembershipTier[]): MembershipTier | null {
  const sorted = [...tiers].sort((a, b) => a.minSpend - b.minSpend)
  let cur: MembershipTier | null = null
  for (const t of sorted) if (spend >= t.minSpend) cur = t
  return cur
}

/** A customer's tier today: by spend over the settings' window. Also says what is left to reach the next one. */
export function membershipOf(s: CustomerStats, now: number, cfg: Pick<CrmSettings, 'tiers' | 'tierWindowDays'>): { tier: MembershipTier | null; spend: number; next: MembershipTier | null; toNext: number } {
  const spend = spendIn(s, now, cfg.tierWindowDays)
  const tier = tierFor(spend, cfg.tiers)
  const next = [...cfg.tiers].sort((a, b) => a.minSpend - b.minSpend).find((t) => t.minSpend > spend) ?? null
  return { tier, spend, next, toNext: next ? round2(next.minSpend - spend) : 0 }
}
