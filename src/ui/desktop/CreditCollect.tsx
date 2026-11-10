import React from 'react'
import { Pressable, View } from 'react-native'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { Customer } from '@/domain/types'
import type { allocateOldestFirst, BillDue } from '@/modules/credit/logic'
import type { CollectionMode } from '@/modules/credit/types'
import { MODE_OPTIONS, REF_HINT } from '@/modules/credit/ui/modes'
import { Field, MoneyField } from '@/ui/Inputs'
import { Chip } from '@/ui/primitives'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, UserPlus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, dtext } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopCollectProps {
  customer: Customer | null
  onPickCustomer: () => void
  dues: { net: number } | undefined
  amount: string; setAmount: (v: string) => void
  mode: CollectionMode; setMode: (v: CollectionMode) => void
  ref: string; setRef: (v: string) => void
  note: string; setNote: (v: string) => void
  open: BillDue[]
  split: ReturnType<typeof allocateOldestFirst>
  amt: number
  saving: boolean
  canSave: boolean
  onSave: () => void
}

/** The desktop Collect-payment form: the same centred-column shell, the amount and mode fields, and the same live "what it settles" breakdown. */
export function DesktopCollect(p: DesktopCollectProps) {
  const { c, radius } = useTheme()
  return (
    <DesktopSettingsPage title="Collect payment" right={<DeskButton label={p.amt > 0 ? `Receive ${inr(p.amt, 0)}` : 'Receive payment'} tone="primary" disabled={!p.canSave} onPress={p.onSave} />}>
      <View style={{ gap: 18 }}>
        <Pressable onPress={p.onPickCustomer} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}><UserPlus size={18} color={c.primary} /></View>
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{p.customer ? p.customer.name : 'Choose the customer'}</T>
            <T v="caption" tone="mute">{p.customer ? (p.dues && p.dues.net !== 0 ? (p.dues.net > 0 ? `Owes ${inr(p.dues.net, 0)}` : `${inr(-p.dues.net, 0)} paid in advance`) : 'Owes nothing') : 'Who is paying?'}</T>
          </View>
          <ChevronRight size={18} color={c.inkMute} />
        </Pressable>

        <MoneyField label="Amount received" value={p.amount} onChange={p.setAmount} placeholder="0" large />
        {p.dues && p.dues.net > 0 ? <View style={{ flexDirection: 'row', gap: 8 }}><Chip label={`All ${inr(p.dues.net, 0)}`} onPress={() => p.setAmount(String(p.dues!.net))} /></View> : null}

        <View style={{ gap: 8 }}>
          <T style={[dtext.label, { color: c.inkMute }]}>Received by</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={p.mode === m.value} onPress={() => { p.setMode(m.value); p.setRef('') }} />)}
          </View>
        </View>
        {p.mode !== 'cash' ? <Field value={p.ref} onChangeText={p.setRef} placeholder={REF_HINT[p.mode]} /> : null}
        <Field label="Note (optional)" value={p.note} onChangeText={p.setNote} />

        {p.customer && p.amt > 0 ? (
          <View style={{ gap: 8 }}>
            <T style={[dtext.label, { color: c.inkMute }]}>What it settles</T>
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              {p.split.allocations.map((a) => {
                const b = p.open.find((x) => x.billId === a.billId)
                return <KV key={a.billId} k={b?.no ?? 'Bill'} sub={b ? `Due ${fmtDayShort(b.dueDate)}` : undefined} v={inr(a.amount, 0)} />
              })}
              {p.split.advance > 0 ? <KV k="Kept as advance" sub="Used against the next bills" v={inr(p.split.advance, 0)} tone="success" /> : null}
              {!p.split.allocations.length && !p.split.advance ? <T tone="mute">Nothing to settle.</T> : null}
            </View>
          </View>
        ) : null}
        {p.customer && !p.open.length ? <Notice tone="primary" title="Nothing is owed on any bill" body="The money will be kept as an advance on this customer's account." /> : null}
      </View>
    </DesktopSettingsPage>
  )
}
