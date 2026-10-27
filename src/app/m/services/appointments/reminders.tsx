import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { act, Denied, useShopName, whatsApp } from '@/modules/services/ui/common'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { EmptyState, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Bell, MessageCircle } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { apptTitle, overdueBookings, reminderText, remindersDue } from '@/modules/services/logic/appointments'
import { markReminded, setAppointmentStatus } from '@/modules/services/ops'

/** Reminders to send (WhatsApp opens with the text ready — you press send) and bookings that passed without anyone arriving. */
export default function Reminders() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const shop = useShopName()
  const now = Date.now()
  if (!can) return <Denied title="Reminders" who="Appointments are for people who work at the counter." />
  const due = remindersDue(data, now)
  const late = overdueBookings(data, now)
  return (
    <Screen title="Reminders" subtitle="Texts to send, bookings to mark" back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        {late.length ? (
          <Section title="Passed without anyone arriving" style={{ marginTop: 0 }}>
            <View style={{ gap: 10 }}>
              {late.map((a) => (
                <Card key={a.id} style={{ gap: 8 }}>
                  <T v="bodyStrong">{a.partyName} · {apptTitle(a)}</T>
                  <T v="caption" tone="mute">{fmtDateTime(a.start)}</T>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button label="Did not come" kind="danger" size="sm" onPress={() => act((s, ctx) => setAppointmentStatus(s, a.id, 'no_show', ctx))} />
                    <Button label="Open" kind="soft" size="sm" onPress={() => router.push({ pathname: '/m/services/appointments/[id]', params: { id: a.id } })} />
                  </View>
                </Card>
              ))}
            </View>
          </Section>
        ) : null}
        <Section title="Reminders to send" style={{ marginTop: 0 }}>
          {due.length ? (
            <View style={{ gap: 10 }}>
              {due.map((a) => (
                <Card key={a.id} style={{ gap: 6 }}>
                  <T v="bodyStrong">{a.partyName} · {apptTitle(a)}</T>
                  <T v="caption" tone="mute">{fmtDateTime(a.start)} · {a.partyPhone}</T>
                  <Button label="WhatsApp the reminder" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />}
                    onPress={() => { void whatsApp(reminderText(data, a, shop), a.partyPhone); act((s, ctx) => markReminded(s, a.id, ctx)) }} />
                </Card>
              ))}
            </View>
          ) : <EmptyState compact icon={<Bell size={24} color={c.primary} />} title="No reminders to send" hint="Bookings with a mobile number show up here once they are within the reminder time." />}
        </Section>
      </View>
    </Screen>
  )
}
