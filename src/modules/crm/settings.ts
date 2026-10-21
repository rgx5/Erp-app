import type { DataState } from '@/data/state'
import type { CrmSettings, MembershipTier } from './types'

export const DEFAULT_TIERS: MembershipTier[] = [
  { name: 'Member', minSpend: 0, perk: '' },
  { name: 'Silver', minSpend: 10_000, perk: '' },
  { name: 'Gold', minSpend: 50_000, perk: '' },
  { name: 'Platinum', minSpend: 100_000, perk: '' },
]

export const DEFAULT_SETTINGS: CrmSettings = {
  id: 'crm',
  slaHours: { high: 24, normal: 72, low: 168 },
  warrantyMonths: 12,
  tiers: DEFAULT_TIERS,
  tierWindowDays: 365,
  referrerCredit: 100,
  referrerPoints: 0,
  refereeCredit: 50,
  referralMinBill: 500,
}

/** The shop's settings, with the defaults filling anything not set yet. */
export const settingsOf = (state: Pick<DataState, 'crmSettings'>): CrmSettings => {
  const cur = state.crmSettings?.crm
  return cur ? { ...DEFAULT_SETTINGS, ...cur, slaHours: { ...DEFAULT_SETTINGS.slaHours, ...cur.slaHours }, tiers: cur.tiers?.length ? cur.tiers : DEFAULT_TIERS, id: 'crm' } : DEFAULT_SETTINGS
}
