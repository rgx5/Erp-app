import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fromInputDate, toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useStore } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { docTotal } from '@/modules/sales-docs/logic/lines'
import { FREQUENCY_LABEL } from '@/modules/sales-docs/logic/subscriptions'
import { hasOnAccount, saveSubscription } from '@/modules/sales-docs/ops'
import { CustomerRow, DateField, DocLinesEditor, isInputDate, useDocLines } from '@/modules/sales-docs/ui/forms'
import type { Frequency, SubPayMode, SubscriptionKind } from '@/modules/sales-docs/types'
import { Button } from '@/ui/Button'
import { Field, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

/** A recurring invoice or an AMC contract. Edits one when given `?id=`. */
export default function NewPlan() {
  const router = useRouter()
  const { id: editId, kind: presetKind } = useLocalSearchParams<{ id?: string; kind?: string }>()
  const can = useCan('salesDocs')
  const store = useStore()
  const existing = useList('subscriptions').find((x) => x.id === editId)

  const [kind, setKind] = useState<SubscriptionKind>(existing?.kind ?? (presetKind === 'amc' ? 'amc' : 'subscription'))
  const [customerId, setCustomerId] = useState<string | null>(existing?.customerId ?? null)
  const doc = useDocLines(existing?.items)
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? 'monthly')
  const [start, setStart] = useState(toInputDate(existing?.startDate ?? Date.now()))
  const [end, setEnd] = useState(existing?.endDate ? toInputDate(existing.endDate) : '')
  const [payMode, setPayMode] = useState<SubPayMode>(existing?.payMode ?? (hasOnAccount() ? 'due' : 'cash'))
  const [coverage, setCoverage] = useState(existing?.coverage ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [busy, setBusy] = useState(false)

  if (!can) return <Screen title="Plan" back><T tone="mute">Recurring billing is for the owner and managers.</T></Screen>
  const each = docTotal(doc.lines, 'amt', 0, store)
  const locked = !!existing?.billCount

  function save() {
    if (!isInputDate(start) || (end && !isInputDate(end))) { toast('Write the dates as YYYY-MM-DD', 'err'); return }
    setBusy(true)
    try {
      const r = perform((s, ctx) => saveSubscription(s, {
        kind, customerId: customerId ?? '', items: doc.lines, frequency, startDate: fromInputDate(start), endDate: end ? fromInputDate(end) : undefined, payMode, coverage, notes,
      }, existing?.id, ctx))
      toast(`${r.subscription.no} saved`, 'ok')
      router.replace({ pathname: '/m/sales-docs/recurring/[id]', params: { id: r.subscription.id } })
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not save the plan', 'err')
      setBusy(false)
    }
  }

  return (
    <Screen title={existing ? `Edit ${existing.no}` : 'New recurring plan'} subtitle={each > 0 ? `${inr(each)} ${FREQUENCY_LABEL[frequency].toLowerCase()}` : undefined} back
      footer={<Button label="Save plan" size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 6, paddingBottom: 14 }}>
        {!existing ? <Segmented<SubscriptionKind> value={kind} options={[{ value: 'subscription', label: 'Subscription' }, { value: 'amc', label: 'AMC contract' }]} onChange={setKind} /> : null}
        <View style={{ marginTop: 12 }}><CustomerRow customerId={customerId} onChange={setCustomerId} /></View>
        <Section title="What is billed each time" style={{ marginTop: 18 }}><DocLinesEditor doc={doc} /></Section>
        <Section title="Schedule" style={{ marginTop: 18 }}>
          <View style={{ gap: 14 }}>
            <Segmented<Frequency> value={frequency} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'yearly', label: 'Yearly' }]} onChange={setFrequency} />
            {locked ? <T v="caption" tone="mute">The start date is fixed once an invoice has been made.</T> : <DateField label="First invoice on" value={start} onChange={setStart} />}
            <DateField label="Ends on" value={end} onChange={setEnd} optional />
            <View>
              <T v="label" tone="soft" style={{ marginBottom: 6 }}>Invoices are settled</T>
              <Segmented<SubPayMode> value={payMode} options={[...(hasOnAccount() ? [{ value: 'due' as const, label: 'On account' }] : []), { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }]} onChange={setPayMode} />
            </View>
          </View>
        </Section>
        <Section title="Details" style={{ marginTop: 18 }}>
          <View style={{ gap: 14 }}>
            {kind === 'amc' ? <Field label="What is covered" value={coverage} onChangeText={setCoverage} multiline placeholder="e.g. 2 services a year, parts excluded" /> : null}
            <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
          </View>
        </Section>
      </View>
    </Screen>
  )
}
