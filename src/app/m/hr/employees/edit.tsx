import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCan } from '@/data/store'
import { hrSettings } from '@/modules/hr/logic/settings'
import { WEEKDAYS, ymdOf } from '@/modules/hr/logic/ymd'
import { saveEmployee } from '@/modules/hr/ops'
import { act, Denied, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Field, Segmented, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'

/** Add an employee, or change one. */
export default function EmployeeForm() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const can = useCan('hr')
  const { data, now } = useHr()
  const cur = id ? data.employees?.[id] : undefined
  const settings = hrSettings(data)
  const [name, setName] = useState(cur?.name ?? '')
  const [phone, setPhone] = useState(cur?.phone ?? '')
  const [email, setEmail] = useState(cur?.email ?? '')
  const [designation, setDesignation] = useState(cur?.designation ?? '')
  const [department, setDepartment] = useState(cur?.department ?? '')
  const [joinDate, setJoinDate] = useState(cur?.joinDate ?? ymdOf(now))
  const [dob, setDob] = useState(cur?.dob ?? '')
  const [gender, setGender] = useState<'female' | 'male' | 'other' | ''>(cur?.gender ?? '')
  const [address, setAddress] = useState(cur?.address ?? '')
  const [userId, setUserId] = useState(cur?.userId ?? '')
  const [shiftId, setShiftId] = useState(cur?.shiftId ?? '')
  const [weeklyOff, setWeeklyOff] = useState<number[]>(cur?.weeklyOff ?? settings.weeklyOffDefault)
  const [emName, setEmName] = useState(cur?.emergency.name ?? '')
  const [emPhone, setEmPhone] = useState(cur?.emergency.phone ?? '')
  const [emRel, setEmRel] = useState(cur?.emergency.relation ?? '')
  const [notes, setNotes] = useState(cur?.notes ?? '')

  if (!can) return <Denied title="Employee" who="The staff list is for the owner and managers." />
  if (id && !cur) return <Denied title="Not found" who="This employee is no longer here." />
  const taken = new Set(Object.values(data.employees ?? {}).filter((e) => e.id !== id && e.userId).map((e) => e.userId))
  const users = Object.values(data.users).filter((u) => u.active && !taken.has(u.id))
  const shifts = Object.values(data.workShifts ?? {}).filter((s) => s.active || s.id === shiftId)

  function save() {
    const r = act((s, ctx) => saveEmployee(s, {
      name, phone, email, designation, department, joinDate, dob: dob || undefined, gender: gender || undefined, address, userId: userId || undefined, shiftId: shiftId || undefined, weeklyOff,
      emergency: { name: emName, phone: emPhone, relation: emRel }, notes,
    }, id, ctx), id ? 'Saved' : 'Employee added')
    if (r) { if (id) router.back(); else router.replace({ pathname: '/m/hr/employees/[id]', params: { id: r.employee.id } } as never) }
  }

  return (
    <Screen title={cur ? 'Edit employee' : 'New employee'} back footer={<Button label={cur ? 'Save' : 'Add employee'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Section title="Who" style={{ marginTop: 0 }}>
          <View style={{ gap: 14 }}>
            <Field label="Full name" value={name} onChangeText={setName} autoCapitalize="words" />
            <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Field label="Email (optional)" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Field label="Date of birth (optional)" value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            <Segmented value={gender || 'none'} options={[{ value: 'none', label: '—' }, { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' }]} onChange={(v) => setGender(v === 'none' ? '' : v)} />
            <Field label="Address (optional)" value={address} onChangeText={setAddress} multiline />
          </View>
        </Section>
        <Section title="Job" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <Field label="Job title" value={designation} onChangeText={setDesignation} placeholder="Salesman, Tailor, Store manager…" />
            <Field label="Department (optional)" value={department} onChangeText={setDepartment} />
            <Field label="Joining date" value={joinDate} onChangeText={setJoinDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            <Select label="Usual shift" value={shiftId} onChange={setShiftId} placeholder="No fixed shift" options={[{ value: '', label: 'No fixed shift' }, ...shifts.map((s) => ({ value: s.id, label: s.name, sub: `${s.start}–${s.end}` }))]} />
            <Select label="Sign-in account" value={userId} onChange={setUserId} placeholder="Not linked" hint="Link the account this person signs in with. Their bills then count towards their sales target, and they can punch in on their own phone."
              options={[{ value: '', label: 'Not linked' }, ...users.map((u) => ({ value: u.id, label: u.name, sub: u.role }))]} />
          </View>
        </Section>
        <Section title="Weekly off" style={{ marginTop: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {WEEKDAYS.map((d, i) => <Chip key={d} label={d} selected={weeklyOff.includes(i)} onPress={() => setWeeklyOff((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))} />)}
          </View>
        </Section>
        <Section title="In an emergency" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <Field label="Contact name" value={emName} onChangeText={setEmName} />
            <Field label="Contact phone" value={emPhone} onChangeText={setEmPhone} keyboardType="phone-pad" />
            <Field label="Relation" value={emRel} onChangeText={setEmRel} placeholder="Father, wife…" />
          </View>
        </Section>
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
      </View>
    </Screen>
  )
}
