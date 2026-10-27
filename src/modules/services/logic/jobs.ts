import { listOf, type DataState } from '@/data/state'
import { DAY, fmtDate } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import type { JobCard, JobKind, JobLine, JobStatus } from '../types'

export const JOB_LABEL: Record<JobStatus, string> = {
  received: 'Received', estimated: 'Estimate given', approved: 'Approved', in_work: 'In work', ready: 'Ready', delivered: 'Delivered', rejected: 'Estimate refused', cancelled: 'Cancelled',
}
export const KIND_LABEL: Record<JobKind, string> = { device: 'Phone / device', vehicle: 'Vehicle', appliance: 'Appliance', other: 'Other' }
/** What the identifier means for each kind. */
export const IDENTIFIER_LABEL: Record<JobKind, string> = { device: 'IMEI / serial number', vehicle: 'Registration number', appliance: 'Serial number', other: 'Serial / tag' }
export const READING_LABEL: Record<JobKind, string> = { device: 'Battery health / lock code note', vehicle: 'Odometer reading', appliance: 'Condition note', other: 'Reading' }

/** Estimate → approval → work → ready → delivered; a refused estimate can be reopened or the item handed back. */
export const JOB_FLOW: Record<JobStatus, JobStatus[]> = {
  received: ['estimated', 'cancelled'],
  estimated: ['approved', 'rejected', 'cancelled'],
  approved: ['in_work', 'estimated'],
  in_work: ['ready', 'estimated'],
  ready: ['delivered', 'in_work'],
  rejected: ['estimated', 'delivered'],
  delivered: [],
  cancelled: [],
}
export const nextJobStatuses = (s: JobStatus) => JOB_FLOW[s]
export const isOpenJob = (j: Pick<JobCard, 'status'>) => !['delivered', 'cancelled'].includes(j.status)
/** Lines can change until the work is done. */
export const canEditLines = (j: Pick<JobCard, 'status'>) => ['received', 'estimated', 'approved', 'in_work'].includes(j.status)
/** Parts come off the shelf only once the customer has said yes. */
export const canIssueParts = (j: Pick<JobCard, 'status'>) => j.status === 'approved' || j.status === 'in_work'

export const lineTotal = (l: Pick<JobLine, 'qty' | 'price'>) => round2(l.qty * l.price)
export function jobTotals(j: Pick<JobCard, 'lines'>): { labour: number; parts: number; total: number } {
  const labour = round2(j.lines.filter((l) => l.kind === 'labour').reduce((s, l) => s + lineTotal(l), 0))
  const parts = round2(j.lines.filter((l) => l.kind === 'part').reduce((s, l) => s + lineTotal(l), 0))
  return { labour, parts, total: round2(labour + parts) }
}

/** Parts still to take from stock for this job. */
export const toIssue = (j: Pick<JobCard, 'lines'>): Array<{ line: JobLine; remaining: number }> =>
  j.lines.filter((l) => l.kind === 'part' && l.variantId).map((l) => ({ line: l, remaining: round3(l.qty - (l.issued ?? 0)) })).filter((x) => x.remaining > 0)

export function linesProblem(lines: JobLine[]): string | null {
  for (const l of lines) {
    if (!l.name.trim()) return 'Every line needs a name.'
    if (!(l.qty > 0)) return `${l.name}: enter a quantity.`
    if (!(l.price >= 0)) return `${l.name}: the price cannot be negative.`
    if (l.kind === 'part' && !l.variantId) return `${l.name}: choose the part from stock.`
    if ((l.issued ?? 0) > l.qty + 0.0005) return `${l.name}: more is issued than the job needs.`
  }
  return null
}

/** Days since the job came in (or since it became ready, for a job waiting to be collected). */
export const jobAgeDays = (j: JobCard, now: number) => Math.max(0, Math.floor((now - j.receivedAt) / DAY))
export const waitingDays = (j: JobCard, now: number) => (j.readyAt ? Math.max(0, Math.floor((now - j.readyAt) / DAY)) : 0)
export const isLate = (j: JobCard, now: number) => isOpenJob(j) && j.status !== 'ready' && j.promisedAt !== undefined && now > j.promisedAt

export const openJobs = (state: DataState): JobCard[] => listOf(state.jobCards ?? {}).filter(isOpenJob).sort((a, b) => a.receivedAt - b.receivedAt)

/** Ready for pickup for `days` or more. */
export const uncollected = (state: DataState, now: number, days = 3): JobCard[] => listOf(state.jobCards ?? {}).filter((j) => j.status === 'ready' && waitingDays(j, now) >= days)

export interface JobBoard { byStatus: Record<JobStatus, number>; open: number; late: number; awaitingApproval: number; ready: number; openValue: number }
export function jobBoard(state: DataState, now: number): JobBoard {
  const byStatus = { received: 0, estimated: 0, approved: 0, in_work: 0, ready: 0, delivered: 0, rejected: 0, cancelled: 0 } as Record<JobStatus, number>
  let open = 0, late = 0, value = 0
  for (const j of listOf(state.jobCards ?? {})) {
    byStatus[j.status]++
    if (isOpenJob(j)) { open++; value += jobTotals(j).total; if (isLate(j, now)) late++ }
  }
  return { byStatus, open, late, awaitingApproval: byStatus.estimated, ready: byStatus.ready, openValue: round2(value) }
}

export interface JobAgeRow { job: JobCard; days: number; total: number; late: boolean }
/** Open jobs by how long they have been with us, oldest first. */
export function jobAgeing(state: DataState, now: number): { rows: JobAgeRow[]; buckets: Array<{ label: string; count: number; value: number }> } {
  const rows = openJobs(state).map((job) => ({ job, days: jobAgeDays(job, now), total: jobTotals(job).total, late: isLate(job, now) })).sort((a, b) => b.days - a.days)
  const defs: Array<[string, number, number]> = [['0–2 days', 0, 2], ['3–7 days', 3, 7], ['8–14 days', 8, 14], ['15+ days', 15, Infinity]]
  return { rows, buckets: defs.map(([label, lo, hi]) => { const m = rows.filter((r) => r.days >= lo && r.days <= hi); return { label, count: m.length, value: round2(m.reduce((s, r) => s + r.total, 0)) } }) }
}

const first = (n: string) => (n.trim().split(/\s+/)[0] || 'there')

export function estimateText(j: JobCard, shop: string): string {
  const lines = j.lines.map((l) => `• ${l.name}${l.qty !== 1 ? ` × ${l.qty}` : ''} — ${inr(lineTotal(l), 0)}`).join('\n')
  return `Hello ${first(j.partyName)}, estimate for your ${j.title || 'item'} (${j.no}) at ${shop}:\n${lines}\nTotal ${inr(jobTotals(j).total, 0)}. Reply YES to go ahead.`
}
export function readyText(j: JobCard, shop: string): string {
  return `Hello ${first(j.partyName)}, your ${j.title || 'item'} (${j.no}) is ready for pickup at ${shop}. Amount due ${inr(jobTotals(j).total, 0)}. Please bring this message or your job number.`
}
export function receiptText(j: JobCard, shop: string): string {
  return `${shop} — job card ${j.no}\nReceived ${fmtDate(j.receivedAt)}: ${j.title}${j.identifier ? ` (${j.identifier})` : ''}\nProblem: ${j.problem || '—'}${j.accessories ? `\nAccessories: ${j.accessories}` : ''}${j.promisedAt ? `\nPromised by ${fmtDate(j.promisedAt)}` : ''}`
}
