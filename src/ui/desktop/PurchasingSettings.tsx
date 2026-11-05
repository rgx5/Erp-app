import React from 'react'
import { View } from 'react-native'
import { MoneyField, NumberField, SwitchRow } from '@/ui/Inputs'
import { Section } from '@/ui/blocks'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopPurchasingSettingsProps {
  on: boolean
  setOn: (v: boolean) => void
  above: string
  setAbove: (v: string) => void
  manager: string
  setManager: (v: string) => void
  days: string
  setDays: (v: string) => void
  remind: string
  setRemind: (v: string) => void
  onSave: () => void
}

/**
 * The desktop purchasing-settings form: the same approval and payment-terms fields the phone screen builds
 * (`src/app/m/purchasing/settings.tsx`), in `DesktopSettingsPage`'s shared shell. No settings logic lives here —
 * every value and `onSave` is computed once on the phone screen and passed down unchanged.
 */
export function DesktopPurchasingSettings({ on, setOn, above, setAbove, manager, setManager, days, setDays, remind, setRemind, onSave }: DesktopPurchasingSettingsProps) {
  return (
    <DesktopSettingsPage title="Purchasing settings" right={<DeskButton label="Save" tone="primary" onPress={onSave} />}>
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
      <Section title="Paying suppliers">
        <View style={{ gap: 14 }}>
          <NumberField label="Usual days to pay" value={days} onChange={setDays} hint="For suppliers with no terms of their own" />
          <NumberField label="Days of warning" value={remind} onChange={setRemind} hint="How early Home warns about payments falling due" />
        </View>
      </Section>
    </DesktopSettingsPage>
  )
}
