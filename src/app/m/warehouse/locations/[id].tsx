import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { inr0 } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { isMain, locationName, stockAtLocationRows, stockAt } from '@/modules/warehouse/logic'
import { saveLocation, setLocationActive, setLocationStock } from '@/modules/warehouse/ops'
import { LocationSheet } from '@/modules/warehouse/ui/LocationSheet'
import { ItemField, useData } from '@/modules/warehouse/ui/common'
import { Button } from '@/ui/Button'
import { NumberField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Boxes } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** What is at one place; set an opening or corrected count for an item there; rename or switch the place off. */
export default function LocationPage() {
  const { c } = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('warehouse')
  const data = useData()
  const [editing, setEditing] = useState(false)
  const [counting, setCounting] = useState(false)
  const [variantId, setVariantId] = useState('')
  const [qty, setQty] = useState('')
  const loc = data.locations[id]
  if (!can) return <Screen title="Location" back><T tone="mute">Locations are for the owner and managers.</T></Screen>
  if (!isMain(id) && !loc) return <Screen title="Not found" back><T tone="mute">This location is no longer here.</T></Screen>
  const rows = stockAtLocationRows(data, id)

  function run(fn: () => void, ok: string) {
    try { fn(); toast(ok, 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  const saveCount = () => run(() => { perform((s, ctx) => setLocationStock(s, { variantId, locationId: id, qty: Number(qty) }, ctx)); setCounting(false); setQty(''); setVariantId('') }, 'Count saved')

  return (
    <Screen title={locationName(data, id)} subtitle={isMain(id) ? 'Stock that is not at any other place' : loc?.active ? undefined : 'Switched off'} back
      footer={!isMain(id) ? <Button label="Set a count" size="lg" block onPress={() => setCounting(true)} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        {!isMain(id) ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Edit" kind="soft" size="sm" onPress={() => setEditing(true)} />
            <Button label={loc?.active ? 'Switch off' : 'Switch on'} kind="soft" size="sm" onPress={() => run(() => perform((s, ctx) => setLocationActive(s, id, !loc!.active, ctx)), loc?.active ? 'Switched off' : 'Switched on')} />
          </View>
        ) : null}
        {rows.length ? (
          <Group>
            {rows.map((r) => <ListRow key={r.variantId} title={r.name} subtitle={r.sku} value={String(r.qty)} sub={inr0(r.value)} badge={<Badge tone="default">{stockAt(data, r.variantId, id)}</Badge>} />)}
          </Group>
        ) : <EmptyState icon={<Boxes size={26} color={c.primary} />} title="Nothing here yet" hint="Transfer stock in, receive goods into this place, or set a count." />}
      </View>
      <LocationSheet visible={editing} onClose={() => setEditing(false)} existing={loc}
        onSave={(d) => run(() => { perform((s, ctx) => saveLocation(s, d, id, ctx)); setEditing(false) }, 'Saved')} />
      <Sheet visible={counting} onClose={() => setCounting(false)} title="Count at this place" subtitle="How many are here right now? The item’s total changes by the difference."
        footer={<Button label="Save count" size="lg" block onPress={saveCount} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <ItemField label="Item" value={variantId} onChange={setVariantId} />
          {variantId ? <T v="caption" tone="mute">Now {stockAt(data, variantId, id)} here</T> : null}
          <NumberField label="Quantity here" value={qty} onChange={setQty} decimals />
        </View>
      </Sheet>
    </Screen>
  )
}
