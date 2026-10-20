import React, { useState } from 'react'
import { View } from 'react-native'
import { fromInputDate, toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { useCart } from '@/features/cart'
import { Field, SwitchRow } from '@/ui/Inputs'
import { Notice, Section } from '@/ui/blocks'
import { Card } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Gift, HandCoins } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { checkGiftCard, normalizeCode } from '../giftcards'
import type { CreditExt } from '../hooks'
import { creditStatus, DAY, creditDaysFor } from '../logic'

/**
 * Checkout section: for a customer, where their account stands and when this sale is due if it goes on account; for a gift card,
 * its code and what is left on it. Saves into `bill.ext.credit` (the bill hook reads it). Shows nothing when neither applies.
 */
export function CreditCheckoutPanel({ moduleId }: { moduleId: string }) {
  const { c } = useTheme()
  const data = useApp((s) => s.data)
  const cart = useCart()
  const canOverride = useCan('bigDiscount')
  const ext = (cart.extras[moduleId] as CreditExt | undefined) ?? {}
  const [code, setCode] = useState(ext.giftCode ?? '')
  const customerId = cart.customerId
  const now = Date.now()
  const hasCards = Object.values(data.giftCards ?? {}).some((g) => g.active)
  if (!customerId && !hasCards) return null

  const set = (patch: Partial<CreditExt>) => cart.setExtra(moduleId, { ...ext, ...patch })
  const st = customerId ? creditStatus(data, customerId, now) : null
  const customer = customerId ? data.customers[customerId] : null
  const defaultDue = customerId ? now + creditDaysFor(data, customerId) * DAY : now
  const dueText = toInputDate(ext.dueDate ?? defaultDue)
  const dueOk = /^\d{4}-\d{2}-\d{2}$/.test(dueText)
  const check = hasCards && code.trim() ? checkGiftCard(data, code, now) : null

  return (
    <>
      {customer && st ? (
        <Section title="On account" style={{ marginTop: 20 }}>
          <Card>
            <View style={{ gap: 4 }}>
              <T v="body">{customer.name} owes {inr(Math.max(0, st.owed), 0)}{st.overdue > 0 ? ` · ${inr(st.overdue, 0)} overdue` : ''}{st.owed < 0 ? ` · ${inr(-st.owed, 0)} paid in advance` : ''}</T>
              <T v="caption" tone="mute">{st.blocked ? 'Not allowed to buy on account' : st.available === null ? 'No credit limit' : `Limit ${inr(st.limit, 0)} · ${inr(st.available, 0)} left`}</T>
            </View>
            {!st.blocked ? (
              <View style={{ marginTop: 12, gap: 10 }}>
                <Field label="If put on account, pay by" value={dueText} onChangeText={(t) => { const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? fromInputDate(t) : undefined; set({ dueDate: d }) }} placeholder="YYYY-MM-DD" error={dueOk ? null : 'Write the date as YYYY-MM-DD'} left={<HandCoins size={18} color={c.inkMute} />} />
                {st.limit > 0 && canOverride ? <SwitchRow title="Allow over the credit limit" subtitle="Manager approval for this bill" value={!!ext.override} onChange={(v) => set({ override: v })} /> : null}
              </View>
            ) : null}
          </Card>
        </Section>
      ) : null}
      {hasCards ? (
        <Section title="Gift card or voucher" style={{ marginTop: 20 }}>
          <View style={{ gap: 10 }}>
            <Field value={code} onChangeText={(t) => { setCode(normalizeCode(t)); set({ giftCode: normalizeCode(t) || undefined }) }} placeholder="Gift card code (then choose Gift card below)" autoCapitalize="characters" left={<Gift size={18} color={c.inkMute} />} />
            {check ? <Notice tone={check.problem ? 'danger' : 'success'} title={check.problem ?? `${inr(check.balance, 0)} on this card`} body={check.card?.expiresAt && !check.problem ? `Valid till ${toInputDate(check.card.expiresAt)}` : undefined} /> : null}
          </View>
        </Section>
      ) : null}
    </>
  )
}
