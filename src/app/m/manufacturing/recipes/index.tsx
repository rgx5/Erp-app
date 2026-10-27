import React, { useMemo } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { costRecipe, goodPerBatch, itemName } from '@/modules/manufacturing/bom'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Layers, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Recipes (bills of materials) with what one unit costs to make today. */
export default function Recipes() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('manufacturing')
  const recipes = useList('recipes')
  const data = useApp((s) => s.data)
  const rows = useMemo(() => recipes.map((r) => ({ r, cost: costRecipe(data, r) })).sort((a, b) => a.r.name.localeCompare(b.r.name)), [recipes, data])

  if (!can) return <Screen title="Recipes" back><T tone="mute">Recipes and costs are for the owner and managers.</T></Screen>
  return (
    <Screen title="Recipes & costing" subtitle={`${recipes.length} recipes`} back scroll={false}
      right={<IconButton label="New recipe" tone="dark" onPress={() => router.push('/m/manufacturing/recipes/edit' as never)}><Plus size={22} color={c.bg} /></IconButton>}>
      <FlatList data={rows} keyExtractor={(x) => x.r.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<Layers size={26} color={c.primary} />} title="No recipes yet" hint="A recipe says what one batch of an item needs. Parts can have recipes of their own." action="New recipe" onAction={() => router.push('/m/manufacturing/recipes/edit' as never)} />}
        renderItem={({ item: { r, cost } }) => (
          <Tap onPress={() => router.push({ pathname: '/m/manufacturing/recipes/edit', params: { id: r.id } } as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong" numberOfLines={1}>{r.name}</T>
              <T v="caption" tone="mute" numberOfLines={1}>{r.code} · makes {goodPerBatch(r)} {itemName(data, r.outputVariantId)}</T>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                {!r.active ? <Badge tone="default">Off</Badge> : null}
                {cost.warnings.length ? <Badge tone="warning">Check costs</Badge> : null}
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}><T v="num">{inr(cost.perUnit)}</T><T v="caption" tone="mute">per unit</T></View>
            <ChevronRight size={16} color={c.inkMute} />
          </Tap>
        )} />
    </Screen>
  )
}
