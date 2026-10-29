import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { settingsOf } from '@/modules/services/logic/settings'
import { saveProject } from '@/modules/services/ops'
import type { ProjectBilling } from '@/modules/services/types'
import { act, CustomerField, DateField, dayText, dayValue, Denied } from '@/modules/services/ui/common'

/** A new project (or editing one): what it is, who pays, and how it is billed. */
export default function ProjectForm() {
  const router = useRouter()
  const p = useLocalSearchParams<{ id?: string }>()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const cur = p.id ? data.projects?.[p.id] : undefined

  const [name, setName] = useState(cur?.name ?? '')
  const [customerId, setCustomerId] = useState<string | null>(cur?.customerId ?? null)
  const [billing, setBilling] = useState<ProjectBilling>(cur?.billing ?? 'hourly')
  const [hourlyRate, setHourlyRate] = useState(cur ? String(cur.hourlyRate) : String(settingsOf(data).defaultHourlyRate || ''))
  const [fixedAmount, setFixedAmount] = useState(cur ? String(cur.fixedAmount) : '')
  const [budgetHours, setBudgetHours] = useState(cur ? String(cur.budgetHours) : '')
  const [startDate, setStartDate] = useState(cur?.startDate ? dayText(cur.startDate) : '')
  const [dueDate, setDueDate] = useState(cur?.dueDate ? dayText(cur.dueDate) : '')
  const [notes, setNotes] = useState(cur?.notes ?? '')

  if (!can) return <Denied title="Project" who="Projects are for people who work at the counter." />

  function save() {
    const r = act((s, ctx) => saveProject(s, {
      name, customerId, billing, hourlyRate: Number(hourlyRate) || 0, fixedAmount: Number(fixedAmount) || 0, budgetHours: Number(budgetHours) || 0, notes,
      ...(dayValue(startDate) !== undefined ? { startDate: dayValue(startDate) } : {}), ...(dayValue(dueDate) !== undefined ? { dueDate: dayValue(dueDate) } : {}),
    }, cur?.id, ctx), cur ? 'Saved' : 'Project started')
    if (r) router.replace({ pathname: '/m/services/projects/[id]', params: { id: r.project.id } })
  }

  return (
    <Screen title={cur ? 'Edit project' : 'New project'} back footer={<Button label={cur ? 'Save changes' : 'Start project'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Office network wiring" />
        <CustomerField value={customerId} optional onChange={(c) => setCustomerId(c?.id ?? null)} />
        <Segmented value={billing} onChange={setBilling} options={[{ value: 'hourly', label: 'Billed by the hour' }, { value: 'fixed', label: 'Fixed fee' }]} />
        {billing === 'hourly' ? <MoneyField label="Hourly rate" value={hourlyRate} onChange={setHourlyRate} /> : <MoneyField label="Agreed fee (GST included)" value={fixedAmount} onChange={setFixedAmount} />}
        <NumberField label="Budget hours (optional)" value={budgetHours} onChange={setBudgetHours} decimals hint="To track progress; does not limit anything." />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><DateField label="Start (optional)" value={startDate} onChange={setStartDate} /></View>
          <View style={{ flex: 1 }}><DateField label="Due (optional)" value={dueDate} onChange={setDueDate} /></View>
        </View>
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline autoCapitalize="sentences" />
      </View>
    </Screen>
  )
}
