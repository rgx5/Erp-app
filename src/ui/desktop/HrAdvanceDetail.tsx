import React from 'react'
import { View } from 'react-native'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { labelYM } from '@/modules/hr/logic/ymd'
import type { Payslip, StaffAdvance, StaffRepayment } from '@/modules/hr/types'
import { Button } from '@/ui/Button'
import { MoneyField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip } from '@/ui/primitives'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, KpiStrip, KpiTile, Toolbar } from './kit'

const MODE_OPTIONS: Array<{ value: 'cash' | 'bank' | 'upi'; label: string }> = [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }]

export interface DesktopAdvanceDetailProps {
  advance: StaffAdvance
  employeeName: string | undefined
  recovered: number
  repaid: number
  balance: number
  emi: number
  slips: Payslip[]
  repays: StaffRepayment[]
  open: boolean; setOpen: (v: boolean) => void
  amount: string; setAmount: (v: string) => void
  mode: 'cash' | 'bank' | 'upi'; setMode: (v: 'cash' | 'bank' | 'upi') => void
  onOpenRepay: () => void
  onConfirmRepay: () => void
  onWriteOff: () => void
}

/** The desktop advance/loan screen: a KPI strip for given / recovered / still to come, and payments as a side list. */
export function DesktopAdvanceDetail(p: DesktopAdvanceDetailProps) {
  const { c } = useTheme()
  const { advance: a } = p

  return (
    <DeskPage toolbar={<Toolbar title={a.no} subtitle={p.employeeName} right={p.balance > 0 ? <><DeskButton label="Record paid back" tone="primary" onPress={p.onOpenRepay} /><DeskButton label="Write off the rest" tone="danger" onPress={p.onWriteOff} /></> : undefined} />}>
      <KpiStrip>
        <KpiTile label={a.kind === 'loan' ? 'Loan given' : 'Advance given'} value={inr(a.amount, 0)} delta={`${fmtDate(a.date)} · ${a.mode}`} />
        <KpiTile label="Taken from salary" value={inr(p.recovered, 0)} />
        <KpiTile label="Paid back by hand" value={inr(p.repaid, 0)} />
        <KpiTile label="Still to come" value={inr(p.balance, 0)} tone={p.balance ? 'warning' : 'success'} delta={`${inr(p.emi, 0)}/mo from ${labelYM(a.startMonth)}`} />
      </KpiStrip>

      <View style={{ flex: 1, margin: 14, maxWidth: 560, gap: 10 }}>
        {p.slips.length || p.repays.length ? (
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T v="label" tone="soft" style={{ marginBottom: 6 }}>Payments</T>
            {p.slips.map((s) => <KV key={s.id} k={`${labelYM(s.month)} salary`} v={inr(s.recoveries.filter((r) => r.advanceId === a.id).reduce((t, r) => t + r.amount, 0), 0)} sub={s.no} />)}
            {p.repays.map((r) => <KV key={r.id} k={r.mode === 'writeoff' ? 'Written off' : 'Paid back'} v={inr(r.amount, 0)} sub={fmtDate(r.date)} />)}
          </View>
        ) : <T tone="mute">No payments yet.</T>}
      </View>

      <Sheet visible={p.open} onClose={() => p.setOpen(false)} title="Money paid back" footer={<View style={{ padding: 16 }}><Button label="Save" size="lg" block onPress={p.onConfirmRepay} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <MoneyField label="Amount" value={p.amount} onChange={p.setAmount} />
          <View style={{ flexDirection: 'row', gap: 8 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={p.mode === m.value} onPress={() => p.setMode(m.value)} />)}</View>
          <T tone="mute">Instalments still come off salary as planned; this reduces what is left.</T>
        </View>
      </Sheet>
    </DeskPage>
  )
}
