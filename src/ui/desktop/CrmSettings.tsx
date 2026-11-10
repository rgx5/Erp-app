import React from 'react'
import { View } from 'react-native'
import { Field, MoneyField, NumberField } from '@/ui/Inputs'
import { Card, Tap } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { Close, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { Button } from '@/ui/Button'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

interface TierRow { name: string; minSpend: string; perk: string }

export interface DesktopCrmSettingsProps {
  high: string; setHigh: (v: string) => void
  normal: string; setNormal: (v: string) => void
  low: string; setLow: (v: string) => void
  warranty: string; setWarranty: (v: string) => void
  window: string; setWindow: (v: string) => void
  tiers: TierRow[]; setTiers: (v: TierRow[]) => void
  credit: string; setCredit: (v: string) => void
  points: string; setPoints: (v: string) => void
  friend: string; setFriend: (v: string) => void
  minBill: string; setMinBill: (v: string) => void
  standardTiers: TierRow[]
  onSave: () => void
}

/**
 * The desktop CRM settings form: the same centred-column shell every desktop form uses, around the exact same
 * fields the phone `m/crm/settings.tsx` already validates and saves — this file only re-lays them out, it does not
 * touch the screen's state or selectors.
 */
export function DesktopCrmSettings(p: DesktopCrmSettingsProps) {
  const { c } = useTheme()
  const set = (i: number, patch: Partial<TierRow>) => p.setTiers(p.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  return (
    <DesktopSettingsPage title="CRM settings" right={<DeskButton label="Save" tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <Section title="Time to settle a ticket (hours)" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><NumberField label="High" value={p.high} onChange={p.setHigh} /></View>
            <View style={{ flex: 1 }}><NumberField label="Normal" value={p.normal} onChange={p.setNormal} /></View>
            <View style={{ flex: 1 }}><NumberField label="Low" value={p.low} onChange={p.setLow} /></View>
          </View>
        </Section>
        <Section title="Warranty" style={{ marginTop: 6 }}>
          <NumberField label="Months from the bill" value={p.warranty} onChange={p.setWarranty} hint="Used to tell whether a claim is inside warranty." />
        </Section>
        <Section title="Membership tiers" action="Add tier" onAction={() => p.setTiers([...p.tiers, { name: '', minSpend: '', perk: '' }])} style={{ marginTop: 6 }}>
          <NumberField label="Count spend over the last … days" value={p.window} onChange={p.setWindow} />
          {p.tiers.map((t, i) => (
            <Card key={i} style={{ marginTop: 10 }}>
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
                  <View style={{ flex: 1 }}><Field label="Name" value={t.name} onChangeText={(v) => set(i, { name: v })} autoCapitalize="words" /></View>
                  <View style={{ flex: 1 }}><MoneyField label="Spend from" value={t.minSpend} onChange={(v) => set(i, { minSpend: v })} /></View>
                  <Tap onPress={() => p.setTiers(p.tiers.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel="Remove tier" style={{ paddingBottom: 14 }}><Close size={18} color={c.inkMute} /></Tap>
                </View>
                <Field label="Perk (shown to staff)" value={t.perk} onChangeText={(v) => set(i, { perk: v })} placeholder="5% off, free alteration" autoCapitalize="sentences" />
              </View>
            </Card>
          ))}
          {!p.tiers.length ? <Button label="Use the standard tiers" kind="soft" icon={<Plus size={16} color={c.primary} />} onPress={() => p.setTiers(p.standardTiers)} /> : null}
        </Section>
        <Section title="Referral reward" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <MoneyField label="Store credit to the customer who referred" value={p.credit} onChange={p.setCredit} />
            <NumberField label="Loyalty points to them" value={p.points} onChange={p.setPoints} />
            <MoneyField label="Store credit to the new customer" value={p.friend} onChange={p.setFriend} />
            <MoneyField label="Given once the new customer has bought" value={p.minBill} onChange={p.setMinBill} />
          </View>
        </Section>
      </View>
    </DesktopSettingsPage>
  )
}
