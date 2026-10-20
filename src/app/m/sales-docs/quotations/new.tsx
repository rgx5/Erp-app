import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fromInputDate, toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useStore } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { docTotal } from '@/modules/sales-docs/logic/lines'
import { DEFAULT_TERMS } from '@/modules/sales-docs/logic/quotes'
import { defaultValidity, saveQuotation } from '@/modules/sales-docs/ops'
import { CustomerRow, DateField, DocLinesEditor, DocTotals, isInputDate, useDiscount, useDocLines } from '@/modules/sales-docs/ui/forms'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

/** A quotation: who it is for, what is offered at what price, and until when. Edits one when given `?id=`. */
export default function NewQuotation() {
  const router = useRouter()
  const { id: editId } = useLocalSearchParams<{ id?: string }>()
  const can = useCan('pos')
  const store = useStore()
  const existing = useList('quotations').find((x) => x.id === editId)

  const [customerId, setCustomerId] = useState<string | null>(existing?.customerId ?? null)
  const [name, setName] = useState(existing && !existing.customerId ? existing.partyName : '')
  const [phone, setPhone] = useState(existing && !existing.customerId ? existing.partyPhone : '')
  const doc = useDocLines(existing?.items)
  const discount = useDiscount(existing?.billDiscountType, existing?.billDiscountValue)
  const [until, setUntil] = useState(toInputDate(existing?.validUntil ?? defaultValidity(Date.now())))
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [terms, setTerms] = useState(existing?.terms ?? DEFAULT_TERMS)
  const [busy, setBusy] = useState(false)

  if (!can) return <Screen title="Quotation" back><T tone="mute">Quotations are for people who use the billing counter.</T></Screen>
  const total = docTotal(doc.lines, discount.type, discount.value, store)

  function save() {
    if (!isInputDate(until)) { toast('Write the date as YYYY-MM-DD', 'err'); return }
    setBusy(true)
    try {
      const r = perform((s, ctx) => saveQuotation(s, {
        customerId, partyName: name, partyPhone: phone, items: doc.lines, billDiscountType: discount.type, billDiscountValue: discount.value, validUntil: fromInputDate(until), notes, terms,
      }, existing?.id, ctx))
      toast(`${r.quotation.no} saved`, 'ok')
      router.replace({ pathname: '/m/sales-docs/quotations/[id]', params: { id: r.quotation.id } })
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not save the quotation', 'err')
      setBusy(false)
    }
  }

  return (
    <Screen title={existing ? `Edit ${existing.no}` : 'New quotation'} subtitle={doc.lines.length ? `${doc.lines.length} ${doc.lines.length === 1 ? 'line' : 'lines'} · ${inr(total)}` : undefined} back
      footer={<Button label={total > 0 ? `Save quotation · ${inr(total)}` : 'Save quotation'} size="lg" block loading={busy} onPress={save} />}>
      <View style={{ gap: 6, paddingBottom: 14 }}>
        <CustomerRow customerId={customerId} onChange={setCustomerId} label="For" optional />
        {!customerId ? (
          <View style={{ gap: 12, marginTop: 10 }}>
            <Field label="Name" value={name} onChangeText={setName} placeholder="Who is the enquiry from?" />
            <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          </View>
        ) : null}
        <Section title="Items" style={{ marginTop: 18 }}><DocLinesEditor doc={doc} /></Section>
        {doc.lines.length ? <Section title="Totals" style={{ marginTop: 18 }}><DocTotals lines={doc.lines} discount={discount} /></Section> : null}
        <Section title="Details" style={{ marginTop: 18 }}>
          <View style={{ gap: 14 }}>
            <DateField label="Valid until" value={until} onChange={setUntil} />
            <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
            <Field label="Terms" value={terms} onChangeText={setTerms} multiline />
          </View>
        </Section>
      </View>
    </Screen>
  )
}
