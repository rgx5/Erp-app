import React, { useMemo } from 'react'
import { View } from 'react-native'
import { fmtTime } from '@/domain/dates'
import { useCan } from '@/data/store'
import { decisionsByRef, statusOf, type RequestStatus } from '@/modules/hr/logic/decisions'
import { labelDayWeek } from '@/modules/hr/logic/ymd'
import { decideRegularisation } from '@/modules/hr/ops'
import { act, useHr } from '@/modules/hr/ui/common'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Pill, Toolbar, dtext, type Column } from './kit'

type Row = { id: string; name: string; meta: string; reason: string; status: RequestStatus }

/** The desktop attendance-fixes screen: the same requests, approve/reject inline, as a dense grid. */
export function DesktopAttendanceRequests() {
  const { c } = useTheme()
  const isHr = useCan('hr')
  const isSelf = useCan('hrSelf')
  const { data, me } = useHr()
  const rows = useMemo(() => {
    const by = decisionsByRef(data)
    return Object.values(data.regularisations ?? {}).map((r) => ({ r, status: statusOf(by.get(r.id)) })).filter((x) => isHr || x.r.employeeId === me?.id).sort((a, b) => b.r.requestedAt - a.r.requestedAt)
  }, [data, isHr, me?.id])

  if (!isHr && !isSelf) {
    return (
      <DeskPage toolbar={<Toolbar title="Attendance fixes" />}>
        <View style={{ padding: 20 }}><T tone="mute">Attendance is for staff and managers.</T></View>
      </DeskPage>
    )
  }

  const tableRows: Row[] = rows.map(({ r, status }) => ({
    id: r.id, name: data.employees?.[r.employeeId]?.name ?? 'Former staff',
    meta: [labelDayWeek(r.date), r.inAt ? `In ${fmtTime(r.inAt)}` : '', r.outAt ? `Out ${fmtTime(r.outAt)}` : ''].filter(Boolean).join(' · '),
    reason: r.reason, status,
  }))

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Person', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.meta}</T>
      </View>
    ) },
    { key: 'reason', label: 'Reason', render: (r) => <T style={dtext.cell} numberOfLines={2}>{r.reason}</T> },
    { key: 'status', label: 'Status', width: 110, sortValue: (r) => r.status, render: (r) => <Pill tone={r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warning' : 'default'} label={r.status === 'pending' ? 'Waiting' : r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Cancelled'} /> },
    { key: 'actions', label: '', width: 180, render: (r) => (
      r.status === 'pending' && isHr ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <DeskButton label="Reject" onPress={() => act((s, ctx) => decideRegularisation(s, r.id, 'rejected', '', ctx), 'Rejected')} />
          <DeskButton label="Approve" tone="primary" onPress={() => act((s, ctx) => decideRegularisation(s, r.id, 'approved', '', ctx), 'Approved')} />
        </View>
      ) : null
    ) },
  ]

  return (
    <DeskPage toolbar={<Toolbar title="Attendance fixes" />}>
      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={tableRows} columns={columns} emptyLabel="Nothing waiting" />
      </View>
    </DeskPage>
  )
}
