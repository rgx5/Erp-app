import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtTime } from '@/domain/dates'
import { useCan } from '@/data/store'
import { STATUS_LABEL } from '@/modules/hr/logic/attendance'
import { dayBoard } from '@/modules/hr/logic/select'
import { waitingApprovals } from '@/modules/hr/notices'
import { addDays, labelDayWeek, ymdOf } from '@/modules/hr/logic/ymd'
import { bulkMark } from '@/modules/hr/ops'
import type { Employee } from '@/modules/hr/types'
import { act, Denied, useHr } from '@/modules/hr/ui/common'
import { DayEditor } from '@/modules/hr/ui/DayEditor'
import { PunchCard } from '@/modules/hr/ui/PunchCard'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Attendance: punch in and out, and (for managers) who is in on any day. */
export default function AttendanceHome() {
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

  if (!isSelf && !isHr) return <Denied title="Attendance" who="Attendance is for staff and managers." />
  const markable = board.filter((b) => b.info.status === 'unmarked' || b.info.status === 'future')
  const tone = (s: string) => (s === 'present' ? 'success' : s === 'half' || s === 'leave' ? 'warning' : s === 'absent' || s === 'unmarked' ? 'danger' : 'default') as 'success' | 'warning' | 'danger' | 'default'

  return (
    <Screen title="Attendance" back scroll={!isHr}>
      {!isHr ? (
        <View style={{ gap: 14, paddingBottom: 24 }}>
          {me ? <PunchCard employee={me} /> : <EmptyState icon={<Clock size={26} color={c.primary} />} title="You are not on the staff list" hint="Ask the owner to add you as an employee and link your sign-in." />}
          {me ? <Button label="My month" kind="outline" block icon={<CalendarDays size={18} color={c.ink} />} onPress={() => router.push({ pathname: '/m/hr/attendance/month', params: { employeeId: me.id } } as never)} /> : null}
        </View>
      ) : (
        <FlatList
          data={board} keyExtractor={(b) => b.employee.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
          ListHeaderComponent={(
            <View style={{ gap: 12, paddingBottom: 12 }}>
              {me ? <PunchCard employee={me} title="My attendance" /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Tap onPress={() => setDate(addDays(date, -1))} style={{ padding: 10 }}><ChevronLeft size={22} color={c.ink} /></Tap>
                <T v="title">{date === today ? 'Today · ' : ''}{labelDayWeek(date)}</T>
                <Tap onPress={() => date < today && setDate(addDays(date, 1))} style={{ padding: 10, opacity: date < today ? 1 : 0.3 }}><ChevronRight size={22} color={c.ink} /></Tap>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {markable.length && date <= today ? <Button label={`Mark ${markable.length} present`} size="sm" onPress={() => act((s, ctx) => bulkMark(s, date, markable.map((m) => m.employee.id), 'present', ctx), 'Marked')} /> : null}
                <Button label="Month sheet" size="sm" kind="soft" onPress={() => router.push('/m/hr/attendance/month')} />
                <Button label={waiting ? `Fix requests · ${waiting}` : 'Fix requests'} size="sm" kind="soft" onPress={() => router.push('/m/hr/attendance/requests')} />
              </View>
            </View>
          )}
          ListEmptyComponent={<EmptyState icon={<Clock size={26} color={c.primary} />} title="No one on the staff" hint="Add employees first, then their attendance shows here." />}
          renderItem={({ item: { employee: e, info } }) => (
            <Tap onPress={() => date <= today && setEditing(e)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <Avatar name={e.name} size={38} />
              <View style={{ flex: 1, gap: 1 }}>
                <T v="bodyStrong" numberOfLines={1}>{e.name}</T>
                <T v="caption" tone="mute" numberOfLines={1}>
                  {info.inAt ? `In ${fmtTime(info.inAt)}` : info.holiday ?? ''}{info.outAt ? ` · Out ${fmtTime(info.outAt)}` : info.incomplete ? ' · no punch-out' : ''}{info.late ? ' · late' : ''}{info.source === 'mark' ? ' · marked' : ''}
                </T>
              </View>
              <Badge tone={tone(info.status)}>{STATUS_LABEL[info.status] || 'Not yet'}</Badge>
            </Tap>
          )}
        />
      )}
      {editing ? <DayEditor employee={editing} date={date} mode="mark" visible onClose={() => setEditing(null)} /> : null}
    </Screen>
  )
}
