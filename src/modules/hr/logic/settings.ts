import type { DataState } from '@/data/state'
import type { HrSettings } from '../types'

/**
 * Statutory rates and company rules as they stood when this was written (India, new tax regime, FY 2025-26). They are
 * starting points the owner or an accountant confirms and changes in Payroll settings — not legal or tax advice.
 */
export const DEFAULT_HR_SETTINGS: HrSettings = {
  id: 'hr',
  pfEmployeePct: 12,
  pfEmployerPct: 12,
  pfWageCeiling: 15000,
  pfCap: true,
  pfBasis: 'basic',
  esiEmployeePct: 0.75,
  esiEmployerPct: 3.25,
  esiWageCeiling: 21000,
  // Professional tax differs by state; this is a common shape (nothing up to ₹10,000 a month, ₹200 above).
  ptSlabs: [{ upTo: 10000, amount: 0 }, { upTo: null, amount: 200 }],
  tdsSlabs: [
    { upTo: 400000, ratePct: 0 }, { upTo: 800000, ratePct: 5 }, { upTo: 1200000, ratePct: 10 }, { upTo: 1600000, ratePct: 15 },
    { upTo: 2000000, ratePct: 20 }, { upTo: 2400000, ratePct: 25 }, { upTo: null, ratePct: 30 },
  ],
  tdsStandardDeduction: 75000,
  tdsRebateLimit: 1200000,
  tdsCessPct: 4,
  daysBasis: 'calendar',
  payWeekoffForDaily: false,
  overtimeMultiplier: 2,
  overtimeMinMins: 30,
  workDayMins: 480,
  roundNet: true,
  leaveYearStartMonth: 1,
  weeklyOffDefault: [0],
  geoNote: '',
  requireGeoNote: false,
  payDay: 7,
}

/** The saved settings over the defaults (a setting added later still has a value on an older workspace). */
export function hrSettings(state: Pick<DataState, 'hrSettings'>): HrSettings {
  const saved = state.hrSettings?.hr
  return saved ? { ...DEFAULT_HR_SETTINGS, ...saved, id: 'hr' } : DEFAULT_HR_SETTINGS
}

/** What is wrong with a set of settings, in a sentence — or null. */
export function settingsProblem(s: HrSettings): string | null {
  const pct = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100
  if (![s.pfEmployeePct, s.pfEmployerPct, s.esiEmployeePct, s.esiEmployerPct, s.tdsCessPct].every(pct)) return 'Rates are percentages between 0 and 100.'
  if (![s.pfWageCeiling, s.esiWageCeiling, s.tdsStandardDeduction, s.tdsRebateLimit].every((n) => Number.isFinite(n) && n >= 0)) return 'Limits cannot be negative.'
  for (const [name, slabs] of [['Professional tax', s.ptSlabs], ['Income tax', s.tdsSlabs]] as const) {
    let last = -1
    for (const [i, sl] of slabs.entries()) {
      if (sl.upTo === null) { if (i !== slabs.length - 1) return `${name}: only the last slab can have no upper limit.`; continue }
      if (!(sl.upTo > last)) return `${name}: each slab must go higher than the one before.`
      last = sl.upTo
    }
    if (slabs.length && slabs[slabs.length - 1].upTo !== null) return `${name}: the last slab must have no upper limit.`
  }
  if (!(s.overtimeMultiplier >= 1 && s.overtimeMultiplier <= 5)) return 'Overtime is paid at 1× to 5× the normal rate.'
  if (!(s.workDayMins >= 60 && s.workDayMins <= 1440)) return 'A working day is between 1 and 24 hours.'
  if (!Number.isInteger(s.leaveYearStartMonth) || s.leaveYearStartMonth < 1 || s.leaveYearStartMonth > 12) return 'The leave year starts in a month from 1 to 12.'
  if (!Number.isInteger(s.payDay) || s.payDay < 1 || s.payDay > 28) return 'Salary day is a day from 1 to 28.'
  if (s.weeklyOffDefault.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Weekly off days are Sunday to Saturday.'
  return null
}
