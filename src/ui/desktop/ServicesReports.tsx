import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { fmtDate, fmtDateTime, RANGE_OPTIONS, rangeBounds, type RangeKey } from '@/domain/dates'
import { csvFileName } from '@/domain/csv'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { Select } from '@/ui/Inputs'
import { T } from '@/ui/Text'
import { Download } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { APPT_LABEL, apptTitle, apptTotal, noShowReport } from '@/modules/services/logic/appointments'
import { utilisation } from '@/modules/services/logic/calendar'
import { jobAgeing, JOB_LABEL } from '@/modules/services/logic/jobs'
import { packageLiability, STATUS_LABEL as PKG_LABEL } from '@/modules/services/logic/packages'
import { PROJECT_LABEL, projectBoard, timesheet } from '@/modules/services/logic/projects'
import {
  appointmentsCsv, jobsCsv, liabilityCsv, noShowCsv, projectsCsv, timesheetCsv, utilisationCsv, visitsCsv,
} from '@/modules/services/logic/reports'
import { visitLog, VISIT_LABEL } from '@/modules/services/logic/visits'
import { listOf } from '@/data/state'
import { JOB_TONE, PACKAGE_TONE, useTeam, VISIT_TONE } from '@/modules/services/ui/common'
import { DataTable, DeskButton, DeskPage, DeskSegmented, dtext, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText } from './kit'

type Tab = 'appointments' | 'utilisation' | 'packages' | 'jobs' | 'projects' | 'timesheets' | 'visits'
const TABS: Array<[Tab, string]> = [['appointments', 'Appointments'], ['utilisation', 'Utilisation'], ['packages', 'Packages'], ['jobs', 'Repairs'], ['projects', 'Projects'], ['timesheets', 'Timesheets'], ['visits', 'Visits']]
const RANGED: Tab[] = ['appointments', 'utilisation', 'timesheets', 'visits']

/**
 * The desktop services reports screen: the same tabs and figures the phone `m/services/reports.tsx` computes
 * (`noShowReport`, `utilisation`, `packageLiability`, `jobAgeing`, `projectBoard`, `timesheet`, `visitLog`), each
 * tab as a KPI strip and a dense grid instead of stacked cards, with the same CSV exports.
 */
