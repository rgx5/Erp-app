import React from 'react'
import { ScrollView, View } from 'react-native'
import { inr } from '@/domain/money'
import type { DataState } from '@/data/state'
import type { Category } from '@/domain/types'
import { variantName } from '@/modules/warehouse/logic'
import { ItemField } from '@/modules/warehouse/ui/common'
import { IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Select, SwitchRow } from '@/ui/Inputs'
import { Card, Group } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, Toolbar } from './kit'

interface Part { variantId: string; qty: string }

export interface DesktopNewBundleProps {
  data: DataState
  isEditing: boolean
  name: string
  setName: (v: string) => void
  categories: Category[]
  categoryId: string
  setCategoryId: (v: string) => void
  parts: Part[]
  setPartQty: (variantId: string, qty: string) => void
  onRemovePart: (variantId: string) => void
  adding: string
  setAdding: (v: string) => void
  onAdd: (variantId: string) => void
  price: string
  setPrice: (v: string) => void
  active: boolean
  setActive: (v: boolean) => void
  econ: { cost: number; separately: number; saving: number; margin: number }
  hasComponents: boolean
  onSave: () => void
}

/**
 * The desktop "New/edit kit" screen: a `DeskPage`/`Toolbar` shell around the exact form
 * `src/app/m/warehouse/bundles/new.tsx` builds, centred in a readable column — the same treatment
 * `DesktopNewPurchase` gives the purchase-receipt form. No pricing or kit-economics logic lives here; every
 * field, the `econ` figures and the save handler are passed down from the phone screen unchanged.
 */
export function DesktopNewBundle({ data, isEditing, name, setName, categories, categoryId, setCategoryId, parts, setPartQty, onRemovePart, adding, setAdding, onAdd, price, setPrice, active, setActive, econ, hasComponents, onSave }: DesktopNewBundleProps) {
  const { c } = useTheme()

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={isEditing ? 'Edit kit' : 'New kit'}
          right={<DeskButton label="Save kit" tone="primary" onPress={onSave} />}
        />
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 680, gap: 14 }}>
          <Field label="Kit name" value={name} onChangeText={setName} placeholder="Festive combo" />
          {!isEditing ? <Select<string> label="Category" value={categoryId} options={categories.map((x) => ({ value: x.id, label: x.name }))} onChange={setCategoryId} /> : null}

          <Section title="What is in it">
            <View style={{ gap: 10 }}>
              {parts.map((p) => (
                <Card key={p.variantId} style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{variantName(data, p.variantId)}</T>
                    <IconButton label="Remove" tone="ghost" size={36} onPress={() => onRemovePart(p.variantId)}><Trash size={17} color={c.inkMute} /></IconButton>
                  </View>
                  <NumberField label="Quantity in one kit" value={p.qty} onChange={(t) => setPartQty(p.variantId, t)} decimals />
                </Card>
              ))}
              <ItemField value={adding} onChange={onAdd} placeholder="Add an item…" />
            </View>
          </Section>

          <MoneyField label="Selling price of the kit" value={price} onChange={setPrice} />

          {hasComponents ? (
            <Group><View style={{ padding: 14 }}>
              <KV k="Parts cost" v={inr(econ.cost)} />
              <KV k="Parts sold separately" v={inr(econ.separately)} />
              <KV k="Customer saves" v={inr(Math.max(0, econ.saving))} />
              <KV k="Margin" v={`${econ.margin}%`} tone={econ.margin < 0 ? 'danger' : undefined} strong />
            </View></Group>
          ) : null}

          {isEditing ? <SwitchRow title="On sale" subtitle="Off hides the kit from selling; old bills are unaffected" value={active} onChange={setActive} /> : null}
        </View>
      </ScrollView>
    </DeskPage>
  )
}
