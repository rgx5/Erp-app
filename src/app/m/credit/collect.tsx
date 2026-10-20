import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { CustomerPicker } from '@/features/CustomerPicker'
import { allocateOldestFirst, receivables } from '@/modules/credit/logic'
import { recordCollection } from '@/modules/credit/ops'
import type { CollectionMode } from '@/modules/credit/types'
import { MODE_OPTIONS, REF_HINT } from '@/modules/credit/ui/modes'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Card, Chip, Tap } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, UserPlus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Receive money from a customer against what they owe. The oldest bills are settled first; anything over is kept as an advance. */
export default function Collect() {
  const { c, radius } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ customerId?: string; amount?: string }>()
  const can = useCan('collections')
  const data = useApp((s) => s.data)
  const customers = useList('customers')
  const [customerId, setCustomerId] = useState<string | null>(params.customerId ?? null)
  const [amount, setAmount] = useState(params.amount ?? '')
  const [mode, setMode] = useState<CollectionMode>('cash')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)

  const customer = customers.find((x) => x.id === customerId) ?? null
  const dues = useMemo(() => (customerId ? receivables(data).byCustomer[customerId] : undefined), [data, customerId])
  const open = useMemo(() => dues?.bills.filter((b) => b.outstanding > 0) ?? [], [dues])
  const amt = round2(Number(amount) || 0)
  const split = useMemo(() => allocateOldestFirst(open, amt), [open, amt])

  if (!can) return <Screen title="Collect payment" back><T tone="mute">Taking payments on account is for the owner, managers and cashiers.</T></Screen>

  function save() {
    if (saving || !customerId) return
    setSaving(true)
    try {
      const r = perform((s, ctx) => recordCollection(s, { customerId, amount: amt, mode, ref, note }, ctx))
      toast(`${r.collection.no} · ${inr(amt, 0)} received`, 'ok')
      router.back()
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not record the payment', 'err')
      setSaving(false)
    }
  }

  return (
    <Screen title="Collect payment" back footer={<Button label={amt > 0 ? `Receive ${inr(amt, 0)}` : 'Receive payment'} size="lg" block loading={saving} disabled={!customerId || !(amt > 0)} onPress={save} />}>
      <View style={{ gap: 18, paddingBottom: 12 }}>
        <Tap onPress={() => setPicking(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          {customer ? <Avatar name={customer.name} size={40} /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}><UserPlus size={18} color={c.primary} /></View>}
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{customer ? customer.name : 'Choose the customer'}</T>
            <T v="caption" tone="mute">{customer ? (dues && dues.net !== 0 ? (dues.net > 0 ? `Owes ${inr(dues.net, 0)}` : `${inr(-dues.net, 0)} paid in advance`) : 'Owes nothing') : 'Who is paying?'}</T>
          </View>
          <ChevronRight size={18} color={c.inkMute} />
        </Tap>

        <MoneyField label="Amount received" value={amount} onChange={setAmount} placeholder="0" large />
        {dues && dues.net > 0 ? <View style={{ flexDirection: 'row', gap: 8 }}><Chip label={`All ${inr(dues.net, 0)}`} onPress={() => setAmount(String(dues.net))} /></View> : null}

        <Section title="Received by" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => { setMode(m.value); setRef('') }} />)}
          </View>
        </Section>
        {mode !== 'cash' ? <Field value={ref} onChangeText={setRef} placeholder={REF_HINT[mode]} /> : null}
        <Field label="Note (optional)" value={note} onChangeText={setNote} />

        {customer && amt > 0 ? (
          <Section title="What it settles" style={{ marginTop: 0 }}>
            <Card>
              {split.allocations.map((a) => {
                const b = open.find((x) => x.billId === a.billId)
                return <KV key={a.billId} k={b?.no ?? 'Bill'} sub={b ? `Due ${fmtDayShort(b.dueDate)}` : undefined} v={inr(a.amount, 0)} />
              })}
              {split.advance > 0 ? <KV k="Kept as advance" sub="Used against the next bills" v={inr(split.advance, 0)} tone="success" /> : null}
              {!split.allocations.length && !split.advance ? <T tone="mute">Nothing to settle.</T> : null}
            </Card>
          </Section>
        ) : null}
        {customer && !open.length ? <Notice tone="primary" title="Nothing is owed on any bill" body="The money will be kept as an advance on this customer's account." /> : null}
      </View>
      <CustomerPicker visible={picking} onClose={() => setPicking(false)} selectedId={customerId} onPick={(cu) => setCustomerId(cu?.id ?? null)} />
    </Screen>
  )
}
