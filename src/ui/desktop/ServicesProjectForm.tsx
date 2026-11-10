import React from 'react'
import { View } from 'react-native'
import { Field, MoneyField, NumberField, Segmented } from '@/ui/Inputs'
import type { Project, ProjectBilling } from '@/modules/services/types'
import { CustomerField, DateField } from '@/modules/services/ui/common'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopProjectFormProps {
  cur?: Project
  name: string; setName: (v: string) => void; customerId: string | null; setCustomerId: (v: string | null) => void
  billing: ProjectBilling; setBilling: (v: ProjectBilling) => void
  hourlyRate: string; setHourlyRate: (v: string) => void; fixedAmount: string; setFixedAmount: (v: string) => void
  budgetHours: string; setBudgetHours: (v: string) => void
  startDate: string; setStartDate: (v: string) => void; dueDate: string; setDueDate: (v: string) => void
  notes: string; setNotes: (v: string) => void
  onSave: () => void
}

/** The desktop project form: the same fields as the phone screen, centred in the settings-page shell. */
export function DesktopProjectForm(p: DesktopProjectFormProps) {
  return (
    <DesktopSettingsPage title={p.cur ? 'Edit project' : 'New project'} subtitle="Projects & timesheets" right={<DeskButton label={p.cur ? 'Save changes' : 'Start project'} tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <Field label="Name" value={p.name} onChangeText={p.setName} autoCapitalize="words" placeholder="Office network wiring" />
        <CustomerField value={p.customerId} optional onChange={(c) => p.setCustomerId(c?.id ?? null)} />
        <Segmented value={p.billing} onChange={p.setBilling} options={[{ value: 'hourly', label: 'Billed by the hour' }, { value: 'fixed', label: 'Fixed fee' }]} />
        {p.billing === 'hourly' ? <MoneyField label="Hourly rate" value={p.hourlyRate} onChange={p.setHourlyRate} /> : <MoneyField label="Agreed fee (GST included)" value={p.fixedAmount} onChange={p.setFixedAmount} />}
        <NumberField label="Budget hours (optional)" value={p.budgetHours} onChange={p.setBudgetHours} decimals hint="To track progress; does not limit anything." />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><DateField label="Start (optional)" value={p.startDate} onChange={p.setStartDate} /></View>
          <View style={{ flex: 1 }}><DateField label="Due (optional)" value={p.dueDate} onChange={p.setDueDate} /></View>
        </View>
        <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline autoCapitalize="sentences" />
      </View>
    </DesktopSettingsPage>
  )
}
