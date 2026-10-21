import { round2 } from '@/domain/money'
import type { Customer } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import { settingsOf } from './settings'
import { statsByCustomer, statsOf } from './stats'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A code the customer can quote: three letters of their name and three random characters ("MEE4K7"). Never one already taken. */
export function makeReferralCode(name: string, taken: Set<string>, rnd: () => number = Math.random): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X')
  for (;;) {
    let tail = ''
    for (let i = 0; i < 3; i++) tail += ALPHABET[Math.floor(rnd() * ALPHABET.length)]
    const code = letters + tail
    if (!taken.has(code)) return code
  }
}

export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

export const customerByCode = (state: Pick<DataState, 'customers'>, code: string): Customer | null => {
  const k = normalizeCode(code)
  return k ? listOf(state.customers).find((c) => c.referralCode && normalizeCode(c.referralCode) === k) ?? null : null
}

/** The id of the reward for a referred customer. It is built from theirs, so a second reward for them cannot exist. */
export const rewardIdFor = (referredId: string) => `rw_${referredId}`

export interface ReferralRow {
  referrer: Customer
  referred: Customer
  /** What the referred customer has spent so far. */
  spend: number
  rewarded: boolean
  /** Bought enough to earn the reward, which has not been given. */
  ready: boolean
}

export function referralRows(state: DataState): ReferralRow[] {
  const cfg = settingsOf(state)
  const stats = statsByCustomer(state)
  const out: ReferralRow[] = []
  for (const referred of listOf(state.customers)) {
    const referrer = referred.referredBy ? state.customers[referred.referredBy] : undefined
    if (!referrer) continue
    const spend = round2(statsOf(stats, referred.id).spend)
    const rewarded = !!state.referralRewards?.[rewardIdFor(referred.id)]
    out.push({ referrer, referred, spend, rewarded, ready: !rewarded && spend >= cfg.referralMinBill && spend > 0 })
  }
  return out.sort((a, b) => Number(b.ready) - Number(a.ready) || a.referred.name.localeCompare(b.referred.name))
}

/** Top referrers: who brought in the most customers. */
export function topReferrers(rows: ReferralRow[]): Array<{ referrer: Customer; count: number; rewarded: number }> {
  const m = new Map<string, { referrer: Customer; count: number; rewarded: number }>()
  for (const r of rows) {
    const e = m.get(r.referrer.id) ?? { referrer: r.referrer, count: 0, rewarded: 0 }
    e.count += 1
    if (r.rewarded) e.rewarded += 1
    m.set(r.referrer.id, e)
  }
  return [...m.values()].sort((a, b) => b.count - a.count)
}

export function referralInvite(shop: string, referrerName: string, code: string, friendCredit: number): string {
  return `${referrerName} thinks you will like ${shop}! Quote the code ${code} on your first visit${friendCredit > 0 ? ` and get ₹${friendCredit} store credit` : ''}.`
}
