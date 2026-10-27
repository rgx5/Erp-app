import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { CHARGE_LABEL, chargesTotal } from '@/modules/purchasing/landed'
import { recordLandedCost } from '@/modules/purchasing/ops-landed'
import type { ChargeKind, PayMode } from '@/modules/purchasing/types'
import { MODE_OPTIONS, supplierOptions } from '@/modules/purchasing/ui/helpers'
import { Button } from '@/ui/Button'
import { Field, MoneyField, Segmented, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

interface Row { kind: ChargeKind; amount: string; gst: string; itc: boolean }
const KINDS = Object.keys(CHARGE_LABEL) as ChargeKind[]

/** Freight, duty and handling for one goods receipt, spread over its items so each item's cost includes them. */
export default function NewLandedCost() {
  const router = useRouter()
  const params = useLocalSearchParams<{ purchaseId?: string }>()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const suppliers = useList('suppliers')
  const [purchaseId, setPurchaseId] = useState(params.purchaseId ?? '')
  const [rows, setRows] = useState<Row[]>(KINDS.slice(0, 3).map((kind) => ({ kind, amount: '', gst: '', itc: true })))
  const [basis, setBasis] = useState<'value' | 'qty'>('value')
  const [billed, setBilled] = useState(false)
  const [payeeId, setPayeeId] = useState('')
  const [mode, setMode] = useState<PayMode>('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const receipts = useMemo(() => Object.values(data.purchases).sort((a, b) => b.date - a.date).slice(0, 60), [data.purchases])
  const charges = rows.map((r) => ({ kind: r.kind, label: CHARGE_LABEL[r.kind], amount: Number(r.amount) || 0, gst: Number(r.gst) || 0, itcEligible: r.itc })).filter((r) => r.amount > 0)
  const total = chargesTotal(charges)
  const setRow = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)))

  if (!can) return <Screen title="Landed cost" back><T tone="mute">Landed cost is for the owner and managers.</T></Screen>

  function save() {
    setBusy(true)
    try {
      const r = perform((s, ctx) => recordLandedCost(s, { purchaseId, charges, basis, payeeId: billed ? payeeId || undefined : undefined, mode: billed ? undefined : mode, note }, ctx))
      toast(`${r.landed.no} · ${inr(r.landed.total, 0)} added to cost`, 'ok'); router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not record the charges', 'err'); setBusy(false) }
  }

  return (
    <Screen title="Landed cost" subtitle="Freight, duty and handling" back footer={<Button label={total > 0 ? `Add to cost · ${inr(total, 0)}` : 'Add to cost'} size="lg" block loading={busy} disabled={!purchaseId || !charges.length} onPress={save} />}>
      <View style={{ gap: 16, paddingBottom: 14 }}>
        <Select<string> label="Goods receipt" value={purchaseId} placeholder="Which goods do the charges belong to?" searchable
          options={receipts.map((p) => ({ value: p.id, label: `${p.no} · ${data.suppliers[p.supplierId]?.name ?? 'Supplier'}`, sub: `${fmtDayShort(p.date)} · ${inr(p.total, 0)}` }))} onChange={setPurchaseId} />
        <Section title="Charges" style={{ marginTop: 0 }}>
          <View style={{ gap: 10 }}>
            {rows.map((r, i) => (
              <Card key={i} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{KINDS.map((k) => <Chip key={k} label={CHARGE_LABEL[k]} selected={r.kind === k} onPress={() => setRow(i, { kind: k })} />)}</View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><MoneyField label="Amount" value={r.amount} onChange={(v) => setRow(i, { amount: v })} /></View>
                  <View style={{ flex: 1 }}><MoneyField label="GST on it" value={r.gst} onChange={(v) => setRow(i, { gst: v })} /></View>
                </View>
                {Number(r.gst) > 0 ? <SwitchRow title="Claim the GST as input credit" subtitle="Otherwise it becomes part of the cost" value={r.itc} onChange={(v) => setRow(i, { itc: v })} /> : null}
              </Card>
            ))}
          </View>
        </Section>
        <Section title="Spread by" style={{ marginTop: 0 }}>
          <Segmented value={basis} options={[{ value: 'value', label: 'Value of goods' }, { value: 'qty', label: 'Quantity' }]} onChange={setBasis} />
        </Section>
        <SwitchRow title="A transporter or agent will bill us" subtitle="Otherwise it was paid straight away" value={billed} onChange={setBilled} />
        {billed
          ? <Select<string> label="Who bills us" value={payeeId} placeholder="Choose the supplier" searchable options={supplierOptions(suppliers)} onChange={setPayeeId} />
          : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => setMode(m.value)} />)}</View>}
        <Field label="Note (optional)" value={note} onChangeText={setNote} />
        {charges.length ? <Card><KV k="Charges and GST" v={inr(total, 0)} strong /></Card> : null}
      </View>
    </Screen>
  )
}
