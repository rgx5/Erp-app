import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { rollUp } from '@/domain/catalog'
import { variantLabel, sortCategories } from '@/domain/codes'
import { fmtDateTime } from '@/domain/dates'
import { labelsHtml, type LabelItem } from '@/domain/labels'
import { inr, inr0, round2 } from '@/domain/money'
import { marginPct, needsPricing } from '@/domain/pricing'
import { fmtQty, fmtQtyUnit, unitName } from '@/domain/qty'
import { stockLevel } from '@/domain/stock'
import type { VariantView } from '@/domain/views'
import { useIndustry, useLabels, useList, useStore, useVariantViews } from '@/data/hooks'
import { addVariants, deleteProduct, hasHistory, OpError, setAllVariants, updateProduct } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { AdjustSheet } from '@/features/AdjustSheet'
import { VariantSheet } from '@/features/VariantSheet'
import { printHtml } from '@/features/share'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Group, Tap } from '@/ui/primitives'
import { KV, ListRow, Notice, Section, StatTile } from '@/ui/blocks'
import { TagInput } from '@/ui/TagInput'
import { T } from '@/ui/Text'
import { Boxes, ChevronRight, More, Package, Pencil, Printer, Rupee, Tags, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const MOVE_TONE: Record<string, 'primary' | 'success' | 'warning' | 'default'> = { sale: 'primary', purchase: 'success', return: 'success', adjust: 'warning', audit: 'warning', opening: 'default', transfer: 'default' }

export default function ItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const store = useStore()
  const canEdit = useCan('inventory')
  const canBuy = useCan('purchases')
  const product = useApp((s) => s.data.products[id])
  const allViews = useVariantViews()
  const categories = useList('categories')
  const moves = useList('moves')
  const purchases = useList('purchases')
  const suppliers = useList('suppliers')
  const users = useList('users')

  const [openVariant, setOpenVariant] = useState<VariantView | null>(null)
  const [adjusting, setAdjusting] = useState<VariantView | null>(null)
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState(false)
  const [priceAll, setPriceAll] = useState(false)
  const [o1, setO1] = useState<string[]>([])
  const [o2, setO2] = useState<string[]>([])

  const variants = useMemo(() => allViews.filter((v) => v.productId === id), [allViews, id])
  const row = useMemo(() => (product ? rollUp([product], variants)[0] : null), [product, variants])
  const ids = useMemo(() => new Set(variants.map((v) => v.id)), [variants])
  const recent = useMemo(() => moves.filter((m) => ids.has(m.variantId)).sort((a, b) => b.at - a.at).slice(0, 8), [moves, ids])
  const receipts = useMemo(() => purchases.filter((p) => p.items.some((i) => ids.has(i.variantId))).sort((a, b) => b.date - a.date).slice(0, 5), [purchases, ids])

  if (!product || !row) return <Screen title="Not found" back><T tone="mute">This item is no longer here.</T></Screen>

  const cat = categories.find((x) => x.id === product.categoryId)
  const sizesMode = (cat?.config?.variantMode ?? 'sizes') === 'sizes'
  const colors = [...new Set(variants.map((v) => v.color))]
  const sample = variants[0]
  const avgMargin = (() => {
    const priced = variants.filter((v) => v.price > 0)
    return priced.length ? priced.reduce((s, v) => s + marginPct(v.price, v.avgCost ?? v.cost), 0) / priced.length : 0
  })()

  function addOptions() {
    try {
      const r = perform((s, ctx) => addVariants(s, product!.id, o1.length ? o1 : [''], sizesMode && o2.length ? o2 : [''], ctx))
      toast(r.made ? `${r.made} ${r.made === 1 ? 'variant' : 'variants'} added` : 'Those already exist', r.made ? 'ok' : 'info')
      setO1([]); setO2([])
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not add', 'err') }
  }

  async function archive() {
    setMenu(false)
    const to = product!.active === false
    if (!to && !(await ask({ title: `Archive ${product!.name}?`, message: 'It stops showing at the counter. Past bills keep it, and you can restore it any time.', confirm: 'Archive', danger: true }))) return
    perform((s, ctx) => updateProduct(s, product!.id, { active: to }, ctx))
    toast(to ? 'Restored' : 'Archived', 'ok')
  }

  async function remove() {
    setMenu(false)
    if (!(await ask({ title: `Delete ${product!.name}?`, message: 'This removes it and its variants for good.', confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteProduct(s, product!.id, ctx)); toast('Deleted', 'ok'); router.back() } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }

  const printAll = () => {
    const items: LabelItem[] = variants.map((v) => ({ name: v.productName, variant: variantLabel(v.size, v.color), sku: v.sku, barcode: v.barcode, price: v.price, mrp: v.mrp, copies: Math.max(1, Math.round(v.stock)) }))
    void printHtml(labelsHtml(items, { store: store.name, widthMm: 62, heightMm: 36, perRow: 3, showMrp: true, showStore: true }))
  }

  return (
    <Screen title={product.name} subtitle={[product.styleCode, cat?.name].filter(Boolean).join(' · ')} back
      right={canEdit ? <IconButton label="More" onPress={() => setMenu(true)}><More size={20} color={c.ink} /></IconButton> : undefined}>
      <View style={{ gap: 14, paddingBottom: 10 }}>
        {product.active === false ? <Notice tone="warning" title="Archived" body="Hidden from the counter. Past bills still show it." action="Restore" onAction={archive} /> : null}
        {row.unpriced > 0 ? <Notice tone="accent" icon={<Tags size={20} color={c.accent} />} title={`${row.unpriced} ${row.unpriced === 1 ? 'variant needs' : 'variants need'} a price`} body="They can’t be sold until priced" action="Set prices" onAction={() => (canEdit ? setPriceAll(true) : undefined)} /> : null}

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile label="Selling price" value={row.minPrice ? (row.minPrice === row.maxPrice ? inr0(row.minPrice) : `${inr0(row.minPrice)}–${inr0(row.maxPrice)}`) : '—'} icon={<Rupee size={16} color={c.primary} />} foot={avgMargin ? `${Math.round(avgMargin)}% margin` : 'Not priced yet'} />
          <StatTile label="In stock" value={sample?.trackStock === false ? '—' : fmtQtyUnit(row.stock, sample)} icon={<Boxes size={16} color={c.success} />} tone="success" foot={sample?.trackStock === false ? 'Not counted' : `${inr0(row.value)} at cost`} />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {canEdit ? <Button label="Edit" kind="soft" size="sm" icon={<Pencil size={15} color={c.primary} />} onPress={() => setEditing(true)} /> : null}
          {canEdit ? <Button label="Set all prices" kind="soft" size="sm" icon={<Rupee size={15} color={c.primary} />} onPress={() => setPriceAll(true)} /> : null}
          <Button label="Print labels" kind="soft" size="sm" icon={<Printer size={15} color={c.primary} />} onPress={printAll} />
          {canBuy ? <Button label="Receive stock" kind="soft" size="sm" icon={<Package size={15} color={c.primary} />} onPress={() => router.push({ pathname: '/purchases/new', params: { productId: product.id } })} /> : null}
        </View>

        <Section title={`Variants · ${variants.length}`} style={{ marginTop: 6 }}>
          <Group>
            {variants.map((v) => {
              const lvl = stockLevel(v)
              return (
                <ListRow key={v.id} title={variantLabel(v.size, v.color) || 'Standard'} subtitle={v.sku} onPress={() => setOpenVariant(v)}
                  badge={lvl === 'na' ? undefined : <Badge tone={lvl === 'out' ? 'danger' : lvl === 'low' ? 'warning' : 'success'}>{lvl === 'out' ? 'Out' : fmtQtyUnit(v.stock, v)}</Badge>}
                  value={needsPricing(v) ? 'No price' : inr0(v.price)} valueTone={needsPricing(v) ? 'warning' : 'default'} sub={v.cost ? `cost ${inr0(v.avgCost ?? v.cost)}` : undefined} />
              )
            })}
          </Group>
        </Section>

        {canEdit ? (
          <Card>
            <T v="h2" style={{ marginBottom: 12 }}>Add {sizesMode ? `${labels.option1.toLowerCase()}s or ${labels.option2.toLowerCase()}s` : 'options'}</T>
            <View style={{ gap: 12 }}>
              <TagInput value={o1} onChange={setO1} placeholder={sizesMode ? `New ${labels.option1.toLowerCase()}s, e.g. 3XL` : 'New options'} />
              {sizesMode && colors.length ? <TagInput value={o2} onChange={setO2} placeholder={`New ${labels.option2.toLowerCase()}s`} /> : null}
              {o1.length || o2.length ? <Button label="Add variants" onPress={addOptions} /> : null}
            </View>
          </Card>
        ) : null}

        <Section title="Details">
          <Card>
            {product.brand ? <KV k="Brand" v={product.brand} /> : null}
            {labels.attr1 && product.fabric ? <KV k={labels.attr1} v={product.fabric} /> : null}
            {labels.attr2 && product.season ? <KV k={labels.attr2} v={product.season} /> : null}
            <KV k="Sold by" v={unitName(sample ?? { unit: product.unit })} />
            <KV k="HSN" v={product.hsn || '—'} />
            <KV k="GST" v={product.gstRate !== undefined ? `${product.gstRate}% fixed` : 'By price slab'} />
            {product.noDiscount ? <KV k="Discounts" v="Not allowed" /> : null}
          </Card>
        </Section>

        {recent.length ? (
          <Section title="Recent stock movements">
            <Group>
              {recent.map((m) => {
                const v = variants.find((x) => x.id === m.variantId)
                return <ListRow key={m.id} dense title={m.reason || m.type} subtitle={`${fmtDateTime(m.at)} · ${[variantLabel(v?.size, v?.color), m.ref].filter(Boolean).join(' · ')}`}
                  value={`${m.qty > 0 ? '+' : ''}${fmtQty(m.qty)}`} valueTone={m.qty < 0 ? 'danger' : 'success'} badge={<Badge tone={MOVE_TONE[m.type]}>{m.type}</Badge>} />
              })}
            </Group>
          </Section>
        ) : null}

        {receipts.length ? (
          <Section title="Deliveries">
            <Group>
              {receipts.map((p) => {
                const q = p.items.filter((i) => ids.has(i.variantId)).reduce((s, i) => s + i.qty, 0)
                const cost = p.items.find((i) => ids.has(i.variantId))?.cost ?? 0
                return <ListRow key={p.id} dense title={suppliers.find((s) => s.id === p.supplierId)?.name ?? 'Supplier'} subtitle={`${p.no} · ${fmtDateTime(p.date)}`} value={`${fmtQty(q)} @ ${inr0(cost)}`} onPress={() => router.push({ pathname: '/purchases/[id]', params: { id: p.id } })} />
              })}
            </Group>
          </Section>
        ) : null}
        <T v="caption" tone="mute" align="center">{users.length ? '' : ''}Created {fmtDateTime(product.createdAt)}</T>
      </View>

      <VariantSheet variant={openVariant ? variants.find((v) => v.id === openVariant.id) ?? openVariant : null} onClose={() => setOpenVariant(null)} onAdjust={setAdjusting} />
      <AdjustSheet variant={adjusting ? variants.find((v) => v.id === adjusting.id) ?? adjusting : null} onClose={() => setAdjusting(null)} />
      <EditSheet visible={editing} onClose={() => setEditing(false)} productId={product.id} />
      <PriceAllSheet visible={priceAll} onClose={() => setPriceAll(false)} productId={product.id} />

      <Sheet visible={menu} onClose={() => setMenu(false)} title={product.name}>
        <View style={{ paddingBottom: 6 }}>
          <Tap onPress={() => { setMenu(false); setEditing(true) }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}><Pencil size={20} color={c.ink} /><T v="bodyStrong" style={{ flex: 1 }}>Edit details</T><ChevronRight size={18} color={c.inkMute} /></Tap>
          <Tap onPress={archive} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}><Package size={20} color={c.ink} /><T v="bodyStrong" style={{ flex: 1 }}>{product.active === false ? 'Restore from archive' : 'Archive'}</T></Tap>
          {!hasHistory(useApp.getState().data, product.id) ? <Tap onPress={remove} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}><Trash size={20} color={c.danger} /><T v="bodyStrong" tone="danger" style={{ flex: 1 }}>Delete</T></Tap> : <T v="caption" tone="mute" style={{ paddingVertical: 10 }}>This item has sales or stock history, so it can be archived but not deleted.</T>}
        </View>
      </Sheet>
    </Screen>
  )
}

function EditSheet({ visible, onClose, productId }: { visible: boolean; onClose: () => void; productId: string }) {
  const pack = useIndustry()
  const labels = useLabels()
  const categories = useList('categories')
  const product = useApp((s) => s.data.products[productId])
  const [f, setF] = useState({ name: '', code: '', categoryId: '', brand: '', fabric: '', season: '', hsn: '', gst: '', noDiscount: false })
  React.useEffect(() => {
    if (visible && product) setF({ name: product.name, code: product.styleCode, categoryId: product.categoryId, brand: product.brand, fabric: product.fabric, season: product.season, hsn: product.hsn, gst: product.gstRate !== undefined ? String(product.gstRate) : '', noDiscount: !!product.noDiscount })
  }, [visible, product])
  const cats = sortCategories(categories, pack.groupOrder)
  function save() {
    try {
      perform((s, ctx) => updateProduct(s, productId, { name: f.name.trim(), styleCode: f.code, categoryId: f.categoryId, brand: f.brand.trim(), fabric: f.fabric.trim(), season: f.season.trim(), hsn: f.hsn.trim(), gstRate: f.gst.trim() === '' ? undefined : Number(f.gst), noDiscount: f.noDiscount }, ctx))
      toast('Saved', 'ok'); onClose()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={`Edit ${labels.item.toLowerCase()}`} full footer={<Button label="Save" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 10 }}>
        <Field label="Name" value={f.name} onChangeText={(t) => setF({ ...f, name: t })} autoCapitalize="words" />
        <Field label="Item code" value={f.code} onChangeText={(t) => setF({ ...f, code: t.toUpperCase() })} mono hint="Existing SKUs keep their old prefix" />
        <Select<string> label="Category" value={f.categoryId} searchable options={cats.map((x) => ({ value: x.id, label: x.name, sub: x.group }))} onChange={(v) => setF({ ...f, categoryId: v })} />
        <Field label="Brand" value={f.brand} onChangeText={(t) => setF({ ...f, brand: t })} />
        {labels.attr1 ? <Field label={labels.attr1} value={f.fabric} onChangeText={(t) => setF({ ...f, fabric: t })} /> : null}
        {labels.attr2 ? <Field label={labels.attr2} value={f.season} onChangeText={(t) => setF({ ...f, season: t })} /> : null}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><NumberField label="HSN" value={f.hsn} onChange={(v) => setF({ ...f, hsn: v })} /></View>
          <View style={{ width: 110 }}><NumberField label="GST %" value={f.gst} onChange={(v) => setF({ ...f, gst: v })} decimals placeholder="slabs" /></View>
        </View>
        <SwitchRow title="No discounts" value={f.noDiscount} onChange={(v) => setF({ ...f, noDiscount: v })} />
      </View>
    </Sheet>
  )
}

function PriceAllSheet({ visible, onClose, productId }: { visible: boolean; onClose: () => void; productId: string }) {
  const [price, setPrice] = useState('')
  const [mrp, setMrp] = useState('')
  const [cost, setCost] = useState('')
  const count = useApp((s) => Object.values(s.data.variants).filter((v) => v.productId === productId).length)
  async function apply() {
    const entries: Array<['price' | 'mrp' | 'cost', string]> = [['price', price], ['mrp', mrp], ['cost', cost]]
    const set = entries.filter(([, v]) => Number(v) > 0)
    if (!set.length) { toast('Enter at least one value', 'err'); return }
    if (!(await ask({ title: `Change all ${count} variants?`, message: set.map(([k, v]) => `${k.toUpperCase()} → ${inr(Number(v))}`).join('\n'), confirm: 'Apply' }))) return
    for (const [k, v] of set) perform((s, ctx) => setAllVariants(s, productId, k, Number(v), ctx))
    toast(`Updated ${count} variants`, 'ok'); setPrice(''); setMrp(''); setCost(''); onClose()
  }
  return (
    <Sheet visible={visible} onClose={onClose} title="Set for every variant" subtitle="Leave a box empty to keep it as it is" footer={<Button label="Apply to all" size="lg" block onPress={apply} />}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <MoneyField label="Selling price" value={price} onChange={setPrice} large />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><MoneyField label="MRP" value={mrp} onChange={setMrp} /></View>
          <View style={{ flex: 1 }}><MoneyField label="Cost" value={cost} onChange={setCost} /></View>
        </View>
      </View>
    </Sheet>
  )
}

void round2
