import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { bundleEconomics, kitAvailable, variantName } from '@/modules/warehouse/logic'
import { useData } from '@/modules/warehouse/ui/common'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Package, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Kits and combos: one item at the counter that takes several off the shelf. */
export default function Bundles() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('warehouse')
  const data = useData()
  const bundles = useList('bundles')
  if (!can) return <Screen title="Kits" back><T tone="mute">Kits are for the owner and managers.</T></Screen>
  return (
    <Screen title="Kits & combos" subtitle={`${bundles.length} kits`} back right={<IconButton label="New kit" tone="dark" onPress={() => router.push('/m/warehouse/bundles/new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ paddingBottom: 20 }}>
        {bundles.length ? (
          <Group>
            {[...bundles].sort((a, b) => a.name.localeCompare(b.name)).map((b) => {
              const e = bundleEconomics(data, b.components, b.price)
              return (
                <ListRow key={b.id} title={b.name} subtitle={b.components.map((x) => `${x.qty} × ${variantName(data, x.variantId)}`).join(', ')} value={inr(b.price, 0)} sub={`${e.margin}% margin`}
                  badge={b.active ? <Badge tone={kitAvailable(data, b) ? 'success' : 'danger'}>{kitAvailable(data, b)} can be made</Badge> : <Badge>Off</Badge>}
                  onPress={() => router.push({ pathname: '/m/warehouse/bundles/new', params: { id: b.id } })} />
              )
            })}
          </Group>
        ) : <EmptyState icon={<Package size={26} color={c.primary} />} title="No kits yet" hint="Bundle items into a combo with its own price. Selling it takes each part off the shelf." action="New kit" onAction={() => router.push('/m/warehouse/bundles/new')} />}
      </View>
    </Screen>
  )
}
