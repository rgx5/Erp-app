import { listOf, type DataState } from '@/data/state'
import { fmtDate, fmtTime, startOfDay } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import type { Appointment, ApptStatus } from '../types'
import { holdsTime } from './calendar'
import { settingsOf } from './settings'

export const APPT_LABEL: Record<ApptStatus, string> = {
  booked: 'Booked', confirmed: 'Confirmed', arrived: 'Arrived', in_service: 'In service', completed: 'Done', cancelled: 'Cancelled', no_show: 'No-show',
}

/** Where a booking can go from each state. Done, cancelled and no-show are the ends (a wrong no-show can be put back to booked by a manager through `reopen`). */
export const APPT_FLOW: Record<ApptStatus, ApptStatus[]> = {
  booked: ['confirmed', 'arrived', 'cancelled', 'no_show'],
  confirmed: ['arrived', 'cancelled', 'no_show'],
  arrived: ['in_service', 'completed', 'cancelled'],
  in_service: ['completed'],
  completed: [],
  cancelled: [],
  no_show: ['booked'],
}
export const nextApptStatuses = (s: ApptStatus) => APPT_FLOW[s]
export const isOpenAppt = (a: Pick<Appointment, 'status'>) => a.status === 'booked' || a.status === 'confirmed' || a.status === 'arrived' || a.status === 'in_service'
export const canEditAppt = (a: Pick<Appointment, 'status'>) => a.status === 'booked' || a.status === 'confirmed'
export const apptTotal = (a: Pick<Appointment, 'services'>) => round2(a.services.reduce((s, x) => s + x.price, 0))
export const apptTitle = (a: Pick<Appointment, 'services'>) => a.services.map((s) => s.name).join(' + ') || 'Appointment'

/** How many times this person (by customer, else by mobile number) has not turned up. */
export function noShowCount(state: DataState, who: { customerId?: string | null; phone?: string }): number {
  const phone = (who.phone ?? '').replace(/\D/g, '').slice(-10)
  return listOf(state.appointments ?? {}).filter((a) => a.status === 'no_show' && ((who.customerId && a.customerId === who.customerId) || (phone.length === 10 && a.partyPhone.replace(/\D/g, '').slice(-10) === phone))).length
}

/** The sentence that stops a booking for someone who keeps not turning up, or null. */
export function noShowProblem(state: DataState, who: { customerId?: string | null; phone?: string; name?: string }): string | null {
  const max = settingsOf(state).maxNoShows
  if (!max) return null
  const n = noShowCount(state, who)
  return n >= max ? `${who.name || 'This customer'} has missed ${n} appointments. A manager must allow this booking.` : null
}

/** Who to send to: the wording of the reminder, and what the person pressing send needs. */
export function reminderText(state: DataState, a: Appointment, shop: string): string {
  const cfg = settingsOf(state)
  const res = state.serviceResources?.[a.resourceId]
  const first = (a.partyName || 'there').trim().split(/\s+/)[0]
  const when = `${fmtDate(a.start)} at ${fmtTime(a.start)}`
  const lines = [
    `Hello ${first}, this is a reminder from ${shop} for your appointment (${apptTitle(a)}) on ${when}${res ? ` with ${res.name}` : ''}.`,
    'Reply YES to confirm, or tell us if you need to change the time.',
  ]
  if (cfg.reminderNote.trim()) lines.push(cfg.reminderNote.trim())
  return lines.join('\n')
}

/** Confirmation text sent right after booking. */
export function confirmationText(state: DataState, a: Appointment, shop: string): string {
  const res = state.serviceResources?.[a.resourceId]
  const first = (a.partyName || 'there').trim().split(/\s+/)[0]
  return `Hello ${first}, your appointment at ${shop} is booked: ${apptTitle(a)} on ${fmtDate(a.start)} at ${fmtTime(a.start)}${res ? ` with ${res.name}` : ''}. Total ${inr(apptTotal(a), 0)}.${settingsOf(state).reminderNote.trim() ? `\n${settingsOf(state).reminderNote.trim()}` : ''}`
}

/** Text for someone who missed their slot. */
export function missedText(a: Appointment, shop: string): string {
  const first = (a.partyName || 'there').trim().split(/\s+/)[0]
  return `Hello ${first}, we missed you at ${shop} for ${apptTitle(a)} on ${fmtDate(a.start)} at ${fmtTime(a.start)}. Reply to book a new time.`
}

/** Bookings whose reminder is due: inside the lead time, still ahead, not yet sent. */
export function remindersDue(state: DataState, now: number): Appointment[] {
  const lead = settingsOf(state).reminderLeadHours * 3_600_000
  return listOf(state.appointments ?? {})
    .filter((a) => (a.status === 'booked' || a.status === 'confirmed') && !a.remindedAt && a.start > now && a.start - now <= lead && !!a.partyPhone)
    .sort((a, b) => a.start - b.start)
}

/** Booked slots that passed without anyone arriving: to be marked as no-shows (or done). */
export function overdueBookings(state: DataState, now: number, graceMin = 30): Appointment[] {
  return listOf(state.appointments ?? {}).filter((a) => (a.status === 'booked' || a.status === 'confirmed') && a.start + graceMin * 60_000 < now).sort((a, b) => a.start - b.start)
}

export interface DaySummary { total: number; booked: number; arrived: number; done: number; cancelled: number; noShows: number; expected: number; earned: number }
export function daySummary(state: DataState, day: number): DaySummary {
  const d = startOfDay(day)
  const list = listOf(state.appointments ?? {}).filter((a) => startOfDay(a.start) === d)
  const sum = (xs: Appointment[]) => round2(xs.reduce((s, a) => s + apptTotal(a), 0))
  return {
    total: list.filter(holdsTime).length, booked: list.filter((a) => a.status === 'booked' || a.status === 'confirmed').length, arrived: list.filter((a) => a.status === 'arrived' || a.status === 'in_service').length,
    done: list.filter((a) => a.status === 'completed').length, cancelled: list.filter((a) => a.status === 'cancelled').length, noShows: list.filter((a) => a.status === 'no_show').length,
    expected: sum(list.filter(isOpenAppt)), earned: sum(list.filter((a) => a.status === 'completed')),
  }
}

export interface NoShowRow { key: string; name: string; phone: string; customerId: string | null; count: number; last: number; of: number }
/** Everyone who has missed a booking, worst first. */
export function noShowReport(state: DataState, from: number, to: number): NoShowRow[] {
  const all = listOf(state.appointments ?? {}).filter((a) => a.start >= from && a.start <= to && a.status !== 'cancelled')
  const rows = new Map<string, NoShowRow>()
  for (const a of all) {
    const key = a.customerId ?? (a.partyPhone.replace(/\D/g, '').slice(-10) || a.partyName)
    const r = rows.get(key) ?? { key, name: a.partyName, phone: a.partyPhone, customerId: a.customerId, count: 0, last: 0, of: 0 }
    r.of++
    if (a.status === 'no_show') { r.count++; r.last = Math.max(r.last, a.start) }
    rows.set(key, r)
  }
  return [...rows.values()].filter((r) => r.count > 0).sort((a, b) => b.count - a.count || b.last - a.last)
}
