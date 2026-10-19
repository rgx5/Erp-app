import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { lastSupplierByVariant } from '@/domain/purchasing'
import { fmtQty, fmtQtyUnit, qtyStep } from '@/domain/qty'
import { needsRestock, stockLevel, suggestReorder } from '@/domain/stock'
import { useLabels, useList, useStore, useVariantViews } from '@/data/hooks'
import { useCan } from '@/data/store'
import { usePurchaseDraft } from '@/features/purchaseDraft'
import { whatsApp } from '@/features/share'
import { Button } from '@/ui/Button'
import { Stepper } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check, PackageCheck, Share, Truck } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Everything at or below its reorder level, with a sensible quantity to order. Tick what you want and make a receipt or send the list. */
export default function Restock() {
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const store = useStore()
  const canStock = useCan('stock')
  const canBuy = useCan('purchases')
  const views = useVariantViews()
  const purchases = useList('purchases')
  const suppliers = useList('suppliers')
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [qty, setQty] = useState<Record<string, number>>({})
  const [supplier, setSupplier] = useState('')

  const need = useMemo(() => needsRestock(views).sort((a, b) => (a.stock - a.reorderLevel) - (b.stock - b.reorderLevel) || a.productName.localeCompare(b.productName)), [views])
  const last = useMemo(() => lastSupplierByVariant(purchases), [purchases])
  const supName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers])
  const used = useMemo(() => {
    const n = new Map<string, number>()
    for (const v of need) { const s = last.get(v.id) ?? ''; n.set(s, (n.get(s) ?? 0) + 1) }
    return n
  }, [need, last])
  const rows = useMemo(() => (supplier === '' ? need : need.filter((v) => (last.get(v.id) ?? '') === (supplier === '-' ? '' : supplier))), [need, supplier, last])
  const picked = rows.filter((v) => !off.has(v.id))
  const qtyOf = (id: string, fallback: number) => qty[id] ?? fallback

  if (!canStock) return <Screen title="Restock" back><T tone="mute">Restocking is for the owner and managers.</T></Screen>

  const toggle = (id: string) => setOff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const lineList = () => picked.map((v) => ({ variantId: v.id, qty: qtyOf(v.id, suggestReorder(v)) }))

  function createReceipt() {
    const sups = new Set(picked.map((v) => last.get(v.id) ?? ''))
    usePurchaseDraft.getState().set({ supplierId: sups.size === 1 ? [...sups][0] : '', lines: lineList() })
    router.push({ pathname: '/purchases/new', params: { draft: '1' } })
  }

  function share() {
    const text = [`*Reorder list — ${store.name}*`, '', ...picked.map((v) => `• ${v.productName}${variantLabel(v.size, v.color) ? ` (${variantLabel(v.size, v.color)})` : ''} × ${fmtQtyUnit(qtyOf(v.id, suggestReorder(v)), v)}`)].join('\n')
    void whatsApp(text, supplier && supplier !== '-' ? suppliers.find((s) => s.id === supplier)?.phone : undefined)
  }

  const chips: Array<[string, string, number]> = [['', 'All', need.length], ...[...used.entries()].map(([id, n]) => [id || '-', id ? supName.get(id) ?? 'Supplier' : 'No supplier yet', n] as [string, string, number])]

  return (
    <Screen title="Restock" subtitle={need.length ? `${need.length} to reorder · ${picked.length} selected` : 'Nothing to reorder'} back scroll={false}
      footer={picked.length ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label="Share list" kind="outline" size="lg" icon={<Share size={18} color={c.ink} />} onPress={share} />
          {canBuy ? <View style={{ flex: 1 }}><Button label={`Receive stock · ${picked.length}`} size="lg" block icon={<Truck size={18} color={c.onPrimary} />} onPress={createReceipt} /></View> : null}
        </View>
      ) : undefined}>
      {chips.length > 2 ? (
        <View style={{ paddingBottom: 10 }}>
          <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0] || 'all'} data={chips}
            renderItem={({ item }) => <Chip label={item[1]} count={item[2]} selected={supplier === item[0]} onPress={() => setSupplier(item[0])} />} />
        </View>
      ) : null}
      <FlatList
        data={rows} keyExtractor={(v) => v.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={rows.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <T tone="soft">Quantities bring each back to twice its reorder level.</T>
            <Tap onPress={() => setOff(picked.length === rows.length ? new Set([...off, ...rows.map((v) => v.id)]) : new Set([...off].filter((id) => !rows.some((v) => v.id === id))))} hitSlop={8}>
              <T v="bodyStrong" tone="primary" style={{ fontSize: 13.5 }}>{picked.length === rows.length ? 'Clear' : 'Select all'}</T>
            </Tap>
          </View>
        ) : undefined}
        ListEmptyComponent={<EmptyState icon={<PackageCheck size={26} color={c.primary} />} title="You’re fully stocked" hint={`No ${labels.item.toLowerCase()} is at or below its reorder level.`} />}
        renderItem={({ item: v }) => {
          const on = !off.has(v.id)
          const lvl = stockLevel(v)
          const label = variantLabel(v.size, v.color)
          const from = last.get(v.id)
          return (
            <Tap onPress={() => toggle(v.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8, borderRadius: 18, backgroundColor: on ? c.surface : c.sunken, borderWidth: on ? 1.5 : 1, borderColor: on ? c.primary : c.line }}>
              <View style={{ width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.primary : 'transparent', borderWidth: on ? 0 : 1.5, borderColor: c.lineStrong }}>
                {on ? <Check size={15} color={c.onPrimary} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong" numberOfLines={1}>{v.productName}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{[label, v.sku].filter(Boolean).join(' · ')}</T>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                  <Badge tone={lvl === 'out' ? 'danger' : 'warning'}>{lvl === 'out' ? 'Out of stock' : `${fmtQty(v.stock)} left`}</Badge>
                  {from ? <Badge>{supName.get(from) ?? 'Supplier'}</Badge> : null}
                </View>
              </View>
              <Stepper compact value={qtyOf(v.id, suggestReorder(v))} onChange={(n) => setQty((q) => ({ ...q, [v.id]: n }))} rules={v} min={qtyStep(v)} />
            </Tap>
          )
        }}
      />
    </Screen>
  )
}
