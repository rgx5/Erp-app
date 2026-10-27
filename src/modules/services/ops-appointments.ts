import { saveBill } from '@/data/ops'
import { startOfDay } from '@/domain/dates'
import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import type { Bill, Payment } from '@/domain/types'
import { nextNo } from '../numbering'
import { apptTotal, apptTitle, canEditAppt, APPT_FLOW, APPT_LABEL, noShowProblem } from './logic/appointments'
import { bookingProblem, canDo, durationOf } from './logic/calendar'
import { serviceBillInput } from './logic/billing'
import { applyChanges, audit, branch, checkPayments, isManager, listOf, mergeChanges, need, OpError, type Changes, type DataState, type OpCtx } from './ops-shared'
import { usePackageSession } from './ops-packages'
import type { Appointment, ApptService, ApptStatus } from './types'
import './replication'

export interface ApptServiceDraft { variantId: string; /** Leave out to use the item's price. */ price?: number; durationMin?: number }
export interface AppointmentDraft {
  customerId: string | null
  partyName: string
  partyPhone: string
  resourceId: string
  services: ApptServiceDraft[]
  start: number
  notes: string
  /** A manager lets a booking through that the rules would refuse (outside hours, too many no-shows). */
  override?: boolean
}

/** The lines of an appointment from the items chosen: name and price from the item, time from the service record. */
export function servicesFor(state: DataState, items: ApptServiceDraft[]): ApptService[] {
  if (!items.length) throw new OpError('Choose at least one service.')
  return items.map((i) => {
    const v = state.variants[i.variantId]
    const p = v ? state.products[v.productId] : undefined
    if (!v || !p) throw new OpError('One of those services no longer exists.')
    const price = i.price ?? v.price
    if (!(price >= 0)) throw new OpError(`${p.name}: the price cannot be negative.`)
    const dur = i.durationMin ?? durationOf(state, v.id)
    if (!(dur > 0)) throw new OpError(`${p.name}: say how long it takes.`)
    return { variantId: v.id, name: [p.name, v.size, v.color].filter(Boolean).join(' '), durationMin: dur, price: round2(price) }
  })
}

/** Books an appointment (or changes one that has not started). Refuses a clash, a day off, and a customer who keeps not turning up. */
export function saveAppointment(state: DataState, d: AppointmentDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; appointment: Appointment } {
  const customer = d.customerId ? state.customers[d.customerId] : undefined
  if (d.customerId && !customer) throw new OpError('That customer no longer exists.')
  const partyName = (customer?.name ?? d.partyName).trim()
  const partyPhone = (customer?.phone ?? d.partyPhone).trim()
  if (!partyName) throw new OpError('Say who the appointment is for.')
  const res = state.serviceResources?.[d.resourceId]
  if (!res || !res.active) throw new OpError('Choose who or what the appointment is with.')
  const services = servicesFor(state, d.services)
  if (!canDo(res, services.map((s) => s.variantId))) throw new OpError(`${res.name} does not do all of those services.`)
  const cur = existingId ? need(state.appointments?.[existingId], 'appointment') : undefined
  if (cur && !canEditAppt(cur)) throw new OpError('Only a booked or confirmed appointment can be changed.')
  const minutes = services.reduce((s, x) => s + x.durationMin, 0)
  const end = d.start + minutes * 60_000
  if (!cur && d.start < startOfDay(ctx.now)) throw new OpError('That day has already passed.')
  const mayOverride = !!d.override && isManager(state, ctx)
  if (d.override && !mayOverride) throw new OpError('Only a manager can book outside the rules.')
  const why = bookingProblem(state, d.resourceId, d.start, end, { ignoreId: existingId, allowOutsideHours: mayOverride })
  if (why) throw new OpError(why)
  if (!cur && !mayOverride) {
    const ns = noShowProblem(state, { customerId: d.customerId, phone: partyPhone, name: partyName })
    if (ns) throw new OpError(ns)
  }
  const base = { customerId: d.customerId, partyName, partyPhone, resourceId: d.resourceId, services, start: d.start, end, notes: d.notes.trim() }
  if (cur) {
    const a: Appointment = { ...cur, ...base, remindedAt: cur.start === d.start ? cur.remindedAt : undefined }
    if (a.remindedAt === undefined) delete a.remindedAt
    return { appointment: a, changes: { put: { appointments: [a], audit: [audit(ctx, 'APPT_EDIT', cur.no)] } } }
  }
  const a: Appointment = {
    id: id('ap', ctx.now), no: nextNo('AP-', listOf(state.appointments ?? {}).map((x) => x.no), ctx), ...base, status: 'booked', createdBy: ctx.userId, createdAt: ctx.now, ...branch(ctx),
  }
  return { appointment: a, changes: { put: { appointments: [a], audit: [audit(ctx, 'APPT_BOOK', `${a.no} — ${partyName}, ${apptTitle(a)}`)] } } }
}

