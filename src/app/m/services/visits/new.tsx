import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { listOf } from '@/data/state'
import { useApp, useCan, useUser } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { toast } from '@/ui/overlays'
import { saveVisit } from '@/modules/services/ops'
import { act, CustomerField, DateField, dayText, Denied, momentOf, TimeField, timeText, useTeam } from '@/modules/services/ui/common'

/** Plans a visit to a customer's place for someone on the team. */
export default function VisitForm() {
  const router = useRouter()
  const p = useLocalSearchParams<{ id?: string }>()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const team = useTeam()
  const me = useUser()
  const cur = p.id ? data.fieldVisits?.[p.id] : undefined

  const [customerId, setCustomerId] = useState<string | null>(cur?.customerId ?? null)
  const [name, setName] = useState(cur?.partyName ?? '')
  const [phone, setPhone] = useState(cur?.partyPhone ?? '')
  const [address, setAddress] = useState(cur?.address ?? '')
  const [purpose, setPurpose] = useState(cur?.purpose ?? '')
  const [userId, setUserId] = useState(cur?.userId ?? me?.id ?? '')
  const [day, setDay] = useState(cur ? dayText(cur.plannedAt) : '')
  const [time, setTime] = useState(cur ? timeText(cur.plannedAt) : '')
  const [projectId, setProjectId] = useState(cur?.projectId ?? '')
  const [jobCardId, setJobCardId] = useState(cur?.jobCardId ?? '')
  const [notes, setNotes] = useState(cur?.notes ?? '')

  const projects = listOf(data.projects ?? {}).filter((x) => x.status === 'active')
  const jobs = listOf(data.jobCards ?? {}).filter((x) => x.status !== 'delivered' && x.status !== 'cancelled')

  if (!can) return <Denied title="Field visit" who="Field visits are for people who work at the counter." />
  if (cur && cur.status !== 'planned') return <Denied title={cur.no} who="Only a planned visit can be changed." />

  function save() {
    const plannedAt = momentOf(day, time)
    if (plannedAt === undefined) { toast('Enter the day and the time', 'err'); return }
    const r = act((s, ctx) => saveVisit(s, {
      customerId, partyName: name, partyPhone: phone, address, purpose, plannedAt, notes, ...(userId ? { userId } : {}), ...(projectId ? { projectId } : {}), ...(jobCardId ? { jobCardId } : {}),
    }, cur?.id, ctx), cur ? 'Saved' : 'Visit planned')
    if (r) router.replace({ pathname: '/m/services/visits/[id]', params: { id: r.visit.id } })
  }

  return (
    <Screen title={cur ? 'Edit visit' : 'New visit'} back footer={<Button label={cur ? 'Save changes' : 'Plan it'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <CustomerField value={customerId} optional onChange={(c) => setCustomerId(c?.id ?? null)} />
        {!customerId ? (
          <View style={{ gap: 12 }}>
            <Field label="Or type a name" value={name} onChangeText={setName} autoCapitalize="words" />
            <Field label="Mobile (optional)" value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
          </View>
        ) : null}
        <Field label="Address" value={address} onChangeText={setAddress} multiline autoCapitalize="sentences" />
        <Field label="Purpose" value={purpose} onChangeText={setPurpose} autoCapitalize="sentences" placeholder="Annual service, installation…" />
        <Select label="Who is visiting" value={userId} placeholder="Choose a person" options={team.map((u) => ({ value: u.id, label: u.name }))} onChange={setUserId} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1.2 }}><DateField label="Day" value={day} onChange={setDay} /></View>
          <View style={{ flex: 1 }}><TimeField label="Time" value={time} onChange={setTime} /></View>
        </View>
        {projects.length ? <Select label="Project (optional)" value={projectId} placeholder="None" options={[{ value: '', label: 'None' }, ...projects.map((x) => ({ value: x.id, label: x.name }))]} onChange={setProjectId} /> : null}
        {jobs.length ? <Select label="Job card (optional)" value={jobCardId} placeholder="None" options={[{ value: '', label: 'None' }, ...jobs.map((x) => ({ value: x.id, label: `${x.no} · ${x.title}` }))]} onChange={setJobCardId} /> : null}
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline autoCapitalize="sentences" />
      </View>
    </Screen>
  )
}
