import React from 'react'
import { View } from 'react-native'
import { Field, Select } from '@/ui/Inputs'
import type { FieldVisit } from '@/modules/services/types'
import { CustomerField, DateField, TimeField } from '@/modules/services/ui/common'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopVisitFormProps {
  cur?: FieldVisit
  customerId: string | null; setCustomerId: (v: string | null) => void
  name: string; setName: (v: string) => void; phone: string; setPhone: (v: string) => void
  address: string; setAddress: (v: string) => void; purpose: string; setPurpose: (v: string) => void
  team: Array<{ id: string; name: string }>; userId: string; setUserId: (v: string) => void
  day: string; setDay: (v: string) => void; time: string; setTime: (v: string) => void
  projects: Array<{ id: string; name: string }>; projectId: string; setProjectId: (v: string) => void
  jobs: Array<{ id: string; no: string; title: string }>; jobCardId: string; setJobCardId: (v: string) => void
  notes: string; setNotes: (v: string) => void
  onSave: () => void
}

/** The desktop visit-planning form: the same fields as the phone screen, centred in the settings-page shell. */
export function DesktopVisitForm(p: DesktopVisitFormProps) {
  return (
    <DesktopSettingsPage title={p.cur ? 'Edit visit' : 'New visit'} subtitle="Field visits" right={<DeskButton label={p.cur ? 'Save changes' : 'Plan it'} tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <CustomerField value={p.customerId} optional onChange={(c) => p.setCustomerId(c?.id ?? null)} />
        {!p.customerId ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><Field label="Or type a name" value={p.name} onChangeText={p.setName} autoCapitalize="words" /></View>
            <View style={{ flex: 1 }}><Field label="Mobile (optional)" value={p.phone} onChangeText={(t) => p.setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" /></View>
          </View>
        ) : null}
        <Field label="Address" value={p.address} onChangeText={p.setAddress} multiline autoCapitalize="sentences" />
        <Field label="Purpose" value={p.purpose} onChangeText={p.setPurpose} autoCapitalize="sentences" placeholder="Annual service, installation…" />
        <Select label="Who is visiting" value={p.userId} placeholder="Choose a person" options={p.team.map((u) => ({ value: u.id, label: u.name }))} onChange={p.setUserId} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1.2 }}><DateField label="Day" value={p.day} onChange={p.setDay} /></View>
          <View style={{ flex: 1 }}><TimeField label="Time" value={p.time} onChange={p.setTime} /></View>
        </View>
        {p.projects.length ? <Select label="Project (optional)" value={p.projectId} placeholder="None" options={[{ value: '', label: 'None' }, ...p.projects.map((x) => ({ value: x.id, label: x.name }))]} onChange={p.setProjectId} /> : null}
        {p.jobs.length ? <Select label="Job card (optional)" value={p.jobCardId} placeholder="None" options={[{ value: '', label: 'None' }, ...p.jobs.map((x) => ({ value: x.id, label: `${x.no} · ${x.title}` }))]} onChange={p.setJobCardId} /> : null}
        <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline autoCapitalize="sentences" />
      </View>
    </DesktopSettingsPage>
  )
}
