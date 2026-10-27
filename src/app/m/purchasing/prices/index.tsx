import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { fromInputDate, fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useVariantViews } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { ItemPicker } from '@/features/ItemPicker'
import { deleteSupplierPrice, saveSupplierPrice } from '@/modules/purchasing/ops-sourcing'
import { dateOk, supplierOptions } from '@/modules/purchasing/ui/helpers'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Card } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { Tags, Trash } from '@/ui/icons'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** What each supplier charges for each item (with quantity breaks and validity), used to suggest costs on orders. */
export default function SupplierPrices() {
  const { c } = useTheme()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const suppliers = useList('suppliers')
  const prices = useList('supplierPrices')
  const views = useVariantViews()
  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [price, setPrice] = useState('')
  const [minQty, setMinQty] = useState('1')
  const [lead, setLead] = useState('')
  const [until, setUntil] = useState('')
  const [busy, setBusy] = useState(false)

  const rows = prices.filter((p) => !filter || p.supplierId === filter).sort((a, b) => (data.suppliers[a.supplierId]?.name ?? '').localeCompare(data.suppliers[b.supplierId]?.name ?? '') || a.minQty - b.minQty)
  if (!can) return <Screen title="Supplier prices" back><T tone="mute">Supplier prices are for the owner and managers.</T></Screen>

  function save() {
    if (!dateOk(until)) { toast('Write the date as YYYY-MM-DD', 'err'); return }
    setBusy(true)
    try {
      perform((s, ctx) => saveSupplierPrice(s, { supplierId, variantId, price: Number(price), minQty: Number(minQty) || 1, leadDays: Number(lead) || undefined, validTo: until ? fromInputDate(until) : undefined }, ctx))
      toast('Price saved', 'ok'); setOpen(false); setVariantId(''); setPrice('')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save the price', 'err') }
    setBusy(false)
  }
  function remove(id: string) {
    try { perform((s, ctx) => deleteSupplierPrice(s, id, ctx)) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not remove', 'err') }
  }

  return (
    <Screen title="Supplier prices" subtitle="Price lists" back footer={<Button label="Add a price" size="lg" block onPress={() => { setSupplierId(filter); setOpen(true) }} />}>
      <View style={{ gap: 12, paddingBottom: 16 }}>
        <Select<string> label="Supplier" value={filter} options={[{ value: '', label: 'All suppliers' }, ...supplierOptions(suppliers)]} onChange={setFilter} searchable />
        {rows.length ? (
          <Card padded={false}>
            {rows.map((p) => {
              const v = byId.get(p.variantId)
              return (
                <ListRow key={p.id} title={v?.productName ?? 'Item'} subtitle={`${data.suppliers[p.supplierId]?.name ?? 'Supplier'} · from ${p.minQty}${p.validTo ? ` · until ${fmtDayShort(p.validTo)}` : ''}${p.leadDays ? ` · ${p.leadDays}d` : ''}`} value={inr(p.price)}
                  right={<IconButton label="Remove" tone="ghost" size={34} onPress={() => remove(p.id)}><Trash size={16} color={c.inkMute} /></IconButton>} />
              )
            })}
          </Card>
        ) : <EmptyState icon={<Tags size={26} color={c.primary} />} title="No prices yet" hint="Save what suppliers charge so new orders suggest the right cost and quotes can be compared." />}
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Supplier price" footer={<Button label="Save price" size="lg" block loading={busy} disabled={!supplierId || !variantId || !(Number(price) > 0)} onPress={save} />}>
        <View style={{ gap: 14 }}>
          <Select<string> label="Supplier" value={supplierId} searchable options={supplierOptions(suppliers)} onChange={setSupplierId} />
          <Button label={variantId ? (byId.get(variantId)?.productName ?? 'Item') : 'Choose the item'} kind="outline" block onPress={() => setPicking(true)} />
          <MoneyField label="Price before tax" value={price} onChange={setPrice} />
          <NumberField label="From quantity" value={minQty} onChange={setMinQty} decimals />
          <NumberField label="Days to deliver (optional)" value={lead} onChange={setLead} />
          <Field label="Valid until (optional)" value={until} onChangeText={setUntil} placeholder="YYYY-MM-DD" error={dateOk(until) ? null : 'YYYY-MM-DD'} />
        </View>
      </Sheet>
      <ItemPicker visible={picking} onClose={() => setPicking(false)} onPick={(v) => { setVariantId(v.id); setPicking(false) }} title="Which item?" />
    </Screen>
  )
}
