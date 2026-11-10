import React from 'react'
import { View } from 'react-native'
import type { Employee } from '@/modules/hr/types'
import { Field, MoneyField, Select } from '@/ui/Inputs'
import { Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopNewClaimProps {
  isHr: boolean
  empId: string; setEmpId: (v: string) => void
  employees: Employee[]
  amount: string; setAmount: (v: string) => void
  cats: string[]
  category: string; setCategory: (v: string) => void
  description: string; setDescription: (v: string) => void
  date: string; setDate: (v: string) => void
  ref: string; setRef: (v: string) => void
  onSave: () => void
}

/** The desktop "expense claim" screen: the exact form the phone screen builds, in the settings shell. */
export function DesktopNewClaim(p: DesktopNewClaimProps) {
  return (
    <DesktopSettingsPage title="Expense claim" right={<DeskButton label="Send claim" tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        {p.isHr ? <Select label="For" value={p.empId} onChange={p.setEmpId} searchable={p.employees.length > 8} placeholder="Choose a person" options={p.employees.map((e) => ({ value: e.id, label: e.name }))} /> : null}
        <MoneyField label="Amount" value={p.amount} onChange={p.setAmount} large />
        <Section title="What kind" style={{ marginTop: 0 }}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{p.cats.map((c) => <Chip key={c} label={c} selected={p.category === c} onPress={() => p.setCategory(c)} />)}</View></Section>
        <Field label="What was it for" value={p.description} onChangeText={p.setDescription} placeholder="Auto to the supplier's godown" />
        <Field label="Date" value={p.date} onChangeText={p.setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <Field label="Bill / UPI reference (optional)" value={p.ref} onChangeText={p.setRef} />
      </View>
    </DesktopSettingsPage>
  )
}
