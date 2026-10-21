import type { YM, YMD } from '../types'

/**
 * Calendar arithmetic on `YYYY-MM-DD` text. Everything is done in UTC on the date parts, so a day is a day wherever the phone
 * is and a payroll month never gains or loses a day to a time zone.
 */

const p2 = (n: number) => String(n).padStart(2, '0')
const DAY_MS = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const isYMD = (s: unknown): s is YMD => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromDays(toDays(s)) === s
export const isYM = (s: unknown): s is YM => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

/** Days since 1970-01-01. */
export const toDays = (s: YMD): number => {
  const [y, m, d] = s.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}
export const fromDays = (n: number): YMD => {
  const d = new Date(n * DAY_MS)
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
}
export const addDays = (s: YMD, n: number): YMD => fromDays(toDays(s) + n)
export const diffDays = (a: YMD, b: YMD): number => toDays(b) - toDays(a)
/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (s: YMD): number => (((toDays(s) + 4) % 7) + 7) % 7

export const monthOf = (s: YMD): YM => s.slice(0, 7)
export const daysInMonth = (ym: YM): number => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
export const firstOf = (ym: YM): YMD => `${ym}-01`
export const lastOf = (ym: YM): YMD => `${ym}-${p2(daysInMonth(ym))}`
export const addMonths = (ym: YM, n: number): YM => {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${p2((t % 12) + 1)}`
}
export const monthIndex = (ym: YM): number => { const [y, m] = ym.split('-').map(Number); return y * 12 + (m - 1) }

/** Every day from `from` to `to` inclusive (at most `cap`, a guard against a typo like year 2062). */
export function eachDay(from: YMD, to: YMD, cap = 800): YMD[] {
  const out: YMD[] = []
  for (let n = toDays(from), end = toDays(to); n <= end && out.length < cap; n++) out.push(fromDays(n))
  return out
}
export const monthDays = (ym: YM): YMD[] => eachDay(firstOf(ym), lastOf(ym))

export const labelYM = (ym: YM): string => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}` }
export const labelYMD = (s: YMD): string => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]}${y === new Date().getFullYear() ? '' : ` ${y}`}` }
export const labelDayWeek = (s: YMD): string => `${WEEKDAYS[weekdayOf(s)]} ${labelYMD(s)}`

/** The local calendar day of a moment, as typed text. */
export const ymdOf = (ms: number): YMD => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }
export const ymOf = (ms: number): YM => ymdOf(ms).slice(0, 7)

/** A local moment from a day and a clock time ("09:30"). */
export function atTime(date: YMD, hhmm: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  return new Date(y, m - 1, d, h || 0, mi || 0, 0, 0).getTime()
}
export const isClock = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
export const clockOf = (ms: number): string => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}` }
export const clockMins = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

/** Local start / end (inclusive) of a month, in milliseconds — for matching bills. */
export function monthBounds(ym: YM): [number, number] {
  const [y, m] = ym.split('-').map(Number)
  return [new Date(y, m - 1, 1, 0, 0, 0, 0).getTime(), new Date(y, m, 0, 23, 59, 59, 999).getTime()]
}
