import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, Segmented, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Section } from '@/ui/blocks'
import { saveJobCard } from '@/modules/services/ops'
import { IDENTIFIER_LABEL, KIND_LABEL, READING_LABEL } from '@/modules/services/logic/jobs'
import { PhotoStrip } from '@/modules/services/ui/Photos'
import type { JobKind } from '@/modules/services/types'
import { act, CustomerField, DateField, dayText, dayValue, Denied, useTeam } from '@/modules/services/ui/common'

const KINDS: JobKind[] = ['device', 'vehicle', 'appliance', 'other']

/** Intake (or edit) of a job card: whose item it is, what it is, what is wrong, and photos of how it arrived. */
export default function JobForm() {
  const router = useRouter()
  const p = useLocalSearchParams<{ id?: string }>()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const team = useTeam()
  const cur = p.id ? data.jobCards?.[p.id] : undefined

  const [customerId, setCustomerId] = useState<string | null>(cur?.customerId ?? null)
  const [name, setName] = useState(cur?.partyName ?? '')
  const [phone, setPhone] = useState(cur?.partyPhone ?? '')
  const [kind, setKind] = useState<JobKind>(cur?.kind ?? 'device')
  const [title, setTitle] = useState(cur?.title ?? '')
  const [identifier, setIdentifier] = useState(cur?.identifier ?? '')
  const [reading, setReading] = useState(cur?.reading ?? '')
  const [accessories, setAccessories] = useState(cur?.accessories ?? '')
  const [condition, setCondition] = useState(cur?.condition ?? '')
  const [problem, setProblem] = useState(cur?.problem ?? '')
  const [photos, setPhotos] = useState<string[]>(cur?.photos ?? [])
  const [assignedTo, setAssignedTo] = useState(cur?.assignedTo ?? '')
  const [promised, setPromised] = useState(cur?.promisedAt ? dayText(cur.promisedAt) : '')
  const [notes, setNotes] = useState(cur?.notes ?? '')

  if (!can) return <Denied title="Job card" who="Job cards are for people who work at the counter." />
  if (cur && (cur.status === 'delivered' || cur.status === 'cancelled')) return <Denied title={cur.no} who="A closed job card cannot be changed." />

  function save() {
    const r = act((s, ctx) => saveJobCard(s, {
      customerId, partyName: name, partyPhone: phone, kind, title, identifier, reading, accessories, condition, problem, photos, notes,
      ...(assignedTo ? { assignedTo } : {}), ...(dayValue(promised) !== undefined ? { promisedAt: dayValue(promised) } : {}),
    }, cur?.id, ctx), cur ? 'Saved' : 'Job taken in')
    if (r) router.replace({ pathname: '/m/services/jobs/[id]', params: { id: r.job.id } })
  }

  return (
    <Screen title={cur ? `Edit ${cur.no}` : 'New intake'} back footer={<Button label={cur ? 'Save changes' : 'Take it in'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <CustomerField value={customerId} optional onChange={(cu) => setCustomerId(cu?.id ?? null)} />
        {!customerId ? (
          <View style={{ gap: 12 }}>
            <Field label="Or type a name" value={name} onChangeText={setName} autoCapitalize="words" />
            <Field label="Mobile (optional)" value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
          </View>
        ) : null}

        <Segmented value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <Field label="Make and model" value={title} onChangeText={setTitle} autoCapitalize="words" />
        <Field label={IDENTIFIER_LABEL[kind]} value={identifier} onChangeText={setIdentifier} autoCapitalize="characters" />
        <Field label={READING_LABEL[kind]} value={reading} onChangeText={setReading} />
        <Field label="Accessories left with it (optional)" value={accessories} onChangeText={setAccessories} />
        <Field label="Condition on arrival (optional)" value={condition} onChangeText={setCondition} multiline autoCapitalize="sentences" />
        <Field label="What is wrong with it" value={problem} onChangeText={setProblem} multiline autoCapitalize="sentences" />

        <Section title="Photos" style={{ marginTop: 6 }}>
          <PhotoStrip photos={photos} onChange={setPhotos} />
        </Section>

        <Select label="Assigned to (optional)" value={assignedTo} placeholder="Not assigned yet" options={[{ value: '', label: 'Not assigned yet' }, ...team.map((u) => ({ value: u.id, label: u.name }))]} onChange={setAssignedTo} />
        <DateField label="Promised by (optional)" value={promised} onChange={setPromised} />
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline autoCapitalize="sentences" />
      </View>
    </Screen>
  )
}
