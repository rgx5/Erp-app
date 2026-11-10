import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { isJobLate, isOpenJob, JOB_KIND_LABEL, JOB_LABEL } from '@/modules/manufacturing/jobs'
import type { JobStatus } from '@/modules/manufacturing/types'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, Pill, Toolbar, cellNum, dtext, type Column } from './kit'

const TONE: Record<JobStatus, Tone> = { received: 'default', in_production: 'primary', ready: 'success', delivered: 'default', cancelled: 'danger' }
type Row = { id: string; title: string; customer: string; no: string; kind: string; dueDate: number | undefined; status: JobStatus; late: boolean; charge: number }

/**
 * The desktop Job work & orders screen: an Open/All filter and one dense sortable grid instead of the phone's
 * scrolling cards. Rows use the same `isOpenJob`/`isJobLate` the phone `m/manufacturing/jobs/index.tsx` calls.
 */
export function DesktopJobs() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pos')
  const jobs = useList('jobOrders')
  const customers = useList('customers')
  const [show, setShow] = useState<'open' | 'all'>('open')
  const name = useMemo(() => new Map(customers.map((x) => [x.id, x.name])), [customers])
  const now = Date.now()

  const rows: Row[] = useMemo(() => jobs
    .filter((j) => show === 'all' || isOpenJob(j))
    .sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) || b.createdAt - a.createdAt)
    .map((j) => ({ id: j.id, title: j.title, customer: name.get(j.customerId) ?? 'Customer', no: j.no, kind: JOB_KIND_LABEL[j.kind], dueDate: j.dueDate, status: j.status, late: isJobLate(j, now), charge: j.charge })), [jobs, show, name, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Job work & orders" />}>
        <View style={{ padding: 20 }}><T tone="mute">Customer jobs are taken at the counter.</T></View>
      </DeskPage>
    )
  }

  const columns: Array<Column<Row>> = [
    { key: 'title', label: 'Job', sortValue: (r) => r.title, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.title}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.no} · {r.customer} · {r.kind}{r.dueDate ? ` · due ${fmtDayShort(r.dueDate)}` : ''}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 150, sortValue: (r) => r.status, render: (r) => (
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Pill tone={TONE[r.status]} label={JOB_LABEL[r.status]} />
        {r.late ? <Pill tone="danger" label="Late" /> : null}
      </View>
    ) },
    { key: 'charge', label: 'Charge', width: 110, align: 'right', sortValue: (r) => r.charge, render: (r) => (r.charge > 0 ? cellNum(inr(r.charge, 0)) : null) },
  ]

  return (
    <DeskPage
      toolbar={<Toolbar title="Job work & orders" subtitle={`${jobs.filter(isOpenJob).length} open`} right={<DeskButton label="New job" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/manufacturing/jobs/new' as never)} />} />}
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 }}>
        <DeskSegmented value={show} onChange={setShow} options={[{ id: 'open', label: 'Open' }, { id: 'all', label: 'All' }]} />
      </View>
      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/manufacturing/jobs/[id]', params: { id: r.id } } as never)} emptyLabel="No jobs" />
      </View>
    </DeskPage>
  )
}
