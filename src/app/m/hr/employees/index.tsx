import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useCan } from '@/data/store'
import { dayBoard } from '@/modules/hr/logic/select'
import { labelYMD, ymdOf } from '@/modules/hr/logic/ymd'
import { Denied, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Plus, Users } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** The staff list: who works here, and who is in today. */
export default function Employees() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('hr')
  const { data, idx, now } = useHr()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'active' | 'left'>('active')
  const today = ymdOf(now)
  const board = useMemo(() => new Map(dayBoard(data, idx, today, now).map((b) => [b.employee.id, b.info])), [data, idx, today, now])
  const all = Object.values(data.employees ?? {})
  const shown = all.filter((e) => (tab === 'active' ? e.active : !e.active)).filter((e) => !q.trim() || `${e.name} ${e.code} ${e.designation}`.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name))

  if (!can) return <Denied title="Employees" who="The staff list is for the owner and managers." />
  return (
    <Screen title="Employees" subtitle={`${all.filter((e) => e.active).length} on the staff`} back scroll={false}
      right={<Button label="Add" size="sm" icon={<Plus size={16} color={c.onPrimary} />} onPress={() => router.push('/m/hr/employees/edit')} />}>
      <FlatList
        data={shown} keyExtractor={(e) => e.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListHeaderComponent={(
          <View style={{ gap: 12, paddingBottom: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip label="On the staff" selected={tab === 'active'} onPress={() => setTab('active')} />
              <Chip label="Left" selected={tab === 'left'} onPress={() => setTab('left')} />
            </View>
            {all.length > 6 ? <SearchBar value={q} onChange={setQ} placeholder="Search name, code or job" /> : null}
          </View>
        )}
        ListEmptyComponent={<EmptyState icon={<Users size={26} color={c.primary} />} title={tab === 'left' ? 'Nobody has left' : 'No employees yet'} hint="Add each person on your staff: their job, joining date, shift and weekly off. Pay terms come next." action={tab === 'active' ? 'Add employee' : undefined} onAction={() => router.push('/m/hr/employees/edit')} />}
        renderItem={({ item: e }) => {
          const info = board.get(e.id)
          return (
            <Tap onPress={() => router.push({ pathname: '/m/hr/employees/[id]', params: { id: e.id } } as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <Avatar name={e.name} size={42} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong" numberOfLines={1}>{e.name}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{[e.code, e.designation].filter(Boolean).join(' · ')}</T>
                {!e.active ? <T v="caption" tone="mute">Left {e.exitDate ? labelYMD(e.exitDate) : ''}</T> : null}
              </View>
              {e.active && info ? <Badge tone={info.presentFrac > 0 ? 'success' : info.status === 'leave' ? 'warning' : 'default'}>{info.presentFrac > 0 ? 'In' : info.status === 'leave' ? 'On leave' : info.status === 'weekoff' || info.status === 'holiday' ? 'Off' : '—'}</Badge> : null}
              <ChevronRight size={16} color={c.inkMute} />
            </Tap>
          )
        }}
      />
    </Screen>
  )
}
