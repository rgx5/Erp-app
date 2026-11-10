import React from 'react'
import { View } from 'react-native'
import type { CreditSettings } from '@/modules/credit/types'
import { Field, NumberField, Segmented } from '@/ui/Inputs'
import { Section } from '@/ui/blocks'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopCreditSettingsProps {
  upiId: string; setUpiId: (v: string) => void
  payee: string; setPayee: (v: string) => void
  days: string; setDays: (v: string) => void
  tone: CreditSettings['reminderTone']; setTone: (v: CreditSettings['reminderTone']) => void
  upiBad: boolean
  onSave: () => void
}

/** The desktop Credit settings form: the same centred-column shell around the UPI id, default days and reminder tone. */
export function DesktopCreditSettings(p: DesktopCreditSettingsProps) {
  return (
    <DesktopSettingsPage title="Credit settings" right={<DeskButton label="Save" tone="primary" disabled={p.upiBad} onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <Section title="Getting paid by UPI" style={{ marginTop: 0 }}>
          <View style={{ gap: 14 }}>
            <Field label="Your UPI id" value={p.upiId} onChangeText={p.setUpiId} placeholder="shop@bank" autoCapitalize="none" error={p.upiBad ? 'A UPI id looks like shop@bank' : null} hint="QR codes and payment links send money to this id." />
            <Field label="Name shown to the payer" value={p.payee} onChangeText={p.setPayee} />
          </View>
        </Section>
        <Section title="Credit" style={{ marginTop: 6 }}>
          <NumberField label="Usual days to pay" value={p.days} onChange={p.setDays} hint="For customers with no terms of their own" />
        </Section>
        <Section title="Reminders" style={{ marginTop: 6 }}>
          <Segmented value={p.tone} options={[{ value: 'polite', label: 'Polite' }, { value: 'firm', label: 'Firm' }]} onChange={p.setTone} />
        </Section>
      </View>
    </DesktopSettingsPage>
  )
}
