import React, { useState } from 'react'
import { View } from 'react-native'
import { useCan } from '@/data/store'
import { deleteIncentivePlan, saveIncentivePlan } from '@/modules/hr/payrollOps'
import type { IncentivePlan } from '@/modules/hr/types'
import { act, Denied, EmployeeSelect, useHr } from '@/modules/hr/ui/common'
import { ask } from '@/ui/overlays'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Group, Tap } from '@/ui/primitives'
import { EmptyState, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Target, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** How sales turn into incentive pay: a rate, better rates at higher achievement, a bonus for hitting target. */
export default function Plans() {
  const { c } = useTheme()
  const can = useCan('payroll')
  const { data } = useHr()
  const [editing, setEditing] = useState<{ id?: string } | null>(null)
  const [name, setName] = useState('')
  const [empId, setEmpId] = useState('')
  const [base, setBase] = useState('1')
  const [slabs, setSlabs] = useState<Array<{ min: string; rate: string }>>([])
  const [bonus, setBonus] = useState('')
  const [minSales, setMinSales] = useState('')
  const [cap, setCap] = useState('')
  const [active, setActive] = useState(true)
  const list = Object.values(data.incentivePlans ?? {}).sort((a, b) => a.name.localeCompare(b.name))
  const employees = Object.values(data.employees ?? {}).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))

  if (!can) return <Denied title="Incentive plans" who="Incentive plans are for the owner and managers with payroll access." />
  const open = (p?: IncentivePlan) => {
    setName(p?.name ?? ''); setEmpId(p?.employeeId ?? ''); setBase(String(p?.baseRatePct ?? 1)); setSlabs((p?.slabs ?? []).map((s) => ({ min: String(s.minAchievementPct), rate: String(s.ratePct) })))
    setBonus(p?.bonusAtTarget ? String(p.bonusAtTarget) : ''); setMinSales(p?.minSales ? String(p.minSales) : ''); setCap(p?.cap ? String(p.cap) : ''); setActive(p?.active ?? true); setEditing({ id: p?.id })
  }
  const save = () => {
    const ok = act((s, ctx) => saveIncentivePlan(s, {
      name, employeeId: empId || undefined, baseRatePct: Number(base) || 0, slabs: slabs.map((x) => ({ minAchievementPct: Number(x.min) || 0, ratePct: Number(x.rate) || 0 })),
      bonusAtTarget: Number(bonus) || 0, minSales: Number(minSales) || 0, cap: Number(cap) || 0, active,
    }, editing?.id, ctx), 'Plan saved')
    if (ok) setEditing(null)
  }
  return (
    <Screen title="Incentive plans" back right={<Button label="New" size="sm" icon={<Plus size={16} color={c.onPrimary} />} onPress={() => open()} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        {list.length ? (
          <Group>{list.map((p) => <ListRow key={p.id} icon={<Target size={18} color={c.primary} />} title={p.name} subtitle={`${p.baseRatePct}% of sales${p.slabs.length ? ` · ${p.slabs.length} slab${p.slabs.length === 1 ? '' : 's'}` : ''}${p.bonusAtTarget ? ` · bonus ₹${p.bonusAtTarget}` : ''} · ${p.employeeId ? data.employees?.[p.employeeId]?.name ?? 'one person' : 'everyone'}${p.active ? '' : ' · off'}`} onPress={() => open(p)} />)}</Group>
        ) : <EmptyState icon={<Target size={26} color={c.primary} />} title="No plans yet" hint="Without a plan no incentive is worked out. A simple plan is 1% of sales for everyone, and 2% once a person reaches 100% of their target." action="New plan" onAction={() => open()} />}
      </View>
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit plan' : 'New plan'} full
        footer={(
          <View style={{ padding: 16, gap: 10 }}>
            <Button label="Save" size="lg" block onPress={save} />
            {editing?.id ? <Button label="Delete" kind="outline" block onPress={async () => { if (await ask({ title: 'Delete this plan?', confirm: 'Delete', cancel: 'Keep' }) && act((s, ctx) => deleteIncentivePlan(s, editing.id!, ctx), 'Deleted')) setEditing(null) }} /> : null}
          </View>
        )}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Floor staff" />
          <EmployeeSelect label="For (leave empty for everyone)" value={empId} onChange={setEmpId} employees={[{ id: '', name: 'Everyone', code: '', designation: '' } as never, ...employees]} />
          <NumberField label="Rate on sales (%)" value={base} onChange={setBase} decimals hint="Of sales without GST, returns taken off" />
          <Section title="Better rates at higher achievement" style={{ marginTop: 0 }} action="Add slab" onAction={() => setSlabs((l) => [...l, { min: '100', rate: '2' }])}>
            <View style={{ gap: 8 }}>
              {slabs.map((sl, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                  <NumberField containerStyle={{ flex: 1 }} label={i === 0 ? 'From % of target' : undefined} value={sl.min} onChange={(t) => setSlabs((l) => l.map((x, k) => (k === i ? { ...x, min: t } : x)))} decimals />
                  <NumberField containerStyle={{ flex: 1 }} label={i === 0 ? 'Rate %' : undefined} value={sl.rate} onChange={(t) => setSlabs((l) => l.map((x, k) => (k === i ? { ...x, rate: t } : x)))} decimals />
                  <Tap onPress={() => setSlabs((l) => l.filter((_, k) => k !== i))} style={{ paddingBottom: 14 }}><Trash size={20} color={c.inkMute} /></Tap>
                </View>
              ))}
              {!slabs.length ? <T tone="mute">None — the rate above always applies.</T> : null}
            </View>
          </Section>
          <MoneyField label="Bonus when the target is met" value={bonus} onChange={setBonus} />
          <MoneyField label="Nothing below sales of" value={minSales} onChange={setMinSales} />
          <MoneyField label="Most paid in a month (0 = no limit)" value={cap} onChange={setCap} />
          <SwitchRow title="In use" value={active} onChange={setActive} />
        </View>
      </Sheet>
    </Screen>
  )
}
