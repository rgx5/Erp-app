import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCan } from '@/data/store'
import { saveOpening, setOpeningStatus } from '@/modules/hr/ops'
import type { OpeningStatus } from '@/modules/hr/types'
import { act, Denied, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'

/** An opening: the job, how many people, and whether it is open, on hold or closed. */
export default function OpeningForm() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const can = useCan('hr')
  const { data } = useHr()
  const cur = id ? data.hrOpenings?.[id] : undefined
  const [title, setTitle] = useState(cur?.title ?? '')
  const [department, setDepartment] = useState(cur?.department ?? '')
  const [positions, setPositions] = useState(String(cur?.positions ?? 1))
  const [location, setLocation] = useState(cur?.location ?? '')
  const [pay, setPay] = useState(cur?.payRange ?? '')
  const [desc, setDesc] = useState(cur?.description ?? '')
  const [status, setStatus] = useState<OpeningStatus>(cur?.status ?? 'open')
  if (!can) return <Denied title="Opening" who="Recruitment is for the owner and managers." />

  function save() {
    const r = act((s, ctx) => saveOpening(s, { title, department, positions: Number(positions), location, payRange: pay, description: desc }, id, ctx), undefined)
    if (!r) return
    if (cur && status !== cur.status && !act((s, ctx) => setOpeningStatus(s, cur.id, status, ctx))) return
    router.back()
  }
  return (
    <Screen title={cur ? 'Edit opening' : 'New opening'} back footer={<Button label="Save" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Field label="Job title" value={title} onChangeText={setTitle} placeholder="Sales associate" />
        <Field label="Department (optional)" value={department} onChangeText={setDepartment} />
        <NumberField label="People to hire" value={positions} onChange={setPositions} />
        <Field label="Location (optional)" value={location} onChangeText={setLocation} />
        <Field label="Pay on offer (optional)" value={pay} onChangeText={setPay} placeholder="₹15,000–18,000 a month" />
        <Field label="About the job (optional)" value={desc} onChangeText={setDesc} multiline />
        {cur ? <Segmented value={status} options={[{ value: 'open', label: 'Open' }, { value: 'on_hold', label: 'On hold' }, { value: 'closed', label: 'Closed' }]} onChange={setStatus} /> : null}
      </View>
    </Screen>
  )
}
