import type { DataState } from '@/data/state'
import { overdueSummary } from './logic'

let memo: { key: unknown[]; day: number; value: { customers: number; amount: number } } | null = null

/**
 * Who is overdue and for how much. Home notices and feature badges ask on every change, and the figure walks every bill, so it is
 * worked out again only when the documents it reads (or the day) have changed.
 */
export function overdueNow(s: DataState, now: number) {
  const key = [s.bills, s.collections, s.customerTerms, s.creditSettings]
  const day = Math.floor(now / 86_400_000)
  if (memo && memo.day === day && memo.key.every((k, i) => k === key[i])) return memo.value
  const value = overdueSummary(s, now)
  memo = { key, day, value }
  return value
}
