import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDate, fromInputDate, toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useStore } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { applyChanges, mergeChanges } from '@/data/state'
import { perform, useCan } from '@/data/store'
import { docTotal } from '@/modules/sales-docs/logic/lines'
import { buildInstalments } from '@/modules/sales-docs/logic/orders'
import { saveSalesOrder, takeOrderPayment, type PaymentInput } from '@/modules/sales-docs/ops'
import { CustomerRow, DateField, DocLinesEditor, DocTotals, isInputDate, useDiscount, useDocLines } from '@/modules/sales-docs/ui/forms'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

const DAY = 86_400_000
type Mode = PaymentInput['mode']

/** An order, advance booking or layaway: the customer, the goods being kept aside, and what is paid now. Edits an open order when given `?id=`. */
export default function NewOrder() {
  const router = useRouter()
  const { id: editId, customerId: presetCustomer } = useLocalSearchParams<{ id?: string; customerId?: string }>()
  const can = useCan('pos')
  const store = useStore()
  const existing = useList('salesOrders').find((o) => o.id === editId)

  const [customerId, setCustomerId] = useState<string | null>(existing?.customerId ?? presetCustomer ?? null)
  const doc = useDocLines(existing?.items)
  const discount = useDiscount(existing?.billDiscountType, existing?.billDiscountValue)
  const [expected, setExpected] = useState(existing?.expectedDate ? toInputDate(existing.expectedDate) : '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [plan, setPlan] = useState(!!existing?.instalments?.length)
  const [count, setCount] = useState(String(existing?.instalments?.length || 3))
  const [every, setEvery] = useState(() => {
    const ins = existing?.instalments
    return String(ins && ins.length > 1 ? Math.max(1, Math.round((ins[1].dueDate - ins[0].dueDate) / DAY)) : 30)
  })
  const [first, setFirst] = useState(toInputDate(existing?.instalments?.[0]?.dueDate ?? Date.now() + 30 * DAY))
  const [advance, setAdvance] = useState('')
  const [mode, setMode] = useState<Mode>('cash')
  const [busy, setBusy] = useState(false)

  const total = docTotal(doc.lines, discount.type, discount.value, store)
  const instalments = useMemo(() => (plan && total > 0 && isInputDate(first) ? buildInstalments(total, Number(count) || 1, fromInputDate(first), Math.max(1, Number(every) || 30)) : undefined), [plan, total, first, count, every])

  if (!can) return <Screen title="Order" back><T tone="mute">Orders are for people who use the billing counter.</T></Screen>

  function save() {
    if (expected && !isInputDate(expected)) { toast('Write the delivery date as YYYY-MM-DD', 'err'); return }
    if (plan && !isInputDate(first)) { toast('Write the first instalment date as YYYY-MM-DD', 'err'); return }
    setBusy(true)
    try {
      const paid = Number(advance) || 0
      const r = perform((s, ctx) => {
        const made = saveSalesOrder(s, {
          customerId: customerId ?? '', items: doc.lines, billDiscountType: discount.type, billDiscountValue: discount.value, notes,
          expectedDate: expected ? fromInputDate(expected) : undefined, instalments,
        }, existing?.id, ctx)
        // The order and its first payment go in together, so a refusal leaves nothing half-done.
        if (!(paid > 0) || existing) return made
        const pay = takeOrderPayment(applyChanges(s, made.changes), made.order.id, { amount: paid, mode }, ctx)
        return { order: made.order, changes: mergeChanges(made.changes, pay.changes) }
      })
      toast(`${r.order.no} saved`, 'ok')
      router.replace({ pathname: '/m/sales-docs/orders/[id]', params: { id: r.order.id } })
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not save the order', 'err')
      setBusy(false)
    }
  }

  return (
    <Screen title={existing ? `Edit ${existing.no}` : 'New order'} subtitle={doc.lines.length ? `${doc.lines.length} ${doc.lines.length === 1 ? 'line' : 'lines'} · ${inr(total)}` : undefined} back
      footer={<Button label={total > 0 ? `Save order · ${inr(total)}` : 'Save order'} size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 6, paddingBottom: 14 }}>
        <CustomerRow customerId={customerId} onChange={setCustomerId} />
        <Section title="Items" style={{ marginTop: 18 }}><DocLinesEditor doc={doc} /></Section>
        {doc.lines.length ? <Section title="Totals" style={{ marginTop: 18 }}><DocTotals lines={doc.lines} discount={discount} label="Order total" /></Section> : null}

        <Section title="Payment" style={{ marginTop: 18 }}>
          <View style={{ gap: 12 }}>
            <Card padded={false}>
              <SwitchRow title="Pay over time (layaway)" subtitle="Split the total into instalments the customer pays before collecting" value={plan} onChange={setPlan} />
            </Card>
            {plan ? (
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><NumberField label="Instalments" value={count} onChange={setCount} /></View>
                  <View style={{ flex: 1 }}><NumberField label="Days apart" value={every} onChange={setEvery} /></View>
                </View>
                <DateField label="First instalment due" value={first} onChange={setFirst} />
                {instalments ? <Card>{instalments.map((i, n) => <KV key={n} k={`${n + 1}. ${fmtDate(i.dueDate)}`} v={inr(i.amount)} />)}</Card> : null}
              </View>
            ) : null}
            {!existing ? (
              <View style={{ gap: 12 }}>
                <MoneyField label="Advance received now (optional)" value={advance} onChange={setAdvance} />
                {Number(advance) > 0 ? <Segmented<Mode> value={mode} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' }]} onChange={setMode} /> : null}
              </View>
            ) : null}
          </View>
        </Section>

        <Section title="Details" style={{ marginTop: 18 }}>
          <View style={{ gap: 14 }}>
            <DateField label="Delivery by" value={expected} onChange={setExpected} optional />
            <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
          </View>
        </Section>
      </View>
    </Screen>
  )
}
