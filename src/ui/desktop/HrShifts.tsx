import React from 'react'
import { ScrollView, View } from 'react-native'
import { labelYMD, weekdayOf } from '@/modules/hr/logic/ymd'
import type { Employee, WorkShift, YMD } from '@/modules/hr/types'
import { Button } from '@/ui/Button'
import { Field, NumberField, Select, SwitchRow } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, cellText, dtext, type Column } from './kit'

/**
 * The desktop content for each tab of Shifts & holidays — the outer `DeskPage`/`Toolbar`/tab-switcher chrome lives
 * in `src/app/m/hr/shifts/index.tsx` itself (so the same segmented control drives both the mobile `Screen` and the
 * desktop toolbar); each of these three is just that tab's dense-grid body, mounted only while its tab is active,
 * exactly like the phone `ShiftsTab`/`RosterTab`/`HolidaysTab` components.
 */

// ───────────────────────────── shifts tab ─────────────────────────────

type ShiftRow = { id: string; name: string; subtitle: string }

export interface ShiftsTabProps {
  shifts: WorkShift[]
  editing: { id?: string } | null
  name: string; setName: (v: string) => void
  start: string; setStart: (v: string) => void
  end: string; setEnd: (v: string) => void
  brk: string; setBrk: (v: string) => void
  grace: string; setGrace: (v: string) => void
  active: boolean; setActive: (v: boolean) => void
  onOpen: (s?: WorkShift) => void
  onClose: () => void
  onSave: () => void
  onDelete: () => void
}

export function DesktopShiftsTab(p: ShiftsTabProps) {
  const { c } = useTheme()
  const rows: ShiftRow[] = p.shifts.map((s) => ({ id: s.id, name: s.name, subtitle: `${s.start}–${s.end} · break ${s.breakMins} min · grace ${s.graceMins} min${s.active ? '' : ' · off'}` }))
  const columns: Array<Column<ShiftRow>> = [
    { key: 'name', label: 'Shift', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.subtitle}</T>
      </View>
    ) },
  ]
  return (
    <>
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 }}>
        <DeskButton label="New shift" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => p.onOpen()} />
      </View>
      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => p.onOpen(p.shifts.find((s) => s.id === r.id))} emptyLabel="No shifts yet" />
      </View>

      <Sheet visible={!!p.editing} onClose={p.onClose} title={p.editing?.id ? 'Edit shift' : 'New shift'}
        footer={(
          <View style={{ padding: 16, gap: 10 }}>
            <Button label="Save" size="lg" block onPress={p.onSave} />
            {p.editing?.id ? <Button label="Delete shift" kind="outline" block onPress={p.onDelete} /> : null}
          </View>
        )}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Name" value={p.name} onChangeText={p.setName} placeholder="Morning, Evening, Night" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field containerStyle={{ flex: 1 }} label="Starts" value={p.start} onChangeText={p.setStart} autoCapitalize="none" placeholder="09:00" />
            <Field containerStyle={{ flex: 1 }} label="Ends" value={p.end} onChangeText={p.setEnd} autoCapitalize="none" placeholder="18:00" />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NumberField containerStyle={{ flex: 1 }} label="Break (min)" value={p.brk} onChange={p.setBrk} />
            <NumberField containerStyle={{ flex: 1 }} label="Grace (min)" value={p.grace} onChange={p.setGrace} hint="Late after this" />
          </View>
          <SwitchRow title="In use" value={p.active} onChange={p.setActive} />
        </View>
      </Sheet>
    </>
  )
}

// ───────────────────────────── roster tab ─────────────────────────────

export interface RosterTabProps {
  from: YMD; onPrevWeek: () => void; onNextWeek: () => void
  people: Employee[]
  shifts: WorkShift[]
  days: YMD[]
  cellOf: (empId: string, d: YMD, weeklyOff: number[], usual?: string) => string
  weekdayLabels: readonly string[]
  open: boolean; setOpen: (v: boolean) => void
  ids: string[]; setIds: (v: string[] | ((l: string[]) => string[])) => void
  a: string; setA: (v: string) => void
  b: string; setB: (v: string) => void
  shift: string; setShift: (v: string) => void
  skip: boolean; setSkip: (v: boolean) => void
  onOpenAssign: () => void
  onSave: () => void
}

