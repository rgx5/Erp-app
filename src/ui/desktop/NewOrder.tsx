import React from 'react'
import { ScrollView, View } from 'react-native'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { PaymentInput } from '@/modules/sales-docs/ops'
import type { Instalment } from '@/modules/sales-docs/types'
import type { DiscountState, DocLinesState } from '@/modules/sales-docs/ui/forms'
import { CustomerRow, DateField, DocLinesEditor, DocTotals } from '@/modules/sales-docs/ui/forms'
import { Field, MoneyField, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { DeskButton, DeskPage, Toolbar } from './kit'

type Mode = PaymentInput['mode']

export interface DesktopNewOrderProps {
  title: string
  customerId: string | null
  setCustomerId: (v: string | null) => void
  doc: DocLinesState
  discount: DiscountState
  total: number
  plan: boolean
  setPlan: (v: boolean) => void
  count: string
  setCount: (v: string) => void
  every: string
  setEvery: (v: string) => void
  first: string
  setFirst: (v: string) => void
  instalments: Instalment[] | undefined
  isExisting: boolean
  advance: string
  setAdvance: (v: string) => void
  mode: Mode
  setMode: (v: Mode) => void
  expected: string
  setExpected: (v: string) => void
  notes: string
  setNotes: (v: string) => void
  busy: boolean
  onSave: () => void
}

/**
 * The desktop "New order" screen: a `DeskPage`/`Toolbar` shell around the exact form
 * `src/app/m/sales-docs/orders/new.tsx` builds (the customer, the items kept aside, the layaway plan and an
 * advance), centred in a readable column. Every field and the live `instalments` preview come from the phone
 * screen unchanged, matching `DesktopNewPurchase`.
 */
export function DesktopNewOrder(p: DesktopNewOrderProps) {
  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={p.title}
          subtitle={p.doc.lines.length ? `${p.doc.lines.length} ${p.doc.lines.length === 1 ? 'line' : 'lines'} · ${inr(p.total)}` : 'Goods kept aside for a customer'}
          right={<DeskButton label={p.busy ? 'Saving…' : p.total > 0 ? `Save order · ${inr(p.total)}` : 'Save order'} tone="primary" disabled={p.busy} onPress={p.onSave} />}
        />
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 780, gap: 6 }}>
          <CustomerRow customerId={p.customerId} onChange={p.setCustomerId} />
          <Section title="Items" style={{ marginTop: 18 }}><DocLinesEditor doc={p.doc} /></Section>
          {p.doc.lines.length ? <Section title="Totals" style={{ marginTop: 18 }}><DocTotals lines={p.doc.lines} discount={p.discount} label="Order total" /></Section> : null}

          <Section title="Payment" style={{ marginTop: 18 }}>
            <View style={{ gap: 12 }}>
              <Card padded={false}>
                <SwitchRow title="Pay over time (layaway)" subtitle="Split the total into instalments the customer pays before collecting" value={p.plan} onChange={p.setPlan} />
              </Card>
              {p.plan ? (
                <View style={{ gap: 12 }}>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ flex: 1 }}><NumberField label="Instalments" value={p.count} onChange={p.setCount} /></View>
                    <View style={{ flex: 1 }}><NumberField label="Days apart" value={p.every} onChange={p.setEvery} /></View>
                  </View>
                  <DateField label="First instalment due" value={p.first} onChange={p.setFirst} />
                  {p.instalments ? <Card>{p.instalments.map((i, n) => <KV key={n} k={`${n + 1}. ${fmtDate(i.dueDate)}`} v={inr(i.amount)} />)}</Card> : null}
                </View>
              ) : null}
              {!p.isExisting ? (
                <View style={{ gap: 12 }}>
                  <MoneyField label="Advance received now (optional)" value={p.advance} onChange={p.setAdvance} />
                  {Number(p.advance) > 0 ? <Segmented<Mode> value={p.mode} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' }]} onChange={p.setMode} /> : null}
                </View>
              ) : null}
            </View>
          </Section>

          <Section title="Details" style={{ marginTop: 18 }}>
            <View style={{ gap: 14 }}>
              <DateField label="Delivery by" value={p.expected} onChange={p.setExpected} optional />
              <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline />
            </View>
          </Section>
        </View>
      </ScrollView>
    </DeskPage>
  )
}
