import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { filterCatalog, rollUp, type CatalogFilter } from '@/domain/catalog'
import { sortCategories } from '@/domain/codes'
import { inr0, num } from '@/domain/money'
import { fmtQtyUnit } from '@/domain/qty'
import { useIndustry, useLabels, useList, useVariantViews } from '@/data/hooks'
import { findVariantByCode } from '@/data/lookup'
import { useApp, useCan } from '@/data/store'
import { openScanner } from '@/features/scanBus'
import { Button, IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Tap } from '@/ui/primitives'
import { SearchBar } from '@/ui/Inputs'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Package, Plus, ScanBarcode } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

export default function Items() {
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

  function scan() {
    openScanner((code) => {
      const v = findVariantByCode(useApp.getState().data, code)
      if (!v) return { ok: false, text: `No ${labels.item.toLowerCase()} for ${code}` }
      setTimeout(() => router.push({ pathname: '/items/[id]', params: { id: v.productId } }), 120)
      return { ok: true, text: `${v.productName} — opening…` }
    }, { title: `Find a ${labels.item.toLowerCase()}` })
    router.push('/scan')
  }

  const active = all.filter((r) => r.product.active !== false).length

  return (
    <Screen large title={labels.items} subtitle={`${num(active)} ${active === 1 ? labels.item.toLowerCase() : labels.items.toLowerCase()} · ${num(variants.length)} variants`} scroll={false}
      right={canEdit ? <IconButton label={`Add ${labels.item.toLowerCase()}`} tone="dark" onPress={() => router.push('/items/new')}><Plus size={22} color={c.bg} /></IconButton> : undefined}>
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <SearchBar value={q} onChange={setQ} placeholder="Search name, code or barcode" right={<IconButton label="Scan" onPress={scan} size={48}><ScanBarcode size={22} color={c.ink} /></IconButton>} />
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['', 'All', 0], ['low', 'Low stock', counts.low], ['out', 'Out of stock', counts.out], ['pricing', 'Needs price', counts.pricing], ['archived', 'Archived', 0]] as Array<[CatalogFilter, string, number]>}
          renderItem={({ item }) => <Chip label={item[1]} count={item[2] || undefined} selected={filter === item[0]} onPress={() => setFilter(item[0])} />} />
        {cats.length > 1 ? (
          <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x.id} data={[{ id: '', name: 'All categories', group: '' }, ...cats]}
            renderItem={({ item }) => <Chip label={item.name} selected={cat === item.id} onPress={() => setCat(cat === item.id ? '' : item.id)} />} />
        ) : null}
      </View>
      <FlatList
        data={rows} keyExtractor={(r) => r.product.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }} initialNumToRender={14} windowSize={9}
        ListEmptyComponent={<EmptyState icon={<Package size={26} color={c.primary} />} title={q || filter || cat ? `No ${labels.items.toLowerCase()} match` : `No ${labels.items.toLowerCase()} yet`}
          hint={q || filter || cat ? 'Try clearing the search or filters.' : `Add your first ${labels.item.toLowerCase()} to start selling.`} action={canEdit && !q ? `Add ${labels.item.toLowerCase()}` : undefined} onAction={() => router.push('/items/new')} />}
        renderItem={({ item: r }) => {
          const first = r.variants[0]
          const frac = first && first.unit !== 'pc'
          return (
            <Tap onPress={() => router.push({ pathname: '/items/[id]', params: { id: r.product.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
                <T v="bodyStrong" tone="primary" style={{ fontSize: 13 }} fixed>{r.product.styleCode.split('-')[0].slice(0, 3)}</T>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong" numberOfLines={2}>{r.product.name}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{[r.product.styleCode, catName.get(r.product.categoryId), `${r.variants.length} ${r.variants.length === 1 ? 'variant' : 'variants'}`].filter(Boolean).join(' · ')}</T>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                  {r.out > 0 ? <Badge tone="danger">{r.out} out</Badge> : null}
                  {r.low > 0 ? <Badge tone="warning">{r.low} low</Badge> : null}
                  {r.unpriced > 0 ? <Badge tone="accent">{r.unpriced === r.variants.length ? 'Needs price' : `${r.unpriced} need price`}</Badge> : null}
                  {r.product.active === false ? <Badge>Archived</Badge> : null}
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <T v="num">{r.minPrice ? (r.minPrice === r.maxPrice ? inr0(r.minPrice) : `${inr0(r.minPrice)}+`) : '—'}</T>
                {r.variants.some((v) => v.trackStock) ? <T v="caption" tone={r.out === r.variants.length ? 'danger' : 'mute'}>{first ? fmtQtyUnit(r.stock, frac ? first : undefined) : r.stock} in stock</T> : <T v="caption" tone="mute">Service</T>}
              </View>
              <ChevronRight size={16} color={c.inkMute} />
            </Tap>
          )
        }}
      />
    </Screen>
  )
}

void Button
