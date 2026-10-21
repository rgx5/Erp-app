import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { csvFileName } from '@/domain/csv'
import { inr } from '@/domain/money'
import { useCan } from '@/data/store'
import { useStore } from '@/data/hooks'
import { printHtml, sharePdf, whatsApp } from '@/features/share'
import { payslipHtml } from '@/modules/hr/html'
import { payoutsOf, paidOf, voidedIds } from '@/modules/hr/logic/slips'
import { labelYM } from '@/modules/hr/logic/ymd'
import { paySalary, voidPayslip } from '@/modules/hr/payrollOps'
import { act, Denied, MODE_OPTIONS, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { FileText, MessageCircle, Printer } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** One payslip: the lines, print / PDF / WhatsApp, mark paid, or void. */
export default function PayslipPage() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('payroll')
  const { data } = useHr()
  const store = useStore()
  const slip = data.payslips?.[id]
  const [paying, setPaying] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [mode, setMode] = useState<'cash' | 'bank' | 'upi'>('bank')
  const [ref, setRef] = useState('')
  const [why, setWhy] = useState('')

  if (!can) return <Denied title="Payslip" who="Payslips are for the owner and managers with payroll access." />
  if (!slip) return <Denied title="Not found" who="This payslip is no longer here." />
  const voided = voidedIds(data).has(slip.id)
  const paid = paidOf(data, slip.id)
  const emp = data.employees?.[slip.employeeId]
  const pay = data.employeePay?.[slip.employeeId]
  const html = () => payslipHtml(slip!, store, emp, pay)
  const file = csvFileName(`payslip-${slip.employeeName}-${slip.month}`, 'pdf')

  return (
    <Screen title={slip.employeeName} subtitle={`${labelYM(slip.month)} · ${slip.no}`} back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {voided ? <Badge tone="danger">Voided</Badge> : paid >= slip.net && slip.net > 0 ? <Badge tone="success">Paid</Badge> : slip.net > 0 ? <Badge tone="warning">To pay</Badge> : null}
          {slip.rev > 1 ? <Badge tone="default">Revision {slip.rev}</Badge> : null}
        </View>
        <Card>
          {slip.earnings.map((l, i) => <KV key={i} k={l.label} v={inr(l.amount)} sub={l.full !== undefined && l.full !== l.amount ? `of ${inr(l.full)} for the full month` : undefined} />)}
          <KV k="Gross pay" v={inr(slip.gross)} strong />
        </Card>
        <Card>
          {slip.deductions.length ? slip.deductions.map((l, i) => <KV key={i} k={l.label} v={inr(l.amount)} />) : <T tone="mute">No deductions</T>}
          {slip.roundOff ? <KV k="Rounding" v={inr(slip.roundOff)} /> : null}
          <KV k="Net pay" v={inr(slip.net)} strong big />
        </Card>
        <Section title="Attendance" style={{ marginTop: 0 }}>
          <Card>
            <KV k="Days worked" v={String(slip.presentDays)} />
            {slip.paidLeaveDays ? <KV k="Paid leave" v={String(slip.paidLeaveDays)} /> : null}
            <KV k="Loss of pay days" v={String(slip.lopDays)} />
            {slip.overtimeHours ? <KV k="Overtime hours" v={String(slip.overtimeHours)} /> : null}
            {slip.employerPf || slip.employerEsi ? <KV k="Employer PF + ESI" v={inr(slip.employerPf + slip.employerEsi)} /> : null}
          </Card>
        </Section>
        {payoutsOf(data, slip.id).map((p) => <T key={p.id} tone="mute">Paid {inr(p.amount, 0)} by {p.mode} on {fmtDate(p.date)}{p.ref ? ` · ${p.ref}` : ''}</T>)}

        {!voided ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button label="Print" kind="outline" block icon={<Printer size={18} color={c.ink} />} onPress={() => void printHtml(html())} /></View>
              <View style={{ flex: 1 }}><Button label="PDF" kind="outline" block icon={<FileText size={18} color={c.ink} />} onPress={() => void sharePdf(html(), file)} /></View>
            </View>
            <Button label="Send on WhatsApp" kind="outline" block icon={<MessageCircle size={18} color={c.ink} />} onPress={() => void whatsApp(`${slip.employeeName}, your salary for ${labelYM(slip.month)}: gross ${inr(slip.gross, 0)}, deductions ${inr(slip.totalDeductions, 0)}, net ${inr(slip.net, 0)}.`, emp?.phone)} />
            {paid < slip.net && slip.net > 0 ? <Button label={`Mark ${inr(slip.net, 0)} as paid`} size="lg" block onPress={() => setPaying(true)} /> : null}
            {paid === 0 ? <Button label="Void this payslip" kind="outline" block onPress={() => setVoiding(true)} /> : null}
          </View>
        ) : <T tone="mute">This payslip was voided. Run payroll again for {labelYM(slip.month)} to make a new one.</T>}
      </View>

      <Sheet visible={paying} onClose={() => setPaying(false)} title="Mark as paid" footer={<View style={{ padding: 16 }}><Button label="Mark as paid" size="lg" block onPress={() => { if (act((s, ctx) => paySalary(s, slip.id, { mode, ref }, ctx), 'Marked as paid')) setPaying(false) }} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => setMode(m.value)} />)}</View>
          <Field label="Reference (optional)" value={ref} onChangeText={setRef} />
        </View>
      </Sheet>
      <Sheet visible={voiding} onClose={() => setVoiding(false)} title="Void this payslip" subtitle="Its advance recoveries and adjustments are freed, and attendance for the month opens again."
        footer={<View style={{ padding: 16 }}><Button label="Void payslip" kind="danger" size="lg" block onPress={() => { if (act((s, ctx) => voidPayslip(s, slip.id, why, ctx), 'Payslip voided')) { setVoiding(false); router.back() } }} /></View>}>
        <Field label="Why" value={why} onChangeText={setWhy} placeholder="Wrong attendance, missed an advance…" />
      </Sheet>
    </Screen>
  )
}
