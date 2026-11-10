import React from 'react'
import { View } from 'react-native'
import type { OpeningStatus } from '@/modules/hr/types'
import { Field, NumberField, Segmented } from '@/ui/Inputs'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopOpeningProps {
  isEdit: boolean
  title: string; setTitle: (v: string) => void
  department: string; setDepartment: (v: string) => void
  positions: string; setPositions: (v: string) => void
  location: string; setLocation: (v: string) => void
  pay: string; setPay: (v: string) => void
  desc: string; setDesc: (v: string) => void
  status: OpeningStatus; setStatus: (v: OpeningStatus) => void
  onSave: () => void
}

/** The desktop "opening" screen: the exact form the phone screen builds, in the settings shell. */
export function DesktopOpening(p: DesktopOpeningProps) {
  return (
    <DesktopSettingsPage title={p.isEdit ? 'Edit opening' : 'New opening'} right={<DeskButton label="Save" tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <Field label="Job title" value={p.title} onChangeText={p.setTitle} placeholder="Sales associate" />
        <Field label="Department (optional)" value={p.department} onChangeText={p.setDepartment} />
        <NumberField label="People to hire" value={p.positions} onChange={p.setPositions} />
        <Field label="Location (optional)" value={p.location} onChangeText={p.setLocation} />
        <Field label="Pay on offer (optional)" value={p.pay} onChangeText={p.setPay} placeholder="₹15,000–18,000 a month" />
        <Field label="About the job (optional)" value={p.desc} onChangeText={p.setDesc} multiline />
        {p.isEdit ? <Segmented value={p.status} options={[{ value: 'open', label: 'Open' }, { value: 'on_hold', label: 'On hold' }, { value: 'closed', label: 'Closed' }]} onChange={p.setStatus} /> : null}
      </View>
    </DesktopSettingsPage>
  )
}
