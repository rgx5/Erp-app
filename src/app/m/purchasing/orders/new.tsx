import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { fromInputDate, toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useVariantViews } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { poTotal } from '@/modules/purchasing/logic'
import { savePurchaseOrder } from '@/modules/purchasing/ops'
import { ItemPicker } from '@/features/ItemPicker'
import { SupplierSheet } from '@/features/SupplierSheet'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash, UserPlus } from '@/ui/icons'
import { goBack } from '@/ui/nav'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

interface Line { variantId: string; qty: string; cost: string }

/** A purchase order: who it is for, what is wanted, at what cost, and by when. Edits an order when given `?id=`. */
export default function NewPurchaseOrder() {
  const { c } = useTheme()
  const router = useRouter()
  const { id: editId, supplierId: presetSupplier } = useLocalSearchParams<{ id?: string; supplierId?: string }>()
  const canBuy = useCan('purchases')
  const suppliers = useList('suppliers')
  const orders = useList('purchaseOrders')
  const views = useVariantViews()
  const existing = editId ? orders.find((o) => o.id === editId) : undefined

  const [supplierId, setSupplierId] = useState(existing?.supplierId ?? presetSupplier ?? '')
  const [lines, setLines] = useState<Line[]>(existing?.items.map((i) => ({ variantId: i.variantId, qty: String(i.qty), cost: String(i.cost) })) ?? [])
  const [expected, setExpected] = useState(existing?.expectedDate ? toInputDate(existing.expectedDate) : '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [picking, setPicking] = useState(false)
  const [newSupplier, setNewSupplier] = useState(false)
  const [busy, setBusy] = useState(false)
  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])

  const items = lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty) || 0, cost: Number(l.cost) || 0 })).filter((l) => l.qty > 0)
  const total = poTotal(items)
  const dateOk = !expected || /^\d{4}-\d{2}-\d{2}$/.test(expected)

  if (!canBuy) return <Screen title="Purchase order" back><T tone="mute">Purchase orders are for the owner and managers.</T></Screen>

  function save() {
    if (!dateOk) { toast('Write the date as YYYY-MM-DD', 'err'); return }
    setBusy(true)
    try {
      const r = perform((s, ctx) => savePurchaseOrder(s, { supplierId, notes, items, expectedDate: expected ? fromInputDate(expected) : undefined }, existing?.id, ctx))
      toast(`${r.order.no} saved`, 'ok')
      router.replace({ pathname: '/m/purchasing/orders/[id]', params: { id: r.order.id } })
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not save the order', 'err')
      setBusy(false)
    }
  }

  const pick = (variantId: string) => {
    const v = byId.get(variantId)
    setLines((cur) => cur.some((l) => l.variantId === variantId) ? cur : [...cur, { variantId, qty: '1', cost: v && v.cost > 0 ? String(v.cost) : '' }])
  }

  return (
    <Screen title={existing ? `Edit ${existing.no}` : 'New purchase order'} subtitle={items.length ? `${items.length} ${items.length === 1 ? 'line' : 'lines'} · ${inr(total)}` : undefined} back
      footer={<Button label={total > 0 ? `Save order · ${inr(total)}` : 'Save order'} size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 6, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Select<string> label="Supplier" value={supplierId} placeholder="Who is it for?" searchable
              options={suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.phone || undefined })).sort((a, b) => a.label.localeCompare(b.label))} onChange={setSupplierId} />
          </View>
          <IconButton label="New supplier" tone="primary" size={50} onPress={() => setNewSupplier(true)}><UserPlus size={20} color={c.primary} /></IconButton>
        </View>

        <Section title="Items" style={{ marginTop: 18 }}>
          <View style={{ gap: 10 }}>
            {lines.map((l) => {
              const v = byId.get(l.variantId)
              if (!v) return null
              return (
                <Card key={l.variantId} style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <T v="bodyStrong" numberOfLines={1}>{v.productName}</T>
                      <T v="caption" tone="mute" numberOfLines={1}>{[variantLabel(v.size, v.color), v.sku].filter(Boolean).join(' · ')} · {v.stock} in stock</T>
                    </View>
                    <IconButton label="Remove" tone="ghost" size={36} onPress={() => setLines(lines.filter((x) => x.variantId !== l.variantId))}><Trash size={18} color={c.inkMute} /></IconButton>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ flex: 1 }}><NumberField label="Quantity" value={l.qty} onChange={(t) => setLines(lines.map((x) => (x.variantId === l.variantId ? { ...x, qty: t } : x)))} decimals={!!v.fractional} /></View>
                    <View style={{ flex: 1 }}><MoneyField label="Cost each" value={l.cost} onChange={(t) => setLines(lines.map((x) => (x.variantId === l.variantId ? { ...x, cost: t } : x)))} /></View>
                  </View>
                </Card>
              )
            })}
            <Button label="Add item" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setPicking(true)} />
          </View>
        </Section>

        <Section title="Details" style={{ marginTop: 18 }}>
          <View style={{ gap: 14 }}>
            <Field label="Expected by (optional)" value={expected} onChangeText={setExpected} placeholder="YYYY-MM-DD" error={dateOk ? null : 'Write the date as YYYY-MM-DD'} />
            <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
          </View>
        </Section>
      </View>
      <ItemPicker visible={picking} onClose={() => setPicking(false)} onPick={(v) => pick(v.id)} picked={new Set(lines.map((l) => l.variantId))} title="Add item to the order" />
      <SupplierSheet visible={newSupplier} onClose={() => setNewSupplier(false)} onSaved={(s) => setSupplierId(s.id)} />
    </Screen>
  )
}

void goBack
