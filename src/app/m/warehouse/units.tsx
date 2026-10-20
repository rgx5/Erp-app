import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { conversionsOf, formatUnits } from '@/modules/warehouse/logic'
import { deleteUnitConversion, saveUnitConversion } from '@/modules/warehouse/ops'
import type { UnitConversion } from '@/modules/warehouse/types'
import { useData } from '@/modules/warehouse/ui/common'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Scale } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Bigger units of an item (box of 12, carton of 48) with an optional pack price. Receiving and selling can then use them. */
export default function Units() {
  const { c } = useTheme()
  const { productId: preset } = useLocalSearchParams<{ productId?: string }>()
  const can = useCan('warehouse')
  const data = useData()
  const products = useList('products')
  const [productId, setProductId] = useState(preset ?? '')
  const [edit, setEdit] = useState<UnitConversion | 'new' | null>(null)
  const [unit, setUnit] = useState('')
  const [factor, setFactor] = useState('')
  const [price, setPrice] = useState('')
  useEffect(() => {
    if (edit) { const e = edit === 'new' ? undefined : edit; setUnit(e?.unit ?? ''); setFactor(e ? String(e.factor) : ''); setPrice(e?.price ? String(e.price) : '') }
  }, [edit])
  if (!can) return <Screen title="Bigger units" back><T tone="mute">Units are for the owner and managers.</T></Screen>
  const product = data.products[productId]
  const convs = productId ? conversionsOf(data, productId) : []
  const base = product?.unit || 'pc'
  const basePrice = Math.min(...Object.values(data.variants).filter((v) => v.productId === productId && v.price > 0).map((v) => v.price))

  function save() {
    try {
      perform((s, ctx) => saveUnitConversion(s, { productId, unit, factor: Number(factor) || 0, price: Number(price) || undefined }, edit === 'new' ? undefined : (edit as UnitConversion).id, ctx))
      toast('Saved', 'ok'); setEdit(null)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  async function remove(cv: UnitConversion) {
    if (!(await ask({ title: `Remove “${cv.unit}”?`, confirm: 'Remove', danger: true }))) return
    try { perform((s, ctx) => deleteUnitConversion(s, cv.id, ctx)) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not remove', 'err') }
  }

  return (
    <Screen title="Bigger units" subtitle="Box ↔ piece, carton ↔ strip" back footer={productId ? <Button label="Add a unit" size="lg" block onPress={() => setEdit('new')} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        <Select<string> label="Item" value={productId} searchable placeholder="Choose an item" options={products.filter((p) => p.active !== false).map((p) => ({ value: p.id, label: p.name, sub: p.styleCode })).sort((a, b) => a.label.localeCompare(b.label))} onChange={setProductId} />
        {productId && !convs.length ? <EmptyState icon={<Scale size={26} color={c.primary} />} title="Only sold by the piece" hint={`Add “box” = 12 ${base} so goods can be received and sold in boxes.`} /> : null}
        {convs.length ? (
          <Group>
            {convs.map((cv) => (
              <ListRow key={cv.id} title={`1 ${cv.unit} = ${cv.factor} ${base}`} subtitle={cv.price ? `${inr(cv.price)} a ${cv.unit}${Number.isFinite(basePrice) ? ` · ${inr(basePrice * cv.factor)} at the piece price` : ''}` : 'Priced at the piece price'}
                value={Number.isFinite(basePrice) && cv.price ? `${inr(cv.price / cv.factor)} / ${base}` : undefined} onPress={() => setEdit(cv)} right={<Button label="Remove" kind="ghost" size="sm" onPress={() => remove(cv)} />} />
            ))}
          </Group>
        ) : null}
        {convs[0] && product ? <T v="caption" tone="mute">Example: 40 {base} shows as {formatUnits(40, base, convs[0])}.</T> : null}
      </View>
      <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New bigger unit' : 'Edit unit'} footer={<Button label="Save" size="lg" block onPress={save} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <Field label="Unit name" value={unit} onChangeText={setUnit} placeholder="box, carton, strip" autoCapitalize="none" />
          <NumberField label={`How many ${base} in one`} value={factor} onChange={setFactor} decimals />
          <MoneyField label="Price of one (optional)" value={price} onChange={setPrice} hint="Leave empty to price at the piece price × quantity" />
        </View>
      </Sheet>
    </Screen>
  )
}
