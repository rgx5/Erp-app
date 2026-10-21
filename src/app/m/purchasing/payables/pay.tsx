import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fromInputDate, fmtDayShort, toInputDate } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { allocateOldestFirst, payables } from '@/modules/purchasing/payables'
import { paySupplier } from '@/modules/purchasing/ops-payables'
import type { PayMode } from '@/modules/purchasing/types'
import { dateOk, MODE_OPTIONS, REF_HINT, supplierOptions } from '@/modules/purchasing/ui/helpers'
import { Button } from '@/ui/Button'
import { Field, MoneyField, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'

/** Pay a supplier. The oldest bills are settled first; anything over is kept as an advance with them. */
export default function PaySupplier() {
  const router = useRouter()
  const params = useLocalSearchParams<{ supplierId?: string; amount?: string }>()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const suppliers = useList('suppliers')
  const [supplierId, setSupplierId] = useState(params.supplierId ?? '')
  const [amount, setAmount] = useState(params.amount ?? '')
  const [mode, setMode] = useState<PayMode>('bank')
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(toInputDate(Date.now()))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const dues = useMemo(() => (supplierId ? payables(data).bySupplier[supplierId] : undefined), [data, supplierId])
  const open = useMemo(() => dues?.docs.filter((d) => d.outstanding > 0) ?? [], [dues])
  const amt = round2(Number(amount) || 0)
  const split = useMemo(() => allocateOldestFirst(open, amt), [open, amt])

  if (!can) return <Screen title="Pay supplier" back><T tone="mute">Paying suppliers is for the owner and managers.</T></Screen>

  function save() {
    if (saving) return
    if (!dateOk(date)) { toast('Write the date as YYYY-MM-DD', 'err'); return }
    setSaving(true)
    try {
      const r = perform((s, ctx) => paySupplier(s, { supplierId, amount: amt, mode, ref, note, date: date ? fromInputDate(date) : undefined }, ctx))
      toast(`${r.payment.no} · ${inr(amt, 0)} paid`, 'ok')
      router.back()
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'Could not record the payment', 'err')
      setSaving(false)
    }
  }

  return (
    <Screen title="Pay supplier" back footer={<Button label={amt > 0 ? `Pay ${inr(amt, 0)}` : 'Pay supplier'} size="lg" block loading={saving} disabled={!supplierId || !(amt > 0)} onPress={save} />}>
      <View style={{ gap: 18, paddingBottom: 12 }}>
        <Select<string> label="Supplier" value={supplierId} placeholder="Who are you paying?" searchable options={supplierOptions(suppliers)} onChange={(v) => { setSupplierId(v); setAmount('') }}
          hint={dues ? (dues.net > 0 ? `You owe ${inr(dues.net, 0)}` : dues.net < 0 ? `${inr(-dues.net, 0)} already paid in advance` : 'You owe nothing') : undefined} />
        <MoneyField label="Amount paid" value={amount} onChange={setAmount} placeholder="0" large />
        {dues && dues.outstanding > 0 ? <View style={{ flexDirection: 'row', gap: 8 }}><Chip label={`All ${inr(dues.outstanding, 0)}`} onPress={() => setAmount(String(dues.outstanding))} /></View> : null}

        <Section title="Paid by" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => { setMode(m.value); setRef('') }} />)}
          </View>
        </Section>
        {mode !== 'cash' ? <Field value={ref} onChangeText={setRef} placeholder={REF_HINT[mode]} /> : null}
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" error={dateOk(date) ? null : 'Write the date as YYYY-MM-DD'} />
        <Field label="Note (optional)" value={note} onChangeText={setNote} />

        {supplierId && amt > 0 ? (
          <Section title="What it settles" style={{ marginTop: 0 }}>
            <Card>
              {split.allocations.map((a) => {
                const d = open.find((x) => x.ref === a.ref)
                return <KV key={a.ref} k={d?.no ?? 'Bill'} sub={d?.dueDate ? `Due ${fmtDayShort(d.dueDate)}` : undefined} v={inr(a.amount, 0)} />
              })}
              {split.advance > 0 ? <KV k="Kept as advance" sub="Used against their next bills" v={inr(split.advance, 0)} tone="success" /> : null}
            </Card>
          </Section>
        ) : null}
        {supplierId && !open.length ? <Notice tone="primary" title="Nothing is owed on any bill" body="The money will be kept as an advance with this supplier." /> : null}
      </View>
    </Screen>
  )
}