/** Moves a booking along: confirmed, arrived, in service, done, cancelled or a no-show. */
export function setAppointmentStatus(state: DataState, apptId: string, to: ApptStatus, ctx: OpCtx, opts: { reason?: string } = {}): { changes: Changes; appointment: Appointment } {
  const cur = need(state.appointments?.[apptId], 'appointment')
  if (!APPT_FLOW[cur.status].includes(to)) throw new OpError(`A ${APPT_LABEL[cur.status].toLowerCase()} appointment cannot become ${APPT_LABEL[to].toLowerCase()}.`)
  if (cur.status === 'no_show' && to === 'booked') {
    if (!isManager(state, ctx)) throw new OpError('Only a manager can undo a no-show.')
    const why = bookingProblem(state, cur.resourceId, cur.start, cur.end, { ignoreId: cur.id, allowOutsideHours: true })
    if (why) throw new OpError(why)
  }
  if (to === 'cancelled' && cur.status === 'arrived' && !isManager(state, ctx)) throw new OpError('Only a manager can cancel once the customer has arrived.')
  const a: Appointment = { ...cur, status: to }
  if (to === 'confirmed') a.confirmedAt = ctx.now
  if (to === 'arrived') a.arrivedAt = ctx.now
  if (to === 'completed') a.completedAt = ctx.now
  if (to === 'cancelled') { a.cancelledAt = ctx.now; if (opts.reason?.trim()) a.cancelReason = opts.reason.trim() }
  if (to === 'no_show') a.noShowAt = ctx.now
  if (to === 'booked') { delete a.noShowAt }
  return { appointment: a, changes: { put: { appointments: [a], audit: [audit(ctx, `APPT_${to.toUpperCase()}`, `${cur.no}${opts.reason?.trim() ? ` — ${opts.reason.trim()}` : ''}`)] } } }
}

/** The reminder text was shared. */
export function markReminded(state: DataState, apptId: string, ctx: OpCtx): { changes: Changes } {
  const cur = need(state.appointments?.[apptId], 'appointment')
  return { changes: { put: { appointments: [{ ...cur, remindedAt: ctx.now }] } } }
}

/** Turns an appointment into a bill (through the ordinary bill path) and marks it done. */
export function billAppointment(state: DataState, apptId: string, payments: Payment[], ctx: OpCtx): { changes: Changes; appointment: Appointment; bill: Bill } {
  const cur = need(state.appointments?.[apptId], 'appointment')
  if (cur.billId || cur.packageUseId) throw new OpError(`${cur.no} has already been paid for.`)
  if (cur.status === 'cancelled' || cur.status === 'no_show') throw new OpError('A cancelled or missed appointment cannot be billed.')
  const total = apptTotal(cur)
  const input = serviceBillInput(state, {
    lines: cur.services.map((s) => ({ variantId: s.variantId, name: s.name, qty: 1, price: s.price })), customerId: cur.customerId, payments, userId: ctx.userId, now: ctx.now,
    notes: `Appointment ${cur.no}`, ext: { services: { appointmentId: cur.id } },
  })
  checkPayments(payments, Math.min(total, input.total))
  const r = saveBill(state, input, ctx)
  // The bill hook marks the appointment done; do the same locally so the result is complete without it (idempotent).
  const a: Appointment = { ...cur, status: 'completed', billId: r.bill.id, completedAt: cur.completedAt ?? ctx.now, ...(cur.arrivedAt ? {} : { arrivedAt: ctx.now }) }
  return { bill: r.bill, appointment: a, changes: mergeChanges(r.changes, { put: { appointments: [a], audit: [audit(ctx, 'APPT_BILLED', `${cur.no} → ${r.bill.no}`)] } }) }
}

/** Pays for an appointment with a session of the customer's package: no bill, the revenue is earned from the package. */
export function completeWithPackage(state: DataState, apptId: string, customerPackageId: string, ctx: OpCtx): { changes: Changes; appointment: Appointment } {
  const cur = need(state.appointments?.[apptId], 'appointment')
  if (cur.billId || cur.packageUseId) throw new OpError(`${cur.no} has already been paid for.`)
  if (!cur.customerId) throw new OpError('Choose a customer on the appointment to use their package.')
  if (cur.status === 'cancelled' || cur.status === 'no_show') throw new OpError('A cancelled or missed appointment cannot use a package.')
  const u = usePackageSession(state, customerPackageId, { customerId: cur.customerId, variantIds: cur.services.map((s) => s.variantId), serviceName: apptTitle(cur), appointmentId: cur.id, note: cur.no }, ctx)
  const a: Appointment = { ...cur, status: 'completed', packageUseId: u.use.id, completedAt: cur.completedAt ?? ctx.now, ...(cur.arrivedAt ? {} : { arrivedAt: ctx.now }) }
  return { appointment: a, changes: mergeChanges(u.changes, { put: { appointments: [a], audit: [audit(ctx, 'APPT_PACKAGE', `${cur.no} — ${u.use.serviceName}`)] } }) }
}

export { applyChanges }
