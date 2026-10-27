import type { DataState } from '@/data/state'
import type { ServiceSettings } from '../types'
import { isHhmm, toMin } from './time'

export const DEFAULT_SERVICE_SETTINGS: ServiceSettings = {
  id: 'services', openTime: '09:00', closeTime: '20:00', workDays: [1, 2, 3, 4, 5, 6], slotMinutes: 15, reminderLeadHours: 24, maxNoShows: 3,
  reminderNote: '', defaultHourlyRate: 0,
}

/** The shop's settings with defaults filled in. */
export function settingsOf(state: Pick<DataState, 'serviceSettings'>): ServiceSettings {
  return { ...DEFAULT_SERVICE_SETTINGS, ...(state.serviceSettings?.services ?? {}), id: 'services' }
}

/** What is wrong with these settings, in a sentence, or null. */
export function settingsProblem(s: ServiceSettings): string | null {
  if (!isHhmm(s.openTime) || !isHhmm(s.closeTime)) return 'Opening and closing times look like 09:00 and 20:00.'
  if (toMin(s.closeTime) <= toMin(s.openTime)) return 'Closing time must be after opening time.'
  if (!s.workDays.length || s.workDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Choose the days you are open.'
  if (!Number.isInteger(s.slotMinutes) || s.slotMinutes < 5 || s.slotMinutes > 120) return 'Time slots are between 5 and 120 minutes.'
  if (!Number.isInteger(s.reminderLeadHours) || s.reminderLeadHours < 1 || s.reminderLeadHours > 168) return 'Reminders go out 1 to 168 hours before.'
  if (!Number.isInteger(s.maxNoShows) || s.maxNoShows < 0 || s.maxNoShows > 50) return 'No-show limit is between 0 and 50.'
  if (!(s.defaultHourlyRate >= 0)) return 'The hourly rate cannot be negative.'
  return null
}
