import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { fmtDate, fmtDateTime, RANGE_OPTIONS, rangeBounds, type RangeKey } from '@/domain/dates'
import { csvFileName } from '@/domain/csv'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Card, Chip, ProgressBar } from '@/ui/primitives'
import { EmptyState, KV, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChartColumn, Download } from '@/ui/icons'
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
import { Denied, JOB_TONE, PACKAGE_TONE, useTeam, VISIT_TONE } from '@/modules/services/ui/common'

type Tab = 'appointments' | 'utilisation' | 'packages' | 'jobs' | 'projects' | 'timesheets' | 'visits'
const TABS: Array<[Tab, string]> = [['appointments', 'Appointments'], ['utilisation', 'Utilisation'], ['packages', 'Packages'], ['jobs', 'Repairs'], ['projects', 'Projects'], ['timesheets', 'Timesheets'], ['visits', 'Visits']]
const RANGED: Tab[] = ['appointments', 'utilisation', 'timesheets', 'visits']

/** Every Services report, one screen with a tab per topic — the numbers plus a CSV to hand to the accountant. */
export default function ServiceReports() {
  const { c } = useTheme()
  const params = useLocalSearchParams<{ tab?: string }>()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const team = useTeam()
  const now = Date.now()
  const [tab, setTab] = useState<Tab>((TABS.some(([k]) => k === params.tab) ? params.tab : 'appointments') as Tab)
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

  if (!can) return <Denied title="Reports" who="Services reports are for people who work at the counter." />
  return (
    <Screen title="Services reports" back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{TABS.map(([k, l]) => <Chip key={k} label={l} selected={tab === k} onPress={() => setTab(k)} />)}</View>
        {RANGED.includes(tab) ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{RANGE_OPTIONS.map((o) => <Chip key={o.value} label={o.label} selected={range === o.value} onPress={() => setRange(o.value)} />)}</View> : null}

        {tab === 'appointments' ? (
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <StatTile label="Bookings" value={String(appts.length)} style={{ flex: 1 }} />
              <StatTile label="No-shows" value={String(appts.filter((a) => a.status === 'no_show').length)} tone="danger" style={{ flex: 1 }} />
              <StatTile label="Earned" value={inr(appts.filter((a) => a.status === 'completed').reduce((s, a) => s + apptTotal(a), 0), 0)} tone="success" style={{ flex: 1 }} />
            </View>
            <Section title="Who keeps missing" style={{ marginTop: 0 }}>
              {noShows.length ? noShows.slice(0, 20).map((r) => <Card key={r.key} style={{ marginBottom: 8 }}><KV k={r.name || r.phone} v={`${r.count} of ${r.of}`} sub={`Last missed ${fmtDate(r.last)}`} tone="danger" /></Card>) : <T tone="mute">Nobody has missed a booking in this range.</T>}
            </Section>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Export bookings" kind="soft" size="sm" icon={<Download size={15} color={c.primary} />} onPress={() => void shareFile(csvFileName('appointments'), appointmentsCsv(data, from, to))} />
              <Button label="Export no-shows" kind="ghost" size="sm" onPress={() => void shareFile(csvFileName('no-shows'), noShowCsv(data, from, to))} />
            </View>
            {appts.length ? (
              <Section title="All bookings" style={{ marginTop: 0 }}>
                {appts.sort((a, b) => b.start - a.start).slice(0, 30).map((a) => (
                  <Card key={a.id} style={{ marginBottom: 8 }}><KV k={`${a.partyName} · ${apptTitle(a)}`} v={APPT_LABEL[a.status]} sub={fmtDateTime(a.start)} /></Card>
                ))}
              </Section>
            ) : null}
          </View>
        ) : null}

        {tab === 'utilisation' ? (
          <View style={{ gap: 10 }}>
            {util.length ? util.map((u) => (
              <Card key={u.resource.id} style={{ gap: 8 }}>
                <KV k={u.resource.name} v={`${u.pct}%`} sub={`${Math.round(u.booked / 60)} h of ${Math.round(u.available / 60)} h · ${u.appointments} bookings${u.noShows ? `, ${u.noShows} no-shows` : ''}`} strong />
                <ProgressBar value={u.pct / 100} tone={u.pct > 85 ? 'warning' : 'primary'} />
              </Card>
            )) : <EmptyState compact icon={<ChartColumn size={22} color={c.primary} />} title="No columns to measure" />}
            <Button label="Export CSV" kind="soft" size="sm" icon={<Download size={15} color={c.primary} />} onPress={() => void shareFile(csvFileName('utilisation'), utilisationCsv(data, from, to))} />
          </View>
        ) : null}

        {tab === 'packages' ? (
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <StatTile label="Held (deferred)" value={inr(liability.deferred, 0)} tone="warning" style={{ flex: 1 }} />
              <StatTile label="Earned so far" value={inr(liability.recognised, 0)} tone="success" style={{ flex: 1 }} />
            </View>
            <T v="caption" tone="mute">{liability.sessionsOutstanding} session{liability.sessionsOutstanding === 1 ? '' : 's'} still owed · {inr(liability.sold, 0)} sold in all</T>
            {liability.rows.length ? liability.rows.slice(0, 40).map((r) => (
              <Card key={r.id} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{data.customers[r.customerId]?.name ?? r.no} · {r.name}</T>
                  <Badge tone={PACKAGE_TONE[r.status]}>{PKG_LABEL[r.status]}</Badge>
                </View>
                <KV k={`${r.used} of ${r.sessions} used`} v={inr(r.deferred, 0)} sub={r.expiresAt ? `Till ${fmtDate(r.expiresAt)}` : 'No expiry'} />
              </Card>
            )) : <T tone="mute">Nothing held right now.</T>}
            <Button label="Export CSV" kind="soft" size="sm" icon={<Download size={15} color={c.primary} />} onPress={() => void shareFile(csvFileName('package-liability'), liabilityCsv(data, now))} />
          </View>
        ) : null}

        {tab === 'jobs' ? (
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {ageing.buckets.map((b) => <Card key={b.label} style={{ flexGrow: 1, gap: 2 }}><T v="caption" tone="mute">{b.label}</T><T v="bodyStrong">{b.count} · {inr(b.value, 0)}</T></Card>)}
            </View>
            {ageing.rows.length ? ageing.rows.slice(0, 40).map((r) => (
              <Card key={r.job.id} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{r.job.no} · {r.job.title}</T>
                  <Badge tone={r.late ? 'danger' : JOB_TONE[r.job.status]}>{JOB_LABEL[r.job.status]}</Badge>
                </View>
                <KV k={`${r.days} day${r.days === 1 ? '' : 's'} with us`} v={inr(r.total, 0)} />
              </Card>
            )) : <T tone="mute">No open job cards.</T>}
            <Button label="Export CSV" kind="soft" size="sm" icon={<Download size={15} color={c.primary} />} onPress={() => void shareFile(csvFileName('repairs-by-age'), jobsCsv(data, now))} />
          </View>
        ) : null}

        {tab === 'projects' ? (
          <View style={{ gap: 14 }}>
            {projects.length ? projects.map(({ project: p, summary: s }) => (
              <Card key={p.id} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{p.no} · {p.name}</T>
                  <Badge>{PROJECT_LABEL[p.status]}</Badge>
                </View>
                <KV k={`${s.hours} h worked`} v={inr(p.billing === 'hourly' ? s.unbilledAmount : s.fixedLeft, 0)} sub={p.billing === 'hourly' ? 'unbilled' : 'left to invoice'} />
              </Card>
            )) : <T tone="mute">No projects yet.</T>}
            <Button label="Export CSV" kind="soft" size="sm" icon={<Download size={15} color={c.primary} />} onPress={() => void shareFile(csvFileName('project-hours-billing'), projectsCsv(data, now))} />
          </View>
        ) : null}

        {tab === 'timesheets' ? (
          <View style={{ gap: 14 }}>
            <Select label="Person" value={userId} placeholder="Everyone" options={[{ value: '', label: 'Everyone' }, ...team.map((u) => ({ value: u.id, label: u.name }))]} onChange={setUserId} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <StatTile label="Hours" value={String(Math.round(sheet.minutes / 60))} style={{ flex: 1 }} />
              <StatTile label="Billable" value={inr(sheet.amount, 0)} tone="success" style={{ flex: 1 }} />
            </View>
            {sheet.days.length ? sheet.days.map((d) => (
              <Card key={d.day} style={{ gap: 4 }}>
                <KV k={fmtDate(d.day)} v={`${Math.round(d.minutes / 60 * 10) / 10} h`} strong />
                {d.entries.map((e) => <T key={e.id} v="caption" tone="mute">{data.users[e.userId]?.name ?? ''} · {data.projects?.[e.projectId]?.name ?? ''} · {Math.round(e.minutes / 6) / 10} h</T>)}
              </Card>
            )) : <T tone="mute">Nothing logged in this range.</T>}
            <Button label="Export CSV" kind="soft" size="sm" icon={<Download size={15} color={c.primary} />} onPress={() => void shareFile(csvFileName('timesheets'), timesheetCsv(data, userId || null, from, to, now))} />
          </View>
        ) : null}

        {tab === 'visits' ? (
          <View style={{ gap: 14 }}>
            {visits.length ? visits.slice(0, 40).map(({ visit: v, minutes }) => (
              <Card key={v.id} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{v.partyName}</T>
                  <Badge tone={VISIT_TONE[v.status]}>{VISIT_LABEL[v.status]}</Badge>
                </View>
                <KV k={fmtDateTime(v.plannedAt)} v={minutes !== null ? `${minutes} min` : '—'} sub={data.users[v.userId]?.name ?? ''} />
              </Card>
            )) : <T tone="mute">No visits in this range.</T>}
            <Button label="Export CSV" kind="soft" size="sm" icon={<Download size={15} color={c.primary} />} onPress={() => void shareFile(csvFileName('field-visits'), visitsCsv(data, from, to, now))} />
          </View>
        ) : null}
      </View>
    </Screen>
  )
}
