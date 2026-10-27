import { listOf, type DataState } from '@/data/state'
import { fmtDate, fmtDateTime, fmtTime } from '@/domain/dates'
import { toCsv, type CsvCell } from '@/domain/csv'
import { round2 } from '@/domain/money'
import { apptTitle, apptTotal, APPT_LABEL, noShowReport } from './appointments'
import { utilisation } from './calendar'
import { jobAgeing, JOB_LABEL, jobTotals } from './jobs'
import { packageLiability, STATUS_LABEL } from './packages'
import { hoursOf, projectBoard, timesheet } from './projects'
import { visitLog, VISIT_LABEL } from './visits'
import { PROJECT_LABEL } from './projects'
import { missedVisits } from './visits'
import { expiringSoon, lapsed } from './packages'
import { overdueBookings, remindersDue } from './appointments'
import { uncollected } from './jobs'

const name = (s: DataState, id: string | undefined | null) => (id ? s.users[id]?.name ?? '' : '')

export function appointmentsCsv(state: DataState, from: number, to: number): string {
  const rows: CsvCell[][] = [['No', 'Date', 'Time', 'Customer', 'Mobile', 'With', 'Services', 'Status', 'Amount', 'Bill', 'Package session', 'Cancel reason']]
  for (const a of listOf(state.appointments ?? {}).filter((x) => x.start >= from && x.start <= to).sort((x, y) => x.start - y.start)) {
    rows.push([a.no, fmtDate(a.start), fmtTime(a.start), a.partyName, a.partyPhone, state.serviceResources?.[a.resourceId]?.name ?? '', apptTitle(a), APPT_LABEL[a.status], apptTotal(a), a.billId ? state.bills[a.billId]?.no ?? '' : '', a.packageUseId ? 'Yes' : '', a.cancelReason ?? ''])
  }
  return toCsv(rows)
}

export function noShowCsv(state: DataState, from: number, to: number): string {
  return toCsv([['Customer', 'Mobile', 'Missed', 'Bookings', 'Last missed'], ...noShowReport(state, from, to).map((r) => [r.name, r.phone, r.count, r.of, fmtDate(r.last)])])
}

export function liabilityCsv(state: DataState, now: number): string {
  const l = packageLiability(state, now)
  return toCsv([
    ['Package', 'Customer', 'Sold on', 'Price', 'Sessions', 'Used', 'Still to earn (incl. GST)', 'Valid until', 'Status'],
    ...l.rows.map((r) => [r.no, state.customers[r.customerId]?.name ?? '', fmtDate(r.sold), r.price, r.sessions, r.used, r.deferred, r.expiresAt ? fmtDate(r.expiresAt) : 'No expiry', STATUS_LABEL[r.status]]),
    ['Total', '', '', l.sold, '', '', l.deferred, '', ''],
  ])
}

export function jobsCsv(state: DataState, now: number): string {
  const a = jobAgeing(state, now)
  return toCsv([
    ['Job', 'Customer', 'Item', 'Status', 'Days with us', 'Promised', 'Estimate'],
    ...a.rows.map((r) => [r.job.no, r.job.partyName, r.job.title, JOB_LABEL[r.job.status], r.days, r.job.promisedAt ? fmtDate(r.job.promisedAt) : '', jobTotals(r.job).total]),
  ])
}

export function utilisationCsv(state: DataState, from: number, to: number): string {
  return toCsv([['Column', 'Kind', 'Bookings', 'Booked hours', 'Working hours', 'Utilisation %', 'No-shows'], ...utilisation(state, from, to).map((u) => [u.resource.name, u.resource.kind === 'staff' ? 'Staff' : 'Resource', u.appointments, round2(u.booked / 60), round2(u.available / 60), u.pct, u.noShows])])
}

export function projectsCsv(state: DataState, now: number): string {
  return toCsv([
    ['Project', 'Customer', 'Status', 'Billing', 'Hours', 'Budget hours', 'Unbilled hours', 'Unbilled amount', 'Billed amount', 'Fixed fee', 'Fixed invoiced'],
    ...projectBoard(state, now).map(({ project: p, summary: s }) => [p.name, p.customerId ? state.customers[p.customerId]?.name ?? '' : '', PROJECT_LABEL[p.status], p.billing === 'hourly' ? 'Hourly' : 'Fixed', s.hours, p.budgetHours || '', s.unbilledHours, s.unbilledAmount, s.billedAmount, p.fixedAmount || '', p.fixedInvoiced || '']),
  ])
}

export function timesheetCsv(state: DataState, userId: string | null, from: number, to: number, now: number): string {
  const t = timesheet(state, userId, from, to, now)
  const rows: CsvCell[][] = [['Date', 'Person', 'Project', 'Task', 'Hours', 'Billable', 'Rate', 'Amount', 'Invoiced', 'Note']]
  for (const d of t.days) for (const e of d.entries) {
    const mins = e.minutes + (e.runningSince ? Math.round((now - e.runningSince) / 60_000) : 0)
    rows.push([fmtDate(e.date), name(state, e.userId), state.projects?.[e.projectId]?.name ?? '', e.taskId ? state.projectTasks?.[e.taskId]?.title ?? '' : '', hoursOf(mins), e.billable, e.rate, e.billable ? round2((mins / 60) * e.rate) : 0, e.billId ? state.bills[e.billId]?.no ?? 'Yes' : '', e.note])
  }
  return toCsv(rows)
}

export function visitsCsv(state: DataState, from: number, to: number, now: number): string {
  return toCsv([
    ['Visit', 'Planned', 'Customer', 'Address', 'Person', 'Status', 'Checked in', 'Place', 'Minutes', 'Summary', 'Signed by'],
    ...visitLog(state, from, to, now).map(({ visit: v, minutes }) => [v.no, fmtDateTime(v.plannedAt), v.partyName, v.address, name(state, v.userId), VISIT_LABEL[v.status], v.checkInAt ? fmtDateTime(v.checkInAt) : '', v.checkInPlace ?? '', minutes ?? '', v.report.summary, v.signature?.name ?? '']),
  ])
}

export interface ServiceAlerts { reminders: number; overdueBookings: number; uncollectedJobs: number; expiringPackages: number; lapsedPackages: number; missedVisits: number }
/** The counts the Home notices and badges show. Cheap enough to run on every change. */
export function serviceAlerts(state: DataState, now: number): ServiceAlerts {
  return {
    reminders: remindersDue(state, now).length, overdueBookings: overdueBookings(state, now).length, uncollectedJobs: uncollected(state, now).length,
    expiringPackages: expiringSoon(state, now).length, lapsedPackages: lapsed(state, now).length, missedVisits: missedVisits(state, now).length,
  }
}
