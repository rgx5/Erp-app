import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { filterCatalog, rollUp, type CatalogFilter, type ProductRow } from '@/domain/catalog'
import { sortCategories } from '@/domain/codes'
import { inr0, num } from '@/domain/money'
import { fmtQtyUnit } from '@/domain/qty'
import { useIndustry, useLabels, useList, useVariantViews } from '@/data/hooks'
import { findVariantByCode } from '@/data/lookup'
import { useApp, useCan } from '@/data/store'
import { openScanner } from '@/features/scanBus'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { Plus, Scan, Search as SearchIcon } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Row = ProductRow & { id: string }

const STATUS_OPTIONS: Array<{ id: CatalogFilter; label: string }> = [
  { id: '', label: 'All' }, { id: 'low', label: 'Low' }, { id: 'out', label: 'Out' }, { id: 'pricing', label: 'Needs price' }, { id: 'archived', label: 'Archived' },
]

/**
 * The desktop Items/catalogue screen: a KPI strip, a search-and-filter bar, and one dense sortable grid of products
 * — not the phone's scrolling card list. Every figure comes from the exact functions the phone `items.tsx` already
 * computes (`rollUp`, `filterCatalog`, `sortCategories`); this file only lays the same rows out as a grid and adds
 * sort, instead of re-deriving the catalogue. Row click opens the same item-detail route the phone list does.
 */
