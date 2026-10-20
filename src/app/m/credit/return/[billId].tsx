import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { inr, round2 } from '@/domain/money'
import { fmtQty, fmtQtyUnit, qtyStep, rulesOfBillItem, round3 } from '@/domain/qty'
import { creditNotesFor, planReturn } from '@/domain/returns'
import { useIndustry, useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { receivables } from '@/modules/credit/logic'
import { returnOnAccount } from '@/modules/credit/ops'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Tap } from '@/ui/primitives'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/**
 * Return goods from a bill that is still partly unpaid. What the customer owes comes down first; only what was really paid is
 * handed back as cash — the shop never pays out for goods that were never paid for.
 */
export default function ReturnOnAccount() {
  const { c } = useTheme()
  const router = useRouter()
  const { billId } = useLocalSearchParams<{ billId: string }>()
  const can = useCan('pos')
  const pack = useIndustry()
  const bills = useList('bills')
  const data = useApp((s) => s.data)
  const bill = bills.find((b) => b.id === billId)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [reason, setReason] = useState(pack.returnReasons[0] ?? '')

  const lines = Object.entries(qty).map(([variantId, q]) => ({ variantId, qty: q })).filter((l) => l.qty > 0)
  const plan = useMemo(() => (bill ? planReturn(bill, creditNotesFor(bills, bill.id), lines) : null), [bill, bills, qty]) // eslint-disable-line react-hooks/exhaustive-deps
  const owed = bill?.customerId ? receivables(data).byCustomer[bill.customerId]?.bills.find((b) => b.billId === bill.id)?.outstanding ?? 0 : 0

  if (!can) return <Screen title="Return goods" back><T tone="mute">Returns are for people who can take sales.</T></Screen>
  if (!bill) return <Screen title="Not found" back><T tone="mute">This bill is no longer here.</T></Screen>

  const against = plan ? round2(Math.min(plan.total, owed)) : 0
  function submit() {
    try {
      const r = perform((s, ctx) => returnOnAccount(s, bill!.id, lines, ctx, reason))
      toast(`${r.creditNote.no} — ${inr(r.reducedDue, 0)} off what is owed${r.cashRefund ? `, ${inr(r.cashRefund, 0)} back in cash` : ''}`, 'ok')
      router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not process the return', 'err') }
  }

  return (
    <Screen title="Return goods" subtitle={`Against ${bill.no}`} back
      footer={<Button label={plan ? `Return · ${inr(plan.total, 0)}` : 'Choose what is coming back'} size="lg" block disabled={!plan} onPress={submit} />}>
      <View style={{ gap: 16, paddingBottom: 10 }}>
        <Notice tone="primary" title={`${inr(owed, 0)} is still owed on this bill`} body="The return comes off that first." />
        <View style={{ gap: 10 }}>
          {bill.items.map((it) => {
            const left = round3(it.qty - it.returnedQty)
            const r = rulesOfBillItem(it)
            const step = qtyStep(r)
            const q = qty[it.variantId] ?? 0
            return (
              <View key={it.variantId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: left <= 0 ? 0.45 : 1 }}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong" numberOfLines={1}>{it.name}</T>
                  <T v="caption" tone="mute">{[variantLabel(it.size, it.color), left > 0 ? `${fmtQtyUnit(left, r)} to return` : 'All returned'].filter(Boolean).join(' · ')}</T>
                </View>
                {left > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Tap onPress={() => setQty({ ...qty, [it.variantId]: Math.max(0, round3(q - step)) })} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.sunken, alignItems: 'center', justifyContent: 'center' }}><T v="h2">−</T></Tap>
                    <T v="num" style={{ minWidth: 28, textAlign: 'center' }}>{fmtQty(q)}</T>
                    <Tap onPress={() => setQty({ ...qty, [it.variantId]: Math.min(left, round3(q + step)) })} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}><T v="h2" tone="primary">+</T></Tap>
                  </View>
                ) : null}
              </View>
            )
          })}
        </View>
        <Select label="Reason" value={reason} options={pack.returnReasons.map((x) => ({ value: x, label: x }))} onChange={setReason} />
        {plan ? (
          <Card flat>
            <KV k="Value of the goods" v={inr(plan.total, 2)} strong />
            <KV k="Taken off what is owed" v={inr(against, 2)} tone="success" />
            {plan.total - against > 0 ? <KV k="Handed back in cash" v={inr(round2(plan.total - against), 2)} /> : null}
          </Card>
        ) : null}
      </View>
    </Screen>
  )
}
