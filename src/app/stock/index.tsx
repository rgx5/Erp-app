import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { inrShort, num } from '@/domain/money'
import { fmtQtyUnit } from '@/domain/qty'
import { filterStock, needsRestock, recentlySold, stockLevel, stockUnits, stockValue, type StockFilter } from '@/domain/stock'
import type { VariantView } from '@/domain/views'
import { useLabels, useList, useStore, useVariantViews } from '@/data/hooks'
import { useCan } from '@/data/store'
import { AdjustSheet } from '@/features/AdjustSheet'
import { scanVariants } from '@/features/ItemPicker'
import { VariantSheet } from '@/features/VariantSheet'
import { IconButton } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Alert, Boxes, ClipboardCheck, ArrowUpDown, Clock, ScanBarcode, Truck } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

const LEVEL_TONE = { out: 'danger', low: 'warning', ok: 'success', na: 'default' } as const

/** What is on the shelf, lowest first: search, filter, and fix a figure with one tap. */
export default function Stock() {
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const store = useStore()
  const canStock = useCan('stock')
  const canBuy = useCan('purchases')
  const views = useVariantViews()
  const moves = useList('moves')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<StockFilter>('')
  const [open, setOpen] = useState<VariantView | null>(null)
  const [adjusting, setAdjusting] = useState<VariantView | null>(null)

  const tracked = useMemo(() => views.filter((v) => v.trackStock && v.active), [views])
  const sold = useMemo(() => recentlySold(moves), [moves])
  const rows = useMemo(() => filterStock(views, q, filter, sold), [views, q, filter, sold])
  const counts = useMemo(() => ({
    low: tracked.filter((v) => stockLevel(v) === 'low').length,
    out: tracked.filter((v) => stockLevel(v) === 'out').length,
    nosale: tracked.filter((v) => v.stock > 0 && !sold.has(v.id)).length,
  }), [tracked, sold])
  const value = useMemo(() => stockValue(tracked, store.costBasis), [tracked, store.costBasis])
  const units = useMemo(() => stockUnits(tracked), [tracked])
  const restock = useMemo(() => needsRestock(views).length, [views])

  if (!canStock) return <Screen title="Stock" back><T tone="mute">Stock is managed by the owner and managers.</T></Screen>

  const scan = () => scanVariants((v) => {
    setQ(v.sku)
    return { ok: true, text: `${v.productName}${variantLabel(v.size, v.color) ? ` · ${variantLabel(v.size, v.color)}` : ''} — ${v.trackStock ? fmtQtyUnit(v.stock, v) : 'not counted'}` }
  }, { title: 'Find stock', noun: labels.item })

  const header = (
    <View style={{ gap: 12, paddingBottom: 4 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <StatTile label="Stock at cost" value={inrShort(value)} icon={<Boxes size={16} color={c.primary} />} foot={`${num(units, units % 1 ? 1 : 0)} units · ${tracked.length} variants`} />
        <StatTile label="To reorder" value={String(restock)} tone={restock ? 'warning' : 'success'} icon={<Alert size={16} color={restock ? c.warning : c.success} />} foot={counts.out ? `${counts.out} out of stock` : restock ? 'Running low' : 'All stocked'} onPress={() => router.push('/stock/restock')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Shortcut icon={<Truck size={18} color={c.primary} />} label="Restock" onPress={() => router.push('/stock/restock')} />
        <Shortcut icon={<ClipboardCheck size={18} color={c.primary} />} label="Count" onPress={() => router.push('/stock/count')} />
        <Shortcut icon={<Clock size={18} color={c.primary} />} label="Ledger" onPress={() => router.push('/stock/ledger')} />
        {canBuy ? <Shortcut icon={<Boxes size={18} color={c.primary} />} label="Receive" onPress={() => router.push('/purchases/new')} /> : null}
      </View>
    </View>
  )

  return (
    <Screen title="Stock" subtitle={`${num(tracked.length)} counted ${labels.items.toLowerCase()}`} back scroll={false}>
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <SearchBar value={q} onChange={setQ} placeholder="Search name, code or barcode" right={<IconButton label="Scan" onPress={scan} size={48}><ScanBarcode size={22} color={c.ink} /></IconButton>} />
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['', 'All', 0], ['low', 'Low', counts.low], ['out', 'Out', counts.out], ['nosale', 'Not selling', counts.nosale]] as Array<[StockFilter, string, number]>}
          renderItem={({ item }) => <Chip label={item[1]} count={item[2] || undefined} selected={filter === item[0]} onPress={() => setFilter(item[0])} />} />
      </View>
      <FlatList
        data={rows} keyExtractor={(v) => v.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }} initialNumToRender={14} windowSize={9}
        ListHeaderComponent={q || filter ? undefined : header}
        ListHeaderComponentStyle={{ marginBottom: 12 }}
        ListEmptyComponent={<EmptyState icon={<Boxes size={26} color={c.primary} />} title={q || filter ? 'Nothing matches' : `No ${labels.items.toLowerCase()} to count yet`} hint={q || filter ? 'Try clearing the search or the filter.' : `Add ${labels.items.toLowerCase()} or receive stock to see it here.`} />}
        renderItem={({ item: v }) => {
          const lvl = stockLevel(v)
          const label = variantLabel(v.size, v.color)
          return (
            <Tap onPress={() => setOpen(v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: lvl === 'out' ? c.danger : lvl === 'low' ? c.warning : c.success }} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong" numberOfLines={1}>{v.productName}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{[label, v.sku].filter(Boolean).join(' · ')}</T>
                {lvl !== 'ok' || (filter === 'nosale') ? (
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                    {lvl === 'out' ? <Badge tone="danger">Out of stock</Badge> : lvl === 'low' ? <Badge tone="warning">Low · reorder at {v.reorderLevel}</Badge> : null}
                    {filter === 'nosale' ? <Badge>No sale in 60 days</Badge> : null}
                  </View>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T v="numLg" tone={LEVEL_TONE[lvl]} style={{ fontSize: 20 }}>{fmtQtyUnit(v.stock, v)}</T>
                <T v="micro" tone="mute">on hand</T>
              </View>
              <IconButton label="Adjust stock" tone="primary" size={38} onPress={() => setAdjusting(v)}><ArrowUpDown size={17} color={c.primary} /></IconButton>
            </Tap>
          )
        }}
      />
      <VariantSheet variant={open} onClose={() => setOpen(null)} onAdjust={setAdjusting} />
      <AdjustSheet variant={adjusting} onClose={() => setAdjusting(null)} />
    </Screen>
  )
}

function Shortcut({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Tap onPress={onPress} style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
      {icon}
      <T v="caption" style={{ fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>{label}</T>
    </Tap>
  )
}
