import React, { useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inrShort, num } from '@/domain/money'
import { variantLabel } from '@/domain/codes'
import { fmtQtyUnit } from '@/domain/qty'
import { filterStock, needsRestock, recentlySold, stockLevel, stockUnits, stockValue, type StockFilter } from '@/domain/stock'
import type { VariantView } from '@/domain/views'
import { useLabels, useList, useStore, useVariantViews } from '@/data/hooks'
import { useCan } from '@/data/store'
import { AdjustSheet } from '@/features/AdjustSheet'
import { scanVariants } from '@/features/ItemPicker'
import { VariantSheet } from '@/features/VariantSheet'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { ArrowUpDown, Boxes, ClipboardCheck, Clock, Lock, Scan, Truck } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

const FILTERS: Array<{ id: StockFilter; label: string }> = [
  { id: '', label: 'All' }, { id: 'low', label: 'Low' }, { id: 'out', label: 'Out' }, { id: 'nosale', label: 'Not selling' },
]

/**
 * The desktop Stock screen: a KPI strip, a toolbar with search/filter chips/shortcuts, and one dense table of every
 * tracked variant, lowest first. Every figure and filter is the exact function the phone Stock screen uses
 * (`src/app/stock/index.tsx` — `filterStock`, `stockLevel`, `stockValue`, `needsRestock`…); this file only lays the
 * same data out as a grid instead of a card list. Row click opens `VariantSheet` the same way mobile does
 * (`setOpen`), and its own "Adjust" action opens `AdjustSheet` (`setAdjusting`) — both sheets are reused as-is.
 */
export function DesktopStock() {
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

  if (!canStock) {
    return (
      <DeskPage toolbar={<Toolbar title="Stock" subtitle={store?.name ?? ''} />}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Lock size={28} color={c.inkMute} />
          <T style={[dtext.cell, { color: c.inkMute }]}>Stock is managed by the owner and managers.</T>
        </View>
      </DeskPage>
    )
  }

  const scan = () => scanVariants((v) => {
    setQ(v.sku)
    return { ok: true, text: `${v.productName}${variantLabel(v.size, v.color) ? ` · ${variantLabel(v.size, v.color)}` : ''} — ${v.trackStock ? fmtQtyUnit(v.stock, v) : 'not counted'}` }
  }, { title: 'Find stock', noun: labels.item })

  const columns: Array<Column<VariantView>> = [
    { key: 'name', label: labels.item, sortValue: (v) => v.productName, render: (v) => cellText(v.productName, true) },
    { key: 'variant', label: 'Variant / code', width: 170, sortValue: (v) => variantLabel(v.size, v.color) || v.sku, render: (v) => (
      <T style={[dtext.cell, { color: c.inkMute }]} numberOfLines={1}>{[variantLabel(v.size, v.color), v.sku].filter(Boolean).join(' · ') || '—'}</T>
    ) },
    { key: 'stock', label: 'On hand', width: 110, align: 'right', sortValue: (v) => v.stock, render: (v) => cellNum(fmtQtyUnit(v.stock, v), true) },
    { key: 'status', label: 'Status', width: 150, align: 'right', render: (v) => {
      const lvl = stockLevel(v)
      if (lvl === 'out') return <Pill tone="danger" label="Out of stock" />
      if (lvl === 'low') return <Pill tone="warning" label={`Low · reorder at ${v.reorderLevel}`} />
      return filter === 'nosale' && !sold.has(v.id) ? <Pill label="No sale in 60 days" /> : <Pill tone="success" label="In stock" />
    } },
    { key: 'adjust', label: '', width: 90, align: 'center', render: (v) => (
      <DeskButton label="Adjust" icon={<ArrowUpDown size={12} color={c.ink} />} onPress={() => setAdjusting(v)} />
    ) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Stock"
          subtitle={`${num(tracked.length)} counted ${labels.items.toLowerCase()}`}
          left={
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 30, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.bg }}>
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search name, code or barcode"
                  placeholderTextColor={c.inkMute}
                  autoCorrect={false}
                  autoCapitalize="none"
                  style={{ width: 220, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
                />
              </View>
              <DeskSegmented value={filter} onChange={setFilter} options={FILTERS} />
            </>
          }
          right={
            <>
              <DeskButton label="Scan" icon={<Scan size={14} color={c.ink} />} onPress={scan} />
              <DeskButton label="Restock" icon={<Truck size={14} color={c.ink} />} onPress={() => router.push('/stock/restock')} />
              <DeskButton label="Count" icon={<ClipboardCheck size={14} color={c.ink} />} onPress={() => router.push('/stock/count')} />
              <DeskButton label="Ledger" icon={<Clock size={14} color={c.ink} />} onPress={() => router.push('/stock/ledger')} />
              {canBuy ? <DeskButton label="Purchase order" tone="primary" icon={<Boxes size={14} color={c.onPrimary} />} onPress={() => router.push('/purchases/new')} /> : null}
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Stock at cost" value={inrShort(value)} delta={`${num(units, units % 1 ? 1 : 0)} units · ${tracked.length} variants`} tone="primary" />
        <KpiTile label="To reorder" value={String(restock)} tone={restock ? 'warning' : 'success'} delta={restock ? 'Running low' : 'All stocked'} onPress={() => router.push('/stock/restock')} />
        <KpiTile label="Out of stock" value={String(counts.out)} tone={counts.out ? 'danger' : 'default'} delta={counts.out ? 'Needs immediate attention' : 'None'} />
        <KpiTile label="Not selling" value={String(counts.nosale)} delta="No sale in 60 days" onPress={() => setFilter('nosale')} />
      </KpiStrip>

      <View style={{ flex: 1, margin: 14, marginTop: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          onRowPress={setOpen}
          rowTone={(v) => (stockLevel(v) === 'out' ? 'danger' : stockLevel(v) === 'low' ? 'warning' : undefined)}
          emptyLabel={q || filter ? 'Nothing matches' : `No ${labels.items.toLowerCase()} to count yet`}
        />
      </View>

      <VariantSheet variant={open} onClose={() => setOpen(null)} onAdjust={setAdjusting} />
      <AdjustSheet variant={adjusting} onClose={() => setAdjusting(null)} />
    </DeskPage>
  )
}
