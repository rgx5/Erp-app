import { DAY } from '@/domain/dates'
import { firstName } from '@/domain/people'
import type { Bill } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import type { Feedback } from './types'

export type NpsClass = 'promoter' | 'passive' | 'detractor'

/** 9–10 promote, 7–8 are passive, 0–6 detract. */
export const npsClass = (score: number): NpsClass => (score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor')

export interface NpsSummary {
  /** Feedback with a 0–10 score. */
  scored: number
  promoters: number
  passives: number
  detractors: number
  /** % promoters minus % detractors, −100 to 100. Null when nothing is scored. */
  score: number | null
  /** Average of the 1–5 ratings. Null when none. */
  avgRating: number | null
  rated: number
}

export function npsSummary(list: Feedback[]): NpsSummary {
  const scored = list.filter((f) => f.nps !== undefined)
  const rated = list.filter((f) => f.rating !== undefined)
  const count = (c: NpsClass) => scored.filter((f) => npsClass(f.nps as number) === c).length
  const promoters = count('promoter')
  const detractors = count('detractor')
  return {
    scored: scored.length, promoters, passives: scored.length - promoters - detractors, detractors,
    score: scored.length ? Math.round(((promoters - detractors) / scored.length) * 100) : null,
    avgRating: rated.length ? Math.round((rated.reduce((s, f) => s + (f.rating as number), 0) / rated.length) * 10) / 10 : null,
    rated: rated.length,
  }
}

/** A low score is a complaint waiting to happen: 1–2 stars, or 0–6 out of 10. */
export const isLowScore = (f: Pick<Feedback, 'rating' | 'nps'>) => (f.rating !== undefined && f.rating <= 2) || (f.nps !== undefined && f.nps <= 6)

export const feedbackList = (state: Pick<DataState, 'crmFeedback'>): Feedback[] => listOf(state.crmFeedback ?? {}).sort((a, b) => b.at - a.at)

/** Recent sales to a known customer that nobody has asked about yet, newest first. A bill from today is left a day to settle. */
export function awaitingFeedback(state: DataState, now: number, windowDays = 14): Bill[] {
  const asked = new Set(listOf(state.crmFeedback ?? {}).map((f) => f.billId).filter(Boolean))
  return listOf(state.bills)
    .filter((b) => b.customerId && b.status !== 'held' && !b.refundOfBillId && b.total > 0 && !asked.has(b.id) && b.date <= now - DAY / 2 && b.date >= now - windowDays * DAY)
    .sort((a, b) => b.date - a.date)
}

/** The message that asks for a rating. The customer replies and the shop records the answer. */
export function feedbackRequest(shop: string, customerName: string, billNo?: string): string {
  const who = firstName(customerName) || 'there'
  return `Hello ${who}, thank you for shopping with ${shop}${billNo ? ` (bill ${billNo})` : ''}. How was your experience? Please reply with a rating from 1 (poor) to 5 (excellent), and tell us anything we can do better.`
}