export function DesktopRosterTab(p: RosterTabProps) {
  const { c } = useTheme()
  return (
    <>
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', gap: 8 }}>
        <DeskButton label="‹ Week" onPress={p.onPrevWeek} />
        <DeskButton label="Week ›" onPress={p.onNextWeek} />
        <View style={{ flex: 1 }} />
        <DeskButton label="Assign" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={p.onOpenAssign} />
      </View>
      {p.people.length ? (
        <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <View style={{ flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 12, backgroundColor: c.sunken }}>
                  <T style={[dtext.label, { color: c.inkMute, width: 140 }]}>Person</T>
                  {p.days.map((d) => <T key={d} style={[dtext.label, { color: c.inkMute, width: 60, textAlign: 'center' }]}>{p.weekdayLabels[weekdayOf(d)]}{'\n'}{d.slice(8)}</T>)}
                </View>
                {p.people.map((e) => (
                  <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: c.line }}>
                    <T style={[dtext.cellStrong, { width: 140 }]} numberOfLines={1}>{e.name}</T>
                    {p.days.map((d) => { const t = p.cellOf(e.id, d, e.weeklyOff, e.shiftId); return <T key={d} style={[dtext.cell, { width: 60, textAlign: 'center', color: t === 'Off' ? c.inkMute : c.ink }]}>{t}</T> })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </ScrollView>
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><T tone="mute">No staff to roster. Add employees first.</T></View>
      )}
      <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}><T tone="mute">&ldquo;·&rdquo; means no usual shift. Weekly offs show as Off unless a roster entry says otherwise.</T></View>

      <Sheet visible={p.open} onClose={() => p.setOpen(false)} title="Assign shifts" full footer={<View style={{ padding: 16 }}><Button label="Save roster" size="lg" block disabled={!p.ids.length} onPress={p.onSave} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Section title="Who" style={{ marginTop: 0 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="Everyone" selected={p.ids.length === p.people.length} onPress={() => p.setIds(p.ids.length === p.people.length ? [] : p.people.map((x) => x.id))} />
              {p.people.map((x) => <Chip key={x.id} label={x.name} selected={p.ids.includes(x.id)} onPress={() => p.setIds((l) => (l.includes(x.id) ? l.filter((y) => y !== x.id) : [...l, x.id]))} />)}
            </View>
          </Section>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field containerStyle={{ flex: 1 }} label="From" value={p.a} onChangeText={p.setA} autoCapitalize="none" placeholder="YYYY-MM-DD" />
            <Field containerStyle={{ flex: 1 }} label="To" value={p.b} onChangeText={p.setB} autoCapitalize="none" placeholder="YYYY-MM-DD" />
          </View>
          <Select label="Shift" value={p.shift} onChange={p.setShift} options={[{ value: 'usual', label: "Back to their usual shift" }, { value: 'off', label: 'Day off' }, ...p.shifts.map((s) => ({ value: s.id, label: s.name, sub: `${s.start}–${s.end}` }))]} />
          <SwitchRow title="Skip weekly offs" subtitle="Keep each person's usual days off" value={p.skip} onChange={p.setSkip} />
        </View>
      </Sheet>
    </>
  )
}

// ───────────────────────────── holidays tab ─────────────────────────────

type HolRow = { id: string; name: string; date: string }

export interface HolidaysTabProps {
  list: Array<{ id: string; name: string; date: YMD }>
  open: boolean; setOpen: (v: boolean) => void
  date: string; setDate: (v: string) => void
  name: string; setName: (v: string) => void
  onNew: () => void
  onSave: () => void
  onDelete: (id: string) => void
}

export function DesktopHolidaysTab(p: HolidaysTabProps) {
  const { c } = useTheme()
  const rows: HolRow[] = p.list.map((h) => ({ id: h.id, name: h.name, date: labelYMD(h.date) }))
  const columns: Array<Column<HolRow>> = [
    { key: 'name', label: 'Holiday', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'date', label: 'Date', width: 160, sortValue: (r) => r.date, render: (r) => cellText(r.date) },
    { key: 'del', label: '', width: 80, render: (r) => <DeskButton label="Remove" onPress={() => p.onDelete(r.id)} /> },
  ]
  return (
    <>
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 }}>
        <DeskButton label="Add a holiday" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={p.onNew} />
      </View>
      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} emptyLabel="No holidays yet" />
      </View>

      <Sheet visible={p.open} onClose={() => p.setOpen(false)} title="Add a holiday" footer={<View style={{ padding: 16 }}><Button label="Add" size="lg" block onPress={p.onSave} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Date" value={p.date} onChangeText={p.setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          <Field label="Name" value={p.name} onChangeText={p.setName} placeholder="Diwali" />
        </View>
      </Sheet>
    </>
  )
}
