import React from 'react'
import { View } from 'react-native'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { labelYM } from '@/modules/hr/logic/ymd'
import type { Employee, EmployeePay, Payslip, SalaryPayout } from '@/modules/hr/types'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip } from '@/ui/primitives'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { FileText, MessageCircle, Printer } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, KpiStrip, KpiTile, Pill, Toolbar } from './kit'

const MODE_OPTIONS: Array<{ value: 'cash' | 'bank' | 'upi'; label: string }> = [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }]

export interface DesktopPayslipProps {
  slip: Payslip
  voided: boolean
  paid: number
  emp: Employee | undefined
  pay: EmployeePay | undefined
  payouts: SalaryPayout[]
  paying: boolean; setPaying: (v: boolean) => void
  voiding: boolean; setVoiding: (v: boolean) => void
  mode: 'cash' | 'bank' | 'upi'; setMode: (v: 'cash' | 'bank' | 'upi') => void
  ref: string; setRef: (v: string) => void
  why: string; setWhy: (v: string) => void
  onPrint: () => void
  onPdf: () => void
  onWhatsapp: () => void
  onConfirmPaid: () => void
  onConfirmVoid: () => void
}

/** The desktop payslip: the same lines and attendance summary as a KPI strip + side detail, instead of a card stack. */
export function DesktopPayslip(p: DesktopPayslipProps) {
  const { c } = useTheme()
  const { slip } = p

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={slip.employeeName}
          subtitle={`${labelYM(slip.month)} · ${slip.no}`}
          right={!p.voided ? (
            <>
              <DeskButton label="Print" icon={<Printer size={14} color={c.ink} />} onPress={p.onPrint} />
              <DeskButton label="PDF" icon={<FileText size={14} color={c.ink} />} onPress={p.onPdf} />
              <DeskButton label="WhatsApp" icon={<MessageCircle size={14} color={c.ink} />} onPress={p.onWhatsapp} />
              {p.paid < slip.net && slip.net > 0 ? <DeskButton label={`Mark ${inr(slip.net, 0)} as paid`} tone="primary" onPress={() => p.setPaying(true)} /> : null}
              {p.paid === 0 ? <DeskButton label="Void" tone="danger" onPress={() => p.setVoiding(true)} /> : null}
            </>
          ) : undefined}
        />
      }
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 10, flexDirection: 'row', gap: 8 }}>
        {p.voided ? <Pill tone="danger" label="Voided" /> : p.paid >= slip.net && slip.net > 0 ? <Pill tone="success" label="Paid" /> : slip.net > 0 ? <Pill tone="warning" label="To pay" /> : null}
        {slip.rev > 1 ? <Pill label={`Revision ${slip.rev}`} /> : null}
      </View>

      <KpiStrip>
        <KpiTile label="Gross pay" value={inr(slip.gross, 0)} />
        <KpiTile label="Net pay" value={inr(slip.net, 0)} tone="primary" />
        <KpiTile label="Days worked" value={String(slip.presentDays)} />
        <KpiTile label="Loss of pay" value={String(slip.lopDays)} tone={slip.lopDays ? 'warning' : 'default'} />
        {slip.overtimeHours ? <KpiTile label="Overtime" value={`${slip.overtimeHours} h`} /> : null}
      </KpiStrip>

      <View style={{ flex: 1, flexDirection: 'row', gap: 14, margin: 14 }}>
        <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
          <T v="label" tone="soft" style={{ marginBottom: 6 }}>Earnings</T>
          {slip.earnings.map((l, i) => <KV key={i} k={l.label} v={inr(l.amount)} sub={l.full !== undefined && l.full !== l.amount ? `of ${inr(l.full)} for the full month` : undefined} />)}
          <KV k="Gross pay" v={inr(slip.gross)} strong />
        </View>
        <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
          <T v="label" tone="soft" style={{ marginBottom: 6 }}>Deductions</T>
          {slip.deductions.length ? slip.deductions.map((l, i) => <KV key={i} k={l.label} v={inr(l.amount)} />) : <T tone="mute">No deductions</T>}
          {slip.roundOff ? <KV k="Rounding" v={inr(slip.roundOff)} /> : null}
          <KV k="Net pay" v={inr(slip.net)} strong big />
        </View>
        <View style={{ width: 280, gap: 10 }}>
          {slip.employerPf || slip.employerEsi ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}><KV k="Employer PF + ESI" v={inr(slip.employerPf + slip.employerEsi)} /></View>
          ) : null}
          {p.payouts.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T v="label" tone="soft" style={{ marginBottom: 6 }}>Paid</T>
              {p.payouts.map((pay) => <T key={pay.id} tone="mute">{inr(pay.amount, 0)} by {pay.mode} on {fmtDate(pay.date)}{pay.ref ? ` · ${pay.ref}` : ''}</T>)}
            </View>
          ) : null}
          {p.voided ? <T tone="mute">This payslip was voided. Run payroll again for {labelYM(slip.month)} to make a new one.</T> : null}
        </View>
      </View>

      <Sheet visible={p.paying} onClose={() => p.setPaying(false)} title="Mark as paid" footer={<View style={{ padding: 16 }}><Button label="Mark as paid" size="lg" block onPress={p.onConfirmPaid} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={p.mode === m.value} onPress={() => p.setMode(m.value)} />)}</View>
          <Field label="Reference (optional)" value={p.ref} onChangeText={p.setRef} />
        </View>
      </Sheet>
      <Sheet visible={p.voiding} onClose={() => p.setVoiding(false)} title="Void this payslip" subtitle="Its advance recoveries and adjustments are freed, and attendance for the month opens again."
        footer={<View style={{ padding: 16 }}><Button label="Void payslip" kind="danger" size="lg" block onPress={p.onConfirmVoid} /></View>}>
        <Field label="Why" value={p.why} onChangeText={p.setWhy} placeholder="Wrong attendance, missed an advance…" />
      </Sheet>
    </DeskPage>
  )
}
