import React, { useState } from 'react'
import { View } from 'react-native'
import { useCan } from '@/data/store'
import { deleteLeaveType, saveLeaveType, seedLeaveTypes } from '@/modules/hr/ops'
import type { LeaveType } from '@/modules/hr/types'
import { act, Denied, useHr } from '@/modules/hr/ui/common'
import { ask } from '@/ui/overlays'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { CalendarCheck, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Casual, sick, earned, unpaid… how many days a year, how they accrue, and what carries over. */
export default function LeaveTypes() {
  const { c } = useTheme()
  const can = useCan('hr')
  const { data } = useHr()
  const [editing, setEditing] = useState<{ id?: string } | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [days, setDays] = useState('12')
  const [accrual, setAccrual] = useState<'monthly' | 'yearly'>('monthly')
  const [carry, setCarry] = useState('0')
  const [paid, setPaid] = useState(true)
  const [negative, setNegative] = useState(false)
  const [active, setActive] = useState(true)
  const list = Object.values(data.leaveTypes ?? {}).sort((a, b) => a.name.localeCompare(b.name))

  if (!can) return <Denied title="Leave types" who="Leave types are for the owner and managers." />
  const open = (t?: LeaveType) => { setName(t?.name ?? ''); setCode(t?.code ?? ''); setDays(String(t?.daysPerYear ?? 12)); setAccrual(t?.accrual ?? 'monthly'); setCarry(String(t?.carryForwardMax ?? 0)); setPaid(t?.paid ?? true); setNegative(t?.allowNegative ?? false); setActive(t?.active ?? true); setEditing({ id: t?.id }) }
  const save = () => { if (act((s, ctx) => saveLeaveType(s, { name, code, daysPerYear: Number(days) || 0, accrual, carryForwardMax: Number(carry) || 0, paid, allowNegative: negative, active }, editing?.id, ctx), 'Saved')) setEditing(null) }

  return (
    <Screen title="Leave types" back right={<Button label="New" size="sm" icon={<Plus size={16} color={c.onPrimary} />} onPress={() => open()} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        {list.length ? (
          <Group>{list.map((t) => <ListRow key={t.id} icon={<CalendarCheck size={18} color={c.primary} />} title={`${t.name} (${t.code})`} subtitle={t.paid ? `${t.daysPerYear} days a year · ${t.accrual}${t.carryForwardMax ? ` · carry up to ${t.carryForwardMax}` : ''}${t.active ? '' : ' · off'}` : 'Unpaid · no balance'} onPress={() => open(t)} />)}</Group>
        ) : <EmptyState icon={<CalendarCheck size={26} color={c.primary} />} title="No leave types yet" hint="Start with casual (12 days), sick (6), earned (15) and unpaid leave. You can change them any time." action="Add the usual four" onAction={() => act((s, ctx) => seedLeaveTypes(s, ctx), 'Leave types added')} />}
      </View>
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit leave type' : 'New leave type'} full
        footer={(
          <View style={{ padding: 16, gap: 10 }}>
            <Button label="Save" size="lg" block onPress={save} />
            {editing?.id ? <Button label="Delete" kind="outline" block onPress={async () => { if (await ask({ title: 'Delete this leave type?', confirm: 'Delete', cancel: 'Keep' }) && act((s, ctx) => deleteLeaveType(s, editing.id!, ctx), 'Deleted')) setEditing(null) }} /> : null}
          </View>
        )}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Casual leave" />
          <Field label="Short code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="CL" />
          <SwitchRow title="Paid leave" subtitle="Off for leave without pay" value={paid} onChange={setPaid} />
          {paid ? (
            <>
              <NumberField label="Days in a year" value={days} onChange={setDays} decimals />
              <Segmented value={accrual} options={[{ value: 'monthly', label: 'A little each month' }, { value: 'yearly', label: 'All at the start' }]} onChange={setAccrual} />
              <NumberField label="Most that carries to next year" value={carry} onChange={setCarry} decimals />
              <SwitchRow title="May go below zero" subtitle="Let a request take more than the balance" value={negative} onChange={setNegative} />
            </>
          ) : null}
          <SwitchRow title="In use" value={active} onChange={setActive} />
        </View>
      </Sheet>
    </Screen>
  )
}
