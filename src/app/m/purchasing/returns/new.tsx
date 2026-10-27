import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useVariantViews } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { GST_RATES, isInterState } from '@/modules/purchasing/itc'
import { recordPurchaseReturn } from '@/modules/purchasing/ops-returns'
import { REASON_LABEL, returnableQty, returnTotals } from '@/modules/purchasing/returns'
import { MODE_OPTIONS, supplierOptions } from '@/modules/purchasing/ui/helpers'
import type { PayMode, ReturnReason } from '@/modules/purchasing/types'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

/** Send goods back to a supplier. Choosing the receipt they came in on limits the quantities and fills their cost. */
export default function NewReturn() {
  const router = useRouter()
  const params = useLocalSearchParams<{ supplierId?: string; purchaseId?: string }>()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const suppliers = useList('suppliers')
  const views = useVariantViews()
  const [supplierId, setSupplierId] = useState(params.supplierId ?? data.purchases[params.purchaseId ?? '']?.supplierId ?? '')
  const [purchaseId, setPurchaseId] = useState(params.purchaseId ?? '')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [rate, setRate] = useState('18')
  const [reason, setReason] = useState<ReturnReason>('damaged')
  const [refund, setRefund] = useState('')
  const [refundMode, setRefundMode] = useState<PayMode>('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const receipts = useMemo(() => Object.values(data.purchases).filter((p) => p.supplierId === supplierId).sort((a, b) => b.date - a.date), [data.purchases, supplierId])
  const grn = purchaseId ? data.purchases[purchaseId] : undefined
  const back = useMemo(() => (grn ? returnableQty(data, grn.id) : {}), [data, grn])
  const byId = new Map(views.map((v) => [v.id, v]))
  const items = (grn?.items ?? []).map((i) => ({ variantId: i.variantId, qty: Number(qty[i.variantId]) || 0, cost: i.cost, rate: Number(rate) || 0 })).filter((i) => i.qty > 0)
  const interState = isInterState(data.store, data.suppliers[supplierId]?.gstin)
  const totals = returnTotals(items, interState)

  if (!can) return <Screen title="Return goods" back><T tone="mute">Purchase returns are for the owner and managers.</T></Screen>

  function save() {
    setBusy(true)
    try {
      const r = perform((s, ctx) => recordPurchaseReturn(s, { supplierId, purchaseId: purchaseId || undefined, reason, note, items, refund: Number(refund) || 0, refundMode: Number(refund) > 0 ? refundMode : undefined }, ctx))
      toast(`${r.debitNote.no} · ${inr(r.debitNote.total, 0)}`, 'ok'); router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not record the return', 'err'); setBusy(false) }
  }

  return (
    <Screen title="Return goods" back footer={<Button label={totals.total > 0 ? `Create debit note · ${inr(totals.total, 0)}` : 'Create debit note'} size="lg" block loading={busy} disabled={!items.length} onPress={save} />}>
      <View style={{ gap: 16, paddingBottom: 14 }}>
        <Select<string> label="Supplier" value={supplierId} placeholder="Who are you returning to?" searchable options={supplierOptions(suppliers)} onChange={(v) => { setSupplierId(v); setPurchaseId(''); setQty({}) }} />
        {supplierId ? (
          <Select<string> label="Goods receipt" value={purchaseId} placeholder="Which receipt did they come in on?" options={receipts.map((p) => ({ value: p.id, label: `${p.no} · ${fmtDayShort(p.date)}`, sub: inr(p.total, 0) }))} onChange={(v) => { setPurchaseId(v); setQty({}) }}
            hint={receipts.length ? undefined : 'No goods have been received from this supplier.'} />
        ) : null}
        {grn ? (
          <Section title="Goods going back" style={{ marginTop: 0 }}>
            <View style={{ gap: 10 }}>
              {grn.items.map((i) => {
                const v = byId.get(i.variantId)
                const left = back[i.variantId] ?? 0
                return (
                  <Card key={i.variantId} style={{ gap: 8 }}>
                    <T v="bodyStrong" numberOfLines={1}>{v?.productName ?? 'Item'}</T>
                    <T v="caption" tone="mute">{v ? [variantLabel(v.size, v.color), v.sku].filter(Boolean).join(' · ') : ''} · {inr(i.cost)} each · {left} can go back</T>
                    <NumberField label="Quantity to return" value={qty[i.variantId] ?? ''} onChange={(t) => setQty({ ...qty, [i.variantId]: t })} decimals={!!v?.fractional} />
                  </Card>
                )
              })}
            </View>
          </Section>
        ) : null}
        <Section title="GST the supplier charged" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{GST_RATES.map((r) => <Chip key={r} label={`${r}%`} selected={Number(rate) === r} onPress={() => setRate(String(r))} />)}</View>
        </Section>
        <Section title="Why" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(Object.keys(REASON_LABEL) as ReturnReason[]).map((r) => <Chip key={r} label={REASON_LABEL[r]} selected={reason === r} onPress={() => setReason(r)} />)}</View>
        </Section>
        <MoneyField label="Money handed back at once (optional)" value={refund} onChange={setRefund} hint="The rest cuts what you owe" />
        {Number(refund) > 0 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={refundMode === m.value} onPress={() => setRefundMode(m.value)} />)}</View> : null}
        <Field label="Note (optional)" value={note} onChangeText={setNote} />
        {items.length ? <Card><KV k="Goods" v={inr(totals.taxable, 0)} /><KV k="GST" v={inr(totals.cgst + totals.sgst + totals.igst, 0)} /><KV k="Debit note" v={inr(totals.total, 0)} strong /></Card> : null}
      </View>
    </Screen>
  )
}
