import { DAY, monthDay } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { Customer } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import { settingsOf } from './settings'
import { daysSinceLast, membershipOf, ordersIn, spendIn, statsByCustomer, statsOf, type CustomerStats } from './stats'
import type { CrmSettings, CustomerSegment, DatePeriod, SegmentRule } from './types'

const p2 = (n: number) => String(n).padStart(2, '0')
const md = (d: Date) => `${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

/** Whether a birthday or anniversary ("YYYY-MM-DD", year ignored) falls today, in the next 7 days, this month or next month. */
export function dateFalls(date: string, when: DatePeriod, now: number): boolean {
  const key = monthDay(date)
  if (!key) return false
  const today = new Date(now)
  switch (when) {
    case 'today': return key === md(today)
    case 'week': {
      for (let i = 0; i < 7; i++) if (key === md(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i))) return true
      return false
    }
    case 'month': return key.startsWith(p2(today.getMonth() + 1))
    case 'next-month': return key.startsWith(p2(((today.getMonth() + 1) % 12) + 1))
  }
}

export interface MatchCtx {
  now: number
  stats: Map<string, CustomerStats>
  settings: CrmSettings
}

/** Builds what rules need: everyone's figures and the shop's tiers. Build it once and reuse it for every customer. */
export const matchCtx = (state: DataState, now: number, stats = statsByCustomer(state)): MatchCtx => ({ now, stats, settings: settingsOf(state) })

/** Whether one customer meets one rule. */
export function matchesRule(c: Customer, rule: SegmentRule, m: MatchCtx): boolean {
  const s = statsOf(m.stats, c.id)
  switch (rule.kind) {
    case 'spend': {
      const v = spendIn(s, m.now, rule.days)
      return (rule.min === undefined || v >= rule.min) && (rule.max === undefined || v <= rule.max)
    }
    case 'orders': {
      const v = ordersIn(s, m.now, rule.days)
      return (rule.min === undefined || v >= rule.min) && (rule.max === undefined || v <= rule.max)
    }
    case 'recency': {
      const d = daysSinceLast(s, m.now)
      return d !== null && (rule.minDays === undefined || d >= rule.minDays) && (rule.maxDays === undefined || d <= rule.maxDays)
    }
    case 'never': return s.orders === 0
    case 'birthday': return dateFalls(c.dob, rule.when, m.now)
    case 'anniversary': return dateFalls(c.anniversary, rule.when, m.now)
    case 'tag': {
      const has = (c.tags ?? []).some((t) => t.toLowerCase() === rule.tag.trim().toLowerCase())
      return rule.not ? !has : has
    }
    case 'points': return (c.loyaltyPoints ?? 0) >= rule.min
    case 'dues': return ((c as { dueBalance?: number }).dueBalance ?? 0) >= rule.min
    case 'joined': return c.createdAt >= m.now - rule.withinDays * DAY
    case 'tier': return membershipOf(s, m.now, m.settings).tier?.name.toLowerCase() === rule.tier.trim().toLowerCase()
  }
}

/** A segment's rules and how they combine. A segment with no rules matches everyone. */
export interface SegmentDef { match: 'all' | 'any'; rules: SegmentRule[] }

export function matchesSegment(c: Customer, seg: SegmentDef, m: MatchCtx): boolean {
  if (!seg.rules.length) return true
  return seg.match === 'all' ? seg.rules.every((r) => matchesRule(c, r, m)) : seg.rules.some((r) => matchesRule(c, r, m))
}

/** The customers in a segment, biggest spenders first. */
export function segmentMembers(state: DataState, seg: SegmentDef, now: number, m: MatchCtx = matchCtx(state, now)): Customer[] {
  return listOf(state.customers)
    .filter((c) => matchesSegment(c, seg, m))
    .sort((a, b) => statsOf(m.stats, b.id).spend - statsOf(m.stats, a.id).spend || a.name.localeCompare(b.name))
}

// ───────────────────────────── ready-made segments ─────────────────────────────

export interface PresetSegment extends SegmentDef { id: string; name: string; note: string }

/** Segments every shop wants, ready to use. They are code, not documents, so they are the same on every phone. */
export const PRESET_SEGMENTS: PresetSegment[] = [
  { id: 'preset:lapsed', name: 'Lapsed customers', note: 'Bought before, but not in the last 90 days', match: 'all', rules: [{ kind: 'recency', minDays: 90 }] },
  { id: 'preset:high-value', name: 'High value', note: 'Spent ₹10,000 or more in the last year', match: 'all', rules: [{ kind: 'spend', min: 10_000, days: 365 }] },
  { id: 'preset:frequent', name: 'Frequent buyers', note: '4 or more purchases in the last 90 days', match: 'all', rules: [{ kind: 'orders', min: 4, days: 90 }] },
  { id: 'preset:birthday-month', name: 'Birthday this month', note: 'Birthday falls in the current month', match: 'all', rules: [{ kind: 'birthday', when: 'month' }] },
  { id: 'preset:birthday-week', name: 'Birthday this week', note: 'Birthday in the next 7 days', match: 'all', rules: [{ kind: 'birthday', when: 'week' }] },
  { id: 'preset:anniversary-month', name: 'Anniversary this month', note: 'Anniversary falls in the current month', match: 'all', rules: [{ kind: 'anniversary', when: 'month' }] },
  { id: 'preset:new', name: 'New this month', note: 'Joined in the last 30 days', match: 'all', rules: [{ kind: 'joined', withinDays: 30 }] },
  { id: 'preset:never', name: 'Never bought', note: 'In the book but no purchase yet', match: 'all', rules: [{ kind: 'never' }] },
  { id: 'preset:dues', name: 'Owe money', note: 'Have something outstanding on account', match: 'all', rules: [{ kind: 'dues', min: 1 }] },
]

export const ALL_CUSTOMERS = 'all'

export interface ResolvedAudience { id: string; name: string; def: SegmentDef }

/** Finds the segment a campaign or screen names: everyone, a ready-made one, or a saved one. Null when it no longer exists. */
export function resolveAudience(state: Pick<DataState, 'crmSegments'>, ref: string): ResolvedAudience | null {
  if (ref === ALL_CUSTOMERS) return { id: ref, name: 'All customers', def: { match: 'all', rules: [] } }
  const preset = PRESET_SEGMENTS.find((p) => p.id === ref)
  if (preset) return { id: preset.id, name: preset.name, def: preset }
  const seg = state.crmSegments?.[ref]
  return seg ? { id: seg.id, name: seg.name, def: seg } : null
}

// ───────────────────────────── words ─────────────────────────────

const WHEN: Record<DatePeriod, string> = { today: 'today', week: 'in the next 7 days', month: 'this month', 'next-month': 'next month' }

/** A rule in plain words, for the list under a segment's name. */
export function describeRule(r: SegmentRule): string {
  const span = (days?: number) => (days ? ` in the last ${days} days` : '')
  const range = (min: number | undefined, max: number | undefined, fmt: (n: number) => string) =>
    min !== undefined && max !== undefined ? `${fmt(min)} to ${fmt(max)}` : min !== undefined ? `${fmt(min)} or more` : max !== undefined ? `${fmt(max)} or less` : 'any amount'
  switch (r.kind) {
    case 'spend': return `Spent ${range(r.min, r.max, (n) => inr(n, 0))}${span(r.days)}`
    case 'orders': return `${range(r.min, r.max, String)} purchase${(r.min ?? r.max) === 1 ? '' : 's'}${span(r.days)}`
    case 'recency': return r.minDays !== undefined && r.maxDays !== undefined ? `Last bought ${r.minDays}–${r.maxDays} days ago` : r.minDays !== undefined ? `Not bought for ${r.minDays} days or more` : `Bought in the last ${r.maxDays ?? 0} days`
    case 'never': return 'Has never bought'
    case 'birthday': return `Birthday ${WHEN[r.when]}`
    case 'anniversary': return `Anniversary ${WHEN[r.when]}`
    case 'tag': return r.not ? `Not in group “${r.tag}”` : `In group “${r.tag}”`
    case 'points': return `${r.min} loyalty points or more`
    case 'dues': return `Owes ${inr(r.min, 0)} or more`
    case 'joined': return `Joined in the last ${r.withinDays} days`
    case 'tier': return `Membership tier ${r.tier}`
  }
}

export const describeSegment = (seg: SegmentDef): string => (seg.rules.length ? seg.rules.map(describeRule).join(seg.match === 'all' ? ' and ' : ' or ') : 'Everyone')

/** Problems with a segment a person is about to save, in plain words; null when it is fine. */
export function segmentProblem(name: string, rules: SegmentRule[]): string | null {
  if (!name.trim()) return 'Give the segment a name.'
  if (!rules.length) return 'Add at least one rule.'
  for (const r of rules) {
    if ((r.kind === 'spend' || r.kind === 'orders') && r.min !== undefined && r.max !== undefined && r.min > r.max) return 'A minimum cannot be more than its maximum.'
    if (r.kind === 'recency' && r.minDays === undefined && r.maxDays === undefined) return 'Say how many days for the “last bought” rule.'
    if (r.kind === 'recency' && r.minDays !== undefined && r.maxDays !== undefined && r.minDays > r.maxDays) return 'The days to are before the days from.'
    if (r.kind === 'tag' && !r.tag.trim()) return 'Type the group name for the group rule.'
    if (r.kind === 'tier' && !r.tier.trim()) return 'Choose a tier.'
    if (r.kind === 'joined' && !(r.withinDays > 0)) return 'Say how many days for the “joined” rule.'
  }
  return null
}

/** A segment saved on this phone, as the def the matching code takes. */
export const defOf = (seg: CustomerSegment): SegmentDef => ({ match: seg.match, rules: seg.rules })
