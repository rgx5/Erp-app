import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { pointsEarned } from '@/domain/checkout'
import { inr } from '@/domain/money'
import { useStore } from '@/data/hooks'
import { saveSettings, SettingsLocked, useCanSettings } from '@/features/settingsKit'
import { Button } from '@/ui/Button'
import { NumberField, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'

/** Loyalty points, the discount a cashier may give, and the stock and cost rules that apply everywhere. */
export default function LoyaltySettings() {
  const { c } = useTheme()
  const router = useRouter()
  const allowed = useCanSettings()
  const store = useStore()

  const [earn, setEarn] = useState(String(store.loyaltyEarnPct))
  const [redeem, setRedeem] = useState(String(store.loyaltyRedeemValue))
  const [maxDisc, setMaxDisc] = useState(String(store.maxCashierDiscountPct))
  const [low, setLow] = useState(String(store.lowStockDefault))
  const [basis, setBasis] = useState<'average' | 'latest'>(store.costBasis ?? 'average')
  const [tried, setTried] = useState(false)

  if (!allowed) return <SettingsLocked title="Loyalty & rules" />

  const e = Number(earn), r = Number(redeem), m = Number(maxDisc), l = Number(low)
  const errors = {
    earn: earn === '' || e < 0 || e > 100 ? 'Between 0 and 100' : null,
    redeem: redeem === '' || r < 0 || r > 100 ? 'Between ₹0 and ₹100' : null,
    max: maxDisc === '' || m < 0 || m > 100 ? 'Between 0 and 100' : null,
    low: low === '' || l < 0 ? 'Enter 0 or more' : null,
  }
  const dirty = e !== store.loyaltyEarnPct || r !== store.loyaltyRedeemValue || m !== store.maxCashierDiscountPct || l !== store.lowStockDefault || basis !== (store.costBasis ?? 'average')

  const points = pointsEarned(1000, e || 0)
  const worth = points * (r || 0)

  function save() {
    setTried(true)
    if (Object.values(errors).some(Boolean)) return
    if (saveSettings({ loyaltyEarnPct: e, loyaltyRedeemValue: r, maxCashierDiscountPct: m, lowStockDefault: Math.floor(l), costBasis: basis })) router.back()
  }

  return (
    <Screen title="Loyalty & rules" back footer={<Button label="Save changes" size="lg" block disabled={!dirty} onPress={save} />}>
      <View style={{ paddingBottom: 12 }}>
        <Section title="Loyalty points" style={{ marginTop: 6 }}>
          <Card>
            <View style={{ gap: 14 }}>
              <NumberField label="Points earned per ₹100 spent" value={earn} onChange={setEarn} decimals hint="0 turns loyalty off" error={tried ? errors.earn : null} />
              <NumberField label="Value of 1 point (₹)" value={redeem} onChange={setRedeem} decimals prefix="₹" error={tried ? errors.redeem : null} />
            </View>
            <View style={{ marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: c.primaryTint }}>
              <T v="caption" tone="soft">{e > 0 ? `A ₹1,000 bill earns ${points} points, worth ${inr(worth, 0)} on the next bill — about ${(((worth || 0) / 1000) * 100).toFixed(1)}% back.` : 'Loyalty is off — customers earn no points.'}</T>
            </View>
          </Card>
        </Section>

        <Section title="Discounts" style={{ marginTop: 24 }}>
          <NumberField label="Most a cashier may discount a bill (%)" value={maxDisc} onChange={setMaxDisc} decimals suffix="%" hint="Above this, a manager or owner has to approve." error={tried ? errors.max : null} />
        </Section>

        <Section title="Stock" style={{ marginTop: 24 }}>
          <NumberField label="Low-stock warning level" value={low} onChange={setLow} hint="Given to new items. Each item can have its own." error={tried ? errors.low : null} />
        </Section>

        <Section title="Profit reports" style={{ marginTop: 24 }}>
          <Segmented<'average' | 'latest'> value={basis} onChange={setBasis} options={[{ value: 'average', label: 'Average cost' }, { value: 'latest', label: 'Latest cost' }]} />
          <T v="caption" tone="mute" style={{ marginTop: 8 }}>{basis === 'average' ? 'Stock value and profit use the weighted average of everything you bought. Smoother, and what most accountants expect.' : 'Stock value and profit use what you paid on the most recent delivery.'}</T>
        </Section>
      </View>
    </Screen>
  )
}
