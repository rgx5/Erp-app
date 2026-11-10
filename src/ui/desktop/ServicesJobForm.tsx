import React from 'react'
import { View } from 'react-native'
import { Field, Segmented, Select } from '@/ui/Inputs'
import { Section } from '@/ui/blocks'
import { IDENTIFIER_LABEL, KIND_LABEL, READING_LABEL } from '@/modules/services/logic/jobs'
import { PhotoStrip } from '@/modules/services/ui/Photos'
import type { JobCard, JobKind } from '@/modules/services/types'
import { CustomerField, DateField } from '@/modules/services/ui/common'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

const KINDS: JobKind[] = ['device', 'vehicle', 'appliance', 'other']

export interface DesktopJobFormProps {
  cur?: JobCard
  customerId: string | null; setCustomerId: (v: string | null) => void
  name: string; setName: (v: string) => void; phone: string; setPhone: (v: string) => void
  kind: JobKind; setKind: (v: JobKind) => void; title: string; setTitle: (v: string) => void
  identifier: string; setIdentifier: (v: string) => void; reading: string; setReading: (v: string) => void
  accessories: string; setAccessories: (v: string) => void; condition: string; setCondition: (v: string) => void
  problem: string; setProblem: (v: string) => void; photos: string[]; setPhotos: (v: string[]) => void
  team: Array<{ id: string; name: string }>; assignedTo: string; setAssignedTo: (v: string) => void
  promised: string; setPromised: (v: string) => void; notes: string; setNotes: (v: string) => void
  onSave: () => void
}

/** The desktop job intake form: the same fields as the phone screen, centred in the settings-page shell. */
export function DesktopJobForm(p: DesktopJobFormProps) {
  return (
    <DesktopSettingsPage title={p.cur ? `Edit ${p.cur.no}` : 'New intake'} subtitle="Job cards" right={<DeskButton label={p.cur ? 'Save changes' : 'Take it in'} tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <CustomerField value={p.customerId} optional onChange={(cu) => p.setCustomerId(cu?.id ?? null)} />
        {!p.customerId ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><Field label="Or type a name" value={p.name} onChangeText={p.setName} autoCapitalize="words" /></View>
            <View style={{ flex: 1 }}><Field label="Mobile (optional)" value={p.phone} onChangeText={(t) => p.setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" /></View>
          </View>
        ) : null}

        <Segmented value={p.kind} onChange={p.setKind} options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><Field label="Make and model" value={p.title} onChangeText={p.setTitle} autoCapitalize="words" /></View>
          <View style={{ flex: 1 }}><Field label={IDENTIFIER_LABEL[p.kind]} value={p.identifier} onChangeText={p.setIdentifier} autoCapitalize="characters" /></View>
        </View>
        <Field label={READING_LABEL[p.kind]} value={p.reading} onChangeText={p.setReading} />
        <Field label="Accessories left with it (optional)" value={p.accessories} onChangeText={p.setAccessories} />
        <Field label="Condition on arrival (optional)" value={p.condition} onChangeText={p.setCondition} multiline autoCapitalize="sentences" />
        <Field label="What is wrong with it" value={p.problem} onChangeText={p.setProblem} multiline autoCapitalize="sentences" />

        <Section title="Photos" style={{ marginTop: 6 }}>
          <PhotoStrip photos={p.photos} onChange={p.setPhotos} />
        </Section>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><Select label="Assigned to (optional)" value={p.assignedTo} placeholder="Not assigned yet" options={[{ value: '', label: 'Not assigned yet' }, ...p.team.map((u) => ({ value: u.id, label: u.name }))]} onChange={p.setAssignedTo} /></View>
          <View style={{ flex: 1 }}><DateField label="Promised by (optional)" value={p.promised} onChange={p.setPromised} /></View>
        </View>
        <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline autoCapitalize="sentences" />
      </View>
    </DesktopSettingsPage>
  )
}
