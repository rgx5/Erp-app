import React, { useState } from 'react'
import { View } from 'react-native'
import { listOf } from '@/data/state'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Chip, Group } from '@/ui/primitives'
import { EmptyState, ListRow, Section } from '@/ui/blocks'
import { Settings as SettingsIcon } from '@/ui/icons'
import { ask } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { settingsOf } from '@/modules/services/logic/settings'
import { removeServiceItem, saveServiceItem, saveServiceSettings } from '@/modules/services/ops'
import type { ServiceItem } from '@/modules/services/types'
import { act, Denied, TimeField, useVariantChoices, VariantSelect } from '@/modules/services/ui/common'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The shop's hours and booking rules, and how long each service takes. */
export default function ServiceSettings() {
  const { c } = useTheme()
  const can = useCan('servicesManage')
  const data = useApp((s) => s.data)
  const services = useVariantChoices('service')
  const cfg = settingsOf(data)

  const [openTime, setOpenTime] = useState(cfg.openTime)
  const [closeTime, setCloseTime] = useState(cfg.closeTime)
  const [workDays, setWorkDays] = useState(cfg.workDays)
  const [slotMinutes, setSlotMinutes] = useState(String(cfg.slotMinutes))
  const [reminderLeadHours, setReminderLeadHours] = useState(String(cfg.reminderLeadHours))
  const [maxNoShows, setMaxNoShows] = useState(String(cfg.maxNoShows))
  const [reminderNote, setReminderNote] = useState(cfg.reminderNote)
  const [defaultHourlyRate, setDefaultHourlyRate] = useState(String(cfg.defaultHourlyRate))

  const [edit, setEdit] = useState<{ variantId: string } | null>(null)
  const [duration, setDuration] = useState('')
  const [buffer, setBuffer] = useState('')
  const [active, setActive] = useState(true)
  const items = listOf(data.serviceItems ?? {})

  if (!can) return <Denied title="Service settings" who="Service settings are set up by the owner or a manager." />

  function save() {
    act((s, ctx) => saveServiceSettings(s, {
      openTime, closeTime, workDays, slotMinutes: Number(slotMinutes) || 0, reminderLeadHours: Number(reminderLeadHours) || 0, maxNoShows: Number(maxNoShows) || 0, reminderNote, defaultHourlyRate: Number(defaultHourlyRate) || 0,
    }, ctx), 'Saved')
  }
  function openItem(variantId: string, cur?: ServiceItem) { setDuration(cur ? String(cur.durationMin) : '30'); setBuffer(cur ? String(cur.bufferMin) : '0'); setActive(cur?.active ?? true); setEdit({ variantId }) }
  function saveItem() {
    if (act((s, ctx) => saveServiceItem(s, { variantId: edit!.variantId, durationMin: Number(duration) || 0, bufferMin: Number(buffer) || 0, active }, ctx), 'Saved')) setEdit(null)
  }
  async function removeItem() {
    if (await ask({ title: 'Remove this service?', message: 'Its duration and buffer will be forgotten; the item itself stays.', confirm: 'Remove', danger: true }) && act((s, ctx) => removeServiceItem(s, edit!.variantId, ctx), 'Removed')) setEdit(null)
  }

  return (
    <Screen title="Service settings" subtitle="Hours, booking rules and durations" back footer={<Button label="Save settings" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Section title="Hours" style={{ marginTop: 0 }}>
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><TimeField label="Opens" value={openTime} onChange={setOpenTime} /></View>
              <View style={{ flex: 1 }}><TimeField label="Closes" value={closeTime} onChange={setCloseTime} /></View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {DAYS.map((d, i) => <Chip key={d} label={d} selected={workDays.includes(i)} onPress={() => setWorkDays(workDays.includes(i) ? workDays.filter((x) => x !== i) : [...workDays, i])} />)}
            </View>
            <NumberField label="Calendar slot size (minutes)" value={slotMinutes} onChange={setSlotMinutes} hint="How finely bookings can be placed." />
          </View>
        </Section>

        <Section title="Bookings">
          <View style={{ gap: 12 }}>
            <NumberField label="Reminder lead time (hours before)" value={reminderLeadHours} onChange={setReminderLeadHours} />
            <NumberField label="No-show limit" value={maxNoShows} onChange={setMaxNoShows} hint="0 = never refuse a booking. Above the limit, only a manager can book the customer again." />
            <Field label="Reminder note (optional)" value={reminderNote} onChangeText={setReminderNote} multiline autoCapitalize="sentences" hint="Added to the end of every reminder text, e.g. address or cancellation policy." />
          </View>
        </Section>

        <Section title="Projects">
          <MoneyField label="Default hourly rate" value={defaultHourlyRate} onChange={setDefaultHourlyRate} hint="Used when a new hourly project does not set its own rate." />
        </Section>

        <Section title="Services">
          {items.length ? (
            <Group>{items.map((it) => {
              const v = data.variants[it.variantId]
              const name = v ? [data.products[v.productId]?.name, v.size, v.color].filter(Boolean).join(' ') : it.variantId
              return <ListRow key={it.id} title={name} subtitle={`${it.durationMin} min${it.bufferMin ? ` + ${it.bufferMin} min clean-up` : ''}`} meta={it.active ? undefined : 'Off'} onPress={() => openItem(it.variantId, it)} />
            })}</Group>
          ) : <EmptyState compact icon={<SettingsIcon size={22} color={c.primary} />} title="No service durations set yet" />}
          <View style={{ marginTop: 10 }}>
            <VariantSelect kind="service" value="" placeholder="Add or change a service's duration" onChange={(v) => openItem(v, items.find((x) => x.variantId === v))} />
          </View>
        </Section>
      </View>

      <Sheet visible={!!edit} onClose={() => setEdit(null)} title="Service duration"
        footer={<View style={{ gap: 10 }}><Button label="Save" size="lg" block onPress={saveItem} />{items.some((x) => x.variantId === edit?.variantId) ? <Button label="Remove" kind="outline" block onPress={() => void removeItem()} /> : null}</View>}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          {edit ? <Field label="Service" value={services.find((x) => x.value === edit.variantId)?.label ?? edit.variantId} editable={false} /> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NumberField containerStyle={{ flex: 1 }} label="Duration (minutes)" value={duration} onChange={setDuration} />
            <NumberField containerStyle={{ flex: 1 }} label="Clean-up after (minutes)" value={buffer} onChange={setBuffer} />
          </View>
          <SwitchRow title="Active" subtitle="Switch off to stop booking it" value={active} onChange={setActive} />
        </View>
      </Sheet>
    </Screen>
  )
}
