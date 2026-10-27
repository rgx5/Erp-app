import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort, fmtLongDate, fmtTime, fmtWeekdayShort, startOfDay } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { IconButton } from '@/ui/Button'
import { Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Card, Chip, ProgressBar, Tap } from '@/ui/primitives'
import { EmptyState, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { APPT_LABEL, apptTitle, daySummary, overdueBookings, remindersDue } from '@/modules/services/logic/appointments'
import { blockBox, dayBoard, weekBoard } from '@/modules/services/logic/calendar'
import { addDays, minutesLabel, sameDay } from '@/modules/services/logic/time'
import { Denied, timeText } from '@/modules/services/ui/common'
import type { Appointment, ApptStatus } from '@/modules/services/types'

const PX = 1.1 // pixels per minute: a 30-minute booking is 33 high
const COL = 150
const GUTTER = 46

/** The calendar: one day with a column per person or resource, or a week at a glance. */
export default function Appointments() {
  const { c, radius } = useTheme()
  const router = useRouter()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const [mode, setMode] = useState<'day' | 'week'>('day')
  const [day, setDay] = useState(() => startOfDay(Date.now()))
  const [only, setOnly] = useState<string | null>(null)
  const now = Date.now()
  const board = useMemo(() => dayBoard(data, day), [data, day])
  const week = useMemo(() => weekBoard(data, day, only), [data, day, only])
  const sum = daySummary(data, day)
  const resources = board.columns.filter((x) => x.resource).map((x) => x.resource!)
  const due = remindersDue(data, now).length
  const late = overdueBookings(data, now).length

  if (!can) return <Denied title="Appointments" who="Appointments are for people who work at the counter." />
  const open = (a: Appointment) => router.push({ pathname: '/m/services/appointments/[id]', params: { id: a.id } })
  const create = (resourceId?: string, start?: number) => router.push({ pathname: '/m/services/appointments/new', params: { ...(resourceId ? { resourceId } : {}), start: String(start ?? day) } })
  const step = mode === 'day' ? 1 : 7
  const hours: number[] = []
  for (let t = board.start; t < board.end; t += 3_600_000) hours.push(t)
  const height = Math.max(1, (board.end - board.start) / 60_000) * PX

  return (
    <Screen title="Appointments" subtitle={mode === 'day' ? fmtLongDate(day) : `Week of ${fmtDayShort(week[0].day)}`} back scroll={false}
      right={<IconButton label="New appointment" tone="dark" onPress={() => create()}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ gap: 10, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <IconButton label="Earlier" onPress={() => setDay(addDays(day, -step))}><ChevronLeft size={20} color={c.ink} /></IconButton>
          <View style={{ flex: 1 }}><Segmented value={mode} onChange={setMode} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} /></View>
          <IconButton label="Later" onPress={() => setDay(addDays(day, step))}><ChevronRight size={20} color={c.ink} /></IconButton>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Chip label="Today" selected={sameDay(day, now)} onPress={() => setDay(startOfDay(now))} />
          {due ? <Chip label={`${due} reminder${due === 1 ? '' : 's'} due`} tone="warning" onPress={() => router.push('/m/services/appointments/reminders')} /> : null}
          {late ? <Chip label={`${late} to mark`} tone="danger" onPress={() => router.push('/m/services/appointments/reminders')} /> : null}
        </View>
        {mode === 'day' ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <StatTile label="Booked" value={String(sum.booked + sum.arrived)} foot={`${sum.done} done`} icon={<CalendarDays size={16} color={c.primary} />} style={{ flex: 1 }} />
            <StatTile label="Expected" value={inr(sum.expected, 0)} foot={sum.noShows ? `${sum.noShows} no-show${sum.noShows === 1 ? '' : 's'}` : `${inr(sum.earned, 0)} earned`} tone="success" style={{ flex: 1 }} />
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Chip label="Everyone" selected={!only} onPress={() => setOnly(null)} />
            {resources.map((r) => <Chip key={r.id} label={r.name} selected={only === r.id} onPress={() => setOnly(r.id)} />)}
          </ScrollView>
        )}
      </View>

      {mode === 'week' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 28 }}>
          {week.map((d) => (
            <Card key={d.day} onPress={() => { setDay(d.day); setMode('day') }} style={{ gap: 6, opacity: d.working ? 1 : 0.6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong">{fmtWeekdayShort(d.day)}, {fmtDayShort(d.day)}{sameDay(d.day, now) ? ' · today' : ''}</T>
                  <T v="caption" tone="mute">{d.working ? `${d.appointments.length} booking${d.appointments.length === 1 ? '' : 's'} · ${minutesLabel(d.bookedMinutes)} of ${minutesLabel(d.availableMinutes)}` : 'Closed'}</T>
                </View>
                <Badge tone={d.availableMinutes && d.bookedMinutes / d.availableMinutes > 0.8 ? 'warning' : 'primary'}>{d.availableMinutes ? `${Math.round((d.bookedMinutes / d.availableMinutes) * 100)}%` : '—'}</Badge>
              </View>
              {d.availableMinutes ? <ProgressBar value={Math.min(1, d.bookedMinutes / d.availableMinutes)} /> : null}
              {d.appointments.slice(0, 4).map((a) => <T key={a.id} v="caption" tone="soft" numberOfLines={1}>{fmtTime(a.start)} · {a.partyName} · {apptTitle(a)}</T>)}
              {d.appointments.length > 4 ? <T v="caption" tone="mute">+ {d.appointments.length - 4} more</T> : null}
            </Card>
          ))}
        </ScrollView>
      ) : !board.columns.length ? (
        <EmptyState icon={<CalendarDays size={26} color={c.primary} />} title="Add who or what people book" hint="A calendar column is a stylist, a technician, a chair or a bay. Add one, then book appointments into it." action="Add a column" onAction={() => router.push('/m/services/resources')} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: GUTTER, paddingTop: 34 }}>
              {hours.map((h) => <View key={h} style={{ height: 60 * PX }}><T v="micro" tone="mute">{fmtTime(h).replace(':00', '')}</T></View>)}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {board.columns.map((col) => (
                <View key={col.resource?.id ?? 'other'} style={{ width: COL, marginRight: 8 }}>
                  <Tap onPress={() => col.resource && create(col.resource.id)} disabled={!col.resource} style={{ height: 30, justifyContent: 'center', paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: c.sunken, marginBottom: 4 }}>
                    <T v="bodyStrong" numberOfLines={1}>{col.resource?.name ?? 'Other'}</T>
                  </Tap>
                  <Pressable
                    onPress={(e) => {
                      if (!col.resource) return
                      const mins = Math.floor(e.nativeEvent.locationY / PX / 15) * 15
                      create(col.resource.id, board.start + mins * 60_000)
                    }}
                    style={{ height, borderRadius: radius.sm, backgroundColor: col.window ? c.surface : c.sunken, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
                    {hours.map((h, i) => <View key={h} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: i * 60 * PX, height: 1, backgroundColor: c.line }} />)}
                    {col.window ? null : <T v="caption" tone="mute" style={{ padding: 8 }} pointerEvents="none">Not working</T>}
                    {col.appointments.map((a) => {
                      const { top, height: h } = blockBox({ start: a.start, end: a.end }, board.start, PX)
                      return (
                        <Tap key={a.id} onPress={() => open(a)} style={{
                          position: 'absolute', left: 3, right: 3, top, height: h - 2, borderRadius: radius.sm, padding: 6, overflow: 'hidden',
                          backgroundColor: a.status === 'no_show' ? c.dangerTint : a.status === 'completed' ? c.successTint : a.status === 'arrived' || a.status === 'in_service' ? c.warningTint : c.primaryTint,
                          borderLeftWidth: 3, borderLeftColor: a.status === 'no_show' ? c.danger : a.status === 'completed' ? c.success : a.status === 'arrived' || a.status === 'in_service' ? c.warning : c.primary,
                        }}>
                          <T v="caption" numberOfLines={1}>{timeText(a.start)} {a.partyName}</T>
                          {h > 40 ? <T v="micro" tone="soft" numberOfLines={1}>{apptTitle(a)}</T> : null}
                          {h > 58 ? <T v="micro" tone="mute" numberOfLines={1}>{APPT_LABEL[a.status as ApptStatus]}</T> : null}
                        </Tap>
                      )
                    })}
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
          {board.total === 0 ? <T v="caption" tone="mute" align="center" style={{ marginTop: 12 }}>Nothing booked this day. Tap a column to book.</T> : null}
        </ScrollView>
      )}
    </Screen>
  )
}

