import { id } from '@/domain/ids'
import { nextNo } from '../numbering'
import { signatureProblem, VISIT_FLOW, VISIT_LABEL } from './logic/visits'
import { consumePackageSession } from './ops-packages'
import { audit, branch, isManager, listOf, mergeChanges, need, OpError, type Changes, type DataState, type OpCtx } from './ops-shared'
import type { FieldVisit, VisitReport, VisitSignature } from './types'
import './replication'

export interface VisitDraft {
  customerId: string | null; partyName: string; partyPhone: string; address: string; purpose: string; userId?: string; plannedAt: number; projectId?: string; jobCardId?: string; notes: string
}

/** Plans a visit to a customer's place for a person on the team. */
export function saveVisit(state: DataState, d: VisitDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; visit: FieldVisit } {
  const customer = d.customerId ? state.customers[d.customerId] : undefined
  if (d.customerId && !customer) throw new OpError('That customer no longer exists.')
  const partyName = (customer?.name ?? d.partyName).trim()
  if (!partyName) throw new OpError('Say who is being visited.')
  const userId = d.userId ?? ctx.userId
  if (!state.users[userId]) throw new OpError('That person no longer exists.')
  if (!(d.plannedAt > 0)) throw new OpError('Choose the day and time.')
  if (d.projectId && !state.projects?.[d.projectId]) throw new OpError('That project no longer exists.')
  if (d.jobCardId && !state.jobCards?.[d.jobCardId]) throw new OpError('That job card no longer exists.')
  const base = {
    customerId: d.customerId, partyName, partyPhone: (customer?.phone ?? d.partyPhone).trim(), address: (d.address || customer?.address || '').trim(), purpose: d.purpose.trim(), userId, plannedAt: d.plannedAt, notes: d.notes.trim(),
  }
  if (existingId) {
    const cur = need(state.fieldVisits?.[existingId], 'visit')
    if (cur.status !== 'planned') throw new OpError('Only a planned visit can be changed.')
    const v: FieldVisit = { ...cur, ...base }
    if (d.projectId) v.projectId = d.projectId; else delete v.projectId
    if (d.jobCardId) v.jobCardId = d.jobCardId; else delete v.jobCardId
    return { visit: v, changes: { put: { fieldVisits: [v], audit: [audit(ctx, 'VISIT_EDIT', cur.no)] } } }
  }
  const v: FieldVisit = {
    id: id('fv', ctx.now), no: nextNo('FV-', listOf(state.fieldVisits ?? {}).map((x) => x.no), ctx), ...base, status: 'planned', report: { summary: '', workDone: '', issues: '', nextSteps: '' }, photos: [], createdAt: ctx.now,
    ...branch(ctx), ...(d.projectId ? { projectId: d.projectId } : {}), ...(d.jobCardId ? { jobCardId: d.jobCardId } : {}),
  }
  return { visit: v, changes: { put: { fieldVisits: [v], audit: [audit(ctx, 'VISIT_PLANNED', `${v.no} — ${partyName}`)] } } }
}

/** Arrived: records the time and where (a typed place, or coordinates when the phone could give them). */
export function checkIn(state: DataState, visitId: string, o: { place: string; lat?: number; lng?: number }, ctx: OpCtx): { changes: Changes; visit: FieldVisit } {
  const cur = need(state.fieldVisits?.[visitId], 'visit')
  if (cur.status !== 'planned') throw new OpError(`${cur.no} is ${VISIT_LABEL[cur.status].toLowerCase()}.`)
  if (cur.userId !== ctx.userId && !isManager(state, ctx)) throw new OpError(`${state.users[cur.userId]?.name ?? 'The person this visit is for'} checks in for this visit.`)
  const place = o.place.trim()
  const hasGeo = Number.isFinite(o.lat) && Number.isFinite(o.lng)
  if (!place && !hasGeo) throw new OpError('Say where you are (for example “Customer’s shop, Andheri”).')
  if (hasGeo && (Math.abs(o.lat as number) > 90 || Math.abs(o.lng as number) > 180)) throw new OpError('Those coordinates are not on the map.')
  const v: FieldVisit = { ...cur, status: 'checked_in', checkInAt: ctx.now, ...(place ? { checkInPlace: place } : {}), ...(hasGeo ? { lat: o.lat, lng: o.lng } : {}) }
  return { visit: v, changes: { put: { fieldVisits: [v], audit: [audit(ctx, 'VISIT_CHECK_IN', `${cur.no}${place ? ` — ${place}` : ''}`)] } } }
}

