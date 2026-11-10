import React from 'react'
import { View } from 'react-native'
import { inr } from '@/domain/money'
import { labelYM } from '@/modules/hr/logic/ymd'
import type { AdjustmentKind, Employee, PayAdjustment, YM } from '@/modules/hr/types'
import { Button } from '@/ui/Button'
import { Field, MoneyField, Select } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Plus, Target } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Pill, Toolbar, cellNum, dtext, type Column } from './kit'

const KINDS: Array<{ value: AdjustmentKind; label: string }> = [{ value: 'incentive', label: 'Incentive' }, { value: 'bonus', label: 'Bonus' }, { value: 'allowance', label: 'Extra pay' }, { value: 'deduction', label: 'Fine / deduction' }]
type Row = { id: string; title: string; subtitle: string; amount: string; tone: 'danger' | 'success'; inPayslip: boolean; deletable: boolean; raw: PayAdjustment }

export interface DesktopPayrollAdjustmentsProps {
  month: YM; onPrevMonth: () => void; onNextMonth: () => void
  list: PayAdjustment[]
  employeeName: (id: string) => string
  used: Set<string>
  open: boolean; setOpen: (v: boolean) => void
  empId: string; setEmpId: (v: string) => void
  employees: Employee[]
  kind: AdjustmentKind; setKind: (v: AdjustmentKind) => void
  label: string; setLabel: (v: string) => void
  amount: string; setAmount: (v: string) => void
  onNew: () => void
  onSave: () => void
  onDelete: (id: string) => void
  onPostIncentives: () => void
}

/** The desktop pay-adjustments screen: the month's bonuses, incentives and fines as a dense grid. */
export function DesktopPayrollAdjustments(p: DesktopPayrollAdjustmentsProps) {
  const { c } = useTheme()

  const rows: Row[] = p.list.map((a) => ({
    id: a.id, title: `${p.employeeName(a.employeeId)} · ${a.label}`, subtitle: a.note || a.source,
    amount: `${a.kind === 'deduction' ? '−' : '+'}${inr(a.amount, 0)}`, tone: a.kind === 'deduction' ? 'danger' : 'success', inPayslip: p.used.has(a.id), deletable: !p.used.has(a.id), raw: a,
  }))

  const columns: Array<Column<Row>> = [
    { key: 'title', label: 'Who / what for', sortValue: (r) => r.title, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.title}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.subtitle}</T>
      </View>
    ) },
    { key: 'status', label: '', width: 110, render: (r) => (r.inPayslip ? <Pill label="In payslip" /> : null) },
    { key: 'amount', label: 'Amount', width: 110, align: 'right', render: (r) => cellNum(r.amount, true) },
    { key: 'del', label: '', width: 70, render: (r) => (r.deletable ? <DeskButton label="Delete" onPress={() => p.onDelete(r.id)} /> : null) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Pay adjustments"
          subtitle={labelYM(p.month)}
          left={<><DeskButton label="‹" onPress={p.onPrevMonth} /><DeskButton label="›" onPress={p.onNextMonth} /></>}
          right={<DeskButton label="Add" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={p.onNew} />}
        />
      }
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 }}>
        <DeskButton label="Add sales incentives from targets" icon={<Target size={14} color={c.ink} />} onPress={p.onPostIncentives} />
      </View>
      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} emptyLabel={`Nothing for ${labelYM(p.month)}`} />
      </View>

      <Sheet visible={p.open} onClose={() => p.setOpen(false)} title="New adjustment" subtitle={labelYM(p.month)} full
        footer={<View style={{ padding: 16 }}><Button label="Save" size="lg" block onPress={p.onSave} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Select label="Employee" value={p.empId} onChange={p.setEmpId} searchable={p.employees.length > 8} placeholder="Choose a person" options={p.employees.map((e) => ({ value: e.id, label: e.name }))} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{KINDS.map((k) => <Chip key={k.value} label={k.label} selected={p.kind === k.value} onPress={() => p.setKind(k.value)} />)}</View>
          <Field label="What for" value={p.label} onChangeText={p.setLabel} placeholder="Diwali bonus, cash short…" />
          <MoneyField label="Amount" value={p.amount} onChange={p.setAmount} />
        </View>
      </Sheet>
    </DeskPage>
  )
}
