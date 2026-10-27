import { startOfDay } from '@/domain/dates'
import type { Hhmm } from '../types'

const p2 = (n: number) => String(n).padStart(2, '0')

/** Minutes after midnight for 'HH:MM'. NaN when it is not a time. */
export function toMin(t: Hhmm): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
  if (!m) return NaN
  const h = Number(m[1]), mi = Number(m[2])
  return h > 23 || mi > 59 ? NaN : h * 60 + mi
}
export const isHhmm = (t: unknown): t is Hhmm => typeof t === 'string' && !Number.isNaN(toMin(t))
export const fromMin = (m: number): Hhmm => `${p2(Math.floor(m / 60) % 24)}:${p2(m % 60)}`

/** The moment 'HH:MM' on the day that contains `day` (local time). */
export function at(day: number, t: Hhmm): number {
  const d = new Date(day)
  const m = toMin(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60).getTime()
}
export const hhmmOf = (ms: number): Hhmm => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}` }

export function addDays(day: number, n: number): number {
  const d = new Date(day)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}
/** Monday of the week that contains `day`. */
export function weekStart(day: number): number {
  const d = new Date(startOfDay(day))
  const back = (d.getDay() + 6) % 7
  return addDays(d.getTime(), -back)
}
export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b)
/** 'YYYY-MM-DD' of a moment (local). */
export const ymd = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }
export const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export const minutesLabel = (m: number) => {
  const h = Math.floor(m / 60), r = Math.round(m % 60)
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`
}
/** 'HH:MM' style hours for a timesheet: 90 → "1:30". */
export const hoursLabel = (m: number) => `${Math.floor(m / 60)}:${p2(Math.round(m % 60))}`
