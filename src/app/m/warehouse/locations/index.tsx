import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr0 } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { saveLocation } from '@/modules/warehouse/ops'
import { locationSummary } from '@/modules/warehouse/logic'
import type { LocationType } from '@/modules/warehouse/types'
import { LocationSheet } from '@/modules/warehouse/ui/LocationSheet'
import { useData } from '@/modules/warehouse/ui/common'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Warehouse } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const TYPE: Record<LocationType, string> = { warehouse: 'Godown', shelf: 'Shelf', counter: 'Counter' }

/** Godowns, shelves and counters, with what each holds. Main is the built-in place for stock that is not anywhere else. */
export default function Locations() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('warehouse')
  const data = useData()
  const [adding, setAdding] = useState(false)
  if (!can) return <Screen title="Locations" back><T tone="mute">Locations are for the owner and managers.</T></Screen>
  const rows = locationSummary(data)

  function create(d: { name: string; type: LocationType; parentId?: string }) {
    try { perform((s, ctx) => saveLocation(s, d, undefined, ctx)); toast(`${d.name} added`, 'ok'); setAdding(false) }
    catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  return (
    <Screen title="Locations" subtitle="Where your stock sits" back right={<IconButton label="Add location" tone="dark" onPress={() => setAdding(true)}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ gap: 12, paddingBottom: 20 }}>
        {rows.length <= 1 ? <EmptyState icon={<Warehouse size={26} color={c.primary} />} title="One place so far" hint="Add a godown or shelf, then move stock into it with a transfer or when you receive goods." action="Add location" onAction={() => setAdding(true)} /> : null}
        <Group>
          {rows.map((r) => (
            <ListRow key={r.locationId} title={r.name} subtitle={`${r.items} ${r.items === 1 ? 'item' : 'items'} · ${r.units} units`} value={inr0(r.value)} sub="at cost"
              icon={<Warehouse size={20} color={c.primary} />} badge={<Badge>{r.locationId === 'main' ? 'Built in' : TYPE[r.type as LocationType] ?? r.type}</Badge>}
              onPress={() => router.push({ pathname: '/m/warehouse/locations/[id]', params: { id: r.locationId } })} />
          ))}
        </Group>
      </View>
      <LocationSheet visible={adding} onClose={() => setAdding(false)} onSave={create} />
    </Screen>
  )
}
