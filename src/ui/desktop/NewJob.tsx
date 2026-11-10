import React from 'react'
import { ScrollView, View } from 'react-native'
import type { Customer } from '@/domain/types'
import type { JobKind, Recipe } from '@/modules/manufacturing/types'
import { Field, MoneyField, NumberField, Segmented, Select } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { DeskButton, DeskPage, Toolbar } from './kit'

export interface DesktopNewJobProps {
  customers: Customer[]
  recipes: Recipe[]
  canRecipe: boolean
  kind: JobKind
  setKind: (v: JobKind) => void
  customerId: string
  setCustomerId: (v: string) => void
  title: string
  setTitle: (v: string) => void
  qty: string
  setQty: (v: string) => void
  charge: string
  setCharge: (v: string) => void
  due: string
  setDue: (v: string) => void
  dueOk: boolean
  stages: string
  setStages: (v: string) => void
  recipeId: string
  setRecipeId: (v: string) => void
  salesOrderId: string
  setSalesOrderId: (v: string) => void
  meas: Array<{ label: string; value: string }>
  setMeas: (v: Array<{ label: string; value: string }>) => void
  notes: string
  setNotes: (v: string) => void
  busy: boolean
  onSave: () => void
}

/**
 * The desktop "New job" screen: a `DeskPage`/`Toolbar` shell around the exact form
 * `src/app/m/manufacturing/jobs/new.tsx` builds, centred in a readable column, with measurements kept as editable
 * mobile `Card`s (same pattern as `DesktopNewPurchase`'s line items).
 */
export function DesktopNewJob(p: DesktopNewJobProps) {
  return (
    <DeskPage toolbar={<Toolbar title="New job" right={<DeskButton label={p.busy ? 'Saving…' : 'Save job'} tone="primary" disabled={p.busy} onPress={p.onSave} />} />}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 780, gap: 14 }}>
          <Segmented value={p.kind} onChange={p.setKind} options={[{ value: 'made_to_order', label: 'Made to order' }, { value: 'job_work', label: 'Job work' }]} />
          <T v="caption" tone="mute">{p.kind === 'job_work' ? 'The customer brings the material; we charge for the work.' : 'We make it from our own material.'}</T>
          <Select<string> label="Customer" value={p.customerId} placeholder="Who is it for?" searchable options={p.customers.map((x) => ({ value: x.id, label: x.name, sub: x.phone || undefined }))} onChange={p.setCustomerId} />
          <Field label="What is to be made" value={p.title} onChangeText={p.setTitle} placeholder="e.g. Two shirts, size 40" />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><NumberField label="How many" value={p.qty} onChange={p.setQty} decimals /></View>
            <View style={{ flex: 1 }}><MoneyField label="Charge" value={p.charge} onChange={p.setCharge} /></View>
          </View>
          <Field label="Promised by (optional)" value={p.due} onChangeText={p.setDue} placeholder="YYYY-MM-DD" error={p.dueOk ? null : 'Write the date as YYYY-MM-DD'} />
          <Field label="Stages (comma separated)" value={p.stages} onChangeText={p.setStages} />
          {p.canRecipe && p.recipes.length ? <Select<string> label="Make it from a recipe (optional)" value={p.recipeId} placeholder="No work order yet" options={[{ value: '', label: 'No work order yet' }, ...p.recipes.map((r) => ({ value: r.id, label: r.name, sub: r.code }))]} onChange={p.setRecipeId} /> : null}
          <Field label="Sales order (optional)" value={p.salesOrderId} onChangeText={p.setSalesOrderId} hint="The customer’s order number, if there is one" />
          <Section title="Measurements" style={{ marginTop: 4 }}>
            <View style={{ gap: 10 }}>
              {p.meas.map((m, i) => (
                <Card key={i} style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><Field label="Label" value={m.label} onChangeText={(t) => p.setMeas(p.meas.map((x, j) => (j === i ? { ...x, label: t } : x)))} /></View>
                  <View style={{ flex: 1 }}><Field label="Value" value={m.value} onChangeText={(t) => p.setMeas(p.meas.map((x, j) => (j === i ? { ...x, value: t } : x)))} /></View>
                </Card>
              ))}
              <DeskButton label="Add measurement" icon={<Plus size={14} />} onPress={() => p.setMeas([...p.meas, { label: '', value: '' }])} />
            </View>
          </Section>
          <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline />
        </View>
      </ScrollView>
    </DeskPage>
  )
}
