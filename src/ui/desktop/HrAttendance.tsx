import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtTime } from '@/domain/dates'
import { useCan } from '@/data/store'
import { STATUS_LABEL, type DayStatus } from '@/modules/hr/logic/attendance'
import { dayBoard } from '@/modules/hr/logic/select'
import { waitingApprovals } from '@/modules/hr/notices'
import { addDays, labelDayWeek, ymdOf } from '@/modules/hr/logic/ymd'
import { bulkMark } from '@/modules/hr/ops'
import type { Employee } from '@/modules/hr/types'
import { act, useHr } from '@/modules/hr/ui/common'
import { DayEditor } from '@/modules/hr/ui/DayEditor'
import { PunchCard } from '@/modules/hr/ui/PunchCard'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { attendanceTone } from './hrShared'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, Toolbar, dtext, type Column } from './kit'

type Row = { id: string; name: string; meta: string; status: DayStatus }

/**
 * The desktop Attendance home: today's board as a `KpiStrip` (in / waiting) plus a dense grid of everyone, a day
 * at a time, with the exact prev/next day control the phone screen has — instead of a scrolling card list. Marking
 * a day reuses `DayEditor` unchanged (it carries its own state and calls the same `markAttendance`/
 * `requestRegularisation` ops either screen would). For someone with no HR access, just their own `PunchCard`.
 */
export function DesktopAttendanceHome() {
  const { c } = useTheme()
  const router = useRouter()
  const isHr = useCan('hr')
  const isSelf = useCan('hrSelf')
  const { data, idx, me, now } = useHr()
  const today = ymdOf(now)
  const [date, setDate] = useState(today)
  const [editing, setEditing] = useState<Employee | null>(null)
  const board = useMemo(() => (isHr ? dayBoard(data, idx, date, now) : []), [isHr, data, idx, date, now])
  const waiting = waitingApprovals(data).regularisations

  if (!isSelf && !isHr) {
    return (
      <DeskPage toolbar={<Toolbar title="Attendance" />}>
        <View style={{ padding: 20 }}><T tone="mute">Attendance is for staff and managers.</T></View>
      </DeskPage>
    )
  }

  if (!isHr) {
    return (
      <DeskPage toolbar={<Toolbar title="Attendance" />}>
        <View style={{ padding: 20, maxWidth: 420, gap: 12 }}>
          {me ? <PunchCard employee={me} /> : <T tone="mute">You are not on the staff list. Ask the owner to add you as an employee and link your sign-in.</T>}
          {me ? <DeskButton label="My month" onPress={() => router.push({ pathname: '/m/hr/attendance/month', params: { employeeId: me.id } } as never)} /> : null}
        </View>
      </DeskPage>
    )
  }

  const markable = board.filter((b) => b.info.status === 'unmarked' || b.info.status === 'future')
  const present = board.filter((b) => b.info.presentFrac > 0).length
  const rows: Row[] = board.map(({ employee: e, info }) => ({
    id: e.id, name: e.name,
    meta: [info.inAt ? `In ${fmtTime(info.inAt)}` : info.holiday ?? '', info.outAt ? `Out ${fmtTime(info.outAt)}` : info.incomplete ? 'no punch-out' : '', info.late ? 'late' : '', info.source === 'mark' ? 'marked' : ''].filter(Boolean).join(' · '),
    status: info.status,
  }))

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Name', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.meta}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 140, sortValue: (r) => r.status, render: (r) => <Pill tone={attendanceTone(r.status)} label={STATUS_LABEL[r.status] || 'Not yet'} /> },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Attendance"
          subtitle={date === today ? `Today · ${labelDayWeek(date)}` : labelDayWeek(date)}
          left={
            <>
              <DeskButton label="‹" onPress={() => setDate(addDays(date, -1))} />
              <DeskButton label="›" disabled={date >= today} onPress={() => date < today && setDate(addDays(date, 1))} />
            </>
          }
          right={
            <>
              {markable.length && date <= today ? <DeskButton label={`Mark ${markable.length} present`} tone="primary" onPress={() => act((s, ctx) => bulkMark(s, date, markable.map((m) => m.employee.id), 'present', ctx), 'Marked')} /> : null}
              <DeskButton label="Month sheet" onPress={() => router.push('/m/hr/attendance/month')} />
              <DeskButton label={waiting ? `Fix requests · ${waiting}` : 'Fix requests'} onPress={() => router.push('/m/hr/attendance/requests')} />
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label="In today" value={`${present}/${board.length}`} tone="success" />
        <KpiTile label="Waiting on fixes" value={String(waiting)} tone={waiting ? 'warning' : 'success'} />
      </KpiStrip>

      {me ? <View style={{ paddingHorizontal: 14, paddingTop: 4, maxWidth: 420 }}><PunchCard employee={me} title="My attendance" /></View> : null}

      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => date <= today && setEditing(board.find((b) => b.employee.id === r.id)?.employee ?? null)} emptyLabel="No one on the staff" />
      </View>

      {editing ? <DayEditor employee={editing} date={date} mode="mark" visible onClose={() => setEditing(null)} /> : null}
    </DeskPage>
  )
}
