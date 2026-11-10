import React from 'react'
import { ScrollView, View } from 'react-native'
import { inr } from '@/domain/money'
import { FREQUENCY_LABEL } from '@/modules/sales-docs/logic/subscriptions'
import type { Frequency, SubPayMode, SubscriptionKind } from '@/modules/sales-docs/types'
import { CustomerRow, DateField, DocLinesEditor, type DocLinesState } from '@/modules/sales-docs/ui/forms'
import { Field, Segmented } from '@/ui/Inputs'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { DeskButton, DeskPage, Toolbar } from './kit'

export interface DesktopNewPlanProps {
  title: string
  isExisting: boolean
  kind: SubscriptionKind
  setKind: (v: SubscriptionKind) => void
  customerId: string | null
  setCustomerId: (v: string | null) => void
  doc: DocLinesState
  frequency: Frequency
  setFrequency: (v: Frequency) => void
  start: string
  setStart: (v: string) => void
  end: string
  setEnd: (v: string) => void
  locked: boolean
  payMode: SubPayMode
  setPayMode: (v: SubPayMode) => void
  hasOnAccount: boolean
  coverage: string
  setCoverage: (v: string) => void
  notes: string
  setNotes: (v: string) => void
  each: number
  busy: boolean
  onSave: () => void
}

/**
 * The desktop "New recurring plan" screen: a `DeskPage`/`Toolbar` shell around the exact form
 * `src/app/m/sales-docs/recurring/new.tsx` builds, centred in a readable column, matching `DesktopNewPurchase`.
 */
export function DesktopNewPlan(p: DesktopNewPlanProps) {
  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={p.title}
          subtitle={p.each > 0 ? `${inr(p.each)} ${FREQUENCY_LABEL[p.frequency].toLowerCase()}` : 'A plan that bills itself on a schedule'}
          right={<DeskButton label={p.busy ? 'Saving…' : 'Save plan'} tone="primary" disabled={p.busy} onPress={p.onSave} />}
        />
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 780, gap: 6 }}>
          {!p.isExisting ? <Segmented<SubscriptionKind> value={p.kind} options={[{ value: 'subscription', label: 'Subscription' }, { value: 'amc', label: 'AMC contract' }]} onChange={p.setKind} /> : null}
          <View style={{ marginTop: 12 }}><CustomerRow customerId={p.customerId} onChange={p.setCustomerId} /></View>
          <Section title="What is billed each time" style={{ marginTop: 18 }}><DocLinesEditor doc={p.doc} /></Section>
          <Section title="Schedule" style={{ marginTop: 18 }}>
            <View style={{ gap: 14 }}>
              <Segmented<Frequency> value={p.frequency} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'yearly', label: 'Yearly' }]} onChange={p.setFrequency} />
              {p.locked ? <T v="caption" tone="mute">The start date is fixed once an invoice has been made.</T> : <DateField label="First invoice on" value={p.start} onChange={p.setStart} />}
              <DateField label="Ends on" value={p.end} onChange={p.setEnd} optional />
              <Segmented<SubPayMode> value={p.payMode} options={[...(p.hasOnAccount ? [{ value: 'due' as const, label: 'On account' }] : []), { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }]} onChange={p.setPayMode} />
            </View>
          </Section>
          <Section title="Details" style={{ marginTop: 18 }}>
            <View style={{ gap: 14 }}>
              {p.kind === 'amc' ? <Field label="What is covered" value={p.coverage} onChangeText={p.setCoverage} multiline placeholder="e.g. 2 services a year, parts excluded" /> : null}
              <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline />
            </View>
          </Section>
        </View>
      </ScrollView>
    </DeskPage>
  )
}
