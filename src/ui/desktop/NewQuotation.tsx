import React from 'react'
import { ScrollView, View } from 'react-native'
import { inr } from '@/domain/money'
import type { DocLinesState, DiscountState } from '@/modules/sales-docs/ui/forms'
import { CustomerRow, DateField, DocLinesEditor, DocTotals } from '@/modules/sales-docs/ui/forms'
import { Field } from '@/ui/Inputs'
import { Section } from '@/ui/blocks'
import { DeskButton, DeskPage, Toolbar } from './kit'

export interface DesktopNewQuotationProps {
  title: string
  customerId: string | null
  setCustomerId: (v: string | null) => void
  name: string
  setName: (v: string) => void
  phone: string
  setPhone: (v: string) => void
  doc: DocLinesState
  discount: DiscountState
  until: string
  setUntil: (v: string) => void
  notes: string
  setNotes: (v: string) => void
  terms: string
  setTerms: (v: string) => void
  total: number
  busy: boolean
  onSave: () => void
}

/**
 * The desktop "New quotation" screen: a `DeskPage`/`Toolbar` shell around the exact form
 * `src/app/m/sales-docs/quotations/new.tsx` builds, centred in a readable column instead of stretched edge-to-edge.
 * `doc`, `discount`, `total` and every field come from the phone screen unchanged — this file only re-homes the
 * same `CustomerRow`/`DocLinesEditor`/`Field` controls under desktop chrome, matching `DesktopNewPurchase`.
 */
export function DesktopNewQuotation(p: DesktopNewQuotationProps) {
  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={p.title}
          subtitle={p.doc.lines.length ? `${p.doc.lines.length} ${p.doc.lines.length === 1 ? 'line' : 'lines'} · ${inr(p.total)}` : 'A price offer for a customer'}
          right={<DeskButton label={p.busy ? 'Saving…' : p.total > 0 ? `Save quotation · ${inr(p.total)}` : 'Save quotation'} tone="primary" disabled={p.busy} onPress={p.onSave} />}
        />
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 780, gap: 6 }}>
          <CustomerRow customerId={p.customerId} onChange={p.setCustomerId} label="For" optional />
          {!p.customerId ? (
            <View style={{ gap: 12, marginTop: 10 }}>
              <Field label="Name" value={p.name} onChangeText={p.setName} placeholder="Who is the enquiry from?" />
              <Field label="Phone (optional)" value={p.phone} onChangeText={p.setPhone} keyboardType="phone-pad" />
            </View>
          ) : null}
          <Section title="Items" style={{ marginTop: 18 }}><DocLinesEditor doc={p.doc} /></Section>
          {p.doc.lines.length ? <Section title="Totals" style={{ marginTop: 18 }}><DocTotals lines={p.doc.lines} discount={p.discount} /></Section> : null}
          <Section title="Details" style={{ marginTop: 18 }}>
            <View style={{ gap: 14 }}>
              <DateField label="Valid until" value={p.until} onChange={p.setUntil} />
              <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline />
              <Field label="Terms" value={p.terms} onChangeText={p.setTerms} multiline />
            </View>
          </Section>
        </View>
      </ScrollView>
    </DeskPage>
  )
}
