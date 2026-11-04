import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { bundleEconomics, kitAvailable, variantName } from '@/modules/warehouse/logic'
import type { Bundle } from '@/modules/warehouse/types'
import { useData } from '@/modules/warehouse/ui/common'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { Plus } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

/**
 * The desktop Kits & combos screen: a KPI strip for how many kits are set up and how many are active, and a
 * dense grid instead of a card list. Reads the exact same `bundleEconomics`/`kitAvailable` the phone screen
 * computes per row; this file only lays the same rows out as a grid.
 */
export function DesktopBundles() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('warehouse')
  const data = useData()
  const bundles = useList('bundles')

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Kits & combos" />}>
        <View style={{ padding: 20 }}><T tone="mute">Kits are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const rows = [...bundles].sort((a, b) => a.name.localeCompare(b.name))
  const active = rows.filter((b) => b.active).length

  const columns: Array<Column<Bundle>> = [
    { key: 'name', label: 'Kit', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.components.map((x) => `${x.qty} × ${variantName(data, x.variantId)}`).join(', ')}</T>
      </View>
    ) },
    { key: 'price', label: 'Price', width: 110, align: 'right', sortValue: (r) => r.price, render: (r) => cellNum(inr(r.price, 0), true) },
    { key: 'margin', label: 'Margin', width: 90, align: 'right', sortValue: (r) => bundleEconomics(data, r.components, r.price).margin, render: (r) => cellNum(`${bundleEconomics(data, r.components, r.price).margin}%`) },
    { key: 'available', label: 'Available', width: 150, sortValue: (r) => (r.active ? kitAvailable(data, r) : -1), render: (r) => (
      r.active ? <Pill tone={kitAvailable(data, r) ? 'success' : 'danger'} label={`${kitAvailable(data, r)} can be made`} /> : <Pill label="Off" />
    ) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Kits & combos"
          subtitle={`${bundles.length} kits`}
          right={<DeskButton label="New kit" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/warehouse/bundles/new')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Kits" value={String(bundles.length)} delta={`${active} on sale`} />
      </KpiStrip>

      <View style={{ flex: 1, margin: 14, marginTop: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/warehouse/bundles/new', params: { id: r.id } })}
          emptyLabel="No kits yet"
        />
      </View>
    </DeskPage>
  )
}
