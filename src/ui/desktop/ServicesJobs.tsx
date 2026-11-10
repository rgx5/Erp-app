import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { isLate, isOpenJob, jobAgeDays, JOB_LABEL, jobBoard, jobTotals, KIND_LABEL } from '@/modules/services/logic/jobs'
import { JOB_TONE } from '@/modules/services/ui/common'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, dtext, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

type Filter = 'open' | 'ready' | 'all'
type Row = { id: string; no: string; title: string; kind: string; party: string; identifier: string; status: string; age: number | null; late: boolean; total: number }

/**
 * The desktop job-card board: a KPI strip (open jobs, open value, awaiting approval), a status filter and a dense
 * sortable grid of jobs — instead of the phone's filter chips and stacked cards. Every figure comes from the exact
 * functions the phone `m/services/jobs/index.tsx` already calls (`jobBoard`, `isLate`, `jobAgeDays`, `jobTotals`).
 */
export function DesktopServicesJobs() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const [filter, setFilter] = useState<Filter>('open')
  const board = useMemo(() => jobBoard(data, now), [data, now])
  const all = useMemo(() => listOf(data.jobCards ?? {}).sort((a, b) => b.receivedAt - a.receivedAt), [data.jobCards])
  const rows = filter === 'all' ? all : filter === 'ready' ? all.filter((j) => j.status === 'ready') : all.filter(isOpenJob)

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Job cards" />}>
        <View style={{ padding: 20 }}><T tone="mute">Job cards are for people who work at the counter.</T></View>
      </DeskPage>
    )
  }

  const tableRows: Row[] = rows.map((j) => ({
    id: j.id, no: j.no, title: j.title || KIND_LABEL[j.kind], kind: KIND_LABEL[j.kind], party: j.partyName, identifier: j.identifier,
    status: JOB_LABEL[j.status], age: isOpenJob(j) ? jobAgeDays(j, now) : null, late: isLate(j, now), total: jobTotals(j).total,
  }))

  const columns: Array<Column<Row>> = [
    { key: 'no', label: 'Job', sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.no} · {r.title}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{[r.party, r.identifier].filter(Boolean).join(' · ')}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 160, sortValue: (r) => r.status, render: (r) => (
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <Pill tone={JOB_TONE[rows.find((j) => j.id === r.id)!.status]} label={r.status} />
        {r.late ? <Pill tone="danger" label="Late" /> : null}
      </View>
    ) },
    { key: 'age', label: 'Age', width: 90, align: 'right', sortValue: (r) => r.age ?? -1, render: (r) => cellText(r.age !== null ? `${r.age} d` : '—') },
    { key: 'total', label: 'Total', width: 120, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Job cards"
          subtitle="Repairs and work orders"
          right={<DeskButton label="Intake" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/services/jobs/new')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Open" value={String(board.open)} tone={board.late ? 'danger' : 'primary'} delta={board.late ? `${board.late} late` : 'None late'} />
        <KpiTile label="Open value" value={inr(board.openValue, 0)} tone="success" delta={`${board.awaitingApproval} awaiting approval`} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented<Filter> value={filter} onChange={setFilter} options={[{ id: 'open', label: `Open (${board.open})` }, { id: 'ready', label: `Ready (${board.ready})` }, { id: 'all', label: 'All' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={tableRows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/services/jobs/[id]', params: { id: r.id } })} emptyLabel="Nothing here" />
      </View>
    </DeskPage>
  )
}
