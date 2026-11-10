import React from 'react'
import { View } from 'react-native'
import { inr } from '@/domain/money'
import { labelYM } from '@/modules/hr/logic/ymd'
import type { PayrollRow } from '@/modules/hr/logic/payroll'
import type { YM } from '@/modules/hr/types'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip } from '@/ui/primitives'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, Settings } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Row = { id: string; name: string; meta: string; net: number; badge: 'paid' | 'topay' | 'warn' | null; warnCount: number }
const MODE_OPTIONS: Array<{ value: 'cash' | 'bank' | 'upi'; label: string }> = [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }]

export interface DesktopPayrollProps {
  month: YM; onPrevMonth: () => void; onNextMonth: () => void
  totals: { net: number; cost: number }
  ready: PayrollRow[]
  blocked: PayrollRow[]
  done: PayrollRow[]
  unpaid: PayrollRow[]
  warnCount: number
  ratesNote: string
  preview: PayrollRow | null; setPreview: (v: PayrollRow | null) => void
  paying: boolean; setPaying: (v: boolean) => void
  mode: 'cash' | 'bank' | 'upi'; setMode: (v: 'cash' | 'bank' | 'upi') => void
  ref: string; setRef: (v: string) => void
  onRun: () => void
  onOpenPaying: () => void
  onConfirmPaid: () => void
  onExportBank: () => void
  onOpenSettings: () => void
  onOpenSlip: (id: string) => void
  onOpenAdjustments: () => void
  onOpenRegister: () => void
  onOpenStatutory: () => void
}

/**
 * The desktop Payroll screen: the month's totals as a `KpiStrip`, the "to run" and "run" lists as one dense grid —
 * instead of two stacks of cards — and the same preview / mark-as-paid `Sheet`s the phone screen uses.
 */
export function DesktopPayroll(p: DesktopPayrollProps) {
  const { c } = useTheme()

  const rowOf = (r: PayrollRow): Row => {
    const x = r.existing ?? r.result
    const net = x?.net ?? 0
    const badge: Row['badge'] = r.existing ? (r.paid >= r.existing.net && r.existing.net > 0 ? 'paid' : r.existing.net > 0 ? 'topay' : null) : r.warnings.length ? 'warn' : null
    return { id: r.employee.id, name: r.employee.name, meta: r.existing ? r.existing.no : `${r.summary.presentDays} days${r.summary.lopDays ? ` · ${r.summary.lopDays} loss of pay` : ''}`, net, badge, warnCount: r.warnings.length }
  }

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Employee', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.meta}</T>
      </View>
    ) },
    { key: 'badge', label: '', width: 110, render: (r) => (r.badge === 'paid' ? <Pill tone="success" label="Paid" /> : r.badge === 'topay' ? <Pill tone="warning" label="To pay" /> : r.badge === 'warn' ? <Pill tone="warning" label={`${r.warnCount} to check`} /> : null) },
    { key: 'net', label: 'Net', width: 120, align: 'right', sortValue: (r) => r.net, render: (r) => cellNum(inr(r.net, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Payroll"
          subtitle={labelYM(p.month)}
          left={<><DeskButton label="‹" onPress={p.onPrevMonth} /><DeskButton label="›" onPress={p.onNextMonth} /></>}
          right={<DeskButton label="Settings" icon={<Settings size={14} color={c.ink} />} onPress={p.onOpenSettings} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Net pay" value={inr(p.totals.net, 0)} tone="primary" />
        <KpiTile label="Cost to business" value={inr(p.totals.cost, 0)} tone="accent" delta="with employer PF / ESI" />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <DeskButton label="Adjustments" onPress={p.onOpenAdjustments} />
        <DeskButton label="Register" onPress={p.onOpenRegister} />
        <DeskButton label="PF · ESI · PT · TDS" onPress={p.onOpenStatutory} />
        <View style={{ flex: 1 }} />
        {p.ready.length ? <DeskButton label={`Run payroll for ${p.ready.length}`} tone="primary" onPress={p.onRun} /> : null}
        {p.unpaid.length ? <DeskButton label={`Mark ${p.unpaid.length} as paid`} tone="primary" onPress={p.onOpenPaying} /> : null}
        {p.done.length ? <DeskButton label="Bank transfer file" icon={<Download size={14} color={c.ink} />} onPress={p.onExportBank} /> : null}
      </View>

      {p.blocked.length ? (
        <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
          <Notice tone="warning" title={`${p.blocked.length} can't be run`} body={p.blocked.map((r) => `${r.employee.name}: ${r.problem ?? 'check the pay terms'}`).join('\n')} />
        </View>
      ) : null}

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={[...p.ready, ...p.done].map(rowOf)}
          columns={columns}
          onRowPress={(r) => {
            const found = p.ready.find((x) => x.employee.id === r.id)
            if (found) { p.setPreview(found); return }
            const d = p.done.find((x) => x.employee.id === r.id)
            if (d?.existing) p.onOpenSlip(d.existing.id)
          }}
          emptyLabel="No one to pay this month"
        />
      </View>
      <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}><T tone="mute">{p.ratesNote}</T></View>

      <Sheet visible={!!p.preview} onClose={() => p.setPreview(null)} title={p.preview?.employee.name} subtitle={`${labelYM(p.month)} · preview`} full>
        {p.preview?.result ? (
          <View style={{ gap: 12, paddingBottom: 16 }}>
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              {p.preview.result.earnings.map((l, i) => <KV key={i} k={l.label} v={inr(l.amount)} sub={l.full !== undefined && l.full !== l.amount ? `of ${inr(l.full)}` : undefined} />)}
              <KV k="Gross" v={inr(p.preview.result.gross)} strong />
            </View>
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              {p.preview.result.deductions.length ? p.preview.result.deductions.map((l, i) => <KV key={i} k={l.label} v={inr(l.amount)} />) : <T tone="mute">No deductions</T>}
              <KV k="Net pay" v={inr(p.preview.result.net)} strong big />
            </View>
            <KV k="Days worked" v={String(p.preview.result.presentDays)} />
            <KV k="Loss of pay days" v={String(p.preview.result.lopDays)} />
            {p.preview.result.employerPf || p.preview.result.employerEsi ? <KV k="Employer PF + ESI" v={inr(p.preview.result.employerPf + p.preview.result.employerEsi)} /> : null}
            {p.preview.warnings.map((w) => <Notice key={w} tone="warning" title={w} />)}
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={p.paying} onClose={() => p.setPaying(false)} title="Mark salaries as paid" subtitle={`${p.unpaid.length} people · ${inr(p.unpaid.reduce((t, r) => t + r.existing!.net - r.paid, 0), 0)}`}
        footer={<View style={{ padding: 16 }}><Button label="Mark as paid" size="lg" block onPress={p.onConfirmPaid} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={p.mode === m.value} onPress={() => p.setMode(m.value)} />)}</View>
          <Field label="Reference (optional)" value={p.ref} onChangeText={p.setRef} placeholder="Batch / UTR number" />
          <T tone="mute">Do this after the money has gone out. It books the payment against each person&apos;s salary payable.</T>
        </View>
      </Sheet>
    </DeskPage>
  )
}
