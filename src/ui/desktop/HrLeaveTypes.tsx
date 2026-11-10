import React from 'react'
import { View } from 'react-native'
import type { LeaveType } from '@/modules/hr/types'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Toolbar, cellText, dtext, type Column } from './kit'

type Row = { id: string; name: string; subtitle: string }

export interface DesktopLeaveTypesProps {
  list: LeaveType[]
  editing: { id?: string } | null
  name: string; setName: (v: string) => void
  code: string; setCode: (v: string) => void
  days: string; setDays: (v: string) => void
  accrual: 'monthly' | 'yearly'; setAccrual: (v: 'monthly' | 'yearly') => void
  carry: string; setCarry: (v: string) => void
  paid: boolean; setPaid: (v: boolean) => void
  negative: boolean; setNegative: (v: boolean) => void
  active: boolean; setActive: (v: boolean) => void
  onOpen: (t?: LeaveType) => void
  onClose: () => void
  onSave: () => void
  onDelete: () => void
  onSeed: () => void
}

/** The desktop leave-types screen: the list as a dense grid, and the editor as the same `Sheet` the phone uses. */
export function DesktopLeaveTypes(p: DesktopLeaveTypesProps) {
  const { c } = useTheme()

  const rows: Row[] = p.list.map((t) => ({ id: t.id, name: `${t.name} (${t.code})`, subtitle: t.paid ? `${t.daysPerYear} days a year · ${t.accrual}${t.carryForwardMax ? ` · carry up to ${t.carryForwardMax}` : ''}${t.active ? '' : ' · off'}` : 'Unpaid · no balance' }))
  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Leave type', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.subtitle}</T>
      </View>
    ) },
  ]

  return (
    <DeskPage toolbar={<Toolbar title="Leave types" right={<DeskButton label="New" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => p.onOpen()} />} />}>
      {p.list.length ? (
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} onRowPress={(r) => p.onOpen(p.list.find((t) => t.id === r.id))} emptyLabel="No leave types yet" />
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <T tone="mute">Start with casual (12 days), sick (6), earned (15) and unpaid leave.</T>
          <DeskButton label="Add the usual four" tone="primary" onPress={p.onSeed} />
        </View>
      )}

      <Sheet visible={!!p.editing} onClose={p.onClose} title={p.editing?.id ? 'Edit leave type' : 'New leave type'} full
        footer={(
          <View style={{ padding: 16, gap: 10 }}>
            <Button label="Save" size="lg" block onPress={p.onSave} />
            {p.editing?.id ? <Button label="Delete" kind="outline" block onPress={p.onDelete} /> : null}
          </View>
        )}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Name" value={p.name} onChangeText={p.setName} placeholder="Casual leave" />
          <Field label="Short code" value={p.code} onChangeText={p.setCode} autoCapitalize="characters" placeholder="CL" />
          <SwitchRow title="Paid leave" subtitle="Off for leave without pay" value={p.paid} onChange={p.setPaid} />
          {p.paid ? (
            <>
              <NumberField label="Days in a year" value={p.days} onChange={p.setDays} decimals />
              <Segmented value={p.accrual} options={[{ value: 'monthly', label: 'A little each month' }, { value: 'yearly', label: 'All at the start' }]} onChange={p.setAccrual} />
              <NumberField label="Most that carries to next year" value={p.carry} onChange={p.setCarry} decimals />
              <SwitchRow title="May go below zero" subtitle="Let a request take more than the balance" value={p.negative} onChange={p.setNegative} />
            </>
          ) : null}
          <SwitchRow title="In use" value={p.active} onChange={p.setActive} />
        </View>
      </Sheet>
    </DeskPage>
  )
}
