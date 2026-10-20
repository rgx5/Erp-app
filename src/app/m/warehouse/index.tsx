import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr0 } from '@/domain/money'
import { listOf } from '@/data/state'
import { useCan } from '@/data/store'
import { allModules } from '@/modules/registry'
import { expirySummary, openTransfers, locationSummary } from '@/modules/warehouse/logic'
import { useData } from '@/modules/warehouse/ui/common'
import { Screen } from '@/ui/Screen'
import { Group } from '@/ui/primitives'
import { ListRow, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'

/** Warehouse home: a few numbers and the way into each part. */
export default function WarehouseHome() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('warehouse')
  const data = useData()
  if (!can) return <Screen title="Warehouse" back><T tone="mute">The warehouse is for the owner and managers.</T></Screen>
  const ex = expirySummary(data, Date.now())
  const places = locationSummary(data)
  const features = (allModules().find((m) => m.id === 'inventory')?.features ?? []).filter((f) => f.id.startsWith('wh-'))
  const sections = [...new Set(features.map((f) => f.section ?? ''))]
  return (
    <Screen title="Warehouse" subtitle="Locations, batches, serial numbers, kits" back>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile label="Places" value={String(places.length)} foot={`${listOf(data.locations).filter((l) => l.active).length} set up`} />
          <StatTile label="In transit" value={String(openTransfers(data).length)} tone="accent" foot="transfers on the way" />
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile label="Expired" value={String(ex.expired)} tone="danger" foot="batches with stock" />
          <StatTile label="Expiring soon" value={String(ex.soon)} tone="warning" foot={`${inr0(ex.value)} at risk`} />
        </View>
        {sections.map((sec) => (
          <Section key={sec} title={sec}>
            <Group>
              {features.filter((f) => (f.section ?? '') === sec).map((f) => {
                const Icon = f.icon
                return <ListRow key={f.id} title={f.label} subtitle={f.sub} icon={<Icon size={20} color={c.primary} />} iconTone={f.tone} onPress={() => router.push(f.to as never)} />
              })}
            </Group>
          </Section>
        ))}
      </View>
    </Screen>
  )
}
