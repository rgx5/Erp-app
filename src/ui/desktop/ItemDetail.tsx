import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { ProductRow } from '@/domain/catalog'
import { variantLabel } from '@/domain/codes'
import { fmtDateTime } from '@/domain/dates'
import { inr0 } from '@/domain/money'
import { needsPricing } from '@/domain/pricing'
import { fmtQty, fmtQtyUnit, unitName } from '@/domain/qty'
import { stockLevel } from '@/domain/stock'
import type { Category, Product, Purchase, StockMove, Supplier } from '@/domain/types'
import type { VariantView } from '@/domain/views'
import type { IndustryPack } from '@/industries/types'
import { KV } from '@/ui/blocks'
import { TagInput } from '@/ui/TagInput'
import { T } from '@/ui/Text'
import { Boxes, Package, Pencil, Printer, Rupee, Tags, Trash } from '@/ui/icons'
import { toneColor, useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, cellText, dtext, type Column } from './kit'
import { Notice } from '@/ui/blocks'

// The same tone-per-move-type mapping `src/app/items/[id].tsx` uses for its mobile badges — a display-only lookup
// table, kept local here (rather than imported from the route file) to avoid a circular import between the two.
const MOVE_TONE: Record<string, Tone> = { sale: 'primary', purchase: 'success', return: 'success', adjust: 'warning', audit: 'warning', opening: 'default', transfer: 'default' }

export interface DesktopItemDetailProps {
  product: Product
  row: ProductRow
  cat: Category | undefined
  colors: string[]
  sample: VariantView | undefined
  avgMargin: number
  variants: VariantView[]
  recent: StockMove[]
  receipts: Purchase[]
  ids: Set<string>
  suppliers: Supplier[]
  labels: IndustryPack['labels']
  canEdit: boolean
  canBuy: boolean
  canDelete: boolean
  sizesMode: boolean
  o1: string[]
  o2: string[]
  setO1: (v: string[]) => void
  setO2: (v: string[]) => void
  addOptions: () => void
  onEdit: () => void
  onPriceAll: () => void
  onPrintAll: () => void
  onArchive: () => void
  onDelete: () => void
  onOpenVariant: (v: VariantView) => void
}

/**
 * The desktop item-detail screen: a toolbar with the actions mobile hides behind a "…" menu, a KPI strip, and a
 * two-pane body — variants grid + "add options" on the left, details and recent activity on the right. Every value
 * and handler (`row`, `avgMargin`, `addOptions`, `archive`, `remove`, `printAll`, the sheet setters…) is passed down
 * from `src/app/items/[id].tsx` exactly as the phone screen computes it; this file only lays the same data out as a
 * dense grid instead of stacked cards, matching `DesktopItems` (the catalogue list this screen is reached from).
 */
