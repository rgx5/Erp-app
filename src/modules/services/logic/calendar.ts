import { listOf, type DataState } from '@/data/state'
import { startOfDay } from '@/domain/dates'
import type { Appointment, ServiceResource, ServiceSettings } from '../types'
import { settingsOf } from './settings'
import { addDays, at, sameDay, toMin, weekStart, ymd } from './time'

/** Appointments that hold a place in the calendar. A cancelled or no-show booking frees its time. */
export const HOLDS_TIME: Appointment['status'][] = ['booked', 'confirmed', 'arrived', 'in_service', 'completed']
export const holdsTime = (a: Pick<Appointment, 'status'>) => HOLDS_TIME.includes(a.status)

export const activeResources = (state: DataState): ServiceResource[] =>
  listOf(state.serviceResources ?? {}).filter((r) => r.active).sort((a, b) => a.name.localeCompare(b.name))

/** When a column works on a day: its own hours if it has them, else the shop's. Null on a day off. */
export function workWindow(settings: ServiceSettings, res: ServiceResource | undefined, day: number): { open: number; close: number } | null {
  const dow = new Date(day).getDay()
  const days = res?.workDays?.length ? res.workDays : settings.workDays
  if (!days.includes(dow)) return null
  if (res?.daysOff?.includes(ymd(day))) return null
  const open = at(day, res?.openTime || settings.openTime)
  const close = at(day, res?.closeTime || settings.closeTime)
  return close > open ? { open, close } : null
}

/** Cleaning-up time kept free after a booking: the longest of its services'. */
export function bufferOf(state: DataState, a: Pick<Appointment, 'services'>): number {
  let b = 0
  for (const s of a.services) b = Math.max(b, state.serviceItems?.[`si_${s.variantId}`]?.bufferMin ?? 0)
  return b
}

/** The service record for an item (its id is derived from the variant's, so two phones never make two). */
export const serviceItemId = (variantId: string) => `si_${variantId}`
export const durationOf = (state: DataState, variantId: string): number => state.serviceItems?.[serviceItemId(variantId)]?.durationMin ?? 30

/** Bookings that overlap [start, end) on a column (the ones already there keep their cleaning-up time). */
export function conflicts(state: DataState, resourceId: string, start: number, end: number, ignoreId?: string): Appointment[] {
  return listOf(state.appointments ?? {}).filter((a) => a.resourceId === resourceId && a.id !== ignoreId && holdsTime(a) && a.start < end && start < a.end + bufferOf(state, a) * 60_000)
}

/** Why a column cannot take this booking, or null when it can. */
export function bookingProblem(state: DataState, resourceId: string, start: number, end: number, opts: { ignoreId?: string; allowOutsideHours?: boolean } = {}): string | null {
  const res = state.serviceResources?.[resourceId]
  if (!res || !res.active) return 'Choose who or what the booking is for.'
  const w = workWindow(settingsOf(state), res, start)
  if (!w) return `${res.name} is not working that day.`
  if (!opts.allowOutsideHours && (start < w.open || end > w.close)) return `${res.name} works only between those hours on that day.`
  const clash = conflicts(state, resourceId, start, end, opts.ignoreId)
  if (clash.length) return `${res.name} already has ${clash[0].partyName || 'a booking'} at that time.`
  return null
}

/** Start times a column is free for a booking of `minutes` (+ cleaning-up time), stepping by the shop's slot size. */
export function freeSlots(state: DataState, resourceId: string, day: number, minutes: number, now: number, opts: { bufferMin?: number; ignoreId?: string } = {}): number[] {
  const res = state.serviceResources?.[resourceId]
  const settings = settingsOf(state)
  const w = workWindow(settings, res, day)
  if (!res || !w || !(minutes > 0)) return []
  const out: number[] = []
  const step = settings.slotMinutes * 60_000
  for (let s = w.open; s + minutes * 60_000 <= w.close; s += step) {
    if (s < now) continue
    if (!conflicts(state, resourceId, s, s + minutes * 60_000 + (opts.bufferMin ?? 0) * 60_000, opts.ignoreId).length) out.push(s)
  }
  return out
}

/** Columns that can do all of these items. */
export const canDo = (r: ServiceResource, variantIds: string[]) => !r.variantIds.length || variantIds.every((v) => r.variantIds.includes(v))

