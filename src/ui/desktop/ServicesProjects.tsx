import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'
import { projectBoard, PROJECT_LABEL } from '@/modules/services/logic/projects'
import type { ProjectStatus } from '@/modules/services/types'
import { DataTable, DeskButton, DeskPage, DeskSegmented, dtext, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

const TONE: Record<ProjectStatus, Tone> = { active: 'primary', on_hold: 'warning', completed: 'success', cancelled: 'default' }
type Filter = ProjectStatus | 'all'
type Row = { id: string; no: string; name: string; customer: string; billing: string; status: ProjectStatus; hours: number; unbilledHours: number; value: number; sub: string }

/**
 * The desktop projects & timesheets board: the same `projectBoard` figures as the phone screen, as a dense
 * sortable grid with a status filter — instead of stacked cards.
 */
export function DesktopServicesProjects() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const [filter, setFilter] = useState<Filter>('active')
  const board = useMemo(() => projectBoard(data, now), [data, now])
  const list = filter === 'all' ? board : board.filter((r) => r.project.status === filter)

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Projects & timesheets" />}>
        <View style={{ padding: 20 }}><T tone="mute">Projects are for people who work at the counter.</T></View>
      </DeskPage>
    )
  }

  const rows: Row[] = list.map(({ project: pr, summary: s }) => ({
    id: pr.id, no: pr.no, name: pr.name, customer: pr.customerId ? data.customers[pr.customerId]?.name ?? '' : 'No customer', billing: pr.billing === 'hourly' ? 'Hourly' : 'Fixed fee',
    status: pr.status, hours: s.hours, unbilledHours: s.unbilledHours, value: pr.billing === 'hourly' ? s.unbilledAmount : s.fixedLeft, sub: pr.billing === 'hourly' ? 'unbilled' : 'left to invoice',
  }))

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Project', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.no} · {r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.customer} · {r.billing}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 120, sortValue: (r) => r.status, render: (r) => <Pill tone={TONE[r.status]} label={PROJECT_LABEL[r.status]} /> },
    { key: 'hours', label: 'Hours', width: 130, align: 'right', sortValue: (r) => r.hours, render: (r) => cellText(`${r.hours} h${r.unbilledHours ? ` · ${r.unbilledHours} unbilled` : ''}`) },
    { key: 'value', label: 'Value', width: 140, align: 'right', sortValue: (r) => r.value, render: (r) => (
      <View style={{ alignItems: 'flex-end' }}>{cellNum(inr(r.value, 0), true)}<T style={[dtext.tiny, { color: c.inkMute }]}>{r.sub}</T></View>
    ) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Projects & timesheets"
          subtitle="Tasks, hours and billing"
          right={<DeskButton label="New" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/services/projects/new')} />}
        />
      }
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 }}>
        <DeskSegmented<Filter> value={filter} onChange={setFilter} options={[{ id: 'active', label: PROJECT_LABEL.active }, { id: 'on_hold', label: PROJECT_LABEL.on_hold }, { id: 'completed', label: PROJECT_LABEL.completed }, { id: 'cancelled', label: PROJECT_LABEL.cancelled }, { id: 'all', label: 'All' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/services/projects/[id]', params: { id: r.id } })} emptyLabel="No projects yet" />
      </View>
    </DeskPage>
  )
}
