import React from 'react'
import { inr } from '@/domain/money'
import { itemName, recipeFor, type costRecipe, type requirements } from '@/modules/manufacturing/bom'
import type { Recipe } from '@/modules/manufacturing/types'
import type { DataState } from '@/data/state'
import { Field, NumberField, Select } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

type Need = ReturnType<typeof requirements>
type Cost = ReturnType<typeof costRecipe>

export interface DesktopNewWorkOrderProps {
  data: DataState
  recipes: Recipe[]
  recipeId: string
  setRecipeId: (v: string) => void
  qty: string
  setQty: (v: string) => void
  due: string
  setDue: (v: string) => void
  dueOk: boolean
  notes: string
  setNotes: (v: string) => void
  need: Need
  cost: Cost | null
  busy: boolean
  onSave: () => void
}

/**
 * The desktop "New work order" screen: the same `DesktopSettingsPage` shell every settings-style screen uses, with
 * the recipe/quantity picker and the live material/cost preview from `src/app/m/manufacturing/orders/new.tsx`
 * unchanged.
 */
export function DesktopNewWorkOrder(p: DesktopNewWorkOrderProps) {
  return (
    <DesktopSettingsPage title="New work order" subtitle="Pick a recipe and a quantity" right={<DeskButton label={p.busy ? 'Planning…' : 'Plan order'} tone="primary" disabled={p.busy} onPress={p.onSave} />}>
      <Select<string> label="Recipe" value={p.recipeId} placeholder="What are you making?" searchable
        options={p.recipes.map((r) => ({ value: r.id, label: r.name, sub: `${r.code} · recipe` }))} onChange={p.setRecipeId} />
      <NumberField label="How many good units" value={p.qty} onChange={p.setQty} decimals />
      <Field label="Due (optional)" value={p.due} onChangeText={p.setDue} placeholder="YYYY-MM-DD" error={p.dueOk ? null : 'Write the date as YYYY-MM-DD'} />
      <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline />
      {p.need.length ? (
        <Section title="It will need" style={{ marginTop: 18 }}>
          <Card style={{ gap: 4 }}>
            {p.need.map((l) => {
              const have = p.data.variants[l.variantId]?.stock ?? 0
              const inner = recipeFor(p.data, l.variantId)
              return <KV key={l.variantId} k={itemName(p.data, l.variantId)} v={`${l.qty}`} sub={l.customerSupplied ? 'Customer’s material' : have < l.qty ? `Only ${have} on hand${inner ? ' — can be made' : ''}` : `${have} on hand`} tone={!l.customerSupplied && have < l.qty ? 'warning' : undefined} />
            })}
            {p.cost ? <KV k="Cost" v={inr(p.cost.total)} strong sub={`${inr(p.cost.perUnit)} each`} /> : null}
          </Card>
        </Section>
      ) : null}
    </DesktopSettingsPage>
  )
}
