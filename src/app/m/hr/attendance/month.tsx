import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { fmtTime } from '@/domain/dates'
import { useCan } from '@/data/store'
import { STATUS_LABEL } from '@/modules/hr/logic/attendance'
import { employeeMonth } from '@/modules/hr/logic/select'
import { attendanceSheetTable } from '@/modules/hr/logic/reports'
import { labelDayWeek, ymOf, ymdOf } from '@/modules/hr/logic/ymd'
import type { YM, YMD } from '@/modules/hr/types'
import { Denied, EmployeeSelect, ExportBar, MonthBar, TableCard, useHr } from '@/modules/hr/ui/common'
import { DayEditor } from '@/modules/hr/ui/DayEditor'
import { Screen } from '@/ui/Screen'
import { Segmented } from '@/ui/Inputs'
import { Badge, Card, Tap } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'

/** A month of attendance: everyone at a glance, or one person day by day (tap a day to mark it, or to ask for a fix). */
export default function AttendanceMonth() {
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

  if (!isHr && !isSelf) return <Denied title="Attendance" who="Attendance is for staff and managers." />
  const own = !!me && me.id === empId
  const canEdit = isHr || own
  const tone = (s: string) => (s === 'present' ? 'success' : s === 'half' || s === 'leave' ? 'warning' : s === 'absent' || s === 'unmarked' ? 'danger' : 'default') as 'success' | 'warning' | 'danger' | 'default'

  return (
    <Screen title="Attendance month" back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <MonthBar month={month} onChange={setMonth} />
        {isHr ? <EmployeeSelect label="Person" value={empId} onChange={setEmpId} employees={employees} /> : null}
        {isHr && empId ? <Segmented value="one" options={[{ value: 'one', label: emp?.name ?? 'One person' }, { value: 'all', label: 'Everyone' }]} onChange={(v) => v === 'all' && setEmpId('')} compact /> : null}
        {sheet ? <><TableCard table={sheet} /><ExportBar table={sheet} /></> : null}
        {emp && m ? (
          <>
            <Card>
              <KV k="Days worked" v={String(m.summary.presentDays)} />
              <KV k="Paid leave" v={String(m.summary.paidLeaveDays)} />
              <KV k="Holidays and weekly offs" v={String(m.summary.holidayDays + m.summary.weekoffDays)} />
              <KV k="Loss of pay" v={String(m.summary.lopDays)} tone={m.summary.lopDays ? 'warning' : undefined} sub={m.summary.unmarkedDays ? `${m.summary.unmarkedDays} not marked, counted as absent` : undefined} />
              <KV k="Late" v={String(m.summary.lateCount)} />
              {m.summary.overtimeMins ? <KV k="Overtime" v={`${Math.round((m.summary.overtimeMins / 60) * 10) / 10} h`} /> : null}
            </Card>
            <Section title="Day by day" style={{ marginTop: 0 }}>
              <View style={{ gap: 6 }}>
                {m.sheet.filter((d) => d.status !== 'notEmployed').map((d) => (
                  <Tap key={d.date} onPress={() => canEdit && d.date <= today && setDay(d.date)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
                    <View style={{ flex: 1 }}>
                      <T v="bodyStrong">{labelDayWeek(d.date)}</T>
                      <T v="caption" tone="mute" numberOfLines={1}>{d.inAt ? `In ${fmtTime(d.inAt)}` : d.holiday ?? ''}{d.outAt ? ` · Out ${fmtTime(d.outAt)}` : ''}{d.late ? ' · late' : ''}{d.source === 'mark' ? ' · marked' : ''}</T>
                    </View>
                    {STATUS_LABEL[d.status] ? <Badge tone={tone(d.status)}>{STATUS_LABEL[d.status]}</Badge> : null}
                  </Tap>
                ))}
              </View>
            </Section>
          </>
        ) : null}
        {!emp && !isHr ? <T tone="mute">You are not on the staff list yet.</T> : null}
      </View>
      {emp && day ? <DayEditor employee={emp} date={day} mode={isHr ? 'mark' : 'request'} visible onClose={() => setDay(null)} /> : null}
    </Screen>
  )
}
