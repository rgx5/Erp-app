import React, { useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { fmtDate } from '@/domain/dates'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { batchWise, daysToExpiry, isExpired } from '@/modules/warehouse/logic'
import { addOpeningBatch, adjustBatch } from '@/modules/warehouse/ops'
import type { Batch } from '@/modules/warehouse/types'
import { DateInput, ItemField, useData, whenLabel } from '@/modules/warehouse/ui/common'
import { Field, MoneyField, NumberField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

type Row = { id: string; variantId: string; name: string; batch: Batch }

/**
 * The desktop Batches screen: a KPI strip (how many items have batches, how many units in all), a search box in
 * place of the phone's `SearchBar`, and one flat, sortable grid instead of a per-item scroll of sections. Reads
 * the exact same `batchWise` the phone screen groups by item; this file only flattens the same groups into rows
 * (repeating the item name) so every batch can still be sorted by expiry across the whole catalogue. The "add a
 * batch" and "correct a batch" sheets are reused unchanged.
 */
export function DesktopBatches() {
  const { c } = useTheme()
  const canSee = useCan('stock')
  const canEdit = useCan('warehouse')
  const data = useData()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [adjusting, setAdjusting] = useState<Batch | null>(null)
  const [f, setF] = useState({ variantId: '', batchNo: '', qty: '', cost: '' })
  const [mfg, setMfg] = useState<number | undefined>()
  const [exp, setExp] = useState<number | undefined>()
  const [delta, setDelta] = useState('')
  const [why, setWhy] = useState('')
  const now = Date.now()
  const groups = useMemo(() => batchWise(data).filter((g) => !q.trim() || g.name.toLowerCase().includes(q.trim().toLowerCase())), [data, q])
  const rows: Row[] = useMemo(() => groups.flatMap((g) => g.batches.map((b) => ({ id: b.id, variantId: g.variantId, name: g.name, batch: b }))), [groups])

  if (!canSee) {
    return (
      <DeskPage toolbar={<Toolbar title="Batches" />}>
        <View style={{ padding: 20 }}><T tone="mute">Batches are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  function create() {
    try {
      perform((s, ctx) => addOpeningBatch(s, { variantId: f.variantId, batchNo: f.batchNo, qty: Number(f.qty) || 0, mfgDate: mfg, expiry: exp, cost: Number(f.cost) || undefined }, ctx))
      toast('Batch added', 'ok'); setAdding(false); setF({ variantId: '', batchNo: '', qty: '', cost: '' }); setMfg(undefined); setExp(undefined)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  function adjust() {
    try { perform((s, ctx) => adjustBatch(s, adjusting!.id, Number(delta) || 0, why, ctx)); toast('Batch corrected', 'ok'); setAdjusting(null); setDelta(''); setWhy('') }
    catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Item', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'batchNo', label: 'Batch', width: 140, sortValue: (r) => r.batch.batchNo, render: (r) => cellText(r.batch.batchNo) },
    { key: 'qty', label: 'Qty', width: 90, align: 'right', sortValue: (r) => r.batch.qty, render: (r) => cellNum(String(r.batch.qty)) },
    { key: 'expiry', label: 'Expiry', width: 140, sortValue: (r) => r.batch.expiry ?? Infinity, render: (r) => cellText(r.batch.expiry ? fmtDate(r.batch.expiry) : 'No expiry') },
    { key: 'status', label: 'Status', width: 120, sortValue: (r) => daysToExpiry(r.batch, now) ?? Infinity, render: (r) => {
      const d = daysToExpiry(r.batch, now)
      if (isExpired(r.batch, now)) return <Pill tone="danger" label="Expired" />
      if (d !== null && d <= 30) return <Pill tone="warning" label={whenLabel(d)} />
      return d !== null ? <Pill label={whenLabel(d)} /> : <Pill label="No expiry" />
    } },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Batches"
          subtitle="Quantity and expiry of each lot"
          left={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 30, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.bg }}>
              <TextInput value={q} onChangeText={setQ} placeholder="Search item" placeholderTextColor={c.inkMute} autoCorrect={false} autoCapitalize="none"
                style={{ width: 200, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }} />
            </View>
          }
          right={canEdit ? <DeskButton label="Add batch" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => setAdding(true)} /> : undefined}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Items with batches" value={String(groups.length)} delta={`${rows.length} batches in all`} />
        <KpiTile label="Units batched" value={String(groups.reduce((s, g) => s + g.total, 0))} />
      </KpiStrip>

      <View style={{ flex: 1, margin: 14, marginTop: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          onRowPress={canEdit ? (r) => setAdjusting(r.batch) : undefined}
          rowTone={(r) => (isExpired(r.batch, now) ? 'danger' : undefined)}
          emptyLabel="No batches with stock"
        />
      </View>

      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a batch" subtitle="Give stock you already hold a batch number and expiry. The item's total does not change." full
        footer={<DeskButton label="Add batch" tone="primary" onPress={create} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <ItemField label="Item" value={f.variantId} onChange={(v) => setF({ ...f, variantId: v })} />
          <Field label="Batch number" value={f.batchNo} onChangeText={(t) => setF({ ...f, batchNo: t })} autoCapitalize="characters" />
          <NumberField label="Quantity in this batch" value={f.qty} onChange={(t) => setF({ ...f, qty: t })} decimals />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><DateInput label="Made on (optional)" value={mfg} onChange={setMfg} /></View>
            <View style={{ flex: 1 }}><DateInput label="Expires on" value={exp} onChange={setExp} /></View>
          </View>
          <MoneyField label="Cost each (optional)" value={f.cost} onChange={(t) => setF({ ...f, cost: t })} />
        </View>
      </Sheet>

      <Sheet visible={!!adjusting} onClose={() => setAdjusting(null)} title={adjusting ? `Batch ${adjusting.batchNo}` : ''} subtitle={adjusting ? `${adjusting.qty} in this batch. A count showed a difference?` : ''}
        footer={<DeskButton label="Correct batch" tone="primary" onPress={adjust} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <NumberField label="Add (+) or remove (−)" value={delta} onChange={setDelta} decimals />
          <Field label="Why" value={why} onChangeText={setWhy} placeholder="Count correction" />
        </View>
      </Sheet>
    </DeskPage>
  )
}
