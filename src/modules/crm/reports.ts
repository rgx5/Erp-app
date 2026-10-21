import { toCsv, type CsvCell } from '@/domain/csv'
import { fmtDate } from '@/domain/dates'
import type { Customer } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import { leadsToFollowUp, STAGE_LABEL } from './leads'
import { referralRows } from './referrals'
import { dateFalls, matchCtx } from './segments'
import { statsOf, type CustomerStats } from './stats'
import { taskCounts } from './tasks'
import { KIND_LABEL, slaState, STATUS_LABEL, ticketSummary } from './tickets'

/** What needs a look today. Pure and quick: it runs on every change for the Home screen. */
export interface CrmAlerts {
  tasksOverdue: number
  tasksToday: number
  leadsDue: number
  ticketsBreached: number
  ticketsDueSoon: number
  referralsReady: number
  birthdaysToday: number
}

export function crmAlerts(state: DataState, now: number): CrmAlerts {
  const t = taskCounts(state, now)
  const tk = ticketSummary(state, now)
  const birthdaysToday = listOf(state.customers).filter((c) => c.dob && !c.optOutMarketing && dateFalls(c.dob, 'today', now)).length
  return {
    tasksOverdue: t.overdue, tasksToday: t.today, leadsDue: leadsToFollowUp(state, now).length, ticketsBreached: tk.breached, ticketsDueSoon: tk.dueSoon,
    referralsReady: referralRows(state).filter((r) => r.ready).length, birthdaysToday,
  }
}

/** A segment's members as a spreadsheet: for a mail-merge, a printed list or another tool. */
export function segmentCsv(members: Customer[], stats: Map<string, CustomerStats>, now: number): string {
  const rows: CsvCell[][] = [['Name', 'Phone', 'Email', 'Birthday', 'Groups', 'Points', 'Store credit', 'Orders', 'Spent', 'Last purchase']]
  for (const c of members) {
    const s = statsOf(stats, c.id)
    rows.push([c.name, c.phone, c.email, c.dob, (c.tags ?? []).join('; '), c.loyaltyPoints, c.storeCredit, s.orders, s.spend, s.lastAt === null ? '' : fmtDate(s.lastAt)])
  }
  void now
  return toCsv(rows)
}

export function leadsCsv(state: Pick<DataState, 'crmLeads'>): string {
  const rows: CsvCell[][] = [['No', 'Name', 'Phone', 'Source', 'Stage', 'Value', 'Next follow-up', 'Created']]
  for (const l of listOf(state.crmLeads ?? {}).sort((a, b) => b.createdAt - a.createdAt)) {
    rows.push([l.no, l.name, l.phone, l.source, STAGE_LABEL[l.stage], l.value, l.nextFollowUp ? fmtDate(l.nextFollowUp) : '', fmtDate(l.createdAt)])
  }
  return toCsv(rows)
}

export function ticketsCsv(state: Pick<DataState, 'crmTickets'>, now: number): string {
  const rows: CsvCell[][] = [['No', 'Kind', 'Status', 'Priority', 'Customer', 'Subject', 'Opened', 'Due', 'Time', 'Resolution']]
  for (const t of listOf(state.crmTickets ?? {}).sort((a, b) => b.openedAt - a.openedAt)) {
    rows.push([t.no, KIND_LABEL[t.kind], STATUS_LABEL[t.status], t.priority, t.partyName, t.subject, fmtDate(t.openedAt), fmtDate(t.slaDue), slaState(t, now), t.resolution])
  }
  return toCsv(rows)
}

/** The figures a segment screen shows: how many, their total spend, and how many can actually be messaged. */
export function segmentFigures(members: Customer[], state: DataState, now: number) {
  const m = matchCtx(state, now)
  let spend = 0
  let reachable = 0
  for (const c of members) {
    spend += statsOf(m.stats, c.id).spend
    if (!c.optOutMarketing && c.phone.replace(/\D/g, '').length >= 10) reachable += 1
  }
  return { count: members.length, spend: Math.round(spend * 100) / 100, reachable }
}
