import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useCan } from '@/data/store'
import { scorecardTable } from '@/modules/hr/logic/reports'
import { scorecards, type ScorecardRow } from '@/modules/hr/logic/targets'
import { labelYM, ymOf } from '@/modules/hr/logic/ymd'
import { saveTarget } from '@/modules/hr/ops'
import { postIncentives } from '@/modules/hr/payrollOps'
import { act, Denied, ExportBar, MonthBar, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Avatar, Badge, Card, ProgressBar } from '@/ui/primitives'
import { EmptyState, KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Target } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Sales by each person (from the bills they are named on) against their target, with the incentive that earns. */
export default function Targets() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('hr')
  const canPay = useCan('payroll')
  const { data, now } = useHr()
  const [month, setMonth] = useState(ymOf(now))
  const [editing, setEditing] = useState<ScorecardRow | null>(null)
  const [amount, setAmount] = useState('')
  const rows = useMemo(() => (can ? scorecards(data, month, now) : []), [can, data, month, now])
  const table = useMemo(() => scorecardTable(rows, month), [rows, month])
  const unposted = rows.filter((r) => !r.posted && r.incentive.amount > 0)

  if (!can) return <Denied title="Targets" who="Targets and incentives are for the owner and managers." />
  const unlinked = rows.filter((r) => !r.employee.userId)
  return (
    <Screen title="Targets & incentives" back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <MonthBar month={month} onChange={setMonth} />
        {unlinked.length ? <Notice tone="primary" title={`${unlinked.length} not linked to a sign-in`} body={`${unlinked.map((r) => r.employee.name).join(', ')}: bills cannot name them as the salesperson until their employee profile is linked to a sign-in account.`} /> : null}
        {rows.length ? rows.map((r) => (
          <Card key={r.employee.id} onPress={() => { setEditing(r); setAmount(r.target ? String(r.target) : '') }} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={r.employee.name} size={38} />
              <View style={{ flex: 1 }}>
                <T v="bodyStrong" numberOfLines={1}>{r.employee.name}</T>
                <T v="caption" tone="mute">{r.bills} {r.bills === 1 ? 'bill' : 'bills'}{r.attendancePct !== null ? ` · ${Math.round(r.attendancePct)}% attendance` : ''}{r.lateCount ? ` · late ${r.lateCount}×` : ''}</T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T v="num">{inr(r.sales, 0)}</T>
                <T v="caption" tone="mute">{r.target ? `of ${inr(r.target, 0)}` : 'no target'}</T>
              </View>
            </View>
            {r.target ? <ProgressBar value={Math.min(1, r.sales / r.target)} tone={r.sales >= r.target ? 'success' : 'primary'} /> : null}
            {r.incentive.amount > 0 ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Badge tone={r.posted ? 'default' : 'success'}>{r.posted ? 'In payroll' : `Incentive ${inr(r.incentive.amount, 0)}`}</Badge><T v="caption" tone="mute">{r.incentive.ratePct}%{r.incentive.bonus ? ` + ${inr(r.incentive.bonus, 0)} bonus` : ''}{r.incentive.capped ? ' (capped)' : ''}</T></View> : null}
          </Card>
        )) : <EmptyState icon={<Target size={26} color={c.primary} />} title={`No one to score in ${labelYM(month)}`} hint="Add employees and link each to their sign-in account. Sales are counted from bills that name them as the salesperson." />}
        {canPay ? (
          <View style={{ gap: 10 }}>
            {unposted.length ? <Button label={`Add ${unposted.length} ${unposted.length === 1 ? 'incentive' : 'incentives'} to payroll`} size="lg" block onPress={() => act((s, ctx) => postIncentives(s, month, ctx), 'Added to payroll')} /> : null}
            <Button label="Incentive plans" kind="outline" block onPress={() => router.push('/m/hr/targets/plans')} />
          </View>
        ) : null}
        <ExportBar table={table} />
      </View>
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={`Target for ${editing?.employee.name ?? ''}`} subtitle={labelYM(month)}
        footer={<View style={{ padding: 16 }}><Button label="Save target" size="lg" block onPress={() => { if (editing && act((s, ctx) => saveTarget(s, { employeeId: editing.employee.id, month, amount: Number(amount) || 0 }, ctx), 'Target saved')) setEditing(null) }} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <MoneyField label="Sales target (excluding GST)" value={amount} onChange={setAmount} large />
          {editing ? <Card flat><KV k="Sold so far" v={inr(editing.sales, 0)} /><KV k="Pieces" v={String(editing.pieces)} /></Card> : null}
        </View>
      </Sheet>
    </Screen>
  )
}
