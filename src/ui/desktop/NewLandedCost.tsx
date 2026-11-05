import React from 'react'
import { View } from 'react-native'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { DataState } from '@/data/state'
import type { Supplier } from '@/domain/types'
import type { ChargeKind, PayMode } from '@/modules/purchasing/types'
import { Field, MoneyField, Segmented, Select, SwitchRow } from '@/ui/Inputs'
import { Card, Chip } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

interface Row { kind: ChargeKind; amount: string; gst: string; itc: boolean }

export interface DesktopNewLandedCostProps {
  data: DataState
  receipts: Array<{ id: string; no: string; supplierId: string; date: number; total: number }>
  purchaseId: string
  setPurchaseId: (v: string) => void
  rows: Row[]
  setRow: (i: number, p: Partial<Row>) => void
  kinds: ChargeKind[]
  chargeLabel: Record<ChargeKind, string>
  basis: 'value' | 'qty'
  setBasis: (v: 'value' | 'qty') => void
  billed: boolean
  setBilled: (v: boolean) => void
  suppliers: Supplier[]
  payeeId: string
  setPayeeId: (v: string) => void
  mode: PayMode
  setMode: (v: PayMode) => void
  modeOptions: Array<{ value: PayMode; label: string }>
  note: string
  setNote: (v: string) => void
  total: number
  canSave: boolean
  busy: boolean
  onSave: () => void
}

/**
 * The desktop "landed cost" form: the same charge rows (freight, duty, handling) the phone screen builds
 * (`src/app/m/purchasing/landed/new.tsx`), centred in `DesktopSettingsPage`'s readable column. `total` and every
 * charge come from the phone screen's own `chargesTotal`; this file only re-homes the same controls.
 */
export function DesktopNewLandedCost(p: DesktopNewLandedCostProps) {
  return (
    <DesktopSettingsPage title="Landed cost" subtitle="Freight, duty and handling"
      right={<DeskButton label={p.total > 0 ? `Add to cost · ${inr(p.total, 0)}` : 'Add to cost'} tone="primary" disabled={p.busy || !p.canSave} onPress={p.onSave} />}>
      <Select<string> label="Goods receipt" value={p.purchaseId} placeholder="Which goods do the charges belong to?" searchable
        options={p.receipts.map((r) => ({ value: r.id, label: `${r.no} · ${p.data.suppliers[r.supplierId]?.name ?? 'Supplier'}`, sub: `${fmtDayShort(r.date)} · ${inr(r.total, 0)}` }))} onChange={p.setPurchaseId} />

      <Section title="Charges" style={{ marginTop: 18 }}>
        <View style={{ gap: 10 }}>
          {p.rows.map((r, i) => (
            <Card key={i} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{p.kinds.map((k) => <Chip key={k} label={p.chargeLabel[k]} selected={r.kind === k} onPress={() => p.setRow(i, { kind: k })} />)}</View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}><MoneyField label="Amount" value={r.amount} onChange={(v) => p.setRow(i, { amount: v })} /></View>
                <View style={{ flex: 1 }}><MoneyField label="GST on it" value={r.gst} onChange={(v) => p.setRow(i, { gst: v })} /></View>
              </View>
              {Number(r.gst) > 0 ? <SwitchRow title="Claim the GST as input credit" subtitle="Otherwise it becomes part of the cost" value={r.itc} onChange={(v) => p.setRow(i, { itc: v })} /> : null}
            </Card>
          ))}
        </View>
      </Section>

      <Section title="Spread by" style={{ marginTop: 18 }}>
        <Segmented value={p.basis} options={[{ value: 'value', label: 'Value of goods' }, { value: 'qty', label: 'Quantity' }]} onChange={p.setBasis} />
      </Section>

      <View style={{ marginTop: 18, gap: 14 }}>
        <SwitchRow title="A transporter or agent will bill us" subtitle="Otherwise it was paid straight away" value={p.billed} onChange={p.setBilled} />
        {p.billed
          ? <Select<string> label="Who bills us" value={p.payeeId} placeholder="Choose the supplier" searchable options={p.suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.phone || undefined }))} onChange={p.setPayeeId} />
          : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{p.modeOptions.map((m) => <Chip key={m.value} label={m.label} selected={p.mode === m.value} onPress={() => p.setMode(m.value)} />)}</View>}
        <Field label="Note (optional)" value={p.note} onChangeText={p.setNote} />
        {p.total ? <Card><KV k="Charges and GST" v={inr(p.total, 0)} strong /></Card> : null}
      </View>
    </DesktopSettingsPage>
  )
}
