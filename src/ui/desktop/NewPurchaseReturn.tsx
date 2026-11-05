import React from 'react'
import { View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { DataState } from '@/data/state'
import type { Purchase, Supplier } from '@/domain/types'
import type { PayMode, ReturnReason } from '@/modules/purchasing/types'
import type { ReturnTotals } from '@/modules/purchasing/returns'
import type { VariantView } from '@/domain/views'
import { Field, MoneyField, NumberField, Select } from '@/ui/Inputs'
import { Card, Chip } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopNewPurchaseReturnProps {
  data: DataState
  suppliers: Supplier[]
  supplierId: string
  onSupplierChange: (v: string) => void
  receipts: Purchase[]
  purchaseId: string
  onPurchaseChange: (v: string) => void
  grn: Purchase | undefined
  back: Record<string, number>
  byId: Map<string, VariantView>
  qty: Record<string, string>
  setQty: (variantId: string, v: string) => void
  rate: string
  setRate: (v: string) => void
  gstRates: readonly number[]
  reason: ReturnReason
  setReason: (v: ReturnReason) => void
  reasonLabel: Record<ReturnReason, string>
  refund: string
  setRefund: (v: string) => void
  refundMode: PayMode
  setRefundMode: (v: PayMode) => void
  modeOptions: Array<{ value: PayMode; label: string }>
  note: string
  setNote: (v: string) => void
  items: Array<{ variantId: string }>
  totals: ReturnTotals
  busy: boolean
  onSave: () => void
}

/**
 * The desktop "return goods" form: the same supplier/receipt picking and per-item return quantities the phone
 * screen builds (`src/app/m/purchasing/returns/new.tsx`), centred in `DesktopSettingsPage`'s readable column.
 * `totals` and `back` (how much of each line can still go back) come from the phone screen's own
 * `returnableQty`/`returnTotals` calls; this file only re-homes the same controls.
 */
export function DesktopNewPurchaseReturn(p: DesktopNewPurchaseReturnProps) {
  return (
    <DesktopSettingsPage title="Return goods"
      right={<DeskButton label={p.totals.total > 0 ? `Create debit note · ${inr(p.totals.total, 0)}` : 'Create debit note'} tone="primary" disabled={p.busy || !p.items.length} onPress={p.onSave} />}>
      <Select<string> label="Supplier" value={p.supplierId} placeholder="Who are you returning to?" searchable options={p.suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.phone || undefined }))} onChange={p.onSupplierChange} />
      {p.supplierId ? (
        <View style={{ marginTop: 14 }}>
          <Select<string> label="Goods receipt" value={p.purchaseId} placeholder="Which receipt did they come in on?" options={p.receipts.map((r) => ({ value: r.id, label: `${r.no} · ${fmtDayShort(r.date)}`, sub: inr(r.total, 0) }))} onChange={p.onPurchaseChange}
            hint={p.receipts.length ? undefined : 'No goods have been received from this supplier.'} />
        </View>
      ) : null}

      {p.grn ? (
        <Section title="Goods going back" style={{ marginTop: 18 }}>
          <View style={{ gap: 10 }}>
            {p.grn.items.map((i) => {
              const v = p.byId.get(i.variantId)
              const left = p.back[i.variantId] ?? 0
              return (
                <Card key={i.variantId} style={{ gap: 8 }}>
                  <T v="bodyStrong" numberOfLines={1}>{v?.productName ?? 'Item'}</T>
                  <T v="caption" tone="mute">{v ? [variantLabel(v.size, v.color), v.sku].filter(Boolean).join(' · ') : ''} · {inr(i.cost)} each · {left} can go back</T>
                  <NumberField label="Quantity to return" value={p.qty[i.variantId] ?? ''} onChange={(t) => p.setQty(i.variantId, t)} decimals={!!v?.fractional} />
                </Card>
              )
            })}
          </View>
        </Section>
      ) : null}

      <Section title="GST the supplier charged" style={{ marginTop: 18 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{p.gstRates.map((r) => <Chip key={r} label={`${r}%`} selected={Number(p.rate) === r} onPress={() => p.setRate(String(r))} />)}</View>
      </Section>
      <Section title="Why" style={{ marginTop: 18 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(Object.keys(p.reasonLabel) as ReturnReason[]).map((r) => <Chip key={r} label={p.reasonLabel[r]} selected={p.reason === r} onPress={() => p.setReason(r)} />)}</View>
      </Section>

      <View style={{ marginTop: 18, gap: 14 }}>
        <MoneyField label="Money handed back at once (optional)" value={p.refund} onChange={p.setRefund} hint="The rest cuts what you owe" />
        {Number(p.refund) > 0 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{p.modeOptions.map((m) => <Chip key={m.value} label={m.label} selected={p.refundMode === m.value} onPress={() => p.setRefundMode(m.value)} />)}</View> : null}
        <Field label="Note (optional)" value={p.note} onChangeText={p.setNote} />
        {p.items.length ? <Card><KV k="Goods" v={inr(p.totals.taxable, 0)} /><KV k="GST" v={inr(p.totals.cgst + p.totals.sgst + p.totals.igst, 0)} /><KV k="Debit note" v={inr(p.totals.total, 0)} strong /></Card> : null}
      </View>
    </DesktopSettingsPage>
  )
}
