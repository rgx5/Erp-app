import React, { useState } from 'react'
import { Share, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fromInputDate } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { CustomerPicker } from '@/features/CustomerPicker'
import { issueGiftCard } from '@/modules/credit/ops'
import type { CollectionMode } from '@/modules/credit/types'
import { MODE_OPTIONS } from '@/modules/credit/ui/modes'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Chip, Tap } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Sell a gift card or voucher: the value is loaded on a new code and the money is taken now. */
export default function NewGiftCard() {
  const { c, radius } = useTheme()
  const router = useRouter()
  const can = useCan('collections')
  const shop = useApp((s) => s.data.store?.name ?? 'our shop')
  const customers = useList('customers')
  const [value, setValue] = useState('')
  const [mode, setMode] = useState<CollectionMode>('cash')
  const [code, setCode] = useState('')
  const [expires, setExpires] = useState('')
  const [note, setNote] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const customer = customers.find((x) => x.id === customerId) ?? null
  const amt = round2(Number(value) || 0)
  const dateOk = !expires || /^\d{4}-\d{2}-\d{2}$/.test(expires)

  if (!can) return <Screen title="Sell a gift card" back><T tone="mute">Gift cards are for the owner, managers and cashiers.</T></Screen>

  function save() {
    try {
      const r = perform((s, ctx) => issueGiftCard(s, { value: amt, mode, code, note, ...(customerId ? { customerId } : {}), ...(expires ? { expiresAt: fromInputDate(expires) } : {}) }, ctx))
      toast(`Gift card ${r.card.code} · ${inr(amt, 0)}`, 'ok')
      void Share.share({ message: `${shop} gift card for ${inr(amt, 0)}. Code: ${r.card.code}${r.card.expiresAt ? ` (valid till ${expires})` : ''}. Show this code at the counter to use it.` })
      router.replace({ pathname: '/m/credit/giftcards/[id]', params: { id: r.card.id } })
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not issue the card', 'err') }
  }

  return (
    <Screen title="Sell a gift card" back footer={<Button label={amt > 0 ? `Sell for ${inr(amt, 0)}` : 'Sell card'} size="lg" block disabled={!(amt > 0) || !dateOk} onPress={save} />}>
      <View style={{ gap: 18, paddingBottom: 12 }}>
        <MoneyField label="Value of the card" value={value} onChange={setValue} placeholder="0" large />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {[500, 1000, 2000, 5000].map((n) => <Chip key={n} label={inr(n, 0)} selected={amt === n} onPress={() => setValue(String(n))} />)}
        </View>
        <Section title="Paid by" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODE_OPTIONS.filter((m) => m.value !== 'cheque').map((m) => <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => setMode(m.value)} />)}
          </View>
        </Section>
        <Field label="Code (optional)" value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="Leave empty to make one" autoCapitalize="characters" />
        <Field label="Valid till (optional)" value={expires} onChangeText={setExpires} placeholder="YYYY-MM-DD" error={dateOk ? null : 'Write the date as YYYY-MM-DD'} />
        <Tap onPress={() => setPicking(true)} style={{ padding: 14, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          <T v="body" tone={customer ? 'default' : 'mute'}>{customer ? `For ${customer.name}` : 'For a customer (optional)'}</T>
        </Tap>
        <Field label="Note (optional)" value={note} onChangeText={setNote} />
      </View>
      <CustomerPicker visible={picking} onClose={() => setPicking(false)} selectedId={customerId} onPick={(cu) => setCustomerId(cu?.id ?? null)} />
    </Screen>
  )
}
