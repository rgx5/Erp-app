import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { fromInputDate, fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useVariantViews } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { deleteSupplierPrice, saveSupplierPrice } from '@/modules/purchasing/ops-sourcing'
import { dateOk, supplierOptions } from '@/modules/purchasing/ui/helpers'
import { ItemPicker } from '@/features/ItemPicker'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Select } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Toolbar, cellNum, cellText, type Column } from './kit'

type PriceRow = { id: string; item: string; supplierName: string; minQty: number; price: number; leadDays?: number; validTo?: number }

/**
 * The desktop supplier-prices screen: a KPI strip for how many prices are saved, a supplier filter, and a dense
 * grid of every price list entry — instead of the phone's stacked list. Adding a price reuses the exact same
 * `saveSupplierPrice`/`deleteSupplierPrice` ops the phone `m/purchasing/prices/index.tsx` calls, in the same Sheet.
 */
export function DesktopSupplierPrices() {
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

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Supplier prices" />}>
        <View style={{ padding: 20 }}><T tone="mute">Supplier prices are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

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

  const tableRows: PriceRow[] = rows.map((p) => ({
    id: p.id, item: byId.get(p.variantId)?.productName ?? 'Item', supplierName: data.suppliers[p.supplierId]?.name ?? 'Supplier', minQty: p.minQty, price: p.price, leadDays: p.leadDays, validTo: p.validTo,
  }))

  const columns: Array<Column<PriceRow>> = [
    { key: 'item', label: 'Item', sortValue: (r) => r.item, render: (r) => cellText(r.item, true) },
    { key: 'supplier', label: 'Supplier', sortValue: (r) => r.supplierName, render: (r) => cellText(r.supplierName) },
    { key: 'minQty', label: 'From qty', width: 100, align: 'right', sortValue: (r) => r.minQty, render: (r) => cellNum(String(r.minQty)) },
    { key: 'lead', label: 'Lead', width: 90, align: 'right', sortValue: (r) => r.leadDays ?? 0, render: (r) => cellText(r.leadDays ? `${r.leadDays}d` : '—') },
    { key: 'until', label: 'Valid until', width: 120, sortValue: (r) => r.validTo ?? 0, render: (r) => cellText(r.validTo ? fmtDayShort(r.validTo) : '—') },
    { key: 'price', label: 'Price', width: 110, align: 'right', sortValue: (r) => r.price, render: (r) => cellNum(inr(r.price), true) },
    { key: 'actions', label: '', width: 60, render: (r) => <IconButton label="Remove" tone="ghost" size={28} onPress={() => remove(r.id)}><Trash size={15} color={c.inkMute} /></IconButton> },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Supplier prices" subtitle="Price lists"
          right={<DeskButton label="Add a price" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => { setSupplierId(filter); setOpen(true) }} />} />
      }
    >
      <KpiStrip>
        <KpiTile label="Price entries" value={String(prices.length)} tone="primary" delta={`${suppliers.length} suppliers`} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, maxWidth: 320 }}>
        <Select<string> label="Supplier" value={filter} options={[{ value: '', label: 'All suppliers' }, ...supplierOptions(suppliers)]} onChange={setFilter} searchable />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={tableRows} columns={columns} emptyLabel="No prices yet" />
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
    </DeskPage>
  )
}
