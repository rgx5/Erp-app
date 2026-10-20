import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { inr } from '@/domain/money'
import { fmtQtyUnit } from '@/domain/qty'
import { DEFAULT_SCALE, makeScaleBarcode, parseScaleBarcode, scaleFiller, scaleLayoutProblem, type ScaleLayout, type ScaleValueKind } from '@/domain/scale'
import { findVariantByCode } from '@/data/lookup'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { ItemPicker } from '@/features/ItemPicker'
import { shareText } from '@/features/share'
import { savePricingSettings } from '@/modules/pricing/ops'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import type { VariantView } from '@/domain/views'

const KINDS: Array<{ value: ScaleValueKind; label: string }> = [
  { value: 'weight_g', label: 'Grams' }, { value: 'weight_10g', label: '10 g' }, { value: 'price_rupees', label: '₹' }, { value: 'price_paise', label: 'Paise' },
]

/** Weighing-scale and price-embedded barcodes: how the labels are laid out, a tester, and a label maker. */
export default function ScaleBarcodes() {
  const can = useCan('pricing')
  const saved = useApp((s) => s.data.pricingSettings?.settings?.scale)
  const data = useApp((s) => s.data)
  const [layout, setLayout] = useState<ScaleLayout>({ ...DEFAULT_SCALE, ...(saved ?? {}) })
  const [code, setCode] = useState('')
  const [picked, setPicked] = useState<VariantView | null>(null)
  const [picking, setPicking] = useState(false)
  const [amount, setAmount] = useState('')

  const problem = scaleLayoutProblem(layout)
  const preview = useMemo(() => {
    const c = code.trim()
    if (!c) return null
    const read = parseScaleBarcode(c, { ...layout, enabled: true })
    if (!read) return { text: /^\d{13}$/.test(c) ? 'Not a label in this layout (check the prefix and the layout).' : 'A label has 13 digits.' }
    const v = findVariantByCode({ ...data, pricingSettings: { settings: { id: 'settings', scale: { ...layout, enabled: true } } } } as never, c)
    return { read, v }
  }, [code, layout, data])
  const label = picked && Number(amount) > 0 ? makeScaleBarcode(layout, (picked.barcode || picked.sku).replace(/\D/g, '').replace(/^0+/, '') || '0', Number(amount)) : null

  if (!can) return <Screen title="Scale barcodes" back><T tone="mute">Scale barcodes are for the owner and managers.</T></Screen>

  function save() {
    try { perform((s, ctx) => savePricingSettings(s, { scale: layout }, ctx)); toast('Saved', 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  const set = (p: Partial<ScaleLayout>) => setLayout({ ...layout, ...p })

  return (
    <Screen title="Scale & price barcodes" back footer={<Button label="Save layout" size="lg" block onPress={save} disabled={!!problem} />}>
      <View style={{ gap: 6, paddingBottom: 14 }}>
        <Notice tone="primary" title="How a label works" body="A scale prints 13 digits: a prefix (2), the item’s code, then the weight or the price, then a check digit. Set the item’s barcode or SKU to that item code, scan the label, and the bill gets the right amount." />
        <Section title="Layout" style={{ marginTop: 14 }}>
          <View style={{ gap: 14 }}>
            <Card padded={false}><SwitchRow title="Read scale labels" subtitle="Off by default; your own item barcodes also start with 2, and an exact barcode match always wins" value={layout.enabled} onChange={(v) => set({ enabled: v })} /></Card>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label="Prefix" value={layout.prefix} onChangeText={(t) => set({ prefix: t.replace(/\D/g, '').slice(0, 2) })} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><NumberField label="Item code digits" value={String(layout.itemDigits)} onChange={(t) => set({ itemDigits: Number(t) || 0 })} /></View>
              <View style={{ flex: 1 }}><NumberField label="Weight / price digits" value={String(layout.valueDigits)} onChange={(t) => set({ valueDigits: Number(t) || 0 })} /></View>
            </View>
            <View style={{ gap: 6 }}>
              <T v="label" tone="soft">The number after the item code is</T>
              <Segmented compact value={layout.value} options={KINDS} onChange={(v) => set({ value: v })} />
            </View>
            {problem ? <Notice tone="warning" title={problem} /> : <T v="caption" tone="mute">{layout.prefix}{'0'.repeat(Math.max(0, scaleFiller(layout)))}{'I'.repeat(layout.itemDigits)}{'V'.repeat(layout.valueDigits)} + check digit</T>}
          </View>
        </Section>

        <Section title="Try a label" style={{ marginTop: 18 }}>
          <View style={{ gap: 10 }}>
            <Field label="Type or paste a label’s 13 digits" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 13))} keyboardType="number-pad" />
            {preview && 'read' in preview && preview.read ? (
              <Card>
                <KV k="Item code" v={preview.read.item} />
                <KV k={preview.read.kind === 'weight' ? 'Weight' : 'Price'} v={preview.read.kind === 'weight' ? `${preview.read.value} g` : inr(preview.read.value)} />
                <KV k="Matches" v={preview.v ? `${preview.v.productName}${variantLabel(preview.v.size, preview.v.color) ? ` (${variantLabel(preview.v.size, preview.v.color)})` : ''}` : 'No item has this code yet'} tone={preview.v ? 'success' : 'warning'} />
                {preview.v?.scanQty ? <KV k="Sells" v={fmtQtyUnit(preview.v.scanQty, preview.v)} strong /> : null}
              </Card>
            ) : preview ? <T v="caption" tone="mute">{preview.text}</T> : null}
          </View>
        </Section>

        <Section title="Make a label" style={{ marginTop: 18 }}>
          <View style={{ gap: 10 }}>
            <Button label={picked ? `${picked.productName} · code ${picked.barcode || picked.sku}` : 'Choose an item'} kind="outline" block onPress={() => setPicking(true)} />
            <NumberField label={layout.value.startsWith('weight') ? 'Weight (grams)' : 'Price (₹)'} value={amount} onChange={setAmount} decimals />
            {label ? (
              <Card style={{ gap: 8 }}>
                <T v="num">{label}</T>
                <Button label="Share the number" kind="soft" onPress={() => void shareText(label)} />
              </Card>
            ) : picked && Number(amount) > 0 ? <T v="caption" tone="mute">That does not fit the layout (the item code or the amount has too many digits).</T> : null}
          </View>
        </Section>
      </View>
      <ItemPicker visible={picking} onClose={() => setPicking(false)} onPick={(v) => { setPicked(v); setPicking(false) }} title="Item for the label" />
    </Screen>
  )
}