export function DesktopServicesReports() {
  const { c } = useTheme()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const team = useTeam()
  const now = Date.now()
  const [tab, setTab] = useState<Tab>('appointments')
  const [range, setRange] = useState<RangeKey>('30d')
  const [userId, setUserId] = useState('')
  const [from, to] = rangeBounds(range, now)

  const appts = useMemo(() => listOf(data.appointments ?? {}).filter((a) => a.start >= from && a.start <= to), [data.appointments, from, to])
  const noShows = useMemo(() => noShowReport(data, from, to), [data, from, to])
  const util = useMemo(() => utilisation(data, from, to), [data, from, to])
  const liability = useMemo(() => packageLiability(data, now), [data, now])
  const ageing = useMemo(() => jobAgeing(data, now), [data, now])
  const projects = useMemo(() => projectBoard(data, now), [data, now])
  const sheet = useMemo(() => timesheet(data, userId || null, from, to, now), [data, userId, from, to, now])
  const visits = useMemo(() => visitLog(data, from, to, now), [data, from, to, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Services reports" />}>
        <View style={{ padding: 20 }}><T tone="mute">Services reports are for people who work at the counter.</T></View>
      </DeskPage>
    )
  }

  const exportBtn = (lbl: string, run: () => void) => <DeskButton key={lbl} label={lbl} icon={<Download size={14} color={c.ink} />} onPress={run} />

  return (
    <DeskPage toolbar={<Toolbar title="Services reports" />}>
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, gap: 10 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{TABS.map(([k, l]) => <DeskButton key={k} label={l} tone={tab === k ? 'primary' : 'default'} onPress={() => setTab(k)} />)}</View>
        {RANGED.includes(tab) ? <DeskSegmented<RangeKey> value={range} onChange={setRange} options={RANGE_OPTIONS.map((o) => ({ id: o.value, label: o.label }))} /> : null}
      </View>

      {tab === 'appointments' ? (
        <>
          <KpiStrip>
            <KpiTile label="Bookings" value={String(appts.length)} />
            <KpiTile label="No-shows" value={String(appts.filter((a) => a.status === 'no_show').length)} tone="danger" />
            <KpiTile label="Earned" value={inr(appts.filter((a) => a.status === 'completed').reduce((s, a) => s + apptTotal(a), 0), 0)} tone="success" />
          </KpiStrip>
          <View style={{ paddingHorizontal: 20, paddingBottom: 10, flexDirection: 'row', gap: 8 }}>
            {exportBtn('Export bookings', () => void shareFile(csvFileName('appointments'), appointmentsCsv(data, from, to)))}
            {exportBtn('Export no-shows', () => void shareFile(csvFileName('no-shows'), noShowCsv(data, from, to)))}
          </View>
          <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              rows={appts.sort((a, b) => b.start - a.start).map((a) => ({ id: a.id, title: `${a.partyName} · ${apptTitle(a)}`, status: APPT_LABEL[a.status], when: fmtDateTime(a.start), ts: a.start }))}
              columns={[
                { key: 'title', label: 'Booking', sortValue: (r) => r.title, render: (r) => cellText(r.title, true) },
                { key: 'status', label: 'Status', width: 130, sortValue: (r) => r.status, render: (r) => cellText(r.status) },
                { key: 'when', label: 'When', width: 180, sortValue: (r) => r.ts, render: (r) => cellText(r.when) },
              ]}
              emptyLabel="No bookings in this range"
            />
          </View>

          {noShows.length ? (
            <View style={{ paddingHorizontal: 20, paddingBottom: 6 }}><T style={[dtext.label, { color: c.inkMute }]}>Repeat no-shows</T></View>
          ) : null}
          <View style={{ height: 160, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              rows={noShows.map((r) => ({ id: r.key, name: r.name || r.phone, count: `${r.count} of ${r.of}`, last: fmtDate(r.last), ts: r.last }))}
              columns={[
                { key: 'name', label: 'Customer', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
                { key: 'count', label: 'Missed', width: 110, align: 'right', render: (r) => cellText(r.count) },
                { key: 'last', label: 'Last missed', width: 140, sortValue: (r) => r.ts, render: (r) => cellText(r.last) },
              ]}
              compact
              emptyLabel="Nobody has missed a booking in this range"
            />
          </View>
        </>
      ) : null}

      {tab === 'utilisation' ? (
        <>
          <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>{exportBtn('Export CSV', () => void shareFile(csvFileName('utilisation'), utilisationCsv(data, from, to)))}</View>
          <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              rows={util.map((u) => ({ id: u.resource.id, name: u.resource.name, pct: u.pct, detail: `${Math.round(u.booked / 60)} h of ${Math.round(u.available / 60)} h · ${u.appointments} bookings${u.noShows ? `, ${u.noShows} no-shows` : ''}` }))}
              columns={[
                { key: 'name', label: 'Resource', sortValue: (r) => r.name, render: (r) => (
                  <View style={{ gap: 1 }}><T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T><T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.detail}</T></View>
                ) },
                { key: 'pct', label: 'Utilisation', width: 120, align: 'right', sortValue: (r) => r.pct, render: (r) => <Pill tone={r.pct > 85 ? 'warning' : 'primary'} label={`${r.pct}%`} /> },
              ]}
              emptyLabel="No columns to measure"
            />
          </View>
        </>
      ) : null}

      {tab === 'packages' ? (
        <>
          <KpiStrip>
            <KpiTile label="Held (deferred)" value={inr(liability.deferred, 0)} tone="warning" delta={`${liability.sessionsOutstanding} session${liability.sessionsOutstanding === 1 ? '' : 's'} owed`} />
            <KpiTile label="Earned so far" value={inr(liability.recognised, 0)} tone="success" delta={`${inr(liability.sold, 0)} sold in all`} />
          </KpiStrip>
          <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>{exportBtn('Export CSV', () => void shareFile(csvFileName('package-liability'), liabilityCsv(data, now)))}</View>
          <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              rows={liability.rows.map((r) => ({ id: r.id, title: `${data.customers[r.customerId]?.name ?? r.no} · ${r.name}`, status: PKG_LABEL[r.status], tone: PACKAGE_TONE[r.status], used: `${r.used} of ${r.sessions}`, deferred: r.deferred, till: r.expiresAt ? `Till ${fmtDate(r.expiresAt)}` : 'No expiry' }))}
              columns={[
                { key: 'title', label: 'Package', sortValue: (r) => r.title, render: (r) => (
                  <View style={{ gap: 1 }}><T style={dtext.cellStrong} numberOfLines={1}>{r.title}</T><T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.used} used · {r.till}</T></View>
                ) },
                { key: 'status', label: 'Status', width: 110, sortValue: (r) => r.status, render: (r) => <Pill tone={r.tone} label={r.status} /> },
                { key: 'deferred', label: 'Held', width: 110, align: 'right', sortValue: (r) => r.deferred, render: (r) => cellNum(inr(r.deferred, 0)) },
              ]}
              emptyLabel="Nothing held right now"
            />
          </View>
        </>
      ) : null}

      {tab === 'jobs' ? (
        <>
          <KpiStrip>{ageing.buckets.map((b) => <KpiTile key={b.label} label={b.label} value={String(b.count)} delta={inr(b.value, 0)} />)}</KpiStrip>
          <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>{exportBtn('Export CSV', () => void shareFile(csvFileName('repairs-by-age'), jobsCsv(data, now)))}</View>
          <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              rows={ageing.rows.map((r) => ({ id: r.job.id, title: `${r.job.no} · ${r.job.title}`, status: JOB_LABEL[r.job.status], tone: r.late ? 'danger' as const : JOB_TONE[r.job.status], days: r.days, total: r.total }))}
              columns={[
                { key: 'title', label: 'Job', sortValue: (r) => r.title, render: (r) => (
                  <View style={{ gap: 1 }}><T style={dtext.cellStrong} numberOfLines={1}>{r.title}</T><T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.days} day{r.days === 1 ? '' : 's'} with us</T></View>
                ) },
                { key: 'status', label: 'Status', width: 120, sortValue: (r) => r.status, render: (r) => <Pill tone={r.tone} label={r.status} /> },
                { key: 'total', label: 'Total', width: 110, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0)) },
              ]}
              emptyLabel="No open job cards"
            />
          </View>
        </>
      ) : null}

      {tab === 'projects' ? (
        <>
          <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 }}>{exportBtn('Export CSV', () => void shareFile(csvFileName('project-hours-billing'), projectsCsv(data, now)))}</View>
          <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              rows={projects.map(({ project: pr, summary: s }) => ({ id: pr.id, title: `${pr.no} · ${pr.name}`, status: PROJECT_LABEL[pr.status], hours: `${s.hours} h`, value: pr.billing === 'hourly' ? s.unbilledAmount : s.fixedLeft, sub: pr.billing === 'hourly' ? 'unbilled' : 'left to invoice' }))}
              columns={[
                { key: 'title', label: 'Project', sortValue: (r) => r.title, render: (r) => (
                  <View style={{ gap: 1 }}><T style={dtext.cellStrong} numberOfLines={1}>{r.title}</T><T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.hours} worked</T></View>
                ) },
                { key: 'status', label: 'Status', width: 110, sortValue: (r) => r.status, render: (r) => cellText(r.status) },
                { key: 'value', label: 'Value', width: 140, align: 'right', sortValue: (r) => r.value, render: (r) => (
                  <View style={{ alignItems: 'flex-end' }}>{cellNum(inr(r.value, 0), true)}<T style={[dtext.tiny, { color: c.inkMute }]}>{r.sub}</T></View>
                ) },
              ]}
              emptyLabel="No projects yet"
            />
          </View>
        </>
      ) : null}

      {tab === 'timesheets' ? (
        <>
          <View style={{ paddingHorizontal: 20, paddingTop: 10, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <View style={{ flex: 1, maxWidth: 280 }}><Select label="Person" value={userId} placeholder="Everyone" options={[{ value: '', label: 'Everyone' }, ...team.map((u) => ({ value: u.id, label: u.name }))]} onChange={setUserId} /></View>
          </View>
          <KpiStrip>
            <KpiTile label="Hours" value={String(Math.round(sheet.minutes / 60))} />
            <KpiTile label="Billable" value={inr(sheet.amount, 0)} tone="success" />
          </KpiStrip>
          <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>{exportBtn('Export CSV', () => void shareFile(csvFileName('timesheets'), timesheetCsv(data, userId || null, from, to, now)))}</View>
          <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              rows={sheet.days.map((d) => ({ id: String(d.day), day: fmtDate(d.day), hours: Math.round(d.minutes / 60 * 10) / 10, detail: d.entries.map((e) => `${data.users[e.userId]?.name ?? ''} · ${data.projects?.[e.projectId]?.name ?? ''} · ${Math.round(e.minutes / 6) / 10} h`).join(' · ') }))}
              columns={[
                { key: 'day', label: 'Day', sortValue: (r) => r.day, render: (r) => (
                  <View style={{ gap: 1 }}><T style={dtext.cellStrong}>{r.day}</T><T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.detail}</T></View>
                ) },
                { key: 'hours', label: 'Hours', width: 110, align: 'right', sortValue: (r) => r.hours, render: (r) => cellNum(`${r.hours} h`, true) },
              ]}
              emptyLabel="Nothing logged in this range"
            />
          </View>
        </>
      ) : null}

      {tab === 'visits' ? (
        <>
          <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 }}>{exportBtn('Export CSV', () => void shareFile(csvFileName('field-visits'), visitsCsv(data, from, to, now)))}</View>
          <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              rows={visits.map(({ visit: v, minutes }) => ({ id: v.id, title: v.partyName, status: VISIT_LABEL[v.status], tone: VISIT_TONE[v.status], when: fmtDateTime(v.plannedAt), minutes: minutes !== null ? `${minutes} min` : '—', by: data.users[v.userId]?.name ?? '' }))}
              columns={[
                { key: 'title', label: 'Visit', sortValue: (r) => r.title, render: (r) => (
                  <View style={{ gap: 1 }}><T style={dtext.cellStrong} numberOfLines={1}>{r.title}</T><T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.when} · {r.by}</T></View>
                ) },
                { key: 'status', label: 'Status', width: 120, sortValue: (r) => r.status, render: (r) => <Pill tone={r.tone} label={r.status} /> },
                { key: 'minutes', label: 'Duration', width: 110, align: 'right', render: (r) => cellText(r.minutes) },
              ]}
              emptyLabel="No visits in this range"
            />
          </View>
        </>
      ) : null}
    </DeskPage>
  )
}
