import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { saveCreditSettings } from '@/modules/credit/ops'
import type { CreditSettings } from '@/modules/credit/types'
import { isUpiId } from '@/modules/credit/upi'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

/** The shop's UPI id (for QR codes and links), the usual days to pay, and the wording of reminders. */
export default function CreditSettingsScreen() {
  const router = useRouter()
  const can = useCan('credit')
  const cur = useApp((s) => s.data.creditSettings?.credit)
  const shop = useApp((s) => s.data.store?.name ?? '')
  const [upiId, setUpiId] = useState(cur?.upiId ?? '')
  const [payee, setPayee] = useState(cur?.payeeName ?? shop)
  const [days, setDays] = useState(String(cur?.defaultDays ?? 30))
  const [tone, setTone] = useState<CreditSettings['reminderTone']>(cur?.reminderTone ?? 'polite')

  if (!can) return <Screen title="Credit settings" back><T tone="mute">Credit settings are for the owner and managers.</T></Screen>
  const upiBad = !!upiId.trim() && !isUpiId(upiId)

  function save() {
    try {
      perform((s, ctx) => saveCreditSettings(s, { upiId, payeeName: payee, defaultDays: Number(days), reminderTone: tone }, ctx))
      toast('Saved', 'ok'); router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  return (
    <Screen title="Credit settings" back footer={<Button label="Save" size="lg" block disabled={upiBad} onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Section title="Getting paid by UPI" style={{ marginTop: 0 }}>
          <View style={{ gap: 14 }}>
            <Field label="Your UPI id" value={upiId} onChangeText={setUpiId} placeholder="shop@bank" autoCapitalize="none" error={upiBad ? 'A UPI id looks like shop@bank' : null} hint="QR codes and payment links send money to this id." />
            <Field label="Name shown to the payer" value={payee} onChangeText={setPayee} />
          </View>
        </Section>
        <Section title="Credit" style={{ marginTop: 6 }}>
          <NumberField label="Usual days to pay" value={days} onChange={setDays} hint="For customers with no terms of their own" />
        </Section>
        <Section title="Reminders" style={{ marginTop: 6 }}>
          <Segmented value={tone} options={[{ value: 'polite', label: 'Polite' }, { value: 'firm', label: 'Firm' }]} onChange={setTone} />
        </Section>
      </View>
    </Screen>
  )
}
