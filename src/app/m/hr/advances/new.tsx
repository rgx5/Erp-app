import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useCan } from '@/data/store'
import { addMonths, labelYM, ymOf } from '@/modules/hr/logic/ymd'
import { issueAdvance } from '@/modules/hr/payrollOps'
import type { AdvanceKind } from '@/modules/hr/types'
import { act, Denied, EmployeeSelect, MODE_OPTIONS, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'

/** Give an advance (taken back in one go) or a loan (taken back in instalments). */
export default function NewAdvance() {
  const router = useRouter()
  const can = useCan('payroll')
  const { data, now } = useHr()
  const [empId, setEmpId] = useState('')
  const [kind, setKind] = useState<AdvanceKind>('advance')
  const [amount, setAmount] = useState('')
  const [months, setMonths] = useState('1')
  const [start, setStart] = useState(ymOf(now))
  const [mode, setMode] = useState<'cash' | 'bank' | 'upi'>('cash')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const employees = Object.values(data.employees ?? {}).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))
  if (!can) return <Denied title="Give an advance" who="Advances are for the owner and managers with payroll access." />
  const n = kind === 'advance' ? 1 : Math.max(1, Math.floor(Number(months) || 1))
  const emi = Number(amount) > 0 ? Math.round((Number(amount) / n) * 100) / 100 : 0

  function save() {
    const r = act((s, ctx) => issueAdvance(s, { employeeId: empId, kind, amount: Number(amount), mode, ref, installments: n, startMonth: start, note }, ctx), undefined)
    if (r) { router.back() }
  }
  return (
    <Screen title="Give an advance" back footer={<Button label={Number(amount) > 0 ? `Give ${inr(Number(amount), 0)}` : 'Give'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <EmployeeSelect label="To" value={empId} onChange={setEmpId} employees={employees} />
        <Segmented value={kind} options={[{ value: 'advance', label: 'Advance' }, { value: 'loan', label: 'Loan in instalments' }]} onChange={(k) => { setKind(k); if (k === 'advance') setMonths('1') }} />
        <MoneyField label="Amount" value={amount} onChange={setAmount} large />
        {kind === 'loan' ? <NumberField label="Recover over (months)" value={months} onChange={setMonths} /> : null}
        <Section title="Recovery starts" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>{[0, 1, 2].map((k) => <Chip key={k} label={labelYM(addMonths(ymOf(now), k))} selected={start === addMonths(ymOf(now), k)} onPress={() => setStart(addMonths(ymOf(now), k))} />)}</View>
        </Section>
        <Section title="Given by" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => setMode(m.value)} />)}</View>
        </Section>
        {mode !== 'cash' ? <Field value={ref} onChangeText={setRef} placeholder="Reference" /> : null}
        <Field label="Note (optional)" value={note} onChangeText={setNote} />
        {emi > 0 ? <T tone="mute">Payroll will take {inr(emi, 0)} a month from {labelYM(start)}{n > 1 ? ` for ${n} months` : ''}, never more than the pay can bear.</T> : null}
      </View>
    </Screen>
  )
}
