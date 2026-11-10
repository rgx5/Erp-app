import React from 'react'
import { View } from 'react-native'
import { fmtTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { Field, MoneyField, Select, SwitchRow } from '@/ui/Inputs'
import { Card, Chip, Tap } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Close } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import type { Appointment, ServiceResource } from '@/modules/services/types'
import { CustomerField, DateField, momentOf, TimeField, timeText, VariantSelect } from '@/modules/services/ui/common'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

interface Row { variantId: string; name: string; price: string; duration: string }

export interface DesktopAppointmentFormProps {
  cur?: Appointment
  customerId: string | null; setCustomerId: (v: string | null) => void
  name: string; setName: (v: string) => void; phone: string; setPhone: (v: string) => void
  rows: Row[]; setRows: (v: Row[]) => void; onAddService: (v: string, ch: { name: string; price: number }) => void
  resources: ServiceResource[]; resourceId: string; setResourceId: (v: string) => void
  day: string; setDay: (v: string) => void; time: string; setTime: (v: string) => void
  notes: string; setNotes: (v: string) => void; manager: boolean; override: boolean; setOverride: (v: boolean) => void
  warn: string | null; slots: number[]; minutes: number; total: number
  onSave: () => void
}

/** The desktop booking form: the same services/time/resource fields as the phone screen, centred in the settings-page shell. */
export function DesktopAppointmentForm(p: DesktopAppointmentFormProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title={p.cur ? `Change ${p.cur.no}` : 'New appointment'} subtitle="Appointments" right={<DeskButton label={p.cur ? 'Save changes' : 'Book it'} tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <CustomerField value={p.customerId} optional onChange={(cu) => p.setCustomerId(cu?.id ?? null)} />
        {!p.customerId ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><Field label="Or type a name" value={p.name} onChangeText={p.setName} autoCapitalize="words" /></View>
            <View style={{ flex: 1 }}><Field label="Mobile (for the reminder)" value={p.phone} onChangeText={(t) => p.setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" /></View>
          </View>
        ) : null}
        {p.warn ? <Card tone="warning"><T v="caption">{p.warn}</T></Card> : null}

        <Section title="Services" style={{ marginTop: 6 }}>
          <View style={{ gap: 10 }}>
            {p.rows.map((r, i) => (
              <Card key={`${r.variantId}${i}`} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{r.name}</T>
                  <Tap onPress={() => p.setRows(p.rows.filter((_, j) => j !== i))} accessibilityLabel="Remove service"><Close size={18} color={c.inkMute} /></Tap>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <MoneyField containerStyle={{ flex: 1 }} label="Price" value={r.price} onChange={(v) => p.setRows(p.rows.map((x, j) => (j === i ? { ...x, price: v } : x)))} />
                  <Field containerStyle={{ flex: 1 }} label="Minutes" value={r.duration} keyboardType="number-pad" onChangeText={(v) => p.setRows(p.rows.map((x, j) => (j === i ? { ...x, duration: v.replace(/\D/g, '') } : x)))} />
                </View>
              </Card>
            ))}
            <VariantSelect kind="service" value="" placeholder="Add a service" onChange={p.onAddService} />
            {p.rows.length ? <T v="caption" tone="mute">{p.minutes} minutes · {inr(p.total, 0)}</T> : null}
          </View>
        </Section>

        <Select label="With" value={p.resourceId} placeholder={p.rows.length ? 'Choose who or what' : 'Add a service first'} options={p.resources.map((r) => ({ value: r.id, label: r.name, sub: r.kind === 'staff' ? 'Staff' : 'Resource' }))} onChange={p.setResourceId} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1.2 }}><DateField label="Day" value={p.day} onChange={p.setDay} /></View>
          <View style={{ flex: 1 }}><TimeField label="Time" value={p.time} onChange={p.setTime} /></View>
        </View>
        {p.resourceId && p.minutes > 0 ? (
          p.slots.length ? (
            <View style={{ gap: 6 }}>
              <T v="label" tone="soft">FREE TIMES</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {p.slots.map((s) => <Chip key={s} label={fmtTime(s)} selected={momentOf(p.day, p.time) === s} onPress={() => p.setTime(timeText(s))} />)}
              </View>
            </View>
          ) : <T v="caption" tone="warning">No free time that day for {p.minutes} minutes. Try another day.</T>
        ) : null}
        <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline autoCapitalize="sentences" />
        {p.manager ? <Card padded={false}><SwitchRow title="Allow outside the rules" subtitle="Outside working hours, or a customer over the no-show limit" value={p.override} onChange={p.setOverride} /></Card> : null}
      </View>
    </DesktopSettingsPage>
  )
}