export interface DayColumn { resource: ServiceResource | null; window: { open: number; close: number } | null; appointments: Appointment[] }
export interface DayBoard { day: number; columns: DayColumn[]; total: number; open: number; start: number; end: number }

const hourFloor = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime() }
const hourCeil = (ms: number) => { const f = hourFloor(ms); return f === ms ? ms : f + 3_600_000 }

/** One day, a column for every staff member / resource (and one for bookings whose column has since been removed). */
export function dayBoard(state: DataState, day: number): DayBoard {
  const d = startOfDay(day)
  const settings = settingsOf(state)
  const todays = listOf(state.appointments ?? {}).filter((a) => sameDay(a.start, d) && a.status !== 'cancelled').sort((a, b) => a.start - b.start)
  const cols: DayColumn[] = activeResources(state).map((r) => ({ resource: r, window: workWindow(settings, r, d), appointments: todays.filter((a) => a.resourceId === r.id) }))
  const known = new Set(cols.map((c) => c.resource!.id))
  const orphans = todays.filter((a) => !known.has(a.resourceId))
  if (orphans.length) cols.push({ resource: null, window: null, appointments: orphans })
  // The visible hours: the earliest opening to the latest closing of any column (or any booking outside them).
  let start = at(d, settings.openTime), end = at(d, settings.closeTime)
  for (const c of cols) {
    if (c.window) { start = Math.min(start, c.window.open); end = Math.max(end, c.window.close) }
    for (const a of c.appointments) { start = Math.min(start, a.start); end = Math.max(end, a.end) }
  }
  return { day: d, columns: cols, total: todays.length, open: todays.filter((a) => a.status === 'booked' || a.status === 'confirmed').length, start: hourFloor(start), end: hourCeil(end) }
}

export interface WeekDay { day: number; working: boolean; appointments: Appointment[]; bookedMinutes: number; availableMinutes: number }

/** Seven days from Monday, for one column or for everybody. */
export function weekBoard(state: DataState, anyDay: number, resourceId?: string | null): WeekDay[] {
  const settings = settingsOf(state)
  const start = weekStart(anyDay)
  const cols = resourceId ? [state.serviceResources?.[resourceId]].filter(Boolean) as ServiceResource[] : activeResources(state)
  const all = listOf(state.appointments ?? {}).filter((a) => holdsTime(a) && (!resourceId || a.resourceId === resourceId))
  const out: WeekDay[] = []
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i)
    const appts = all.filter((a) => sameDay(a.start, day)).sort((a, b) => a.start - b.start)
    let avail = 0
    for (const c of cols) { const w = workWindow(settings, c, day); if (w) avail += (w.close - w.open) / 60_000 }
    out.push({ day, working: avail > 0, appointments: appts, bookedMinutes: appts.reduce((s, a) => s + (a.end - a.start) / 60_000, 0), availableMinutes: avail })
  }
  return out
}

/** Booked time as a share of working time, per column, over a range. */
export function utilisation(state: DataState, from: number, to: number): Array<{ resource: ServiceResource; booked: number; available: number; pct: number; appointments: number; noShows: number }> {
  const settings = settingsOf(state)
  const appts = listOf(state.appointments ?? {}).filter((a) => a.start >= from && a.start <= to)
  return activeResources(state).map((r) => {
    let available = 0
    for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) { const w = workWindow(settings, r, d); if (w) available += (w.close - w.open) / 60_000 }
    const mine = appts.filter((a) => a.resourceId === r.id)
    const booked = mine.filter(holdsTime).reduce((s, a) => s + (a.end - a.start) / 60_000, 0)
    return { resource: r, booked, available, pct: available ? Math.min(100, Math.round((booked / available) * 100)) : 0, appointments: mine.filter(holdsTime).length, noShows: mine.filter((a) => a.status === 'no_show').length }
  })
}

/** Pixel layout of a booking inside a day column. */
export function blockBox(a: Pick<Appointment, 'start' | 'end'>, dayStart: number, pxPerMin: number): { top: number; height: number } {
  return { top: Math.max(0, ((a.start - dayStart) / 60_000) * pxPerMin), height: Math.max(22, ((a.end - a.start) / 60_000) * pxPerMin) }
}

export { toMin }
