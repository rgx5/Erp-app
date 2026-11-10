import React from 'react'
import { Pressable, View } from 'react-native'
import { inr } from '@/domain/money'
import type { Customer } from '@/domain/types'
import type { CollectionMode } from '@/modules/credit/types'
import { MODE_OPTIONS, REF_HINT } from '@/modules/credit/ui/modes'
import { Field, MoneyField } from '@/ui/Inputs'
import { Chip } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { ChevronRight, UserPlus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, dtext } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopTopupProps {
  customer: Customer | null
  onPickCustomer: () => void
  amount: string; setAmount: (v: string) => void
  mode: CollectionMode; setMode: (v: CollectionMode) => void
  ref: string; setRef: (v: string) => void
  amt: number
  canSave: boolean
  onSave: () => void
}

/** The desktop Store-credit top-up form: the same centred-column shell around the exact same customer picker, amount and mode fields. */
export function DesktopTopup(p: DesktopTopupProps) {
  const { c, radius } = useTheme()
  return (
    <DesktopSettingsPage title="Store-credit top-up" right={<DeskButton label={p.amt > 0 ? `Add ${inr(p.amt, 0)} credit` : 'Add credit'} tone="primary" disabled={!p.canSave} onPress={p.onSave} />}>
      <View style={{ gap: 18 }}>
        <Pressable onPress={p.onPickCustomer} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}><UserPlus size={18} color={c.primary} /></View>
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{p.customer ? p.customer.name : 'Choose the customer'}</T>
            <T v="caption" tone="mute">{p.customer ? `Has ${inr(p.customer.storeCredit, 0)} store credit` : 'Credit is kept on their account'}</T>
          </View>
          <ChevronRight size={18} color={c.inkMute} />
        </Pressable>
        <MoneyField label="Amount paid in" value={p.amount} onChange={p.setAmount} placeholder="0" large />
        <View style={{ gap: 8 }}>
          <T style={[dtext.label, { color: c.inkMute }]}>Paid by</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODE_OPTIONS.filter((m) => m.value !== 'cheque').map((m) => <Chip key={m.value} label={m.label} selected={p.mode === m.value} onPress={() => { p.setMode(m.value); p.setRef('') }} />)}
          </View>
        </View>
        {p.mode !== 'cash' ? <Field value={p.ref} onChangeText={p.setRef} placeholder={REF_HINT[p.mode]} /> : null}
      </View>
    </DesktopSettingsPage>
  )
}
