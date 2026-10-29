import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useCart } from '@/features/cart'
import { MoneyField, Segmented } from '@/ui/Inputs'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { HandCoins } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import type { FoodCheckoutExtra } from '../hooks'
import type { TipMode } from '../types'
import { KIND_LABEL } from '../logic/orders'

const MODES: TipMode[] = ['cash', 'upi', 'card']

/** Shown only once a table, takeaway or delivery order has been loaded into the cart (see the settle screens): the order
 *  it is for, and a tip to add on top of the bill, collected separately from the sale. */
export function FoodCheckoutPanel({ moduleId }: { moduleId: string }) {
  const { c, radius } = useTheme()
  const extras = useCart((s) => s.extras)
  const setExtra = useCart((s) => s.setExtra)
  const extra = useMemo(() => (extras[moduleId] ?? {}) as FoodCheckoutExtra, [extras, moduleId])
  const [tipText, setTipText] = useState(extra.tip ? String(extra.tip) : '')

  if (!extra.orderIds?.length && !extra.deliveryId) return null

  const patch = (p: Partial<FoodCheckoutExtra>) => setExtra(moduleId, { ...extra, ...p })

  return (
    <Section title={extra.kind ? KIND_LABEL[extra.kind] : 'Order'} style={{ marginTop: 20 }}>
      <View style={{ gap: 10 }}>
        {extra.label ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <T v="bodyStrong">{extra.kind === 'dine_in' ? `Table ${extra.label}` : extra.label}</T>
          </View>
        ) : null}
        <MoneyField label="Tip (optional)" value={tipText} onChange={(t) => { setTipText(t); patch({ tip: Number(t) || undefined }) }} left={<HandCoins size={16} color={c.inkMute} />} />
        {Number(tipText) > 0 ? <Segmented value={extra.tipMode ?? 'cash'} onChange={(m) => patch({ tipMode: m })} options={MODES.map((m) => ({ value: m, label: m === 'upi' ? 'UPI' : m.charAt(0).toUpperCase() + m.slice(1) }))} /> : null}
      </View>
    </Section>
  )
}
