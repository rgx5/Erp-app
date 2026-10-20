import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr, round2 } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { CustomerPicker } from '@/features/CustomerPicker'
import { topUpStoreCredit } from '@/modules/credit/ops'
import type { CollectionMode } from '@/modules/credit/types'
import { MODE_OPTIONS, REF_HINT } from '@/modules/credit/ui/modes'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Chip, Tap } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, UserPlus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** A customer pays money in and gets the same amount as store credit, to spend on any bill. */
export default function Topup() {
  const { c, radius } = useTheme()
  const router = useRouter()
  const can = useCan('collections')
  const customers = useList('customers')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<CollectionMode>('cash')
  const [ref, setRef] = useState('')
  const [picking, setPicking] = useState(false)
  const customer = customers.find((x) => x.id === customerId) ?? null
  const amt = round2(Number(amount) || 0)

  if (!can) return <Screen title="Store-credit top-up" back><T tone="mute">Top-ups are for the owner, managers and cashiers.</T></Screen>

  function save() {
    if (!customerId) return
    try {
      const r = perform((s, ctx) => topUpStoreCredit(s, { customerId, amount: amt, mode, ref }, ctx))
      toast(`${r.topup.no} · ${inr(amt, 0)} added as store credit`, 'ok'); router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not add the credit', 'err') }
  }

  return (
    <Screen title="Store-credit top-up" back footer={<Button label={amt > 0 ? `Add ${inr(amt, 0)} credit` : 'Add credit'} size="lg" block disabled={!customerId || !(amt > 0)} onPress={save} />}>
      <View style={{ gap: 18, paddingBottom: 12 }}>
        <Tap onPress={() => setPicking(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          {customer ? <Avatar name={customer.name} size={40} /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}><UserPlus size={18} color={c.primary} /></View>}
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{customer ? customer.name : 'Choose the customer'}</T>
            <T v="caption" tone="mute">{customer ? `Has ${inr(customer.storeCredit, 0)} store credit` : 'Credit is kept on their account'}</T>
          </View>
          <ChevronRight size={18} color={c.inkMute} />
        </Tap>
        <MoneyField label="Amount paid in" value={amount} onChange={setAmount} placeholder="0" large />
        <Section title="Paid by" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODE_OPTIONS.filter((m) => m.value !== 'cheque').map((m) => <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => { setMode(m.value); setRef('') }} />)}
          </View>
        </Section>
        {mode !== 'cash' ? <Field value={ref} onChangeText={setRef} placeholder={REF_HINT[mode]} /> : null}
      </View>
      <CustomerPicker visible={picking} onClose={() => setPicking(false)} selectedId={customerId} onPick={(cu) => setCustomerId(cu?.id ?? null)} />
    </Screen>
  )
}
