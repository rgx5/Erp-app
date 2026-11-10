import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { act, useShopName, whatsApp } from '@/modules/services/ui/common'
import { useApp, useCan } from '@/data/store'
import { Card } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { MessageCircle } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { apptTitle, overdueBookings, reminderText, remindersDue } from '@/modules/services/logic/appointments'
import { markReminded, setAppointmentStatus } from '@/modules/services/ops'
import { DeskButton, DeskPage, dtext, KpiStrip, KpiTile, SplitPane, Toolbar } from './kit'

/**
 * The desktop reminders queue: the same two lists the phone screen shows (bookings passed without anyone
 * arriving, and reminders to send), side by side instead of stacked — the data comes straight from
 * `overdueBookings` and `remindersDue`, exactly as `m/services/appointments/reminders.tsx` already computes it.
 */
export function DesktopServicesReminders() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const shop = useShopName()
  const now = Date.now()

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Reminders" />}>
        <View style={{ padding: 20 }}><T tone="mute">Appointments are for people who work at the counter.</T></View>
      </DeskPage>
    )
  }

  const due = remindersDue(data, now)
  const late = overdueBookings(data, now)

  return (
    <DeskPage toolbar={<Toolbar title="Reminders" subtitle="Texts to send, bookings to mark" />}>
      <KpiStrip>
        <KpiTile label="Reminders due" value={String(due.length)} tone={due.length ? 'warning' : 'success'} />
        <KpiTile label="Passed without arriving" value={String(late.length)} tone={late.length ? 'danger' : 'success'} />
      </KpiStrip>

      <SplitPane>
        <View style={{ flex: 1, padding: 14 }}>
          <T style={[dtext.label, { color: c.inkMute, marginBottom: 10 }]}>Passed without anyone arriving</T>
          {late.length ? (
            <View style={{ gap: 10 }}>
              {late.map((a) => (
                <Card key={a.id} style={{ gap: 8 }}>
                  <T v="bodyStrong">{a.partyName} · {apptTitle(a)}</T>
                  <T v="caption" tone="mute">{fmtDateTime(a.start)}</T>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <DeskButton label="Did not come" tone="danger" onPress={() => act((s, ctx) => setAppointmentStatus(s, a.id, 'no_show', ctx))} />
                    <DeskButton label="Open" onPress={() => router.push({ pathname: '/m/services/appointments/[id]', params: { id: a.id } })} />
                  </View>
                </Card>
              ))}
            </View>
          ) : <T tone="mute">Nothing passed unattended.</T>}
        </View>

        <View style={{ flex: 1, padding: 14 }}>
          <T style={[dtext.label, { color: c.inkMute, marginBottom: 10 }]}>Reminders to send</T>
          {due.length ? (
            <View style={{ gap: 10 }}>
              {due.map((a) => (
                <Card key={a.id} style={{ gap: 6 }}>
                  <T v="bodyStrong">{a.partyName} · {apptTitle(a)}</T>
                  <T v="caption" tone="mute">{fmtDateTime(a.start)} · {a.partyPhone}</T>
                  <DeskButton label="WhatsApp the reminder" tone="primary" icon={<MessageCircle size={14} color={c.onPrimary} />}
                    onPress={() => { void whatsApp(reminderText(data, a, shop), a.partyPhone); act((s, ctx) => markReminded(s, a.id, ctx)) }} />
                </Card>
              ))}
            </View>
          ) : <T tone="mute">No reminders to send. Bookings with a mobile number show up here once they are within the reminder time.</T>}
        </View>
      </SplitPane>
    </DeskPage>
  )
}
