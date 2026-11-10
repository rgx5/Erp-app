import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { TIER_LABEL, type Tier } from '@/modules/pricing/types'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, Toolbar, cellNum, type Column } from './kit'

const TONE: Record<Tier, Tone> = { retail: 'default', wholesale: 'primary', dealer: 'accent' }
const BASIS = { price: 'selling price', mrp: 'MRP', cost: 'cost' } as const
type Row = { id: string; name: string; tier: Tier; rule: string; ownPrices: number; customers: number; active: boolean }

/** The desktop price lists screen: the same lists as a dense grid, instead of a stacked list. */
export function DesktopPriceLists() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pricing')
  const lists = useList('priceLists')
  const customers = useList('customers')
  const items = useList('priceListItems')

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Price lists" />}>
        <View style={{ padding: 20 }}><T tone="mute">Price lists are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const open = (id: string) => router.push({ pathname: '/m/pricing/lists/[id]', params: { id } })
  const rows: Row[] = [...lists].sort((a, b) => a.name.localeCompare(b.name)).map((l) => ({
    id: l.id, name: l.name, tier: l.tier, active: l.active,
    rule: l.pct === 0 && l.basis === 'price' ? 'Selling price' : `${BASIS[l.basis]} ${l.pct > 0 ? '+' : ''}${l.pct}%`,
    ownPrices: items.filter((x) => x.listId === l.id).length, customers: customers.filter((x) => x.priceListId === l.id).length,
  }))

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'List', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.rule} · {r.ownPrices} own {r.ownPrices === 1 ? 'price' : 'prices'}</T>
      </View>
    ) },
    { key: 'tier', label: 'Tier', width: 120, sortValue: (r) => r.tier, render: (r) => <Pill tone={TONE[r.tier]} label={TIER_LABEL[r.tier]} /> },
    { key: 'customers', label: 'Customers', width: 110, align: 'right', sortValue: (r) => r.customers, render: (r) => cellNum(String(r.customers)) },
    { key: 'status', label: '', width: 70, render: (r) => (r.active ? null : <Pill tone="warning" label="Off" />) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Price lists"
          subtitle={`${lists.length} lists`}
          right={<DeskButton label="New price list" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => open('new')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Lists" value={String(lists.length)} tone="primary" delta={`${lists.filter((l) => l.active).length} in use`} />
        <KpiTile label="Customers priced" value={String(customers.filter((cu) => cu.priceListId).length)} tone="accent" />
      </KpiStrip>

      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => open(r.id)} emptyLabel="No price lists yet" />
      </View>
    </DeskPage>
  )
}
