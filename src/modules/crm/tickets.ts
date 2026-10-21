import { DAY } from '@/domain/dates'
import { listOf, type DataState } from '@/data/state'
import type { CrmSettings, Ticket, TicketKind, TicketPriority, TicketStatus } from './types'

export const KIND_LABEL: Record<TicketKind, string> = { complaint: 'Complaint', service: 'After-sales', warranty: 'Warranty claim' }
export const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', 'in-progress': 'In progress', waiting: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed' }
export const PRIORITY_LABEL: Record<TicketPriority, string> = { low: 'Low', normal: 'Normal', high: 'High' }
export const OUTCOME_LABEL = { repair: 'Repair', replace: 'Replace', refund: 'Refund', rejected: 'Claim rejected' } as const

/** Where a ticket may go from each status. Resolved tickets can be closed or reopened; closed ones can be reopened. */
const FLOW: Record<TicketStatus, TicketStatus[]> = {
  open: ['in-progress', 'waiting', 'resolved'],
  'in-progress': ['waiting', 'resolved', 'open'],
  waiting: ['in-progress', 'resolved'],
  resolved: ['closed', 'open'],
  closed: ['open'],
}
export const nextStatuses = (s: TicketStatus): TicketStatus[] => FLOW[s]
export const canMove = (from: TicketStatus, to: TicketStatus) => FLOW[from].includes(to)
export const isOpenTicket = (t: Pick<Ticket, 'status'>) => t.status !== 'resolved' && t.status !== 'closed'

const HOUR = 3_600_000

/** When a ticket opened now must be settled, by its priority. */
export const slaDueFor = (priority: TicketPriority, openedAt: number, cfg: Pick<CrmSettings, 'slaHours'>): number => openedAt + cfg.slaHours[priority] * HOUR

export type SlaState = 'ok' | 'due-soon' | 'breached' | 'met' | 'missed'

/** Open tickets are ok, due soon (under a quarter of the time left, or under 4 hours) or breached; settled ones are met or missed. */
export function slaState(t: Pick<Ticket, 'status' | 'slaDue' | 'openedAt' | 'resolvedAt'>, now: number): SlaState {
  if (!isOpenTicket(t)) return (t.resolvedAt ?? now) <= t.slaDue ? 'met' : 'missed'
  if (now > t.slaDue) return 'breached'
  const left = t.slaDue - now
  return left <= Math.max(4 * HOUR, (t.slaDue - t.openedAt) / 4) ? 'due-soon' : 'ok'
}

/** "3 h left", "1 d 4 h late" — time against the due date, for a row. */
export function slaLabel(t: Pick<Ticket, 'status' | 'slaDue' | 'openedAt' | 'resolvedAt'>, now: number): string {
  const s = slaState(t, now)
  if (s === 'met') return 'Within the time'
  if (s === 'missed') return 'Settled late'
  const diff = Math.abs(t.slaDue - now)
  const d = Math.floor(diff / DAY)
  const h = Math.floor((diff % DAY) / HOUR)
  const span = d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h` : `${Math.max(1, Math.round(diff / 60_000))} min`
  return s === 'breached' ? `${span} late` : `${span} left`
}

/** The date a warranty ends: the sale date plus the months. */
export function warrantyEnds(saleDate: number, months: number): number {
  const d = new Date(saleDate)
  d.setMonth(d.getMonth() + months)
  return d.getTime()
}

export function warrantyCover(saleDate: number, months: number, now: number): { covered: boolean; endsAt: number } {
  const endsAt = warrantyEnds(saleDate, months)
  return { covered: now <= endsAt, endsAt }
}

export interface TicketSummary {
  open: number
  breached: number
  dueSoon: number
  resolved: number
  /** Average hours from opening to resolution of settled tickets. Null when none. */
  avgResolutionHours: number | null
  /** Share of settled tickets that met their time. Null when none. */
  slaMetPct: number | null
  byKind: Record<TicketKind, number>
}

export function ticketSummary(state: Pick<DataState, 'crmTickets'>, now: number): TicketSummary {
  const out: TicketSummary = { open: 0, breached: 0, dueSoon: 0, resolved: 0, avgResolutionHours: null, slaMetPct: null, byKind: { complaint: 0, service: 0, warranty: 0 } }
  let hours = 0
  let met = 0
  for (const t of listOf(state.crmTickets ?? {})) {
    if (isOpenTicket(t)) {
      out.open += 1
      out.byKind[t.kind] += 1
      const s = slaState(t, now)
      if (s === 'breached') out.breached += 1
      else if (s === 'due-soon') out.dueSoon += 1
    } else {
      out.resolved += 1
      hours += ((t.resolvedAt ?? t.updatedAt) - t.openedAt) / HOUR
      if (slaState(t, now) === 'met') met += 1
    }
  }
  if (out.resolved) {
    out.avgResolutionHours = Math.round((hours / out.resolved) * 10) / 10
    out.slaMetPct = Math.round((met / out.resolved) * 100)
  }
  return out
}

/** Open tickets, the most urgent first: breached, then due soonest. */
export function ticketQueue(state: Pick<DataState, 'crmTickets'>): Ticket[] {
  return listOf(state.crmTickets ?? {}).filter(isOpenTicket).sort((a, b) => a.slaDue - b.slaDue)
}

export const ticketsOfCustomer = (state: Pick<DataState, 'crmTickets'>, customerId: string): Ticket[] =>
  listOf(state.crmTickets ?? {}).filter((t) => t.customerId === customerId).sort((a, b) => b.openedAt - a.openedAt)
