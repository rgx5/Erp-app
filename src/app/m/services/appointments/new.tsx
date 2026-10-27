import React, { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, MoneyField, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip, Tap } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Close } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { canEditAppt, noShowProblem } from '@/modules/services/logic/appointments'
import { activeResources, bufferOf, canDo, durationOf, freeSlots } from '@/modules/services/logic/calendar'
import { saveAppointment } from '@/modules/services/ops'
import { act, CustomerField, DateField, Denied, dayText, dayValue, momentOf, TimeField, timeText, VariantSelect } from '@/modules/services/ui/common'

interface Row { variantId: string; name: string; price: string; duration: string }

/** Book an appointment (or change one that has not started): who, what, with whom, and when — with the free times shown. */
export default function AppointmentForm() {
  const { c } = useTheme()
  const router = useRouter()
  const p = useLocalSearchParams<{ id?: string; resourceId?: string; start?: string; customerId?: string }>()
  const can = useCan('services')
  const manager = useCan('servicesManage')
  const data = useApp((s) => s.data)
  const cur = p.id ? data.appointments?.[p.id] : undefined
  const startMs = cur?.start ?? (p.start && Number(p.start) > 0 ? Number(p.start) : Date.now())
  const [customerId, setCustomerId] = useState<string | null>(cur?.customerId ?? p.customerId ?? null)
  const [name, setName] = useState(cur?.partyName ?? '')
  const [phone, setPhone] = useState(cur?.partyPhone ?? '')
  const [rows, setRows] = useState<Row[]>(cur?.services.map((s) => ({ variantId: s.variantId, name: s.name, price: String(s.price), duration: String(s.durationMin) })) ?? [])
  const [resourceId, setResourceId] = useState(cur?.resourceId ?? p.resourceId ?? '')
  const [day, setDay] = useState(dayText(startMs))
  const [time, setTime] = useState(p.start && new Date(startMs).getHours() === 0 && !cur ? '' : timeText(startMs))
  const [notes, setNotes] = useState(cur?.notes ?? '')
  const [override, setOverride] = useState(false)

  const resources = activeResources(data).filter((r) => canDo(r, rows.map((x) => x.variantId)))
  useEffect(() => { if (resourceId && !resources.some((r) => r.id === resourceId) && rows.length) setResourceId('') }, [rows.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const minutes = rows.reduce((s, r) => s + (Number(r.duration) || 0), 0)
  const total = rows.reduce((s, r) => s + (Number(r.price) || 0), 0)
  const dayStart = dayValue(day)
  const slots = useMemo(() => (resourceId && dayStart !== undefined && minutes > 0 ? freeSlots(data, resourceId, dayStart, minutes, Date.now(), { bufferMin: bufferOf(data, { services: rows.map((r) => ({ variantId: r.variantId, name: '', durationMin: 0, price: 0 })) }), ignoreId: cur?.id }).slice(0, 24) : []), [data, resourceId, dayStart, minutes, rows, cur?.id])
  const warn = !cur ? noShowProblem(data, { customerId, phone: customerId ? data.customers[customerId]?.phone : phone, name: customerId ? data.customers[customerId]?.name : name }) : null

  if (!can) return <Denied title="Appointment" who="Appointments are for people who work at the counter." />
  if (cur && !canEditAppt(cur)) return <Denied title="Appointment" who="Only a booked or confirmed appointment can be changed." />

  function save() {
    const start = momentOf(day, time)
    if (start === undefined) { toast('Enter the day and the time', 'err'); return }
    const r = act((s, ctx) => saveAppointment(s, {
      customerId, partyName: name, partyPhone: phone, resourceId, start, notes, override: override && manager,
      services: rows.map((x) => ({ variantId: x.variantId, price: Number(x.price) || 0, durationMin: Number(x.duration) || undefined })),
    }, cur?.id, ctx), cur ? 'Appointment changed' : 'Booked')
    if (r) router.replace({ pathname: '/m/services/appointments/[id]', params: { id: r.appointment.id } })
  }

  return (
    <Screen title={cur ? `Change ${cur.no}` : 'New appointment'} back footer={<Button label={cur ? 'Save changes' : 'Book it'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <CustomerField value={customerId} optional onChange={(cu) => setCustomerId(cu?.id ?? null)} />
        {!customerId ? (
          <View style={{ gap: 12 }}>
            <Field label="Or type a name" value={name} onChangeText={setName} autoCapitalize="words" />
            <Field label="Mobile (for the reminder)" value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
          </View>
        ) : null}
        {warn ? <Card tone="warning"><T v="caption">{warn}</T></Card> : null}

        <Section title="Services" style={{ marginTop: 6 }}>
          <View style={{ gap: 10 }}>
            {rows.map((r, i) => (
              <Card key={`${r.variantId}${i}`} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{r.name}</T>
                  <Tap onPress={() => setRows(rows.filter((_, j) => j !== i))} accessibilityLabel="Remove service"><Close size={18} color={c.inkMute} /></Tap>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <MoneyField containerStyle={{ flex: 1 }} label="Price" value={r.price} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, price: v } : x)))} />
                  <Field containerStyle={{ flex: 1 }} label="Minutes" value={r.duration} keyboardType="number-pad" onChangeText={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, duration: v.replace(/\D/g, '') } : x)))} />
                </View>
              </Card>
            ))}
            <VariantSelect kind="service" value="" placeholder="Add a service" onChange={(v, ch) => setRows([...rows, { variantId: v, name: ch.name, price: String(ch.price), duration: String(durationOf(data, v)) }])} />
            {rows.length ? <T v="caption" tone="mute">{minutes} minutes · {inr(total, 0)}</T> : null}
          </View>
        </Section>

        <Select label="With" value={resourceId} placeholder={rows.length ? 'Choose who or what' : 'Add a service first'} options={resources.map((r) => ({ value: r.id, label: r.name, sub: r.kind === 'staff' ? 'Staff' : 'Resource' }))} onChange={setResourceId} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1.2 }}><DateField label="Day" value={day} onChange={setDay} /></View>
          <View style={{ flex: 1 }}><TimeField label="Time" value={time} onChange={setTime} /></View>
        </View>
        {resourceId && minutes > 0 ? (
          slots.length ? (
            <View style={{ gap: 6 }}>
              <T v="label" tone="soft">FREE TIMES</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {slots.map((s) => <Chip key={s} label={fmtTime(s)} selected={momentOf(day, time) === s} onPress={() => setTime(timeText(s))} />)}
              </View>
            </View>
          ) : <T v="caption" tone="warning">No free time that day for {minutes} minutes. Try another day.</T>
        ) : null}
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline autoCapitalize="sentences" />
        {manager ? <Card padded={false}><SwitchRow title="Allow outside the rules" subtitle="Outside working hours, or a customer over the no-show limit" value={override} onChange={setOverride} /></Card> : null}
      </View>
    </Screen>
  )
}
