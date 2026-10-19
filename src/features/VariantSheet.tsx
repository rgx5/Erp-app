import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { barcodeBits } from '@/domain/barcode'
import { variantLabel } from '@/domain/codes'
import { labelsHtml } from '@/domain/labels'
import { inr } from '@/domain/money'
import { marginPct } from '@/domain/pricing'
import { fmtQtyUnit, unitPer } from '@/domain/qty'
import type { VariantView } from '@/domain/views'
import { useLabels, useStore } from '@/data/hooks'
import { OpError, updateVariant } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { MoneyField, NumberField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { BarcodeView } from '@/ui/charts'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Printer, Boxes } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { printHtml } from './share'

/** One variant up close: its prices and reorder level, its barcode, and a label to print. */
export function VariantSheet({ variant, onClose, onAdjust }: { variant: VariantView | null; onClose: () => void; onAdjust: (v: VariantView) => void }) {
  const { c } = useTheme()
  const store = useStore()
  const labels = useLabels()
  const canEdit = useCan('inventory')
  const canStock = useCan('stock')
  const [price, setPrice] = useState('')
  const [mrp, setMrp] = useState('')
  const [cost, setCost] = useState('')
  const [reorder, setReorder] = useState('')
  const [copies, setCopies] = useState('1')

  useEffect(() => {
    if (!variant) return
    setPrice(variant.price ? String(variant.price) : ''); setMrp(variant.mrp ? String(variant.mrp) : ''); setCost(variant.cost ? String(variant.cost) : ''); setReorder(String(variant.reorderLevel)); setCopies('1')
  }, [variant?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!variant) return <Sheet visible={false} onClose={onClose} />
  const label = variantLabel(variant.size, variant.color)
  let bits = ''
  try { bits = barcodeBits(variant.barcode).bits } catch { bits = '' }
  const dirty = Number(price) !== variant.price || Number(mrp) !== variant.mrp || Number(cost) !== variant.cost || Number(reorder) !== variant.reorderLevel

  function save() {
    try {
      perform((s, ctx) => updateVariant(s, variant!.id, { price: Number(price) || 0, mrp: Number(mrp) || 0, cost: Number(cost) || 0, reorderLevel: Number(reorder) || 0 }, ctx))
      toast('Saved', 'ok')
      onClose()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  const printLabels = () => void printHtml(labelsHtml([{ name: variant.productName, variant: label, sku: variant.sku, barcode: variant.barcode, price: variant.price, mrp: variant.mrp, copies: Math.max(1, Number(copies) || 1) }], { store: store.name, widthMm: 62, heightMm: 36, perRow: 3, showMrp: true, showStore: true }))

  return (
    <Sheet visible onClose={onClose} title={variant.productName} subtitle={[label, variant.sku].filter(Boolean).join(' · ')}
      footer={canEdit && dirty ? <Button label="Save changes" size="lg" block onPress={save} /> : undefined}>
      <View style={{ gap: 16, paddingBottom: 10 }}>
        <Card flat style={{ alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF' }}>
          {bits ? <BarcodeView bits={bits} width={230} height={58} /> : null}
          <T v="caption" style={{ color: '#111', letterSpacing: 2 }}>{variant.barcode}</T>
        </Card>

        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          {variant.trackStock ? <Badge tone={variant.stock <= 0 ? 'danger' : variant.stock <= variant.reorderLevel ? 'warning' : 'success'}>{fmtQtyUnit(variant.stock, variant)} in stock</Badge> : <Badge>Not counted</Badge>}
          {variant.price > 0 ? <Badge tone="primary">{variant.price > 0 ? `${Math.round(marginPct(variant.price, variant.avgCost ?? variant.cost))}% margin` : ''}</Badge> : <Badge tone="warning">No price</Badge>}
        </View>

        <View style={{ gap: 14 }}>
          <MoneyField label={`Selling price${unitPer(variant)}`} value={price} onChange={setPrice} editable={canEdit} large />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><MoneyField label="MRP" value={mrp} onChange={setMrp} editable={canEdit} /></View>
            <View style={{ flex: 1 }}><MoneyField label="Cost" value={cost} onChange={setCost} editable={canEdit} /></View>
          </View>
          {variant.trackStock ? <NumberField label="Reorder level" value={reorder} onChange={setReorder} editable={canEdit} hint="Below this, it shows as low stock" /> : null}
        </View>

        {variant.avgCost !== undefined && variant.avgCost !== variant.cost ? <KV k="Average cost (all deliveries)" v={inr(variant.avgCost)} /> : null}

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {canStock && variant.trackStock ? <View style={{ flex: 1 }}><Button label="Adjust stock" kind="soft" block icon={<Boxes size={18} color={c.primary} />} onPress={() => { onClose(); setTimeout(() => onAdjust(variant), 250) }} /></View> : null}
        </View>

        <Card flat>
          <T v="label" tone="soft" style={{ marginBottom: 8 }}>PRINT {labels.item.toUpperCase()} LABELS</T>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-end' }}>
            <View style={{ width: 110 }}><NumberField label="Copies" value={copies} onChange={setCopies} /></View>
            <View style={{ flex: 1 }}><Button label="Print labels" kind="outline" block icon={<Printer size={18} color={c.ink} />} onPress={printLabels} /></View>
          </View>
        </Card>
      </View>
    </Sheet>
  )
}
