import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { costRecipe, goodPerBatch, itemName } from '@/modules/manufacturing/bom'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Pill, Toolbar, cellNum, dtext, type Column } from './kit'

type Row = { id: string; name: string; code: string; makes: string; perUnit: number; active: boolean; warn: boolean }

/**
 * The desktop Recipes & costing screen: one dense sortable grid instead of the phone's scrolling cards. Every
 * figure comes from the same `costRecipe` the phone `m/manufacturing/recipes/index.tsx` calls.
 */
export function DesktopRecipes() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('manufacturing')
  const recipes = useList('recipes')
  const data = useApp((s) => s.data)
  const rows: Row[] = useMemo(() => recipes.map((r) => {
    const cost = costRecipe(data, r)
    return { id: r.id, name: r.name, code: r.code, makes: `makes ${goodPerBatch(r)} ${itemName(data, r.outputVariantId)}`, perUnit: cost.perUnit, active: r.active, warn: cost.warnings.length > 0 }
  }).sort((a, b) => a.name.localeCompare(b.name)), [recipes, data])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Recipes & costing" />}>
        <View style={{ padding: 20 }}><T tone="mute">Recipes and costs are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Recipe', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.code} · {r.makes}</T>
      </View>
    ) },
    { key: 'status', label: '', width: 110, render: (r) => (
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {!r.active ? <Pill label="Off" /> : null}
        {r.warn ? <Pill tone="warning" label="Check costs" /> : null}
      </View>
    ) },
    { key: 'perUnit', label: 'Per unit', width: 110, align: 'right', sortValue: (r) => r.perUnit, render: (r) => cellNum(inr(r.perUnit), true) },
  ]

  return (
    <DeskPage
      toolbar={<Toolbar title="Recipes & costing" subtitle={`${recipes.length} recipes`} right={<DeskButton label="New recipe" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/manufacturing/recipes/edit' as never)} />} />}
    >
      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/manufacturing/recipes/edit', params: { id: r.id } } as never)} emptyLabel="No recipes yet" />
      </View>
    </DeskPage>
  )
}
