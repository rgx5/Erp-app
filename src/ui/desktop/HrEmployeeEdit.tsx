import React from 'react'
import { View } from 'react-native'
import type { WorkShift } from '@/modules/hr/types'
import { Field, Segmented, Select } from '@/ui/Inputs'
import { Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopEmployeeEditProps {
  isNew: boolean
  name: string; setName: (v: string) => void
  phone: string; setPhone: (v: string) => void
  email: string; setEmail: (v: string) => void
  designation: string; setDesignation: (v: string) => void
  department: string; setDepartment: (v: string) => void
  joinDate: string; setJoinDate: (v: string) => void
  dob: string; setDob: (v: string) => void
  gender: 'female' | 'male' | 'other' | ''; setGender: (v: 'female' | 'male' | 'other' | '') => void
  address: string; setAddress: (v: string) => void
  userId: string; setUserId: (v: string) => void
  shiftId: string; setShiftId: (v: string) => void
  weeklyOff: number[]; setWeeklyOff: (v: number[] | ((w: number[]) => number[])) => void
  emName: string; setEmName: (v: string) => void
  emPhone: string; setEmPhone: (v: string) => void
  emRel: string; setEmRel: (v: string) => void
  notes: string; setNotes: (v: string) => void
  weekdays: readonly string[]
  shifts: WorkShift[]
  users: Array<{ id: string; name: string; role: string }>
  onSave: () => void
}

/**
 * The desktop "add / edit employee" screen: the exact `Field`/`Select`/`Chip` form the phone screen builds, in the
 * shared centred-column shell (`DesktopSettingsPage`) every desktop form uses — no validation or save logic here,
 * `onSave` is the phone screen's own `save()`.
 */
export function DesktopEmployeeEdit(p: DesktopEmployeeEditProps) {
  return (
    <DesktopSettingsPage title={p.isNew ? 'New employee' : 'Edit employee'} right={<DeskButton label={p.isNew ? 'Add employee' : 'Save'} tone="primary" onPress={p.onSave} />}>
      <Section title="Who" style={{ marginTop: 0 }}>
        <View style={{ gap: 14 }}>
          <Field label="Full name" value={p.name} onChangeText={p.setName} autoCapitalize="words" />
          <Field label="Phone" value={p.phone} onChangeText={p.setPhone} keyboardType="phone-pad" />
          <Field label="Email (optional)" value={p.email} onChangeText={p.setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Date of birth (optional)" value={p.dob} onChangeText={p.setDob} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          <Segmented value={p.gender || 'none'} options={[{ value: 'none', label: '—' }, { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' }]} onChange={(v) => p.setGender(v === 'none' ? '' : v)} />
          <Field label="Address (optional)" value={p.address} onChangeText={p.setAddress} multiline />
        </View>
      </Section>
      <Section title="Job">
        <View style={{ gap: 14 }}>
          <Field label="Job title" value={p.designation} onChangeText={p.setDesignation} placeholder="Salesman, Tailor, Store manager…" />
          <Field label="Department (optional)" value={p.department} onChangeText={p.setDepartment} />
          <Field label="Joining date" value={p.joinDate} onChangeText={p.setJoinDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          <Select label="Usual shift" value={p.shiftId} onChange={p.setShiftId} placeholder="No fixed shift" options={[{ value: '', label: 'No fixed shift' }, ...p.shifts.map((s) => ({ value: s.id, label: s.name, sub: `${s.start}–${s.end}` }))]} />
          <Select label="Sign-in account" value={p.userId} onChange={p.setUserId} placeholder="Not linked" hint="Link the account this person signs in with. Their bills then count towards their sales target, and they can punch in on their own phone."
            options={[{ value: '', label: 'Not linked' }, ...p.users.map((u) => ({ value: u.id, label: u.name, sub: u.role }))]} />
        </View>
      </Section>
      <Section title="Weekly off">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {p.weekdays.map((d, i) => <Chip key={d} label={d} selected={p.weeklyOff.includes(i)} onPress={() => p.setWeeklyOff((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))} />)}
        </View>
      </Section>
      <Section title="In an emergency">
        <View style={{ gap: 14 }}>
          <Field label="Contact name" value={p.emName} onChangeText={p.setEmName} />
          <Field label="Contact phone" value={p.emPhone} onChangeText={p.setEmPhone} keyboardType="phone-pad" />
          <Field label="Relation" value={p.emRel} onChangeText={p.setEmRel} placeholder="Father, wife…" />
        </View>
      </Section>
      <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline />
    </DesktopSettingsPage>
  )
}
