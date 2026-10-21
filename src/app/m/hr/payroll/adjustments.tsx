import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { inr } from '@/domain/money'
import { useCan } from '@/data/store'
import { consumedAdjustmentIds } from '@/modules/hr/logic/slips'
import { labelYM, ymOf } from '@/modules/hr/logic/ymd'
import { deleteAdjustment, postIncentives, saveAdjustment } from '@/modules/hr/payrollOps'
import type { AdjustmentKind, YM } from '@/modules/hr/types'
import { act, Denied, EmployeeSelect, MonthBar, useHr } from '@/modules/hr/ui/common'
import { ask } from '@/ui/overlays'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Chip, Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { Plus, Sparkles, Target, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

const KINDS: Array<{ value: AdjustmentKind; label: string }> = [{ value: 'incentive', label: 'Incentive' }, { value: 'bonus', label: 'Bonus' }, { value: 'allowance', label: 'Extra pay' }, { value: 'deduction', label: 'Fine / deduction' }]

/** One-off amounts for a month’s payslips: incentives, bonuses, fines. Each is used by exactly one payslip. */
export default function Adjustments() {
  const { c } = useTheme()
  const params = useLocalSearchParams<{ month?: string }>()
  const can = useCan('payroll')
  const { data, now } = useHr()
  const [month, setMonth] = useState<YM>((params.month as YM) || ymOf(now))
  const [open, setOpen] = useState(false)
  const [empId, setEmpId] = useState('')
  const [kind, setKind] = useState<AdjustmentKind>('bonus')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const used = consumedAdjustmentIds(data)
  const list = Object.values(data.payAdjustments ?? {}).filter((a) => a.month === month).sort((a, b) => b.createdAt - a.createdAt)
  const employees = Object.values(data.employees ?? {}).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))

  if (!can) return <Denied title="Adjustments" who="Pay adjustments are for the owner and managers with payroll access." />
  return (
    <Screen title="Pay adjustments" back right={<Button label="Add" size="sm" icon={<Plus size={16} color={c.onPrimary} />} onPress={() => { setEmpId(''); setKind('bonus'); setLabel(''); setAmount(''); setOpen(true) }} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <MonthBar month={month} onChange={setMonth} />
        <Button label="Add sales incentives from targets" kind="soft" icon={<Target size={18} color={c.primary} />} onPress={() => { const r = act((s, ctx) => postIncentives(s, month, ctx), undefined); if (r) { setMonth(month); void r } }} />
        {list.length ? (
          <Group>
            {list.map((a) => (
              <ListRow key={a.id} icon={<Sparkles size={18} color={c.primary} />} title={`${data.employees?.[a.employeeId]?.name ?? 'Former staff'} · ${a.label}`} subtitle={a.note || a.source}
                value={`${a.kind === 'deduction' ? '−' : '+'}${inr(a.amount, 0)}`} valueTone={a.kind === 'deduction' ? 'danger' : 'success'}
                badge={used.has(a.id) ? <Badge tone="default">In payslip</Badge> : undefined}
                right={used.has(a.id) ? undefined : <Trash size={18} color={c.inkMute} />} chevron={false}
                onPress={async () => { if (!used.has(a.id) && await ask({ title: 'Delete this adjustment?', confirm: 'Delete', cancel: 'Keep' })) act((s, ctx) => deleteAdjustment(s, a.id, ctx), 'Deleted') }} />
            ))}
          </Group>
        ) : <EmptyState icon={<Sparkles size={26} color={c.primary} />} title={`Nothing for ${labelYM(month)}`} hint="Add a bonus, an incentive or a fine for a person. The next payroll run for that month includes it." compact />}
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title="New adjustment" subtitle={labelYM(month)} full
        footer={<View style={{ padding: 16 }}><Button label="Save" size="lg" block onPress={() => { if (act((s, ctx) => saveAdjustment(s, { employeeId: empId, month, kind, label, amount: Number(amount), note: '' }, undefined, ctx), 'Saved')) setOpen(false) }} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <EmployeeSelect value={empId} onChange={setEmpId} employees={employees} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{KINDS.map((k) => <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => setKind(k.value)} />)}</View>
          <Field label="What for" value={label} onChangeText={setLabel} placeholder="Diwali bonus, cash short…" />
          <MoneyField label="Amount" value={amount} onChange={setAmount} />
        </View>
      </Sheet>
    </Screen>
  )
}
