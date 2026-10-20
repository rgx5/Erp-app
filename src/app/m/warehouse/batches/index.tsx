import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { fmtDate } from '@/domain/dates'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { batchWise, daysToExpiry, isExpired } from '@/modules/warehouse/logic'
import { addOpeningBatch, adjustBatch } from '@/modules/warehouse/ops'
import type { Batch } from '@/modules/warehouse/types'
import { DateInput, ItemField, useData, whenLabel } from '@/modules/warehouse/ui/common'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Group } from '@/ui/primitives'
import { EmptyState, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Layers, Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Batch-wise stock: each item's batches with quantity and expiry, soonest first. */
export default function Batches() {
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
  if (!canSee) return <Screen title="Batches" back><T tone="mute">Batches are for the owner and managers.</T></Screen>

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

  return (
    <Screen title="Batches" subtitle="Quantity and expiry of each lot" back
      right={canEdit ? <IconButton label="Add batch" tone="dark" onPress={() => setAdding(true)}><Plus size={22} color={c.bg} /></IconButton> : undefined}>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        <SearchBar value={q} onChange={setQ} placeholder="Search item" />
        {!groups.length ? <EmptyState icon={<Layers size={26} color={c.primary} />} title="No batches with stock" hint="Turn on batch tracking for an item (Tracking rules), then receive goods with a batch number and expiry. Stock you already hold can be given a batch with +." /> : null}
        {groups.map((g) => (
          <Section key={g.variantId} title={`${g.name} · ${g.total}`}>
            <Group>
              {g.batches.map((b) => {
                const d = daysToExpiry(b, now)
                return (
                  <ListRow key={b.id} title={`Batch ${b.batchNo}`} subtitle={b.expiry ? `Expires ${fmtDate(b.expiry)} · ${whenLabel(d)}` : 'No expiry date'} value={String(b.qty)}
                    badge={isExpired(b, now) ? <Badge tone="danger">Expired</Badge> : d !== null && d <= 30 ? <Badge tone="warning">Soon</Badge> : undefined}
                    onPress={canEdit ? () => setAdjusting(b) : undefined} />
                )
              })}
            </Group>
          </Section>
        ))}
      </View>

      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a batch" subtitle="Give stock you already hold a batch number and expiry. The item’s total does not change." full
        footer={<Button label="Add batch" size="lg" block onPress={create} />}>
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
        footer={<Button label="Correct batch" size="lg" block onPress={adjust} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <NumberField label="Add (+) or remove (−)" value={delta} onChange={setDelta} decimals />
          <Field label="Why" value={why} onChangeText={setWhy} placeholder="Count correction" />
        </View>
      </Sheet>
    </Screen>
  )
}
