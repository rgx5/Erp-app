import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { perform, useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Tap } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Close, Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { saveCrmSettings } from '@/modules/crm/ops'
import { settingsOf } from '@/modules/crm/settings'
import { failWith } from '@/modules/crm/ui/forms'

interface TierRow { name: string; minSpend: string; perk: string }

/** How long tickets may take, how long a warranty runs, the membership tiers and the referral reward. */
export default function CrmSettingsScreen() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('crm')
  const cur = useApp((s) => settingsOf(s.data))
  const [high, setHigh] = useState(String(cur.slaHours.high))
  const [normal, setNormal] = useState(String(cur.slaHours.normal))
  const [low, setLow] = useState(String(cur.slaHours.low))
  const [warranty, setWarranty] = useState(String(cur.warrantyMonths))
  const [window, setWindow] = useState(String(cur.tierWindowDays))
  const [tiers, setTiers] = useState<TierRow[]>(cur.tiers.map((t) => ({ name: t.name, minSpend: String(t.minSpend), perk: t.perk })))
  const [credit, setCredit] = useState(String(cur.referrerCredit))
  const [points, setPoints] = useState(String(cur.referrerPoints))
  const [friend, setFriend] = useState(String(cur.refereeCredit))
  const [minBill, setMinBill] = useState(String(cur.referralMinBill))

  if (!can) return <Screen title="CRM settings" back><T tone="mute">These settings are for the owner and managers.</T></Screen>
  const set = (i: number, patch: Partial<TierRow>) => setTiers(tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  function save() {
    try {
      perform((s, ctx) => saveCrmSettings(s, {
        slaHours: { high: Number(high), normal: Number(normal), low: Number(low) }, warrantyMonths: Number(warranty), tierWindowDays: Number(window),
        tiers: tiers.map((t) => ({ name: t.name, minSpend: Number(t.minSpend) || 0, perk: t.perk })), referrerCredit: Number(credit) || 0, referrerPoints: Number(points) || 0,
        refereeCredit: Number(friend) || 0, referralMinBill: Number(minBill) || 0,
      }, ctx))
      toast('Saved', 'ok'); router.back()
    } catch (e) { failWith(e) }
  }
  return (
    <Screen title="CRM settings" back footer={<Button label="Save" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Section title="Time to settle a ticket (hours)" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}><NumberField label="High" value={high} onChange={setHigh} /></View>
            <View style={{ flex: 1 }}><NumberField label="Normal" value={normal} onChange={setNormal} /></View>
            <View style={{ flex: 1 }}><NumberField label="Low" value={low} onChange={setLow} /></View>
          </View>
        </Section>
        <Section title="Warranty" style={{ marginTop: 6 }}>
          <NumberField label="Months from the bill" value={warranty} onChange={setWarranty} hint="Used to tell whether a claim is inside warranty." />
        </Section>
        <Section title="Membership tiers" action="Add tier" onAction={() => setTiers([...tiers, { name: '', minSpend: '', perk: '' }])} style={{ marginTop: 6 }}>
          <NumberField label="Count spend over the last … days" value={window} onChange={setWindow} />
          {tiers.map((t, i) => (
            <Card key={i} style={{ marginTop: 10 }}>
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
                  <View style={{ flex: 1 }}><Field label="Name" value={t.name} onChangeText={(v) => set(i, { name: v })} autoCapitalize="words" /></View>
                  <View style={{ flex: 1 }}><MoneyField label="Spend from" value={t.minSpend} onChange={(v) => set(i, { minSpend: v })} /></View>
                  <Tap onPress={() => setTiers(tiers.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel="Remove tier" style={{ paddingBottom: 14 }}><Close size={18} color={c.inkMute} /></Tap>
                </View>
                <Field label="Perk (shown to staff)" value={t.perk} onChangeText={(v) => set(i, { perk: v })} placeholder="5% off, free alteration" autoCapitalize="sentences" />
              </View>
            </Card>
          ))}
          {!tiers.length ? <Button label="Use the standard tiers" kind="soft" icon={<Plus size={16} color={c.primary} />} onPress={() => setTiers(cur.tiers.map((t) => ({ name: t.name, minSpend: String(t.minSpend), perk: t.perk })))} /> : null}
        </Section>
        <Section title="Referral reward" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <MoneyField label="Store credit to the customer who referred" value={credit} onChange={setCredit} />
            <NumberField label="Loyalty points to them" value={points} onChange={setPoints} />
            <MoneyField label="Store credit to the new customer" value={friend} onChange={setFriend} />
            <MoneyField label="Given once the new customer has bought" value={minBill} onChange={setMinBill} />
          </View>
        </Section>
      </View>
    </Screen>
  )
}
