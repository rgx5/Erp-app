import React from 'react'
import { View } from 'react-native'
import type { IncentivePlan } from '@/modules/hr/types'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Select, SwitchRow } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Tap } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Toolbar, dtext, type Column } from './kit'

type Row = { id: string; name: string; subtitle: string }
type SlabRow = { min: string; rate: string }

export interface DesktopTargetPlansProps {
  list: IncentivePlan[]
  employeeName: (id: string) => string
  editing: { id?: string } | null
  name: string; setName: (v: string) => void
  empId: string; setEmpId: (v: string) => void
  employees: Array<{ id: string; name: string }>
  base: string; setBase: (v: string) => void
  slabs: SlabRow[]; setSlabs: (v: SlabRow[]) => void
  bonus: string; setBonus: (v: string) => void
  minSales: string; setMinSales: (v: string) => void
  cap: string; setCap: (v: string) => void
  active: boolean; setActive: (v: boolean) => void
  onOpen: (p?: IncentivePlan) => void
  onClose: () => void
  onSave: () => void
  onDelete: () => void
}

/** The desktop incentive-plans screen: the list as a dense grid, and the editor as the same `Sheet` the phone uses. */
export function DesktopTargetPlans(p: DesktopTargetPlansProps) {
  const { c } = useTheme()

  const rows: Row[] = p.list.map((pl) => ({
    id: pl.id, name: pl.name,
    subtitle: `${pl.baseRatePct}% of sales${pl.slabs.length ? ` · ${pl.slabs.length} slab${pl.slabs.length === 1 ? '' : 's'}` : ''}${pl.bonusAtTarget ? ` · bonus ₹${pl.bonusAtTarget}` : ''} · ${pl.employeeId ? p.employeeName(pl.employeeId) : 'everyone'}${pl.active ? '' : ' · off'}`,
  }))
  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Plan', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.subtitle}</T>
      </View>
    ) },
  ]

  return (
    <DeskPage toolbar={<Toolbar title="Incentive plans" right={<DeskButton label="New" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => p.onOpen()} />} />}>
      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => p.onOpen(p.list.find((pl) => pl.id === r.id))} emptyLabel="No plans yet" />
      </View>

      <Sheet visible={!!p.editing} onClose={p.onClose} title={p.editing?.id ? 'Edit plan' : 'New plan'} full
        footer={(
          <View style={{ padding: 16, gap: 10 }}>
            <Button label="Save" size="lg" block onPress={p.onSave} />
            {p.editing?.id ? <Button label="Delete" kind="outline" block onPress={p.onDelete} /> : null}
          </View>
        )}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Name" value={p.name} onChangeText={p.setName} placeholder="Floor staff" />
          <Select label="For (leave empty for everyone)" value={p.empId} onChange={p.setEmpId} options={[{ value: '', label: 'Everyone' }, ...p.employees.map((e) => ({ value: e.id, label: e.name }))]} />
          <NumberField label="Rate on sales (%)" value={p.base} onChange={p.setBase} decimals hint="Of sales without GST, returns taken off" />
          <Section title="Better rates at higher achievement" style={{ marginTop: 0 }} action="Add slab" onAction={() => p.setSlabs([...p.slabs, { min: '100', rate: '2' }])}>
            <View style={{ gap: 8 }}>
              {p.slabs.map((sl, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                  <NumberField containerStyle={{ flex: 1 }} label={i === 0 ? 'From % of target' : undefined} value={sl.min} onChange={(t) => p.setSlabs(p.slabs.map((x, k) => (k === i ? { ...x, min: t } : x)))} decimals />
                  <NumberField containerStyle={{ flex: 1 }} label={i === 0 ? 'Rate %' : undefined} value={sl.rate} onChange={(t) => p.setSlabs(p.slabs.map((x, k) => (k === i ? { ...x, rate: t } : x)))} decimals />
                  <Tap onPress={() => p.setSlabs(p.slabs.filter((_, k) => k !== i))} style={{ paddingBottom: 14 }}><Trash size={20} color={c.inkMute} /></Tap>
                </View>
              ))}
              {!p.slabs.length ? <T tone="mute">None — the rate above always applies.</T> : null}
            </View>
          </Section>
          <MoneyField label="Bonus when the target is met" value={p.bonus} onChange={p.setBonus} />
          <MoneyField label="Nothing below sales of" value={p.minSales} onChange={p.setMinSales} />
          <MoneyField label="Most paid in a month (0 = no limit)" value={p.cap} onChange={p.setCap} />
          <SwitchRow title="In use" value={p.active} onChange={p.setActive} />
        </View>
      </Sheet>
    </DeskPage>
  )
}
