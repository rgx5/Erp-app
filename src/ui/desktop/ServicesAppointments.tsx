import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort, fmtLongDate, fmtTime, fmtWeekdayShort, startOfDay } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { ProgressBar, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { APPT_LABEL, apptTitle, daySummary, overdueBookings, remindersDue } from '@/modules/services/logic/appointments'
import { blockBox, dayBoard, weekBoard } from '@/modules/services/logic/calendar'
import { addDays, minutesLabel, sameDay } from '@/modules/services/logic/time'
import { timeText } from '@/modules/services/ui/common'
import type { Appointment, ApptStatus } from '@/modules/services/types'
import { DeskButton, DeskPage, DeskSegmented, dtext, KpiStrip, KpiTile, Pill, Toolbar } from './kit'

const PX = 1.4 // taller columns on the wide desktop canvas than the phone's 1.1
const COL = 180
const GUTTER = 50

/**
 * The desktop calendar: the exact same day/week board the phone screen computes (`dayBoard`, `weekBoard`,
 * `blockBox`), widened into a resource-per-column schedule with more visible columns and a KPI strip, instead of
 * narrowing it into a grid of unrelated rows — a calendar keeps its calendar shape on a bigger screen.
 */
export function DesktopServicesAppointments() {
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

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Appointments" />}>
        <View style={{ padding: 20 }}><T tone="mute">Appointments are for people who work at the counter.</T></View>
      </DeskPage>
    )
  }

  const open = (a: Appointment) => router.push({ pathname: '/m/services/appointments/[id]', params: { id: a.id } })
  const create = (resourceId?: string, start?: number) => router.push({ pathname: '/m/services/appointments/new', params: { ...(resourceId ? { resourceId } : {}), start: String(start ?? day) } })
  const step = mode === 'day' ? 1 : 7
  const hours: number[] = []
  for (let t = board.start; t < board.end; t += 3_600_000) hours.push(t)
  const height = Math.max(1, (board.end - board.start) / 60_000) * PX

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Appointments"
          subtitle={mode === 'day' ? fmtLongDate(day) : `Week of ${fmtDayShort(week[0].day)}`}
          left={(
            <>
              <DeskButton label="Earlier" icon={<ChevronLeft size={16} color={c.ink} />} onPress={() => setDay(addDays(day, -step))} />
              <DeskSegmented value={mode} onChange={setMode} options={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }]} />
              <DeskButton label="Later" icon={<ChevronRight size={16} color={c.ink} />} onPress={() => setDay(addDays(day, step))} />
              <DeskButton label="Today" onPress={() => setDay(startOfDay(now))} tone={sameDay(day, now) ? 'primary' : 'default'} />
            </>
          )}
          right={(
            <>
              {due ? <DeskButton label={`${due} reminder${due === 1 ? '' : 's'} due`} tone="danger" onPress={() => router.push('/m/services/appointments/reminders')} /> : null}
              {late ? <DeskButton label={`${late} to mark`} tone="danger" onPress={() => router.push('/m/services/appointments/reminders')} /> : null}
              <DeskButton label="New appointment" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => create()} />
            </>
          )}
        />
      }
    >
      {mode === 'day' ? (
        <KpiStrip>
          <KpiTile label="Booked" value={String(sum.booked + sum.arrived)} delta={`${sum.done} done`} />
          <KpiTile label="Expected" value={inr(sum.expected, 0)} tone="success" delta={sum.noShows ? `${sum.noShows} no-show${sum.noShows === 1 ? '' : 's'}` : `${inr(sum.earned, 0)} earned`} />
        </KpiStrip>
      ) : null}

      {mode === 'week' ? (
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, gap: 8, flexWrap: 'wrap' }}>
          <DeskButton label="Everyone" tone={!only ? 'primary' : 'default'} onPress={() => setOnly(null)} />
          {resources.map((r) => <DeskButton key={r.id} label={r.name} tone={only === r.id ? 'primary' : 'default'} onPress={() => setOnly(r.id)} />)}
        </View>
      ) : null}

      {mode === 'week' ? (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
          {week.map((d) => (
            <Pressable key={d.day} onPress={() => { setDay(d.day); setMode('day') }} style={{ gap: 6, opacity: d.working ? 1 : 0.6, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong">{fmtWeekdayShort(d.day)}, {fmtDayShort(d.day)}{sameDay(d.day, now) ? ' · today' : ''}</T>
                  <T v="caption" tone="mute">{d.working ? `${d.appointments.length} booking${d.appointments.length === 1 ? '' : 's'} · ${minutesLabel(d.bookedMinutes)} of ${minutesLabel(d.availableMinutes)}` : 'Closed'}</T>
                </View>
                <Pill tone={d.availableMinutes && d.bookedMinutes / d.availableMinutes > 0.8 ? 'warning' : 'primary'} label={d.availableMinutes ? `${Math.round((d.bookedMinutes / d.availableMinutes) * 100)}%` : '—'} />
              </View>
              {d.availableMinutes ? <ProgressBar value={Math.min(1, d.bookedMinutes / d.availableMinutes)} /> : null}
              {d.appointments.slice(0, 6).map((a) => <T key={a.id} v="caption" tone="soft" numberOfLines={1}>{fmtTime(a.start)} · {a.partyName} · {apptTitle(a)}</T>)}
              {d.appointments.length > 6 ? <T v="caption" tone="mute">+ {d.appointments.length - 6} more</T> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : !board.columns.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <CalendarDays size={28} color={c.primary} />
          <T v="bodyStrong">Add who or what people book</T>
          <T tone="mute">A calendar column is a stylist, a technician, a chair or a bay.</T>
          <DeskButton label="Add a column" tone="primary" onPress={() => router.push('/m/services/resources')} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14 }}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: GUTTER, paddingTop: 34 }}>
              {hours.map((h) => <View key={h} style={{ height: 60 * PX }}><T v="micro" tone="mute">{fmtTime(h).replace(':00', '')}</T></View>)}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {board.columns.map((col) => (
                <View key={col.resource?.id ?? 'other'} style={{ width: COL, marginRight: 10 }}>
                  <Tap onPress={() => col.resource && create(col.resource.id)} disabled={!col.resource} style={{ height: 32, justifyContent: 'center', paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: c.sunken, marginBottom: 4 }}>
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
                          position: 'absolute', left: 4, right: 4, top, height: h - 2, borderRadius: radius.sm, padding: 7, overflow: 'hidden',
                          backgroundColor: a.status === 'no_show' ? c.dangerTint : a.status === 'completed' ? c.successTint : a.status === 'arrived' || a.status === 'in_service' ? c.warningTint : c.primaryTint,
                          borderLeftWidth: 3, borderLeftColor: a.status === 'no_show' ? c.danger : a.status === 'completed' ? c.success : a.status === 'arrived' || a.status === 'in_service' ? c.warning : c.primary,
                        }}>
                          <T style={dtext.cellStrong} numberOfLines={1}>{timeText(a.start)} {a.partyName}</T>
                          {h > 44 ? <T style={[dtext.tiny, { color: c.inkSoft }]} numberOfLines={1}>{apptTitle(a)}</T> : null}
                          {h > 62 ? <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{APPT_LABEL[a.status as ApptStatus]}</T> : null}
                        </Tap>
                      )
                    })}
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
          {board.total === 0 ? <T tone="mute" style={{ marginTop: 12 }}>Nothing booked this day. Click a column to book.</T> : null}
        </ScrollView>
      )}
    </DeskPage>
  )
}
