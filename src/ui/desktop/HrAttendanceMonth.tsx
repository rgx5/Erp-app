import React, { useMemo, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { fmtTime } from '@/domain/dates'
import { useCan } from '@/data/store'
import { STATUS_LABEL, type DayStatus } from '@/modules/hr/logic/attendance'
import { employeeMonth } from '@/modules/hr/logic/select'
import { attendanceSheetTable } from '@/modules/hr/logic/reports'
import { addMonths, labelDayWeek, labelYM, ymOf, ymdOf } from '@/modules/hr/logic/ymd'
import type { YM, YMD } from '@/modules/hr/types'
import { EmployeeSelect, useHr } from '@/modules/hr/ui/common'
import { DayEditor } from '@/modules/hr/ui/DayEditor'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { attendanceTone, HrTableGrid } from './hrShared'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, Toolbar, dtext, type Column } from './kit'

type DayRow = { id: string; date: YMD; label: string; meta: string; status: DayStatus }

/**
 * The desktop attendance-month screen: for a manager with no one person chosen, the whole-staff sheet as a dense
 * grid (`HrTableGrid`, from the exact `attendanceSheetTable` the phone screen builds); for one person, a `KpiStrip`
 * of the month's summary plus a day-by-day grid instead of a scrolling list of cards. Clicking a day opens the
 * unchanged `DayEditor`.
 */
export function DesktopAttendanceMonth() {
  const { c } = useTheme()
  const params = useLocalSearchParams<{ employeeId?: string }>()
  const isHr = useCan('hr')
  const isSelf = useCan('hrSelf')
  const { data, idx, me, now } = useHr()
  const [month, setMonth] = useState<YM>(ymOf(now))
  const [empId, setEmpId] = useState(params.employeeId ?? (isHr ? '' : me?.id ?? ''))
  const [day, setDay] = useState<YMD | null>(null)
  const employees = Object.values(data.employees ?? {}).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))
  const emp = empId ? data.employees?.[empId] : undefined
  const m = useMemo(() => (emp ? employeeMonth(data, idx, emp, month, now) : null), [data, idx, emp, month, now])
  const sheet = useMemo(() => (isHr && !emp ? attendanceSheetTable(data, month, now) : null), [isHr, data, month, now, emp])
  const today = ymdOf(now)

  if (!isHr && !isSelf) {
    return (
      <DeskPage toolbar={<Toolbar title="Attendance month" />}>
        <View style={{ padding: 20 }}><T tone="mute">Attendance is for staff and managers.</T></View>
      </DeskPage>
    )
  }

  const own = !!me && me.id === empId
  const canEdit = isHr || own

  const dayRows: DayRow[] = m ? m.sheet.filter((d) => d.status !== 'notEmployed').map((d) => ({
    id: d.date, date: d.date, label: labelDayWeek(d.date),
    meta: [d.inAt ? `In ${fmtTime(d.inAt)}` : d.holiday ?? '', d.outAt ? `Out ${fmtTime(d.outAt)}` : '', d.late ? 'late' : '', d.source === 'mark' ? 'marked' : ''].filter(Boolean).join(' · '),
    status: d.status,
  })) : []

  const dayColumns: Array<Column<DayRow>> = [
    { key: 'day', label: 'Day', sortValue: (r) => r.date, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.label}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.meta}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 140, sortValue: (r) => r.status, render: (r) => (STATUS_LABEL[r.status] ? <Pill tone={attendanceTone(r.status)} label={STATUS_LABEL[r.status]} /> : null) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Attendance month"
          subtitle={labelYM(month)}
          right={<><DeskButton label="‹" onPress={() => setMonth(addMonths(month, -1))} /><DeskButton label="›" disabled={month >= ymOf(now)} onPress={() => month < ymOf(now) && setMonth(addMonths(month, 1))} /></>}
        />
      }
    >
      {isHr ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 14, width: 260 }}>
          <EmployeeSelect label="Person" value={empId} onChange={setEmpId} employees={employees} />
        </View>
      ) : null}

      {emp && m ? (
        <KpiStrip>
          <KpiTile label="Days worked" value={String(m.summary.presentDays)} />
          <KpiTile label="Paid leave" value={String(m.summary.paidLeaveDays)} />
          <KpiTile label="Holidays & offs" value={String(m.summary.holidayDays + m.summary.weekoffDays)} />
          <KpiTile label="Loss of pay" value={String(m.summary.lopDays)} tone={m.summary.lopDays ? 'warning' : 'default'} delta={m.summary.unmarkedDays ? `${m.summary.unmarkedDays} not marked` : undefined} />
          <KpiTile label="Late" value={String(m.summary.lateCount)} />
          {m.summary.overtimeMins ? <KpiTile label="Overtime" value={`${Math.round((m.summary.overtimeMins / 60) * 10) / 10} h`} /> : null}
        </KpiStrip>
      ) : null}

      {sheet ? (
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <HrTableGrid table={sheet} />
        </View>
      ) : emp && m ? (
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={dayRows} columns={dayColumns} onRowPress={(r) => canEdit && r.date <= today && setDay(r.date)} emptyLabel="No days this month" />
        </View>
      ) : (
        <View style={{ padding: 20 }}><T tone="mute">{isHr ? 'Choose a person.' : 'You are not on the staff list yet.'}</T></View>
      )}

      {emp && day ? <DayEditor employee={emp} date={day} mode={isHr ? 'mark' : 'request'} visible onClose={() => setDay(null)} /> : null}
    </DeskPage>
  )
}