/** Notes, the report and photos can be written until the visit is closed. */
export function saveVisitReport(state: DataState, visitId: string, o: { notes?: string; report?: Partial<VisitReport>; photos?: string[] }, ctx: OpCtx): { changes: Changes; visit: FieldVisit } {
  const cur = need(state.fieldVisits?.[visitId], 'visit')
  if (cur.status === 'completed' || cur.status === 'cancelled') throw new OpError(`${cur.no} is closed.`)
  if ((o.photos?.length ?? 0) > 12) throw new OpError('Keep it to 12 photos.')
  const report: VisitReport = { ...cur.report }
  for (const k of ['summary', 'workDone', 'issues', 'nextSteps'] as const) if (o.report?.[k] !== undefined) report[k] = (o.report[k] as string).trim()
  const v: FieldVisit = { ...cur, report, notes: o.notes !== undefined ? o.notes.trim() : cur.notes, photos: o.photos ?? cur.photos }
  return { visit: v, changes: { put: { fieldVisits: [v], audit: [audit(ctx, 'VISIT_REPORT', cur.no)] } } }
}

/** The customer signs on the phone: a drawn signature or a typed name. */
export function signVisit(state: DataState, visitId: string, sig: Omit<VisitSignature, 'signedAt'>, ctx: OpCtx): { changes: Changes; visit: FieldVisit } {
  const cur = need(state.fieldVisits?.[visitId], 'visit')
  if (cur.status !== 'checked_in') throw new OpError('The customer signs while the visit is on.')
  const why = signatureProblem(sig)
  if (why) throw new OpError(why)
  const signature: VisitSignature = {
    kind: sig.kind, name: sig.name.trim(), signedAt: ctx.now, ...(sig.kind === 'drawn' ? { strokes: sig.strokes, width: sig.width, height: sig.height } : {}),
  }
  const v: FieldVisit = { ...cur, signature }
  return { visit: v, changes: { put: { fieldVisits: [v], audit: [audit(ctx, 'VISIT_SIGNED', `${cur.no} — ${signature.name}`)] } } }
}

/** Finishes the visit: needs the summary of what happened. A package session can pay for it. */
export function completeVisit(state: DataState, visitId: string, ctx: OpCtx, o: { packageId?: string } = {}): { changes: Changes; visit: FieldVisit } {
  const cur = need(state.fieldVisits?.[visitId], 'visit')
  if (cur.status !== 'checked_in') throw new OpError('Check in before finishing the visit.')
  if (!cur.report.summary.trim()) throw new OpError('Write a short summary of the visit first.')
  let visit: FieldVisit = { ...cur, status: 'completed', checkOutAt: ctx.now }
  let changes: Changes = {}
  if (o.packageId) {
    if (!cur.customerId) throw new OpError('Choose a customer on the visit to use their package.')
    const u = consumePackageSession(state, o.packageId, { customerId: cur.customerId, serviceName: `Visit ${cur.no}`, visitId: cur.id, note: cur.purpose }, ctx)
    visit = { ...visit, packageUseId: u.use.id }
    changes = u.changes
  }
  return { visit, changes: mergeChanges(changes, { put: { fieldVisits: [visit], audit: [audit(ctx, 'VISIT_DONE', cur.no)] } }) }
}

export function cancelVisit(state: DataState, visitId: string, reason: string, ctx: OpCtx): { changes: Changes; visit: FieldVisit } {
  const cur = need(state.fieldVisits?.[visitId], 'visit')
  if (!VISIT_FLOW[cur.status].includes('cancelled')) throw new OpError(`${cur.no} is already ${VISIT_LABEL[cur.status].toLowerCase()}.`)
  const v: FieldVisit = { ...cur, status: 'cancelled', notes: reason.trim() ? `${cur.notes}${cur.notes ? '\n' : ''}Cancelled: ${reason.trim()}` : cur.notes }
  return { visit: v, changes: { put: { fieldVisits: [v], audit: [audit(ctx, 'VISIT_CANCELLED', `${cur.no}${reason.trim() ? ` — ${reason.trim()}` : ''}`)] } } }
}