export function DesktopItems() {
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const pack = useIndustry()
  const canEdit = useCan('inventory')
  const products = useList('products')
  const variants = useVariantViews()
  const categories = useList('categories')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('')
  const [cat, setCat] = useState('')

  const all = useMemo(() => rollUp(products, variants), [products, variants])
  const rows = useMemo(() => filterCatalog(all, q, filter, cat), [all, q, filter, cat])
  const cats = useMemo(() => {
    const used = new Set(products.map((p) => p.categoryId))
    return sortCategories(categories.filter((x) => used.has(x.id)), pack.groupOrder)
  }, [categories, products, pack.groupOrder])
  const catName = useMemo(() => new Map(categories.map((x) => [x.id, x.name])), [categories])
  const counts = useMemo(() => ({
    low: all.filter((r) => r.product.active !== false && r.low > 0).length,
    out: all.filter((r) => r.product.active !== false && r.out > 0).length,
    pricing: all.filter((r) => r.product.active !== false && r.unpriced > 0).length,
  }), [all])
  const active = all.filter((r) => r.product.active !== false).length

  // Ground truth for the toolbar's scan button — the exact lookup and "open the item" hand-off the phone screen uses.
  function scan() {
    openScanner((code) => {
      const v = findVariantByCode(useApp.getState().data, code)
      if (!v) return { ok: false, text: `No ${labels.item.toLowerCase()} for ${code}` }
      setTimeout(() => router.push({ pathname: '/items/[id]', params: { id: v.productId } }), 120)
      return { ok: true, text: `${v.productName} — opening…` }
    }, { title: `Find a ${labels.item.toLowerCase()}` })
    router.push('/scan')
  }

  const columns: Array<Column<Row>> = [
    { key: 'name', label: labels.item, sortValue: (r) => r.product.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.product.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.product.styleCode}</T>
      </View>
    ) },
    { key: 'category', label: 'Category', width: 150, sortValue: (r) => catName.get(r.product.categoryId) ?? '', render: (r) => cellText(catName.get(r.product.categoryId) ?? '—') },
    { key: 'variants', label: 'Variants', width: 90, align: 'right', sortValue: (r) => r.variants.length, render: (r) => cellNum(num(r.variants.length)) },
    { key: 'price', label: 'Price', width: 130, align: 'right', sortValue: (r) => r.minPrice, render: (r) => cellNum(r.minPrice ? (r.minPrice === r.maxPrice ? inr0(r.minPrice) : `${inr0(r.minPrice)}–${inr0(r.maxPrice)}`) : '—', true) },
    { key: 'stock', label: 'Stock', width: 110, align: 'right', sortValue: (r) => r.stock, render: (r) => r.variants.some((v) => v.trackStock) ? cellNum(fmtQtyUnit(r.stock, r.variants[0])) : cellText('—') },
    { key: 'status', label: 'Status', width: 240, render: (r) => (
      <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
        {r.out > 0 ? <Pill tone="danger" label={`${r.out} out`} /> : null}
        {r.low > 0 ? <Pill tone="warning" label={`${r.low} low`} /> : null}
        {r.unpriced > 0 ? <Pill tone="accent" label={r.unpriced === r.variants.length ? 'Needs price' : `${r.unpriced} need price`} /> : null}
        {r.product.active === false ? <Pill label="Archived" /> : null}
        {!r.out && !r.low && !r.unpriced && r.product.active !== false ? <Pill tone="success" label="OK" /> : null}
      </View>
    ) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={labels.items}
          subtitle={`${num(active)} ${active === 1 ? labels.item.toLowerCase() : labels.items.toLowerCase()} · ${num(variants.length)} variants`}
          right={
            <>
              <DeskButton label="Scan" icon={<Scan size={14} color={c.ink} />} onPress={scan} />
              {canEdit ? <DeskButton label={`Add ${labels.item.toLowerCase()}`} tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/items/new')} /> : null}
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label={`Active ${labels.items.toLowerCase()}`} value={num(active)} tone="primary" delta={`${num(variants.length)} variants`} onPress={() => setFilter('')} />
        <KpiTile label="Low stock" value={String(counts.low)} tone={counts.low ? 'warning' : 'default'} delta={counts.low ? 'Click to filter' : 'All stocked'} onPress={() => setFilter('low')} />
        <KpiTile label="Out of stock" value={String(counts.out)} tone={counts.out ? 'danger' : 'default'} delta={counts.out ? 'Needs restock' : 'None'} onPress={() => setFilter('out')} />
        <KpiTile label="Needs a price" value={String(counts.pricing)} tone={counts.pricing ? 'accent' : 'default'} delta={counts.pricing ? "Can't be sold yet" : 'All priced'} onPress={() => setFilter('pricing')} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, maxWidth: 320, flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
            <SearchIcon size={14} color={c.inkMute} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search name, code or barcode"
              placeholderTextColor={c.inkMute}
              autoCorrect={false}
              autoCapitalize="none"
              style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
            />
          </View>
          <DeskSegmented value={filter} onChange={setFilter} options={STATUS_OPTIONS} />
        </View>
        {cats.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <CatChip label="All categories" active={!cat} onPress={() => setCat('')} />
            {cats.map((x) => <CatChip key={x.id} label={x.name} active={cat === x.id} onPress={() => setCat(cat === x.id ? '' : x.id)} />)}
          </ScrollView>
        ) : null}
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows.map((r) => ({ ...r, id: r.product.id }))}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/items/[id]', params: { id: r.product.id } })}
          rowTone={(r) => (r.out > 0 ? 'danger' : r.low > 0 ? 'warning' : undefined)}
          emptyLabel={q || filter || cat ? `No ${labels.items.toLowerCase()} match` : `No ${labels.items.toLowerCase()} yet`}
        />
      </View>
    </DeskPage>
  )
}

/** A single pressable category toggle. Categories are an open-ended, per-shop list (unlike the fixed status
 * filters above), so they get their own scrollable row instead of a `DeskSegmented` that would overflow the bar. */
function CatChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} style={{ height: 26, paddingHorizontal: 10, borderRadius: 5, justifyContent: 'center', backgroundColor: active ? c.primary : c.surface, borderWidth: 1, borderColor: active ? c.primary : c.lineStrong }}>
      <T style={[dtext.tiny, { color: active ? c.onPrimary : c.inkSoft, fontFamily: fonts.bodyMedium }]} numberOfLines={1}>{label}</T>
    </Pressable>
  )
}
