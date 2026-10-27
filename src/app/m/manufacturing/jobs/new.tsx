import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fromInputDate } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { DEFAULT_STAGES } from '@/modules/manufacturing/jobs'
import { createJobOrder } from '@/modules/manufacturing/ops'
import type { JobKind } from '@/modules/manufacturing/types'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'

/** A customer's order: what, how many, by when, their measurements and the stages it goes through. */
export default function NewJob() {
  const router = useRouter()
  const can = useCan('pos')
  const customers = useList('customers')
  const recipes = useList('recipes').filter((r) => r.active)
  const [kind, setKind] = useState<JobKind>('made_to_order')
  const [customerId, setCustomerId] = useState('')
  const [title, setTitle] = useState('')
  const [qty, setQty] = useState('1')
  const [charge, setCharge] = useState('')
  const [due, setDue] = useState('')
  const [recipeId, setRecipeId] = useState('')
  const [stages, setStages] = useState(DEFAULT_STAGES.join(', '))
  const [meas, setMeas] = useState<Array<{ label: string; value: string }>>([])
  const [salesOrderId, setSalesOrderId] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const dueOk = !due || /^\d{4}-\d{2}-\d{2}$/.test(due)
  const canRecipe = useCan('inventory')

  if (!can) return <Screen title="New job" back><T tone="mute">Customer jobs are taken at the counter.</T></Screen>
  function save() {
    if (!dueOk) { toast('Write the date as YYYY-MM-DD', 'err'); return }
    setBusy(true)
    try {
      const r = perform((s, ctx) => createJobOrder(s, {
        kind, customerId, title, qty: Number(qty) || 0, charge: Number(charge) || 0, ...(due ? { dueDate: fromInputDate(due) } : {}), measurements: meas, stages: stages.split(','),
        ...(recipeId ? { recipeId } : {}), ...(salesOrderId.trim() ? { salesOrderId: salesOrderId.trim() } : {}), notes,
      }, ctx))
      toast(`${r.job.no} saved`, 'ok')
      router.replace({ pathname: '/m/manufacturing/jobs/[id]', params: { id: r.job.id } } as never)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save the job', 'err'); setBusy(false) }
  }
  return (
    <Screen title="New job" back footer={<Button label="Save job" size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'made_to_order', label: 'Made to order' }, { value: 'job_work', label: 'Job work' }]} />
        <T v="caption" tone="mute">{kind === 'job_work' ? 'The customer brings the material; we charge for the work.' : 'We make it from our own material.'}</T>
        <Select<string> label="Customer" value={customerId} placeholder="Who is it for?" searchable options={customers.map((x) => ({ value: x.id, label: x.name, sub: x.phone || undefined }))} onChange={setCustomerId} />
        <Field label="What is to be made" value={title} onChangeText={setTitle} placeholder="e.g. Two shirts, size 40" />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><NumberField label="How many" value={qty} onChange={setQty} decimals /></View>
          <View style={{ flex: 1 }}><MoneyField label="Charge" value={charge} onChange={setCharge} /></View>
        </View>
        <Field label="Promised by (optional)" value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" error={dueOk ? null : 'Write the date as YYYY-MM-DD'} />
        <Field label="Stages (comma separated)" value={stages} onChangeText={setStages} />
        {canRecipe && recipes.length ? <Select<string> label="Make it from a recipe (optional)" value={recipeId} placeholder="No work order yet" options={[{ value: '', label: 'No work order yet' }, ...recipes.map((r) => ({ value: r.id, label: r.name, sub: r.code }))]} onChange={setRecipeId} /> : null}
        <Field label="Sales order (optional)" value={salesOrderId} onChangeText={setSalesOrderId} hint="The customer’s order number, if there is one" />
        <Section title="Measurements">
          <View style={{ gap: 10 }}>
            {meas.map((m, i) => (
              <Card key={i} style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><Field label="Label" value={m.label} onChangeText={(t) => setMeas(meas.map((x, j) => (j === i ? { ...x, label: t } : x)))} /></View>
                <View style={{ flex: 1 }}><Field label="Value" value={m.value} onChangeText={(t) => setMeas(meas.map((x, j) => (j === i ? { ...x, value: t } : x)))} /></View>
              </Card>
            ))}
            <Button label="Add measurement" kind="soft" block icon={<Plus size={18} />} onPress={() => setMeas([...meas, { label: '', value: '' }])} />
          </View>
        </Section>
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
      </View>
    </Screen>
  )
}
