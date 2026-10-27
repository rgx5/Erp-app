import { listOf, type DataState } from '@/data/state'
import { DAY, endOfDay, fmtDate, startOfDay } from '@/domain/dates'
import { round2 } from '@/domain/money'
import type { CustomerPackage, PackagePlan, PackageStatus, PackageUse } from '../types'

/** The price without GST, and the GST inside it. */
export function splitPrice(price: number, gstRate: number): { taxable: number; tax: number } {
  const taxable = round2((price * 100) / (100 + Math.max(0, gstRate)))
  return { taxable, tax: round2(price - taxable) }
}

export const expiryOf = (plan: Pick<PackagePlan, 'validityDays'>, soldAt: number): number | undefined =>
  plan.validityDays > 0 ? soldAt + plan.validityDays * DAY : undefined

type Shares = Pick<CustomerPackage, 'sessions' | 'taxable' | 'price'>
/** The revenue (GST excluded) that `n` sessions of the package have earned in all. The last session takes whatever paisa is left, so the total is exact. */
export const earnedAfter = (p: Shares, n: number): number => (n <= 0 ? 0 : n >= p.sessions ? p.taxable : round2((p.taxable * n) / p.sessions))
/** The GST that belongs to `recognised` of revenue. */
export const taxAt = (p: Pick<CustomerPackage, 'taxable' | 'price'>, recognised: number): number => (p.taxable > 0 ? round2(((p.price - p.taxable) * recognised) / p.taxable) : 0)

/** The revenue and GST released by using `by` more sessions now (negative `by` gives sessions back is not done here — a reversal repeats the original's figures). */
export function releaseFor(p: Pick<CustomerPackage, 'sessions' | 'sessionsUsed' | 'taxable' | 'price' | 'recognised'>, by: number): { value: number; tax: number } {
  const value = round2(earnedAfter(p, p.sessionsUsed + by) - p.recognised)
  return { value, tax: round2(taxAt(p, p.recognised + value) - taxAt(p, p.recognised)) }
}
/** What is left to earn when a package lapses: all the revenue and GST not yet released. */
export function lapseFor(p: Pick<CustomerPackage, 'taxable' | 'price' | 'recognised'>): { value: number; tax: number } {
  const value = round2(p.taxable - p.recognised)
  return { value, tax: round2(p.price - p.taxable - taxAt(p, p.recognised)) }
}

export const sessionsLeft = (p: Pick<CustomerPackage, 'sessions' | 'sessionsUsed'>) => Math.max(0, p.sessions - p.sessionsUsed)

/** Active, frozen, or expired (its date has passed). */
export function packageStatus(p: CustomerPackage, now: number): PackageStatus {
  if (p.status === 'frozen') return 'frozen'
  if (p.status === 'expired') return 'expired'
  return p.expiresAt !== undefined && now > endOfDay(p.expiresAt) && sessionsLeft(p) > 0 ? 'expired' : 'active'
}
export const STATUS_LABEL: Record<PackageStatus, string> = { active: 'Active', frozen: 'Frozen', expired: 'Expired' }

/** Can it pay for a session now? */
export const isUsable = (p: CustomerPackage, now: number) => packageStatus(p, now) === 'active' && sessionsLeft(p) > 0
export const covers = (p: Pick<CustomerPackage, 'variantIds'>, variantId?: string) => !p.variantIds.length || !variantId || p.variantIds.includes(variantId)

/** Why this package cannot pay for a session, or null. */
export function usageProblem(p: CustomerPackage, now: number, variantIds: string[] = []): string | null {
  const st = packageStatus(p, now)
  if (st === 'frozen') return `${p.name} is frozen.`
  if (st === 'expired') return `${p.name} expired on ${p.expiresAt ? fmtDate(p.expiresAt) : 'its date'}.`
  if (sessionsLeft(p) <= 0) return `${p.name} has no sessions left.`
  for (const v of variantIds) if (!covers(p, v)) return `${p.name} does not cover this service.`
  return null
}

export const packagesOf = (state: DataState, customerId: string): CustomerPackage[] =>
  listOf(state.customerPackages ?? {}).filter((p) => p.customerId === customerId).sort((a, b) => b.soldAt - a.soldAt)

/** The package to use for a visit: one that covers it and runs out first. */
export function bestPackage(state: DataState, customerId: string, now: number, variantIds: string[] = []): CustomerPackage | null {
  const ok = packagesOf(state, customerId).filter((p) => !usageProblem(p, now, variantIds))
  ok.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || a.soldAt - b.soldAt)
  return ok[0] ?? null
}

