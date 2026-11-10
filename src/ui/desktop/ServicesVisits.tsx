import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { listOf } from '@/data/state'
import { useApp, useCan } from '@/data/store'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { missedVisits, VISIT_LABEL } from '@/modules/services/logic/visits'
import { VISIT_TONE } from '@/modules/services/ui/common'
import type { VisitStatus } from '@/modules/services/types'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellText, type Column } from './kit'

type Filter = VisitStatus | 'all'
type Row = { id: string; party: string; sub: string; status: VisitStatus; when: string; ts: number }

/** The desktop field-visits screen: the same visit log as a dense grid, with a status filter and the missed-visits count. */
export function DesktopServicesVisits() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const [filter, setFilter] = useState<Filter>('all')
  const missed = useMemo(() => missedVisits(data, now), [data, now])
  const all = useMemo(() => listOf(data.fieldVisits ?? {}).sort((a, b) => b.plannedAt - a.plannedAt), [data.fieldVisits])
  const rows = filter === 'all' ? all : all.filter((v) => v.status === filter)

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Field visits" />}>
        <View style={{ padding: 20 }}><T tone="mute">Field visits are for people who work at the counter.</T></View>
      </DeskPage>
    )
  }

  const tableRows: Row[] = rows.map((v) => ({ id: v.id, party: v.partyName, sub: v.purpose || v.address || '—', status: v.status, when: fmtDateTime(v.plannedAt), ts: v.plannedAt }))
  const columns: Array<Column<Row>> = [
    { key: 'party', label: 'Visit', sortValue: (r) => r.party, render: (r) => cellText(`${r.party} — ${r.sub}`, true) },
    { key: 'status', label: 'Status', width: 130, sortValue: (r) => r.status, render: (r) => <Pill tone={VISIT_TONE[r.status]} label={VISIT_LABEL[r.status]} /> },
    { key: 'when', label: 'Planned', width: 190, sortValue: (r) => r.ts, render: (r) => cellText(r.when) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Field visits"
          subtitle="Check in, report and sign"
          right={<DeskButton label="Plan" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/services/visits/new')} />}
        />
      }
    >
      {missed.length ? (
        <KpiStrip><KpiTile label="Not checked in" value={String(missed.length)} tone="danger" /></KpiStrip>
      ) : null}
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 }}>
        <DeskSegmented<Filter> value={filter} onChange={setFilter} options={[{ id: 'all', label: 'All' }, { id: 'planned', label: VISIT_LABEL.planned }, { id: 'checked_in', label: VISIT_LABEL.checked_in }, { id: 'completed', label: VISIT_LABEL.completed }, { id: 'cancelled', label: VISIT_LABEL.cancelled }]} />
      </View>
      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={tableRows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/services/visits/[id]', params: { id: r.id } })} emptyLabel="No visits yet" />
      </View>
    </DeskPage>
  )
}
