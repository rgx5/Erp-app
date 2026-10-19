import React from 'react'
import { View } from 'react-native'
import { inr0 } from '@/domain/money'
import { fmtQtyUnit } from '@/domain/qty'
import { needsPricing } from '@/domain/pricing'
import { variantLabel } from '@/domain/codes'
import type { ProductGroup } from '@/domain/search'
import { useLabels } from '@/data/hooks'
import { Button } from '@/ui/Button'
import { Sheet } from '@/ui/Sheet'
import { Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { useCart } from './cart'

/** All the options of one product (every size and colour) as tappable tiles with their stock; tap one to add it. */
export function VariantPicker({ group, visible, onClose, onAdd }: { group: ProductGroup | null; visible: boolean; onClose: () => void; onAdd: (variantId: string) => void }) {
  const { c, radius } = useTheme()
  const labels = useLabels()
  const lines = useCart((s) => s.lines)
  const inCart = new Map(lines.map((l) => [l.variantId, l.qty]))
  const colors = group ? [...new Set(group.variants.map((v) => v.color))] : []

  return (
    <Sheet visible={visible} onClose={onClose} title={group?.name} subtitle={[group?.brand, group?.styleCode].filter(Boolean).join(' · ')}
      footer={<Button label={lines.length ? `Done · ${lines.length} in cart` : 'Done'} size="lg" block onPress={onClose} />}>
      <View style={{ gap: 18, paddingBottom: 10 }}>
        {colors.map((color) => (
          <View key={color || 'none'} style={{ gap: 10 }}>
            {color ? <T v="label" tone="soft">{labels.option2.toUpperCase()} · {color.toUpperCase()}</T> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {group!.variants.filter((v) => v.color === color).map((v) => {
                const out = v.trackStock && v.stock <= 0
                const n = inCart.get(v.id) ?? 0
                const unpriced = needsPricing(v)
                return (
                  <Tap key={v.id} disabled={out} onPress={() => onAdd(v.id)}
                    style={{ minWidth: 92, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: n ? 1.5 : 1, borderColor: n ? c.primary : c.lineStrong, backgroundColor: n ? c.primaryTint : c.surface, gap: 2 }}>
                    <T v="bodyStrong" numberOfLines={1}>{variantLabel(v.size, '') || 'Standard'}</T>
                    <T v="caption" tone={out ? 'danger' : unpriced ? 'warning' : 'mute'}>{out ? 'Out of stock' : unpriced ? 'No price' : inr0(v.price)}</T>
                    {!out && v.trackStock ? <T v="micro" tone={v.stock <= v.reorderLevel ? 'warning' : 'mute'}>{fmtQtyUnit(v.stock, v)} left</T> : null}
                    {n ? <View style={{ position: 'absolute', top: -7, right: -7, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}><T v="micro" style={{ color: c.onPrimary }} fixed>{n}</T></View> : null}
                  </Tap>
                )
              })}
            </View>
          </View>
        ))}
      </View>
    </Sheet>
  )
}
