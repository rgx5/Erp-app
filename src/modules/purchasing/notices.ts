import type { DataState } from '@/data/state'
import { awaitingApproval } from './approvals'
import { itcClosingSoon } from './itc'
import { dueSummary, type DueSummary } from './payables'

let memo: { key: unknown[]; day: number; value: DueSummary } | null = null

/**
 * What is overdue to suppliers and what falls due within the warning window. Home notices ask on every change and the figure
 * walks every receipt, so it is worked out again only when the documents it reads (or the day) have changed.
 */
export function dueNow(s: DataState, now: number): DueSummary {
  const key = [s.purchases, s.purchaseInvoices, s.supplierPayments, s.purchaseReturns, s.landedCosts, s.supplierTerms, s.purchaseSettings, s.suppliers]
  const day = Math.floor(now / 86_400_000)
  if (memo && memo.day === day && memo.key.every((k, i) => k === key[i])) return memo.value
  const value = dueSummary(s, now)
  memo = { key, day, value }
  return value
}

export const approvalsWaiting = (s: DataState) => awaitingApproval(s).length
export const itcExpiring = (s: DataState, now: number) => itcClosingSoon(s, now, 30).length
