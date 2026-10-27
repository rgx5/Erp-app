import { listOf, type DataState } from '@/data/state'
import { fmtDate, fmtDateTime, startOfDay } from '@/domain/dates'
import type { FieldVisit, VisitSignature, VisitStatus } from '../types'

export const VISIT_LABEL: Record<VisitStatus, string> = { planned: 'Planned', checked_in: 'On site', completed: 'Done', cancelled: 'Cancelled' }
export const VISIT_FLOW: Record<VisitStatus, VisitStatus[]> = { planned: ['checked_in', 'cancelled'], checked_in: ['completed', 'cancelled'], completed: [], cancelled: [] }
export const isOpenVisit = (v: Pick<FieldVisit, 'status'>) => v.status === 'planned' || v.status === 'checked_in'

export const visitMinutes = (v: Pick<FieldVisit, 'checkInAt' | 'checkOutAt'>, now?: number): number | null =>
  v.checkInAt ? Math.max(0, Math.round(((v.checkOutAt ?? now ?? v.checkInAt) - v.checkInAt) / 60_000)) : null

export function signatureProblem(sig: Pick<VisitSignature, 'kind' | 'name' | 'strokes'>): string | null {
  if (!sig.name.trim()) return 'Type the name of the person signing.'
  if (sig.kind === 'drawn') {
    const pts = (sig.strokes ?? []).reduce((n, s) => n + (s.match(/[ML]/g)?.length ?? 0), 0)
    if (pts < 4) return 'Ask the customer to sign in the box.'
  }
  return null
}

/** Today's visits (planned for today, or on site now), earliest first. */
export const visitsOn = (state: DataState, day: number): FieldVisit[] =>
  listOf(state.fieldVisits ?? {}).filter((v) => startOfDay(v.plannedAt) === startOfDay(day)).sort((a, b) => a.plannedAt - b.plannedAt)

/** Planned visits whose time has passed without a check-in. */
export const missedVisits = (state: DataState, now: number, graceMin = 60): FieldVisit[] =>
  listOf(state.fieldVisits ?? {}).filter((v) => v.status === 'planned' && v.plannedAt + graceMin * 60_000 < now).sort((a, b) => a.plannedAt - b.plannedAt)

/** The report as text to share with the customer or the office. */
export function reportText(v: FieldVisit, shop: string, userName: string): string {
  const mins = visitMinutes(v)
  const out = [
    `${shop} — visit report ${v.no}`,
    `${v.partyName}${v.address ? `, ${v.address}` : ''}`,
    `Visited by ${userName} on ${fmtDate(v.checkInAt ?? v.plannedAt)}${v.checkInAt ? `, in ${fmtDateTime(v.checkInAt)}` : ''}${v.checkOutAt ? `, out ${fmtDateTime(v.checkOutAt)}` : ''}${mins !== null ? ` (${mins} min)` : ''}${v.checkInPlace ? ` at ${v.checkInPlace}` : ''}`,
    `Purpose: ${v.purpose || '—'}`,
  ]
  if (v.report.summary) out.push(`Summary: ${v.report.summary}`)
  if (v.report.workDone) out.push(`Work done: ${v.report.workDone}`)
  if (v.report.issues) out.push(`Issues: ${v.report.issues}`)
  if (v.report.nextSteps) out.push(`Next steps: ${v.report.nextSteps}`)
  if (v.signature) out.push(`Signed by ${v.signature.name} (${v.signature.kind === 'drawn' ? 'signature drawn' : 'typed name'}) on ${fmtDateTime(v.signature.signedAt)}`)
  return out.join('\n')
}

export interface VisitRow { visit: FieldVisit; userId: string; minutes: number | null }
/** The log for a range, newest first, for the visit report and CSV. */
export function visitLog(state: DataState, from: number, to: number, now: number): VisitRow[] {
  return listOf(state.fieldVisits ?? {}).filter((v) => v.plannedAt >= from && v.plannedAt <= to).sort((a, b) => b.plannedAt - a.plannedAt).map((visit) => ({ visit, userId: visit.userId, minutes: visitMinutes(visit, now) }))
}
