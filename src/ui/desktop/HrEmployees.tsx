import React, { useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fonts, useTheme } from '@/ui/theme'
import { useCan } from '@/data/store'
import { dayBoard } from '@/modules/hr/logic/select'
import { labelYMD, ymdOf } from '@/modules/hr/logic/ymd'
import { useHr } from '@/modules/hr/ui/common'
import { T } from '@/ui/Text'
import { Plus, Search as SearchIcon } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, Pill, Toolbar, cellText, type Column } from './kit'

type Tab = 'active' | 'left'
type Row = { id: string; name: string; code: string; designation: string; exitLabel: string; status: 'in' | 'leave' | 'off' | 'none' }

/**
 * The desktop staff list: a search bar with an On the staff / Left toggle and one dense sortable grid — instead of
 * the phone's scrolling card list. Who is in today comes from the same `dayBoard` the phone `employees/index.tsx`
 * calls; this file only lays the same rows out as a grid.
 */
export function DesktopEmployees() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('hr')
  const { data, idx, now } = useHr()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Tab>('active')
  const today = ymdOf(now)
  const board = useMemo(() => new Map(dayBoard(data, idx, today, now).map((b) => [b.employee.id, b.info])), [data, idx, today, now])
  const all = Object.values(data.employees ?? {})
  const shown = all.filter((e) => (tab === 'active' ? e.active : !e.active)).filter((e) => !q.trim() || `${e.name} ${e.code} ${e.designation}`.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name))

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Employees" />}>
        <View style={{ padding: 20 }}><T tone="mute">The staff list is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const rows: Row[] = shown.map((e) => {
    const info = board.get(e.id)
    const status: Row['status'] = !e.active ? 'none' : info?.presentFrac && info.presentFrac > 0 ? 'in' : info?.status === 'leave' ? 'leave' : info?.status === 'weekoff' || info?.status === 'holiday' ? 'off' : 'none'
    return { id: e.id, name: e.name, code: e.code, designation: e.designation, exitLabel: e.exitDate ? `Left ${labelYMD(e.exitDate)}` : 'Left', status }
  })

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Name', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'code', label: 'Code', width: 100, sortValue: (r) => r.code, render: (r) => cellText(r.code || '—') },
    { key: 'designation', label: 'Job', width: 180, sortValue: (r) => r.designation, render: (r) => cellText(r.designation || '—') },
    { key: 'status', label: 'Today', width: 130, render: (r) => (
      r.status === 'in' ? <Pill tone="success" label="In" /> : r.status === 'leave' ? <Pill tone="warning" label="On leave" /> : r.status === 'off' ? <Pill tone="default" label="Off" /> : tab === 'left' ? <Pill tone="default" label={r.exitLabel} /> : null
    ) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Employees"
          subtitle={`${all.filter((e) => e.active).length} on the staff`}
          right={<DeskButton label="Add" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/hr/employees/edit')} />}
        />
      }
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, maxWidth: 320, flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search name, code or job"
            placeholderTextColor={c.inkMute}
            autoCorrect={false}
            autoCapitalize="none"
            style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
          />
        </View>
        <DeskSegmented<Tab> value={tab} onChange={setTab} options={[{ id: 'active', label: 'On the staff' }, { id: 'left', label: 'Left' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/hr/employees/[id]', params: { id: r.id } } as never)}
          emptyLabel={q ? 'No employees match' : tab === 'left' ? 'Nobody has left' : 'No employees yet'}
        />
      </View>
    </DeskPage>
  )
}
