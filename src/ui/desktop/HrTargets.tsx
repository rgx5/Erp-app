import React from 'react'
import { View } from 'react-native'
import { inr } from '@/domain/money'
import { labelYM } from '@/modules/hr/logic/ymd'
import type { ScorecardRow } from '@/modules/hr/logic/targets'
import type { YM } from '@/modules/hr/types'
import { Button } from '@/ui/Button'
import { MoneyField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Row = { id: string; name: string; meta: string; sales: number; target: number; pct: number; incentiveLabel: string; incentiveTone: 'success' | 'default' | undefined }

export interface DesktopTargetsProps {
  month: YM; onPrevMonth: () => void; onNextMonth: () => void
  rows: ScorecardRow[]
  unlinkedNote: string | null
  canPay: boolean
  unpostedCount: number
  editing: ScorecardRow | null; setEditing: (v: ScorecardRow | null) => void
  amount: string; setAmount: (v: string) => void
  onOpenEdit: (r: ScorecardRow) => void
  onSave: () => void
  onPostIncentives: () => void
  onOpenPlans: () => void
}

/** The desktop Targets & incentives screen: everyone's sales against target as a dense grid — instead of a stack
 * of progress-bar cards — with the same "set target" `Sheet` the phone screen uses. */
export function DesktopTargets(p: DesktopTargetsProps) {
  const { c } = useTheme()

  const rows: Row[] = p.rows.map((r) => ({
    id: r.employee.id, name: r.employee.name,
    meta: [`${r.bills} ${r.bills === 1 ? 'bill' : 'bills'}`, r.attendancePct !== null ? `${Math.round(r.attendancePct)}% attendance` : '', r.lateCount ? `late ${r.lateCount}×` : ''].filter(Boolean).join(' · '),
    sales: r.sales, target: r.target, pct: r.target ? Math.min(1, r.sales / r.target) : 0,
    incentiveLabel: r.incentive.amount > 0 ? (r.posted ? 'In payroll' : `Incentive ${inr(r.incentive.amount, 0)}`) : '',
    incentiveTone: r.incentive.amount > 0 ? (r.posted ? 'default' : 'success') : undefined,
  }))

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Employee', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.meta}</T>
      </View>
    ) },
    { key: 'sales', label: 'Sales', width: 120, align: 'right', sortValue: (r) => r.sales, render: (r) => cellNum(inr(r.sales, 0), true) },
    { key: 'target', label: 'Target', width: 120, align: 'right', sortValue: (r) => r.target, render: (r) => cellText(r.target ? inr(r.target, 0) : 'No target') },
    { key: 'incentive', label: '', width: 150, render: (r) => (r.incentiveLabel ? <Pill tone={r.incentiveTone} label={r.incentiveLabel} /> : null) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Targets & incentives"
          subtitle={labelYM(p.month)}
          left={<><DeskButton label="‹" onPress={p.onPrevMonth} /><DeskButton label="›" onPress={p.onNextMonth} /></>}
          right={
            <>
              {p.canPay && p.unpostedCount ? <DeskButton label={`Add ${p.unpostedCount} to payroll`} tone="primary" onPress={p.onPostIncentives} /> : null}
              <DeskButton label="Incentive plans" onPress={p.onOpenPlans} />
            </>
          }
        />
      }
    >
      {p.unlinkedNote ? <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><T tone="mute">{p.unlinkedNote}</T></View> : null}

      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => p.onOpenEdit(p.rows.find((x) => x.employee.id === r.id)!)} emptyLabel={`No one to score in ${labelYM(p.month)}`} />
      </View>

      <Sheet visible={!!p.editing} onClose={() => p.setEditing(null)} title={`Target for ${p.editing?.employee.name ?? ''}`} subtitle={labelYM(p.month)}
        footer={<View style={{ padding: 16 }}><Button label="Save target" size="lg" block onPress={p.onSave} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <MoneyField label="Sales target (excluding GST)" value={p.amount} onChange={p.setAmount} large />
          {p.editing ? <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}><KV k="Sold so far" v={inr(p.editing.sales, 0)} /><KV k="Pieces" v={String(p.editing.pieces)} /></View> : null}
        </View>
      </Sheet>
    </DeskPage>
  )
}
