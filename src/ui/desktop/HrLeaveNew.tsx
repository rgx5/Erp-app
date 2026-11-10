import React from 'react'
import { View } from 'react-native'
import type { Employee, LeaveType } from '@/modules/hr/types'
import { Field, Select } from '@/ui/Inputs'
import { Chip } from '@/ui/primitives'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopNewLeaveProps {
  isHr: boolean
  empId: string; setEmpId: (v: string) => void
  employees: Employee[]
  typeId: string; setTypeId: (v: string) => void
  types: LeaveType[]
  from: string; setFrom: (v: string) => void
  to: string; setTo: (v: string) => void
  half: '' | 'first' | 'second'; setHalf: (v: '' | 'first' | 'second') => void
  reason: string; setReason: (v: string) => void
  days: number
  hasEmployee: boolean
  onSave: () => void
}

/** The desktop "ask for leave" screen: the exact form the phone screen builds, in the settings shell. */
export function DesktopNewLeave(p: DesktopNewLeaveProps) {
  return (
    <DesktopSettingsPage title="Ask for leave" right={<DeskButton label={p.days ? `Ask for ${p.days} ${p.days === 1 ? 'day' : 'days'}` : 'Send request'} tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        {p.isHr ? <Select label="For" value={p.empId} onChange={p.setEmpId} searchable={p.employees.length > 8} placeholder="Choose a person" options={p.employees.map((e) => ({ value: e.id, label: e.name, sub: [e.code, e.designation].filter(Boolean).join(' · ') }))} /> : null}
        {p.types.length ? <Select label="Leave type" value={p.typeId} onChange={p.setTypeId} options={p.types.map((t) => ({ value: t.id, label: t.name, sub: t.paid ? undefined : 'Unpaid' }))} /> : <Notice tone="warning" title="No leave types yet" body="A manager needs to set up leave types first." />}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field containerStyle={{ flex: 1 }} label="From" value={p.from} onChangeText={p.setFrom} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          <Field containerStyle={{ flex: 1 }} label="To" value={p.half ? p.from : p.to} onChangeText={p.setTo} placeholder="YYYY-MM-DD" autoCapitalize="none" editable={!p.half} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Full days" selected={!p.half} onPress={() => p.setHalf('')} />
          <Chip label="First half" selected={p.half === 'first'} onPress={() => p.setHalf('first')} />
          <Chip label="Second half" selected={p.half === 'second'} onPress={() => p.setHalf('second')} />
        </View>
        <Field label="Reason (optional)" value={p.reason} onChangeText={p.setReason} />
        {p.hasEmployee ? <T tone="mute">{p.days ? `That is ${p.days} working ${p.days === 1 ? 'day' : 'days'}. Weekly offs and holidays inside the dates are not counted.` : 'No working days in those dates.'}</T> : null}
      </View>
    </DesktopSettingsPage>
  )
}
