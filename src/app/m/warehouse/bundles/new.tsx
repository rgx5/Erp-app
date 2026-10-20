import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { bundleEconomics, variantName } from '@/modules/warehouse/logic'
import { createBundle, updateBundle } from '@/modules/warehouse/ops'
import { ItemField, useData } from '@/modules/warehouse/ui/common'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Group } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Trash } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

interface Part { variantId: string; qty: string }

/** Make or edit a kit: its parts, its price, and what that leaves you after cost. */
export default function NewBundle() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const can = useCan('warehouse')
  const data = useData()
  const categories = useList('categories')
  const existing = id ? data.bundles[id] : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [price, setPrice] = useState(existing ? String(existing.price) : '')
  const [parts, setParts] = useState<Part[]>(existing?.components.map((x) => ({ variantId: x.variantId, qty: String(x.qty) })) ?? [])
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [active, setActive] = useState(existing?.active ?? true)
  const [adding, setAdding] = useState('')
  if (!can) return <Screen title="Kit" back><T tone="mute">Kits are for the owner and managers.</T></Screen>

  const components = parts.map((p) => ({ variantId: p.variantId, qty: Number(p.qty) || 0 })).filter((p) => p.qty > 0)
  const econ = bundleEconomics(data, components, Number(price) || 0)

  function save() {
    try {
      const r = perform((s, ctx) => (existing
        ? updateBundle(s, existing.id, { name, components, price: Number(price) || 0, active }, ctx)
        : createBundle(s, { name, categoryId, components, price: Number(price) || 0 }, ctx)))
      toast(`${r.bundle.name} saved`, 'ok'); router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  return (
    <Screen title={existing ? 'Edit kit' : 'New kit'} back footer={<Button label="Save kit" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 14 }}>
        <Field label="Kit name" value={name} onChangeText={setName} placeholder="Festive combo" />
        {!existing ? <Select<string> label="Category" value={categoryId} options={categories.map((x) => ({ value: x.id, label: x.name }))} onChange={setCategoryId} /> : null}
        <Section title="What is in it">
          <View style={{ gap: 10 }}>
            {parts.map((p) => (
              <Card key={p.variantId} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{variantName(data, p.variantId)}</T>
                  <IconButton label="Remove" tone="ghost" size={36} onPress={() => setParts(parts.filter((x) => x.variantId !== p.variantId))}><Trash size={17} color={c.inkMute} /></IconButton>
                </View>
                <NumberField label="Quantity in one kit" value={p.qty} onChange={(t) => setParts(parts.map((x) => (x.variantId === p.variantId ? { ...x, qty: t } : x)))} decimals />
              </Card>
            ))}
            <ItemField value={adding} onChange={(v) => { if (v) setParts((ps) => (ps.some((x) => x.variantId === v) ? ps : [...ps, { variantId: v, qty: '1' }])); setAdding('') }} placeholder="Add an item…" />
          </View>
        </Section>
        <MoneyField label="Selling price of the kit" value={price} onChange={setPrice} />
        {components.length ? (
          <Group><View style={{ padding: 14 }}>
            <KV k="Parts cost" v={inr(econ.cost)} />
            <KV k="Parts sold separately" v={inr(econ.separately)} />
            <KV k="Customer saves" v={inr(Math.max(0, econ.saving))} />
            <KV k="Margin" v={`${econ.margin}%`} tone={econ.margin < 0 ? 'danger' : undefined} strong />
          </View></Group>
        ) : null}
        {existing ? <SwitchRow title="On sale" subtitle="Off hides the kit from selling; old bills are unaffected" value={active} onChange={setActive} /> : null}
      </View>
    </Screen>
  )
}
