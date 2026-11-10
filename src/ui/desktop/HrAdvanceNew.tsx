import React from 'react'
import { View } from 'react-native'
import { inr } from '@/domain/money'
import { labelYM } from '@/modules/hr/logic/ymd'
import type { AdvanceKind, Employee, YM } from '@/modules/hr/types'
import { Field, MoneyField, NumberField, Segmented, Select } from '@/ui/Inputs'
import { Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

const MODE_OPTIONS: Array<{ value: 'cash' | 'bank' | 'upi'; label: string }> = [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }]

export interface DesktopNewAdvanceProps {
  empId: string; setEmpId: (v: string) => void
  employees: Employee[]
  kind: AdvanceKind; setKind: (v: AdvanceKind) => void
  amount: string; setAmount: (v: string) => void
  months: string; setMonths: (v: string) => void
  start: YM; setStart: (v: YM) => void
  startOptions: YM[]
  mode: 'cash' | 'bank' | 'upi'; setMode: (v: 'cash' | 'bank' | 'upi') => void
  ref: string; setRef: (v: string) => void
  note: string; setNote: (v: string) => void
  emi: number
  n: number
  onSave: () => void
}

/** The desktop "give an advance" screen: the exact form the phone screen builds, in the settings shell. */
export function DesktopNewAdvance(p: DesktopNewAdvanceProps) {
  return (
    <DesktopSettingsPage title="Give an advance" right={<DeskButton label={Number(p.amount) > 0 ? `Give ${inr(Number(p.amount), 0)}` : 'Give'} tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <Select label="To" value={p.empId} onChange={p.setEmpId} searchable={p.employees.length > 8} placeholder="Choose a person" options={p.employees.map((e) => ({ value: e.id, label: e.name }))} />
        <Segmented value={p.kind} options={[{ value: 'advance', label: 'Advance' }, { value: 'loan', label: 'Loan in instalments' }]} onChange={(k) => { p.setKind(k); if (k === 'advance') p.setMonths('1') }} />
        <MoneyField label="Amount" value={p.amount} onChange={p.setAmount} large />
        {p.kind === 'loan' ? <NumberField label="Recover over (months)" value={p.months} onChange={p.setMonths} /> : null}
        <Section title="Recovery starts" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>{p.startOptions.map((o) => <Chip key={o} label={labelYM(o)} selected={p.start === o} onPress={() => p.setStart(o)} />)}</View>
        </Section>
        <Section title="Given by" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={p.mode === m.value} onPress={() => p.setMode(m.value)} />)}</View>
        </Section>
        {p.mode !== 'cash' ? <Field value={p.ref} onChangeText={p.setRef} placeholder="Reference" /> : null}
        <Field label="Note (optional)" value={p.note} onChangeText={p.setNote} />
        {p.emi > 0 ? <T tone="mute">Payroll will take {inr(p.emi, 0)} a month from {labelYM(p.start)}{p.n > 1 ? ` for ${p.n} months` : ''}, never more than the pay can bear.</T> : null}
      </View>
    </DesktopSettingsPage>
  )
}
