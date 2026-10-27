import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fromInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { costRecipe, goodPerBatch, itemName, recipeFor, requirements } from '@/modules/manufacturing/bom'
import { planWorkOrder } from '@/modules/manufacturing/ops'
import { Button } from '@/ui/Button'
import { Field, NumberField, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

/** Plan a work order: pick a recipe and a quantity and see what it needs and costs before saving. */
export default function NewWorkOrder() {
  const router = useRouter()
  const { recipeId: preset } = useLocalSearchParams<{ recipeId?: string }>()
  const can = useCan('inventory')
  const data = useApp((s) => s.data)
  const recipes = useList('recipes').filter((r) => r.active)
  const [recipeId, setRecipeId] = useState(preset ?? '')
  const [qty, setQty] = useState('')
  const [due, setDue] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const recipe = data.recipes[recipeId]
  const n = Number(qty) || 0
  const need = useMemo(() => (recipe && n > 0 ? requirements(data, recipe, n) : []), [data, recipe, n])
  const cost = useMemo(() => (recipe && n > 0 ? costRecipe(data, recipe, n) : null), [data, recipe, n])
  const dueOk = !due || /^\d{4}-\d{2}-\d{2}$/.test(due)

  if (!can) return <Screen title="New work order" back><T tone="mute">Work orders are for the owner, managers and stock keepers.</T></Screen>
  function save() {
    if (!dueOk) { toast('Write the date as YYYY-MM-DD', 'err'); return }
    setBusy(true)
    try {
      const r = perform((s, ctx) => planWorkOrder(s, { recipeId, qty: n, notes, ...(due ? { dueDate: fromInputDate(due) } : {}) }, ctx))
      toast(`${r.workOrder.no} planned`, 'ok')
      router.replace({ pathname: '/m/manufacturing/orders/[id]', params: { id: r.workOrder.id } } as never)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not plan the order', 'err'); setBusy(false) }
  }
  return (
    <Screen title="New work order" back footer={<Button label="Plan order" size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <Select<string> label="Recipe" value={recipeId} placeholder="What are you making?" searchable options={recipes.map((r) => ({ value: r.id, label: r.name, sub: `${r.code} · ${goodPerBatch(r)} per batch` }))} onChange={setRecipeId} />
        <NumberField label="How many good units" value={qty} onChange={setQty} decimals />
        <Field label="Due (optional)" value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" error={dueOk ? null : 'Write the date as YYYY-MM-DD'} />
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        {need.length ? (
          <Section title="It will need">
            <Card style={{ gap: 4 }}>
              {need.map((l) => {
                const have = data.variants[l.variantId]?.stock ?? 0
                const inner = recipeFor(data, l.variantId)
                return <KV key={l.variantId} k={itemName(data, l.variantId)} v={`${l.qty}`} sub={l.customerSupplied ? 'Customer’s material' : have < l.qty ? `Only ${have} on hand${inner ? ' — can be made' : ''}` : `${have} on hand`} tone={!l.customerSupplied && have < l.qty ? 'warning' : undefined} />
              })}
              {cost ? <KV k="Cost" v={inr(cost.total)} strong sub={`${inr(cost.perUnit)} each`} /> : null}
            </Card>
          </Section>
        ) : null}
      </View>
    </Screen>
  )
}