export function DesktopItemDetail({
  product, row, cat, colors, sample, avgMargin, variants, recent, receipts, ids, suppliers,
  labels, canEdit, canBuy, canDelete, sizesMode, o1, o2, setO1, setO2, addOptions,
  onEdit, onPriceAll, onPrintAll, onArchive, onDelete, onOpenVariant,
}: DesktopItemDetailProps) {
  const { c } = useTheme()
  const router = useRouter()

  const variantColumns: Array<Column<VariantView>> = [
    { key: 'variant', label: sizesMode ? `${labels.option1} / ${labels.option2}` : 'Variant', sortValue: (v) => variantLabel(v.size, v.color) || v.sku, render: (v) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{variantLabel(v.size, v.color) || 'Standard'}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{v.sku}</T>
      </View>
    ) },
    { key: 'stock', label: 'Stock', width: 120, align: 'right', sortValue: (v) => v.stock, render: (v) => {
      if (v.trackStock === false) return cellText('—')
      const lvl = stockLevel(v)
      return <Pill tone={lvl === 'out' ? 'danger' : lvl === 'low' ? 'warning' : 'success'} label={lvl === 'out' ? 'Out' : fmtQtyUnit(v.stock, v)} />
    } },
    { key: 'price', label: 'Price', width: 110, align: 'right', sortValue: (v) => v.price, render: (v) => (needsPricing(v) ? <Pill tone="warning" label="No price" /> : cellNum(inr0(v.price), true)) },
    { key: 'cost', label: 'Cost', width: 110, align: 'right', sortValue: (v) => v.avgCost ?? v.cost, render: (v) => cellNum(v.cost ? inr0(v.avgCost ?? v.cost) : '—') },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={product.name}
          subtitle={[product.styleCode, cat?.name].filter(Boolean).join(' · ')}
          right={
            <>
              {canEdit ? <DeskButton label="Edit" icon={<Pencil size={14} color={c.ink} />} onPress={onEdit} /> : null}
              {canEdit ? <DeskButton label="Set all prices" icon={<Rupee size={14} color={c.ink} />} onPress={onPriceAll} /> : null}
              <DeskButton label="Print labels" icon={<Printer size={14} color={c.ink} />} onPress={onPrintAll} />
              {canBuy ? <DeskButton label="Receive stock" icon={<Package size={14} color={c.ink} />} onPress={() => router.push({ pathname: '/purchases/new', params: { productId: product.id } })} /> : null}
              {canEdit ? <DeskButton label={product.active === false ? 'Restore' : 'Archive'} icon={<Boxes size={14} color={c.ink} />} onPress={onArchive} /> : null}
              {canEdit && canDelete ? <DeskButton label="Delete" tone="danger" icon={<Trash size={14} color={c.danger} />} onPress={onDelete} /> : null}
            </>
          }
        />
      }
    >
      {product.active === false || row.unpriced > 0 ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 8 }}>
          {product.active === false ? <Notice tone="warning" title="Archived" body="Hidden from the counter. Past bills still show it." action="Restore" onAction={onArchive} /> : null}
          {row.unpriced > 0 ? (
            <Notice tone="accent" icon={<Tags size={20} color={c.accent} />} title={`${row.unpriced} ${row.unpriced === 1 ? 'variant needs' : 'variants need'} a price`} body="They can’t be sold until priced" action="Set prices" onAction={() => (canEdit ? onPriceAll() : undefined)} />
          ) : null}
        </View>
      ) : null}

      <KpiStrip>
        <KpiTile
          label="Selling price"
          value={row.minPrice ? (row.minPrice === row.maxPrice ? inr0(row.minPrice) : `${inr0(row.minPrice)}–${inr0(row.maxPrice)}`) : '—'}
          tone="primary"
          delta={avgMargin ? `${Math.round(avgMargin)}% margin` : row.minPrice ? 'Cost not set' : 'Not priced yet'}
        />
        <KpiTile
          label="In stock"
          value={sample?.trackStock === false ? '—' : fmtQtyUnit(row.stock, sample)}
          tone="success"
          delta={sample?.trackStock === false ? 'Not counted' : `${inr0(row.value)} at cost`}
        />
      </KpiStrip>

      <SplitPane widths={['flex', 340]}>
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1, marginHorizontal: 14, marginTop: 14, marginBottom: canEdit ? 10 : 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable
              rows={variants}
              columns={variantColumns}
              onRowPress={onOpenVariant}
              rowTone={(v) => (v.trackStock !== false && stockLevel(v) === 'out' ? 'danger' : v.trackStock !== false && stockLevel(v) === 'low' ? 'warning' : undefined)}
              emptyLabel="No variants yet"
            />
          </View>
          {canEdit ? (
            <View style={{ marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 12 }}>
              <T style={dtext.cellStrong}>Add {sizesMode ? `${labels.option1.toLowerCase()}s or ${labels.option2.toLowerCase()}s` : 'options'}</T>
              <TagInput value={o1} onChange={setO1} caps={sizesMode ? 'characters' : 'words'} placeholder={sizesMode ? `New ${labels.option1.toLowerCase()}s, e.g. 3XL` : 'New options'} />
              {sizesMode && colors.length ? <TagInput value={o2} onChange={setO2} placeholder={`New ${labels.option2.toLowerCase()}s`} /> : null}
              {o1.length || o2.length ? <DeskButton label="Add variants" tone="primary" onPress={addOptions} /> : null}
            </View>
          ) : null}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Details</T>
            {product.brand ? <KV k="Brand" v={product.brand} /> : null}
            {labels.attr1 && product.fabric ? <KV k={labels.attr1} v={product.fabric} /> : null}
            {labels.attr2 && product.season ? <KV k={labels.attr2} v={product.season} /> : null}
            <KV k="Sold by" v={unitName(sample ?? { unit: product.unit })} />
            <KV k="HSN" v={product.hsn || '—'} />
            <KV k="GST" v={product.gstRate !== undefined ? `${product.gstRate}% fixed` : 'By price slab'} />
            {product.noDiscount ? <KV k="Discounts" v="Not allowed" /> : null}
          </View>

          {recent.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Recent stock movements</T>
              {recent.map((m) => {
                const v = variants.find((x) => x.id === m.variantId)
                return (
                  <DenseRow
                    key={m.id}
                    title={m.reason || m.type}
                    subtitle={`${fmtDateTime(m.at)} · ${[variantLabel(v?.size, v?.color), m.ref].filter(Boolean).join(' · ')}`}
                    value={`${m.qty > 0 ? '+' : ''}${fmtQty(m.qty)}`}
                    valueTone={m.qty < 0 ? 'danger' : 'success'}
                    badge={<Pill tone={MOVE_TONE[m.type]} label={m.type} />}
                  />
                )
              })}
            </View>
          ) : null}

          {receipts.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Deliveries</T>
              {receipts.map((p) => {
                const q = p.items.filter((i) => ids.has(i.variantId)).reduce((s, i) => s + i.qty, 0)
                const pcost = p.items.find((i) => ids.has(i.variantId))?.cost ?? 0
                return (
                  <DenseRow
                    key={p.id}
                    title={suppliers.find((s) => s.id === p.supplierId)?.name ?? 'Supplier'}
                    subtitle={`${p.no} · ${fmtDateTime(p.date)}`}
                    value={`${fmtQty(q)} @ ${inr0(pcost)}`}
                    onPress={() => router.push({ pathname: '/purchases/[id]', params: { id: p.id } })}
                  />
                )
              })}
            </View>
          ) : null}
        </ScrollView>
      </SplitPane>
    </DeskPage>
  )
}

/** A dense one-line row for the small, unsorted activity lists in the right-hand column — too little data in each
 * to earn a full `DataTable`. */
function DenseRow({ title, subtitle, value, valueTone, badge, onPress }: {
  title: string; subtitle?: string; value?: string; valueTone?: Tone; badge?: React.ReactNode; onPress?: () => void
}) {
  const { c } = useTheme()
  const Wrap = onPress ? Pressable : View
  return (
    <Wrap onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: c.line }}>
      <View style={{ flex: 1, gap: 1 }}>
        <T style={dtext.cell} numberOfLines={1}>{title}</T>
        {subtitle ? <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{subtitle}</T> : null}
      </View>
      {badge}
      {value !== undefined ? <T style={[dtext.num, { color: valueTone ? toneColor(c, valueTone) : c.ink }]}>{value}</T> : null}
    </Wrap>
  )
}
