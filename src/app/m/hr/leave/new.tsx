import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useCan } from '@/data/store'
import { leaveDays } from '@/modules/hr/logic/leave'
import { ymdOf } from '@/modules/hr/logic/ymd'
import { requestLeave } from '@/modules/hr/ops'
import { act, Denied, EmployeeSelect, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Field, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Chip } from '@/ui/primitives'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'

/** Ask for leave (or, for a manager, enter it for someone). */
export default function NewLeave() {
  const router = useRouter()
  const isHr = useCan('hr')
  const isSelf = useCan('hrSelf')
  const { data, idx, me, now } = useHr()
  const today = ymdOf(now)
  const [empId, setEmpId] = useState(me?.id ?? '')
  const [typeId, setTypeId] = useState('')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [half, setHalf] = useState<'' | 'first' | 'second'>('')
  const [reason, setReason] = useState('')
  const types = Object.values(data.leaveTypes ?? {}).filter((t) => t.active)
  const employees = Object.values(data.employees ?? {}).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))
  const emp = data.employees?.[empId]
  const days = useMemo(() => (emp ? leaveDays(from, half ? from : to, !!half, emp.weeklyOff, idx.holidays) : 0), [emp, from, to, half, idx.holidays])

  if (!isHr && !isSelf) return <Denied title="Ask for leave" who="Leave is for staff and managers." />
  if (!isHr && !me) return <Denied title="Ask for leave" who="You are not on the staff list yet. Ask the owner to add you as an employee." />

  function save() {
    const r = act((s, ctx) => requestLeave(s, { employeeId: empId, typeId, from, to: half ? from : to, half: half || undefined, reason }, ctx), 'Request sent')
    if (r) router.back()
  }
  return (
    <Screen title="Ask for leave" back footer={<Button label={days ? `Ask for ${days} ${days === 1 ? 'day' : 'days'}` : 'Send request'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        {isHr ? <EmployeeSelect label="For" value={empId} onChange={setEmpId} employees={employees} /> : null}
        {types.length ? <Select label="Leave type" value={typeId} onChange={setTypeId} options={types.map((t) => ({ value: t.id, label: t.name, sub: t.paid ? undefined : 'Unpaid' }))} /> : <Notice tone="warning" title="No leave types yet" body="A manager needs to set up leave types first." />}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field containerStyle={{ flex: 1 }} label="From" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          <Field containerStyle={{ flex: 1 }} label="To" value={half ? from : to} onChangeText={setTo} placeholder="YYYY-MM-DD" autoCapitalize="none" editable={!half} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Full days" selected={!half} onPress={() => setHalf('')} />
          <Chip label="First half" selected={half === 'first'} onPress={() => setHalf('first')} />
          <Chip label="Second half" selected={half === 'second'} onPress={() => setHalf('second')} />
        </View>
        <Field label="Reason (optional)" value={reason} onChangeText={setReason} />
        {emp ? <T tone="mute">{days ? `That is ${days} working ${days === 1 ? 'day' : 'days'}. Weekly offs and holidays inside the dates are not counted.` : 'No working days in those dates.'}</T> : null}
      </View>
    </Screen>
  )
}
