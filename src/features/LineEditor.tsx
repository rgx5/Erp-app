import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { CartLine } from '@/domain/cart'
import { variantLabel } from '@/domain/codes'
import { inr } from '@/domain/money'
import { minQtyOf, unitPer, unitSuffix } from '@/domain/qty'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Chip } from '@/ui/primitives'
import { MoneyField, Segmented, Stepper, SwitchRow } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { useCart } from './cart'
import { firstName } from '@/domain/people'
import { PanelSlot } from '@/modules/PanelSlot'

/** Edit one cart line: quantity, price (managers), discount (capped for cashiers) and who sold it. */
export function LineEditor({ variantId, onClose }: { variantId: string | null; onClose: () => void }) {
  const { c } = useTheme()
  const patch = useCart((s) => s.patchLine)
  const remove = useCart((s) => s.remove)
  const staff = useList('users').filter((u) => u.active)
  const cartStaff = useCart((s) => s.staffId)
  const me = useApp((s) => s.session?.userId)
  const defaultStaff = cartStaff || me || ''
  // Subscribe to the line itself so every change (a stepper tap, a typed price) redraws the sheet.
  const live = useCart((s) => s.lines.find((l) => l.variantId === variantId)) as CartLine | undefined
  const canPrice = useCan('bigDiscount')
  const maxPct = useApp((s) => s.data.store?.maxCashierDiscountPct ?? 10)
  const [price, setPrice] = useState('')
  const [disc, setDisc] = useState('')

  useEffect(() => {
    const l = useCart.getState().lines.find((x) => x.variantId === variantId)
    if (l) { setPrice(String(l.price || '')); setDisc(l.discountValue ? String(l.discountValue) : '') }
  }, [variantId])

  if (!live) return <Sheet visible={false} onClose={onClose} />
  const overCap = !canPrice && live.discountType === 'pct' && live.discountValue > maxPct
  const priceLocked = !canPrice && !live.unpricedSale

  return (
    <Sheet visible onClose={onClose} title={live.name} subtitle={[variantLabel(live.size, live.color), live.sku].filter(Boolean).join(' · ')}
      footer={<View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="Remove" kind="danger" icon={<Trash size={18} color={c.danger} />} onPress={() => { remove(live.variantId); onClose() }} />
        <View style={{ flex: 1 }}><Button label="Done" size="md" block onPress={onClose} /></View>
      </View>}>
      <View style={{ gap: 18, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <T v="label" tone="soft">QUANTITY{unitSuffix(live) ? ` (${unitSuffix(live).trim()})` : ''}</T>
            <T v="caption" tone="mute">{live.noStock ? 'Not counted in stock' : `${live.stock} available`}</T>
          </View>
          <Stepper value={live.qty} onChange={(n) => patch(live.variantId, { qty: n })} rules={live} min={minQtyOf(live)} max={live.noStock ? undefined : live.stock} />
        </View>

        <MoneyField label={`Price${unitPer(live)}${live.unpricedSale ? ' — not set in the system' : ''}`} value={price}
          onChange={(v) => { setPrice(v); const n = Number(v); patch(live.variantId, { price: Number.isFinite(n) ? n : 0, mrp: Math.max(live.mrp, Number.isFinite(n) ? n : 0), priceOverridden: !live.unpricedSale && n !== live.price ? true : live.priceOverridden }) }}
          editable={!priceLocked} hint={priceLocked ? 'Only a manager can change the price.' : live.unpricedSale ? 'Type the price for this sale.' : `Tag price ${inr(live.mrp)}`} />

        {live.unpricedSale && canPrice ? <SwitchRow title="Keep this price for the item" subtitle="Saves it so the next sale is priced" value={!!live.savePrice} onChange={(v) => patch(live.variantId, { savePrice: v })} /> : null}

        {!live.noDiscount ? (
          <View style={{ gap: 8 }}>
            <T v="label" tone="soft">DISCOUNT</T>
            <Segmented compact value={live.discountType} options={[{ value: 'amt', label: '₹ off' }, { value: 'pct', label: '% off' }]} onChange={(t) => patch(live.variantId, { discountType: t })} />
            <MoneyField value={disc} onChange={(v) => { setDisc(v); patch(live.variantId, { discountValue: Number(v) || 0 }) }} placeholder="0"
              error={overCap ? `Cashiers can give up to ${maxPct}%. Ask a manager for more.` : null} />
          </View>
        ) : <T v="caption" tone="mute">No discount applies to this item.</T>}

        {staff.length > 1 ? (
          <View style={{ gap: 8 }}>
            <T v="label" tone="soft">SOLD BY</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {staff.map((u) => <Chip key={u.id} label={`${u.code ? u.code + ' · ' : ''}${firstName(u.name)}`} selected={(live.staffId || defaultStaff) === u.id} onPress={() => patch(live.variantId, { staffId: u.id === defaultStaff ? undefined : u.id })} />)}
            </View>
          </View>
        ) : null}
        <PanelSlot slot="line" line={live} patch={(pt) => patch(live.variantId, pt)} />
      </View>
    </Sheet>
  )
}
