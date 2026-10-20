import React, { useState } from 'react'
import { Share, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { fmtDateTime, fmtDayShort } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { giftCardBalance, txnsOf } from '@/modules/credit/giftcards'
import { cancelGiftCard, rechargeGiftCard } from '@/modules/credit/ops'
import type { CollectionMode } from '@/modules/credit/types'
import { MODE_OPTIONS } from '@/modules/credit/ui/modes'
import { QrCode } from '@/modules/credit/ui/QrCode'
import { Button } from '@/ui/Button'
import { MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { KV, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Share as ShareIcon, XCircle } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const WORD = { issue: 'Loaded', redeem: 'Spent', refund: 'Refunded' } as const

/** One gift card: its code (and a QR of it), the balance, every movement, and top-up or cancel. */
export default function GiftCardPage() {
  const { c } = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('collections')
  const data = useApp((s) => s.data)
  const shop = data.store?.name ?? 'our shop'
  const card = data.giftCards?.[id]
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<CollectionMode>('cash')

  if (!can) return <Screen title="Gift card" back><T tone="mute">Gift cards are for the owner, managers and cashiers.</T></Screen>
  if (!card) return <Screen title="Not found" back><T tone="mute">This gift card is no longer here.</T></Screen>
  const balance = giftCardBalance(data, card.id)
  const txns = txnsOf(data, card.id)
  const expired = !!card.expiresAt && card.expiresAt < Date.now()

  function recharge() {
    try {
      perform((s, ctx) => rechargeGiftCard(s, card!.id, round2(Number(amount) || 0), mode, ctx))
      toast('Added to the card', 'ok'); setAdding(false); setAmount('')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not add', 'err') }
  }
  async function cancel() {
    if (!(await ask({ title: `Cancel ${card!.code}?`, message: `${inr(balance, 0)} on it can no longer be spent.`, confirm: 'Cancel card', danger: true }))) return
    try { perform((s, ctx) => cancelGiftCard(s, card!.id, ctx)); toast('Card cancelled', 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not cancel', 'err') }
  }

  return (
    <Screen title={card.code} subtitle="Gift card" back
      right={!card.active ? <Badge tone="danger">Cancelled</Badge> : expired ? <Badge tone="warning">Expired</Badge> : undefined}
      footer={card.active ? <Button label="Add money to the card" size="lg" block icon={<Plus size={18} color={c.onPrimary} />} onPress={() => setAdding(true)} /> : undefined}>
      <View style={{ gap: 4, paddingBottom: 16 }}>
        <Card>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <QrCode value={card.code} size={168} />
            <T v="h2">{card.code}</T>
          </View>
          <KV k="Balance" v={inr(balance, 0)} strong big />
          {data.customers[card.customerId ?? ''] ? <KV k="For" v={data.customers[card.customerId!].name} /> : null}
          {card.expiresAt ? <KV k="Valid till" v={fmtDayShort(card.expiresAt)} /> : null}
          {card.note ? <T v="caption" tone="mute">{card.note}</T> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Button label="Share code" kind="soft" size="sm" icon={<ShareIcon size={15} color={c.primary} />} onPress={() => void Share.share({ message: `${shop} gift card. Code: ${card.code}. Balance ${inr(balance, 0)}.` })} />
            {card.active ? <Button label="Cancel card" kind="danger" size="sm" icon={<XCircle size={15} color={c.onPrimary} />} onPress={() => void cancel()} /> : null}
          </View>
        </Card>
        <Section title="History">
          <Card padded={false}>
            {txns.map((t) => <ListRow key={t.id} dense title={WORD[t.type]} subtitle={`${fmtDateTime(t.date)}${t.note ? ` · ${t.note}` : ''}`} value={`${t.type === 'redeem' ? '−' : '+'}${inr(t.amount, 0)}`} valueTone={t.type === 'redeem' ? 'default' : 'success'} />)}
          </Card>
        </Section>
      </View>
      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add money" subtitle={card.code} footer={<Button label="Add" size="lg" block disabled={!(Number(amount) > 0)} onPress={recharge} />}>
        <View style={{ gap: 14 }}>
          <MoneyField label="Amount" value={amount} onChange={setAmount} placeholder="0" large />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODE_OPTIONS.filter((m) => m.value !== 'cheque').map((m) => <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => setMode(m.value)} />)}
          </View>
        </View>
      </Sheet>
    </Screen>
  )
}