export interface CustomerBalance { sessions: number; value: number; packages: number; nextExpiry?: number }
/** What a customer still has coming: sessions, and what they are worth (money held for them). */
export function customerBalance(state: DataState, customerId: string, now: number): CustomerBalance {
  let sessions = 0, value = 0, packages = 0, nextExpiry: number | undefined
  for (const p of packagesOf(state, customerId)) {
    if (!isUsable(p, now) && packageStatus(p, now) !== 'frozen') continue
    if (sessionsLeft(p) <= 0) continue
    packages++; sessions += sessionsLeft(p); value += remainingValue(p)
    if (p.expiresAt !== undefined) nextExpiry = nextExpiry === undefined ? p.expiresAt : Math.min(nextExpiry, p.expiresAt)
  }
  return { sessions, value: round2(value), packages, ...(nextExpiry !== undefined ? { nextExpiry } : {}) }
}

/** Money received for sessions not yet used (GST included). */
export const remainingValue = (p: Pick<CustomerPackage, 'price' | 'taxable' | 'recognised'>): number => round2(Math.max(0, p.price - p.recognised - taxAt(p, p.recognised)))

/** Packages whose date is close: within `days`, with sessions left. */
export function expiringSoon(state: DataState, now: number, days = 14): CustomerPackage[] {
  return listOf(state.customerPackages ?? {}).filter((p) => p.status !== 'expired' && p.status !== 'frozen' && p.expiresAt !== undefined && sessionsLeft(p) > 0 && p.expiresAt >= startOfDay(now) && p.expiresAt <= now + days * DAY)
    .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0))
}

/** Packages that ran out of time with sessions unused and have not been written off. */
export function lapsed(state: DataState, now: number): CustomerPackage[] {
  return listOf(state.customerPackages ?? {}).filter((p) => p.status !== 'expired' && p.status !== 'frozen' && p.expiresAt !== undefined && now > endOfDay(p.expiresAt) && sessionsLeft(p) > 0)
}

export interface LiabilityRow { id: string; no: string; customerId: string; name: string; sold: number; price: number; used: number; sessions: number; deferred: number; expiresAt?: number; status: PackageStatus }
export interface Liability { rows: LiabilityRow[]; deferred: number; recognised: number; sold: number; sessionsOutstanding: number }

/** Deferred revenue: what has been taken for packages and not yet earned (GST included — it is released with each session). */
export function packageLiability(state: DataState, now: number): Liability {
  const rows: LiabilityRow[] = []
  let deferred = 0, recognised = 0, sold = 0, outstanding = 0
  for (const p of listOf(state.customerPackages ?? {})) {
    const d = p.status === 'expired' ? 0 : remainingValue(p)
    sold += p.price; recognised += p.recognised
    if (d > 0) {
      deferred += d; outstanding += sessionsLeft(p)
      rows.push({ id: p.id, no: p.no, customerId: p.customerId, name: p.name, sold: p.soldAt, price: p.price, used: p.sessionsUsed, sessions: p.sessions, deferred: d, ...(p.expiresAt !== undefined ? { expiresAt: p.expiresAt } : {}), status: packageStatus(p, now) })
    }
  }
  return { rows: rows.sort((a, b) => b.deferred - a.deferred), deferred: round2(deferred), recognised: round2(recognised), sold: round2(sold), sessionsOutstanding: outstanding }
}

/** The uses of one package, newest first. */
export const usesOf = (state: DataState, packageId: string): PackageUse[] =>
  listOf(state.packageUses ?? {}).filter((u) => u.customerPackageId === packageId).sort((a, b) => b.date - a.date)

/** A use that has not been given back. */
export function isReversible(state: DataState, u: PackageUse): boolean {
  return u.kind === 'use' && !state.packageUses?.[`rev_${u.id}`]
}

/** The words for a package: "Hair spa × 5". */
export const planLine = (p: Pick<PackagePlan, 'name' | 'sessions' | 'validityDays'>) => `${p.name} · ${p.sessions} session${p.sessions === 1 ? '' : 's'}${p.validityDays ? ` · ${p.validityDays} days` : ''}`

/** How many sessions of this customer's packages could be used now. */
export const usableCount = (state: DataState, customerId: string, now: number): number =>
  packagesOf(state, customerId).filter((p) => isUsable(p, now)).length

/** Packages that could pay for these services right now, soonest to lapse first. */
export const usableFor = (state: DataState, customerId: string, now: number, variantIds: string[] = []): CustomerPackage[] =>
  packagesOf(state, customerId).filter((p) => !usageProblem(p, now, variantIds)).sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity))

/** "3 of 5 left · till 12 Jan" */
export const packagePlanLabel = (p: Pick<CustomerPackage, 'sessions' | 'sessionsUsed' | 'expiresAt'>) =>
  `${sessionsLeft(p)} of ${p.sessions} left${p.expiresAt ? ` · till ${fmtDate(p.expiresAt)}` : ''}`
