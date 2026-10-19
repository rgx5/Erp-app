export const DAY = 86_400_000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const p2 = (n: number) => String(n).padStart(2, '0')

export const startOfDay = (d: Date | number = Date.now()) => new Date(new Date(d).setHours(0, 0, 0, 0)).getTime()
export const endOfDay = (d: Date | number = Date.now()) => new Date(new Date(d).setHours(23, 59, 59, 999)).getTime()

/** "19 Oct 2026" */
export function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${p2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
/** "19 Oct" */
export function fmtDayShort(ms: number): string {
  const d = new Date(ms)
  return `${p2(d.getDate())} ${MONTHS[d.getMonth()]}`
}
/** "6:42 pm" */
export function fmtTime(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 === 0 ? 12 : h % 12}:${p2(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`
}
/** "19 Oct, 6:42 pm" */
export const fmtDateTime = (ms: number) => `${fmtDayShort(ms)}, ${fmtTime(ms)}`
/** "Mon" */
export const fmtWeekdayShort = (ms: number) => WEEKDAYS_SHORT[new Date(ms).getDay()]
/** "Monday, 19 October 2026" */
export function fmtLongDate(ms: number): string {
  const d = new Date(ms)
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`
}
/** "October 2026" */
export function fmtMonth(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`
}

/** "Today" / "Yesterday" / "Mon, 12 Oct" — the sticky day headers in bill and expense lists. */
export function dayLabel(ms: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ms)) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return `${WEEKDAYS_SHORT[new Date(ms).getDay()]}, ${fmtDayShort(ms)}`
}

/** "2 min ago", "3 h ago", "5 d ago" — falls back to a date after a week. */
export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 8) return `${d} d ago`
  return fmtDate(ms)
}

export function greeting(now = Date.now()): string {
  const h = new Date(now).getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export type RangeKey = 'today' | '7d' | '30d' | 'month' | 'all'

export const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All' },
]

export function rangeBounds(key: RangeKey, now = Date.now()): [number, number] {
  switch (key) {
    case 'today': return [startOfDay(now), endOfDay(now)]
    case '7d': return [startOfDay(now - 6 * DAY), endOfDay(now)]
    case '30d': return [startOfDay(now - 29 * DAY), endOfDay(now)]
    case 'month': {
      const d = new Date(now)
      return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), endOfDay(now)]
    }
    default: return [0, endOfDay(now)]
  }
}

/** yyyy-mm-dd <-> timestamp (noon local, so a timezone shift never changes the day). */
export const toInputDate = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}
export const fromInputDate = (s: string) => new Date(s + 'T12:00:00').getTime()

/** "MM-DD" of a yyyy-mm-dd string, or '' — birthdays and anniversaries ignore the year. */
export const monthDay = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : '')
export const isThisMonth = (s: string, now = Date.now()) => monthDay(s).startsWith(p2(new Date(now).getMonth() + 1))
