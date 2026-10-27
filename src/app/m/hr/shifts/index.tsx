import React, { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useCan } from '@/data/store'
import { addDays, labelYMD, weekdayOf, WEEKDAYS, ymdOf, eachDay } from '@/modules/hr/logic/ymd'
import { assignRoster, deleteHoliday, deleteShift, saveHoliday, saveShift } from '@/modules/hr/ops'
import type { WorkShift } from '@/modules/hr/types'
import { act, Denied, useHr } from '@/modules/hr/ui/common'
import { ask } from '@/ui/overlays'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Card, Chip, Group } from '@/ui/primitives'
import { EmptyState, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { CalendarDays, Clock, Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type Tab = 'shifts' | 'roster' | 'holidays'

/** Shifts, the week's roster, and the holiday calendar. */
export default function Shifts() {
  const can = useCan('hr')
  const [tab, setTab] = useState<Tab>('shifts')
  if (!can) return <Denied title="Shifts" who="Shifts, rosters and holidays are for the owner and managers." />
  return (
    <Screen title="Shifts & holidays" back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Segmented value={tab} options={[{ value: 'shifts', label: 'Shifts' }, { value: 'roster', label: 'Roster' }, { value: 'holidays', label: 'Holidays' }]} onChange={setTab} />
        {tab === 'shifts' ? <ShiftsTab /> : tab === 'roster' ? <RosterTab /> : <HolidaysTab />}
      </View>
    </Screen>
  )
}

function ShiftsTab() {
  const { c } = useTheme()
  const { data } = useHr()
  const [editing, setEditing] = useState<{ id?: string } | null>(null)
  const [name, setName] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('18:00')
  const [brk, setBrk] = useState('60')
  const [grace, setGrace] = useState('10')
  const [active, setActive] = useState(true)
  const shifts = Object.values(data.workShifts ?? {}).sort((a, b) => a.start.localeCompare(b.start))
  const open = (s?: WorkShift) => { setName(s?.name ?? ''); setStart(s?.start ?? '09:00'); setEnd(s?.end ?? '18:00'); setBrk(String(s?.breakMins ?? 60)); setGrace(String(s?.graceMins ?? 10)); setActive(s?.active ?? true); setEditing({ id: s?.id }) }
  const save = () => { if (act((s, ctx) => saveShift(s, { name, start, end, breakMins: Number(brk) || 0, graceMins: Number(grace) || 0, active }, editing?.id, ctx), 'Shift saved')) setEditing(null) }
  return (
    <>
      <Button label="New shift" kind="soft" icon={<Plus size={18} color={c.primary} />} onPress={() => open()} />
      {shifts.length ? (
        <Group>{shifts.map((s) => <ListRow key={s.id} icon={<Clock size={18} color={c.primary} />} title={s.name} subtitle={`${s.start}–${s.end} · break ${s.breakMins} min · grace ${s.graceMins} min${s.active ? '' : ' · off'}`} onPress={() => open(s)} />)}</Group>
      ) : <EmptyState icon={<Clock size={26} color={c.primary} />} title="No shifts yet" hint="A shift has start and end times. Attendance uses it to tell a full day from a half day, and who is late." compact />}
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit shift' : 'New shift'}
        footer={(
          <View style={{ padding: 16, gap: 10 }}>
            <Button label="Save" size="lg" block onPress={save} />
            {editing?.id ? <Button label="Delete shift" kind="outline" block onPress={async () => { if (await ask({ title: 'Delete this shift?', confirm: 'Delete', cancel: 'Keep' }) && act((s, ctx) => deleteShift(s, editing.id!, ctx), 'Deleted')) setEditing(null) }} /> : null}
          </View>
        )}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Morning, Evening, Night" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field containerStyle={{ flex: 1 }} label="Starts" value={start} onChangeText={setStart} autoCapitalize="none" placeholder="09:00" />
            <Field containerStyle={{ flex: 1 }} label="Ends" value={end} onChangeText={setEnd} autoCapitalize="none" placeholder="18:00" />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NumberField containerStyle={{ flex: 1 }} label="Break (min)" value={brk} onChange={setBrk} />
            <NumberField containerStyle={{ flex: 1 }} label="Grace (min)" value={grace} onChange={setGrace} hint="Late after this" />
          </View>
          <SwitchRow title="In use" value={active} onChange={setActive} />
        </View>
      </Sheet>
    </>
  )
}

function RosterTab() {
  const { c } = useTheme()
  const { data, now } = useHr()
  const [from, setFrom] = useState(ymdOf(now))
  const [open, setOpen] = useState(false)
  const [ids, setIds] = useState<string[]>([])
  const [a, setA] = useState(ymdOf(now))
  const [b, setB] = useState(addDays(ymdOf(now), 6))
  const [shift, setShift] = useState<string>('usual')
  const [skip, setSkip] = useState(true)
  const people = Object.values(data.employees ?? {}).filter((e) => e.active).sort((x, y) => x.name.localeCompare(y.name))
  const shifts = Object.values(data.workShifts ?? {}).filter((s) => s.active)
  const days = eachDay(from, addDays(from, 6))
  const cellOf = (empId: string, d: string, weeklyOff: number[], usual?: string) => {
    const r = data.rosters?.[`${empId}_${d}`]
    if (r) return r.shiftId ? data.workShifts?.[r.shiftId]?.name.slice(0, 3) ?? '?' : 'Off'
    if (weeklyOff.includes(weekdayOf(d))) return 'Off'
    return usual ? data.workShifts?.[usual]?.name.slice(0, 3) ?? '·' : '·'
  }
  function save() {
    if (act((s, ctx) => assignRoster(s, { employeeIds: ids, from: a, to: b, shiftId: shift, skipWeeklyOff: skip }, ctx), 'Roster saved')) setOpen(false)
  }
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="‹ Week" onPress={() => setFrom(addDays(from, -7))} />
        <Chip label="Week ›" onPress={() => setFrom(addDays(from, 7))} />
        <View style={{ flex: 1 }} />
        <Button label="Assign" size="sm" icon={<Plus size={16} color={c.onPrimary} />} onPress={() => { setIds([]); setA(from); setB(addDays(from, 6)); setOpen(true) }} />
      </View>
      {people.length ? (
        <Card padded={false}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={{ flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 12, backgroundColor: c.sunken }}>
                <T v="label" tone="soft" style={{ width: 110 }}>Person</T>
                {days.map((d) => <T key={d} v="label" tone="soft" align="center" style={{ width: 52 }}>{WEEKDAYS[weekdayOf(d)]}{'\n'}{d.slice(8)}</T>)}
              </View>
              {people.map((e) => (
                <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: c.line }}>
                  <T v="bodyStrong" style={{ width: 110 }} numberOfLines={1}>{e.name}</T>
                  {days.map((d) => { const t = cellOf(e.id, d, e.weeklyOff, e.shiftId); return <T key={d} v="caption" tone={t === 'Off' ? 'mute' : 'default'} align="center" style={{ width: 52 }}>{t}</T> })}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      ) : <EmptyState icon={<CalendarDays size={26} color={c.primary} />} title="No staff to roster" hint="Add employees first." compact />}
      <T v="caption" tone="mute">“·” means no usual shift. Weekly offs show as Off unless a roster entry says otherwise.</T>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Assign shifts" full footer={<View style={{ padding: 16 }}><Button label="Save roster" size="lg" block disabled={!ids.length} onPress={save} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Section title="Who" style={{ marginTop: 0 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="Everyone" selected={ids.length === people.length} onPress={() => setIds(ids.length === people.length ? [] : people.map((p) => p.id))} />
              {people.map((p) => <Chip key={p.id} label={p.name} selected={ids.includes(p.id)} onPress={() => setIds((l) => (l.includes(p.id) ? l.filter((x) => x !== p.id) : [...l, p.id]))} />)}
            </View>
          </Section>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field containerStyle={{ flex: 1 }} label="From" value={a} onChangeText={setA} autoCapitalize="none" placeholder="YYYY-MM-DD" />
            <Field containerStyle={{ flex: 1 }} label="To" value={b} onChangeText={setB} autoCapitalize="none" placeholder="YYYY-MM-DD" />
          </View>
          <Select label="Shift" value={shift} onChange={setShift} options={[{ value: 'usual', label: 'Back to their usual shift' }, { value: 'off', label: 'Day off' }, ...shifts.map((s) => ({ value: s.id, label: s.name, sub: `${s.start}–${s.end}` }))]} />
          <SwitchRow title="Skip weekly offs" subtitle="Keep each person’s usual days off" value={skip} onChange={setSkip} />
        </View>
      </Sheet>
    </>
  )
}

function HolidaysTab() {
  const { c } = useTheme()
  const { data } = useHr()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const list = Object.values(data.hrHolidays ?? {}).sort((a, b) => a.date.localeCompare(b.date))
  return (
    <>
      <Button label="Add a holiday" kind="soft" icon={<Plus size={18} color={c.primary} />} onPress={() => { setDate(''); setName(''); setOpen(true) }} />
      {list.length ? (
        <Group>{list.map((h) => <ListRow key={h.id} icon={<CalendarDays size={18} color={c.primary} />} title={h.name} subtitle={labelYMD(h.date)} right={<Trash size={18} color={c.inkMute} />} chevron={false} onPress={async () => { if (await ask({ title: `Remove ${h.name}?`, confirm: 'Remove', cancel: 'Keep' })) act((s, ctx) => deleteHoliday(s, h.id, ctx), 'Removed') }} />)}</Group>
      ) : <EmptyState icon={<CalendarDays size={26} color={c.primary} />} title="No holidays yet" hint="Holidays are paid days off for monthly staff and do not count as leave." compact />}
      <Sheet visible={open} onClose={() => setOpen(false)} title="Add a holiday" footer={<View style={{ padding: 16 }}><Button label="Add" size="lg" block onPress={() => { if (act((s, ctx) => saveHoliday(s, { date, name }, ctx), 'Holiday added')) setOpen(false) }} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          <Field label="Name" value={name} onChangeText={setName} placeholder="Diwali" />
        </View>
      </Sheet>
    </>
  )
}
