import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { csvFileName, toCsv } from '@/domain/csv'
import { inr } from '@/domain/money'
import { useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { payrollPreview, payrollTotals, type PayrollRow } from '@/modules/hr/logic/payroll'
import { bankExport } from '@/modules/hr/logic/reports'
import { labelYM, ymOf } from '@/modules/hr/logic/ymd'
import { paySalaries, runPayroll } from '@/modules/hr/payrollOps'
import { act, Denied, MODE_OPTIONS, MonthBar, RATES_NOTE, useHr } from '@/modules/hr/ui/common'
import { ask, tell } from '@/ui/overlays'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Avatar, Badge, Card, Chip, Tap } from '@/ui/primitives'
import { EmptyState, KV, Notice, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, Settings, WalletCards } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** The monthly payroll: preview from attendance, run it, pay it, hand the bank a file. */
export default function PayrollHome() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('payroll')
  const { data, now } = useHr()
  const [month, setMonth] = useState(ymOf(now))
  const [preview, setPreview] = useState<PayrollRow | null>(null)
  const [paying, setPaying] = useState(false)
  const [mode, setMode] = useState<'cash' | 'bank' | 'upi'>('bank')
  const [ref, setRef] = useState('')
  const rows = useMemo(() => (can ? payrollPreview(data, month, now) : []), [can, data, month, now])
  const totals = useMemo(() => payrollTotals(rows), [rows])
  const bank = useMemo(() => (can ? bankExport(data, month) : null), [can, data, month])

  if (!can) return <Denied title="Payroll" who="Payroll is for the owner and managers with payroll access." />
  const ready = rows.filter((r) => !r.existing && r.result && !r.problem)
  const blocked = rows.filter((r) => !r.existing && (!r.result || r.problem))
  const done = rows.filter((r) => r.existing)
  const unpaid = done.filter((r) => r.existing && r.existing.net > 0 && r.paid < r.existing.net)
  const warnCount = ready.reduce((n, r) => n + r.warnings.length, 0)

  async function run() {
    const lines = [`${ready.length} ${ready.length === 1 ? 'payslip' : 'payslips'} for ${labelYM(month)}`, `Net pay ${inr(ready.reduce((t, r) => t + r.result!.net, 0), 0)}`]
    if (warnCount) lines.push(`${warnCount} warnings to look at first`)
    lines.push('Attendance for this month is locked once the payroll is run. You can void a payslip to change it.')
    if (!(await ask({ title: 'Run payroll?', message: lines.join('\n'), confirm: 'Run payroll', cancel: 'Not yet' }))) return
    const r = act((s, ctx) => runPayroll(s, month, undefined, ctx), undefined)
    if (r) await tell(`${r.payslips.length} payslips created`, r.skipped.length ? `Skipped: ${r.skipped.map((x) => `${x.name} (${x.why})`).join('; ')}` : 'Now pay the salaries and share the payslips.')
  }
  async function exportBank() {
    if (!bank) return
    if (bank.missing.length) await tell('Some people have no bank details', `${bank.missing.join(', ')} will be left out of the file. Add their account or UPI id in Pay terms.`)
    if (bank.people) await shareFile(csvFileName(`salary-${month}`), toCsv(bank.rows))
  }

  return (
    <Screen title="Payroll" back right={<Button label="Settings" size="sm" kind="soft" icon={<Settings size={16} color={c.primary} />} onPress={() => router.push('/m/hr/payroll/settings')} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <MonthBar month={month} onChange={setMonth} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile label="Net pay" value={inr(totals.net, 0)} icon={<WalletCards size={18} color={c.primary} />} />
          <StatTile label="Cost to business" value={inr(totals.cost, 0)} foot="with employer PF / ESI" tone="accent" />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip label="Adjustments" onPress={() => router.push({ pathname: '/m/hr/payroll/adjustments', params: { month } } as never)} />
          <Chip label="Register" onPress={() => router.push('/m/hr/reports/payroll')} />
          <Chip label="PF · ESI · PT · TDS" onPress={() => router.push('/m/hr/reports/statutory')} />
        </View>

        {!rows.length ? <EmptyState icon={<WalletCards size={26} color={c.primary} />} title="No one to pay this month" hint="Add employees and set their pay terms. Payroll then works the month out from attendance." action="Employees" onAction={() => router.push('/m/hr/employees')} /> : null}

        {blocked.length ? <Notice tone="warning" title={`${blocked.length} can’t be run`} body={blocked.map((r) => `${r.employee.name}: ${r.problem ?? 'check the pay terms'}`).join('\n')} /> : null}

        {ready.length ? (
          <Section title="To run" style={{ marginTop: 0 }}>
            <View style={{ gap: 8 }}>{ready.map((r) => <Row key={r.employee.id} r={r} onPress={() => setPreview(r)} />)}</View>
            <Button label={`Run payroll for ${ready.length}`} size="lg" block onPress={() => void run()} />
          </Section>
        ) : null}

        {done.length ? (
          <Section title="Run" style={{ marginTop: 0 }}>
            <View style={{ gap: 8 }}>{done.map((r) => <Row key={r.employee.id} r={r} onPress={() => router.push({ pathname: '/m/hr/payroll/[id]', params: { id: r.existing!.id } } as never)} />)}</View>
            {unpaid.length ? (
              <View style={{ gap: 8 }}>
                <Button label={`Mark ${unpaid.length} as paid`} size="lg" block onPress={() => setPaying(true)} />
                <Button label="Bank transfer file" kind="outline" block icon={<Download size={18} color={c.ink} />} onPress={() => void exportBank()} />
              </View>
            ) : <T tone="success">Everyone is paid for {labelYM(month)}.</T>}
          </Section>
        ) : null}
        <T v="caption" tone="mute">{RATES_NOTE}</T>
      </View>

      <Sheet visible={!!preview} onClose={() => setPreview(null)} title={preview?.employee.name} subtitle={`${labelYM(month)} · preview`} full>
        {preview?.result ? (
          <View style={{ gap: 12, paddingBottom: 16 }}>
            <Card>
              {preview.result.earnings.map((l, i) => <KV key={i} k={l.label} v={inr(l.amount)} sub={l.full !== undefined && l.full !== l.amount ? `of ${inr(l.full)}` : undefined} />)}
              <KV k="Gross" v={inr(preview.result.gross)} strong />
            </Card>
            <Card>
              {preview.result.deductions.length ? preview.result.deductions.map((l, i) => <KV key={i} k={l.label} v={inr(l.amount)} />) : <T tone="mute">No deductions</T>}
              <KV k="Net pay" v={inr(preview.result.net)} strong big />
            </Card>
            <KV k="Days worked" v={String(preview.result.presentDays)} />
            <KV k="Loss of pay days" v={String(preview.result.lopDays)} />
            {preview.result.employerPf || preview.result.employerEsi ? <KV k="Employer PF + ESI" v={inr(preview.result.employerPf + preview.result.employerEsi)} /> : null}
            {preview.warnings.map((w) => <Notice key={w} tone="warning" title={w} />)}
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={paying} onClose={() => setPaying(false)} title="Mark salaries as paid" subtitle={`${unpaid.length} people · ${inr(unpaid.reduce((t, r) => t + r.existing!.net - r.paid, 0), 0)}`}
        footer={<View style={{ padding: 16 }}><Button label="Mark as paid" size="lg" block onPress={() => { if (act((s, ctx) => paySalaries(s, month, { mode, ref }, ctx), 'Marked as paid')) setPaying(false) }} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => setMode(m.value)} />)}</View>
          <Field label="Reference (optional)" value={ref} onChangeText={setRef} placeholder="Batch / UTR number" />
          <T tone="mute">Do this after the money has gone out. It books the payment against each person’s salary payable.</T>
        </View>
      </Sheet>
    </Screen>
  )
}

function Row({ r, onPress }: { r: PayrollRow; onPress: () => void }) {
  const { c } = useTheme()
  const x = r.existing ?? r.result
  const net = x?.net ?? 0
  const status = r.existing ? (r.paid >= r.existing.net && r.existing.net > 0 ? <Badge tone="success">Paid</Badge> : r.existing.net > 0 ? <Badge tone="warning">To pay</Badge> : null) : r.warnings.length ? <Badge tone="warning">{r.warnings.length} to check</Badge> : null
  return (
    <Tap onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
      <Avatar name={r.employee.name} size={38} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="bodyStrong" numberOfLines={1}>{r.employee.name}</T>
        <T v="caption" tone="mute" numberOfLines={1}>{r.existing ? r.existing.no : `${r.summary.presentDays} days${r.summary.lopDays ? ` · ${r.summary.lopDays} loss of pay` : ''}`}</T>
      </View>
      {status}
      <T v="num">{inr(net, 0)}</T>
    </Tap>
  )
}
