import React from 'react'
import { ScrollView, View } from 'react-native'
import { inr } from '@/domain/money'
import { itemName, stockUnitOf } from '@/modules/manufacturing/bom'
import { unitChoices } from '@/modules/manufacturing/units'
import type { Recipe } from '@/modules/manufacturing/types'
import type { DataState } from '@/data/state'
import { Field, MoneyField, NumberField, SwitchRow } from '@/ui/Inputs'
import { Card, Chip } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, Toolbar } from './kit'

interface L { variantId: string; qty: string; unit: string; wastage: string; customerSupplied: boolean; buy: boolean }
interface Chk { label: string; critical: boolean }
type Cost = { materials: number; labour: number; overhead: number; total: number; perUnit: number; warnings: string[] } | null

export interface DesktopEditRecipeProps {
  data: DataState
  existing: Recipe | undefined
  name: string
  setName: (v: string) => void
  out: string
  onPickOutput: () => void
  outQty: string
  setOutQty: (v: string) => void
  yieldPct: string
  setYieldPct: (v: string) => void
  lines: L[]
  patch: (variantId: string, p: Partial<L>) => void
  onRemoveLine: (variantId: string) => void
  onAddLine: () => void
  labour: string
  setLabour: (v: string) => void
  overhead: string
  setOverhead: (v: string) => void
  checks: Chk[]
  setChecks: (v: Chk[]) => void
  notes: string
  setNotes: (v: string) => void
  cost: Cost
  price: number
  busy: boolean
  onSave: () => void
  onToggleActive: () => void
  onDelete: () => void
}

/**
 * The desktop recipe editor: a `DeskPage`/`Toolbar` shell around the exact form
 * `src/app/m/manufacturing/recipes/edit.tsx` builds, centred in a readable column, with ingredients kept as
 * editable mobile `Card`s (same pattern as `DesktopNewPurchase`'s line items). The cost preview (`cost`) is worked
 * out live from today's item costs in the phone screen, unchanged.
 */
export function DesktopEditRecipe(p: DesktopEditRecipeProps) {
  const { c } = useTheme()
  return (
    <DeskPage
      toolbar={<Toolbar title={p.existing ? p.existing.code : 'New recipe'} right={<DeskButton label={p.busy ? 'Saving…' : 'Save recipe'} tone="primary" disabled={p.busy} onPress={p.onSave} />} />}
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 780, gap: 14 }}>
          <Field label="Recipe name" value={p.name} onChangeText={p.setName} placeholder="e.g. Chocolate cake" />
          <View style={{ gap: 6 }}>
            <T v="label" tone="mute">Makes</T>
            <DeskButton label={p.out ? itemName(p.data, p.out) : 'Choose the item'} onPress={p.onPickOutput} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><NumberField label="One batch makes" value={p.outQty} onChange={p.setOutQty} decimals suffix={p.out ? stockUnitOf(p.data, p.out) : undefined} /></View>
            <View style={{ flex: 1 }}><NumberField label="Yield %" value={p.yieldPct} onChange={p.setYieldPct} decimals hint="Good units ÷ units made" /></View>
          </View>

          <Section title="Ingredients & parts">
            <View style={{ gap: 10 }}>
              {p.lines.map((l) => (
                <Card key={l.variantId} style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{itemName(p.data, l.variantId)}</T>
                    <DeskButton label="Remove" icon={<Trash size={14} color={c.inkMute} />} onPress={() => p.onRemoveLine(l.variantId)} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ flex: 1 }}><NumberField label="Per batch" value={l.qty} onChange={(t) => p.patch(l.variantId, { qty: t })} decimals /></View>
                    <View style={{ flex: 1 }}><NumberField label="Wastage %" value={l.wastage} onChange={(t) => p.patch(l.variantId, { wastage: t })} decimals /></View>
                  </View>
                  {unitChoices(stockUnitOf(p.data, l.variantId)).length > 1 ? (
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      {unitChoices(stockUnitOf(p.data, l.variantId)).map((u) => <Chip key={u} label={u} selected={l.unit === u} onPress={() => p.patch(l.variantId, { unit: u })} />)}
                    </View>
                  ) : <T v="caption" tone="mute">Counted in {l.unit}</T>}
                  <SwitchRow title="Customer brings this" subtitle="Job work: not our stock, not in our cost" value={l.customerSupplied} onChange={(v) => p.patch(l.variantId, { customerSupplied: v })} />
                  <SwitchRow title="Buy it, do not make it" subtitle="Cost at stock cost even if it has a recipe" value={l.buy} onChange={(v) => p.patch(l.variantId, { buy: v })} />
                </Card>
              ))}
              <DeskButton label="Add ingredient or part" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={p.onAddLine} />
            </View>
          </Section>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><MoneyField label="Labour per batch" value={p.labour} onChange={p.setLabour} /></View>
            <View style={{ flex: 1 }}><MoneyField label="Overhead per batch" value={p.overhead} onChange={p.setOverhead} /></View>
          </View>

          <Section title="Quality checklist">
            <View style={{ gap: 10 }}>
              {p.checks.map((x, i) => (
                <Card key={i} style={{ gap: 8 }}>
                  <Field label={`Point ${i + 1}`} value={x.label} onChangeText={(t) => p.setChecks(p.checks.map((y, j) => (j === i ? { ...y, label: t } : y)))} />
                  <SwitchRow title="Critical" subtitle="Failing it rejects the whole lot" value={x.critical} onChange={(v) => p.setChecks(p.checks.map((y, j) => (j === i ? { ...y, critical: v } : y)))} />
                  <DeskButton label="Remove" onPress={() => p.setChecks(p.checks.filter((_, j) => j !== i))} />
                </Card>
              ))}
              <DeskButton label="Add a check point" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => p.setChecks([...p.checks, { label: '', critical: false }])} />
            </View>
          </Section>
          <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline />

          {p.cost ? (
            <Section title="Cost now">
              <Card style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="body" tone="soft">Materials</T><T v="num">{inr(p.cost.materials)}</T></View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="body" tone="soft">Labour</T><T v="num">{inr(p.cost.labour)}</T></View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="body" tone="soft">Overhead</T><T v="num">{inr(p.cost.overhead)}</T></View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="bodyStrong">One batch</T><T v="numLg">{inr(p.cost.total)}</T></View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T v="bodyStrong">Per unit</T>
                  <View style={{ alignItems: 'flex-end' }}>
                    <T v="numLg">{inr(p.cost.perUnit)}</T>
                    {p.price > 0 ? <T v="caption" tone="mute">Sells at {inr(p.price)} · margin {Math.round(((p.price - p.cost.perUnit) / p.price) * 100)}%</T> : null}
                  </View>
                </View>
              </Card>
              {p.cost.warnings.map((w) => <Notice key={w} title={w} />)}
            </Section>
          ) : null}

          {p.existing ? (
            <Section title="Manage">
              <View style={{ gap: 10 }}>
                <DeskButton label={p.existing.active ? 'Switch off' : 'Switch on'} onPress={p.onToggleActive} />
                <DeskButton label="Delete recipe" tone="danger" onPress={p.onDelete} />
              </View>
            </Section>
          ) : null}
        </View>
      </ScrollView>
    </DeskPage>
  )
}
