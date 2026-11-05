import React from 'react'
import { View } from 'react-native'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { Supplier } from '@/domain/types'
import type { PayableDoc } from '@/modules/purchasing/payables'
import type { PayableRef, PayMode } from '@/modules/purchasing/types'
import { Field, MoneyField, Select } from '@/ui/Inputs'
import { Card, Chip } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopPaySupplierProps {
  suppliers: Supplier[]
  supplierId: string
  onSupplierChange: (v: string) => void
  dues: { net: number; outstanding: number } | undefined
  amount: string
  setAmount: (v: string) => void
  amt: number
  open: PayableDoc[]
  allocations: Array<{ ref: PayableRef; amount: number }>
  advance: number
  mode: PayMode
  onModeChange: (v: PayMode) => void
  modeOptions: Array<{ value: PayMode; label: string }>
  refHint: Record<PayMode, string>
  ref: string
  setRef: (v: string) => void
  date: string
  setDate: (v: string) => void
  dateOk: boolean
  note: string
  setNote: (v: string) => void
  busy: boolean
  canSave: boolean
  onSave: () => void
}

/**
 * The desktop "pay supplier" form: the same amount, mode and allocation preview the phone screen builds
 * (`src/app/m/purchasing/payables/pay.tsx`), centred in `DesktopSettingsPage`'s readable column. The allocation
 * itself (`allocations`, `advance`) comes from the phone screen's own `allocateOldestFirst` call.
 */
export function DesktopPaySupplier(p: DesktopPaySupplierProps) {
  return (
    <DesktopSettingsPage title="Pay supplier"
      right={<DeskButton label={p.amt > 0 ? `Pay ${inr(p.amt, 0)}` : 'Pay supplier'} tone="primary" disabled={p.busy || !p.canSave} onPress={p.onSave} />}>
      <View style={{ gap: 18 }}>
        <Select<string> label="Supplier" value={p.supplierId} placeholder="Who are you paying?" searchable options={p.suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.phone || undefined }))} onChange={p.onSupplierChange}
          hint={p.dues ? (p.dues.net > 0 ? `You owe ${inr(p.dues.net, 0)}` : p.dues.net < 0 ? `${inr(-p.dues.net, 0)} already paid in advance` : 'You owe nothing') : undefined} />
        <MoneyField label="Amount paid" value={p.amount} onChange={p.setAmount} placeholder="0" large />
        {p.dues && p.dues.outstanding > 0 ? <View style={{ flexDirection: 'row', gap: 8 }}><Chip label={`All ${inr(p.dues.outstanding, 0)}`} onPress={() => p.setAmount(String(p.dues!.outstanding))} /></View> : null}

        <Section title="Paid by" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {p.modeOptions.map((m) => <Chip key={m.value} label={m.label} selected={p.mode === m.value} onPress={() => p.onModeChange(m.value)} />)}
          </View>
        </Section>
        {p.mode !== 'cash' ? <Field value={p.ref} onChangeText={p.setRef} placeholder={p.refHint[p.mode]} /> : null}
        <Field label="Date" value={p.date} onChangeText={p.setDate} placeholder="YYYY-MM-DD" error={p.dateOk ? null : 'Write the date as YYYY-MM-DD'} />
        <Field label="Note (optional)" value={p.note} onChangeText={p.setNote} />

        {p.supplierId && p.amt > 0 ? (
          <Section title="What it settles" style={{ marginTop: 0 }}>
            <Card>
              {p.allocations.map((a) => {
                const d = p.open.find((x) => x.ref === a.ref)
                return <KV key={a.ref} k={d?.no ?? 'Bill'} sub={d?.dueDate ? `Due ${fmtDayShort(d.dueDate)}` : undefined} v={inr(a.amount, 0)} />
              })}
              {p.advance > 0 ? <KV k="Kept as advance" sub="Used against their next bills" v={inr(p.advance, 0)} tone="success" /> : null}
            </Card>
          </Section>
        ) : null}
        {p.supplierId && !p.open.length ? <Notice tone="primary" title="Nothing is owed on any bill" body="The money will be kept as an advance with this supplier." /> : null}
      </View>
    </DesktopSettingsPage>
  )
}
