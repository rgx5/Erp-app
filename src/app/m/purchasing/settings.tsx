import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { settingsOf } from '@/modules/purchasing/approvals'
import { savePurchaseSettings } from '@/modules/purchasing/ops-payables'
import { Button } from '@/ui/Button'
import { MoneyField, NumberField, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

/** Approval rules (who may approve how much), the usual days to pay suppliers, and how early to warn about payments. */
export default function PurchasingSettings() {
  const router = useRouter()
  const can = useCan('settings')
  const cur = useApp((s) => settingsOf(s.data))
  const [on, setOn] = useState(cur.approvalsOn)
  const [above, setAbove] = useState(String(cur.approvalAbove))
  const [manager, setManager] = useState(String(cur.limits.manager ?? 0))
  const [days, setDays] = useState(String(cur.defaultDays))
  const [remind, setRemind] = useState(String(cur.remindDays))

  if (!can) return <Screen title="Purchasing settings" back><T tone="mute">Purchasing settings are for the owner.</T></Screen>

  function save() {
    try {
      perform((s, ctx) => savePurchaseSettings(s, {
        approvalsOn: on, approvalAbove: Number(above) || 0, limits: { ...cur.limits, manager: Number(manager) || 0 }, defaultDays: Number(days) || 0, remindDays: Number(remind) || 0,
      }, ctx))
      toast('Saved', 'ok'); router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  return (
    <Screen title="Purchasing settings" back footer={<Button label="Save" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Section title="Approving purchase orders" style={{ marginTop: 0 }}>
          <View style={{ gap: 14 }}>
            <SwitchRow title="Orders need approval" subtitle="Big orders wait for someone with the authority" value={on} onChange={setOn} />
            {on ? (
              <>
                <MoneyField label="Approval needed above" value={above} onChange={setAbove} hint="Orders up to this amount can be sent by anyone" />
                <MoneyField label="A manager may approve up to" value={manager} onChange={setManager} hint="Above this, only the owner can approve. The owner has no limit." />
              </>
            ) : null}
          </View>
        </Section>
        <Section title="Paying suppliers" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <NumberField label="Usual days to pay" value={days} onChange={setDays} hint="For suppliers with no terms of their own" />
            <NumberField label="Days of warning" value={remind} onChange={setRemind} hint="How early Home warns about payments falling due" />
          </View>
        </Section>
      </View>
    </Screen>
  )
}
