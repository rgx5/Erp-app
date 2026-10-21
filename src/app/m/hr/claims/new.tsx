import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useCan } from '@/data/store'
import { useIndustry } from '@/data/hooks'
import { ymdOf } from '@/modules/hr/logic/ymd'
import { submitClaim } from '@/modules/hr/payrollOps'
import { act, Denied, EmployeeSelect, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'

const COMMON = ['Travel', 'Food', 'Fuel', 'Stationery', 'Repairs', 'Phone', 'Other']

/** Claim money spent for the business. */
export default function NewClaim() {
  const router = useRouter()
  const isHr = useCan('hr')
  const isSelf = useCan('hrSelf')
  const { data, me, now } = useHr()
  const industry = useIndustry()
  const [empId, setEmpId] = useState(me?.id ?? '')
  const [date, setDate] = useState(ymdOf(now))
  const [category, setCategory] = useState('Travel')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [ref, setRef] = useState('')
  const cats = [...new Set([...COMMON.slice(0, -1), ...(industry.expenseCategories ?? []).filter((c) => !/salary|rent|gst/i.test(c)), 'Other'])]
  const employees = Object.values(data.employees ?? {}).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))

  if (!isHr && !isSelf) return <Denied title="Expense claim" who="Claims are for staff and managers." />
  if (!isHr && !me) return <Denied title="Expense claim" who="You are not on the staff list yet. Ask the owner to add you as an employee." />

  function save() {
    if (act((s, ctx) => submitClaim(s, { employeeId: empId, date, category, amount: Number(amount), description, ref }, ctx), 'Claim sent')) router.back()
  }
  return (
    <Screen title="Expense claim" back footer={<Button label="Send claim" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        {isHr ? <EmployeeSelect label="For" value={empId} onChange={setEmpId} employees={employees} /> : null}
        <MoneyField label="Amount" value={amount} onChange={setAmount} large />
        <Section title="What kind" style={{ marginTop: 0 }}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{cats.map((c) => <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />)}</View></Section>
        <Field label="What was it for" value={description} onChangeText={setDescription} placeholder="Auto to the supplier’s godown" />
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <Field label="Bill / UPI reference (optional)" value={ref} onChangeText={setRef} />
      </View>
    </Screen>
  )
}
