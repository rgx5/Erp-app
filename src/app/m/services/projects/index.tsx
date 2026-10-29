import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { Briefcase, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import type { Tone } from '@/ui/theme'
import { projectBoard, PROJECT_LABEL } from '@/modules/services/logic/projects'
import { Denied } from '@/modules/services/ui/common'
import type { ProjectStatus } from '@/modules/services/types'

const TONE: Record<ProjectStatus, Tone> = { active: 'primary', on_hold: 'warning', completed: 'success', cancelled: 'default' }
type Filter = ProjectStatus | 'all'

/** Projects: tasks, hours worked, and what is billed and what is still owed. */
export default function Projects() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const [filter, setFilter] = useState<Filter>('active')
  const board = useMemo(() => projectBoard(data, now), [data, now])
  const rows = filter === 'all' ? board : board.filter((r) => r.project.status === filter)

  if (!can) return <Denied title="Projects" who="Projects are for people who work at the counter." />
  return (
    <Screen title="Projects & timesheets" subtitle="Tasks, hours and billing" back
      right={<Button label="New" size="sm" kind="dark" icon={<Plus size={15} color={c.bg} />} onPress={() => router.push('/m/services/projects/new')} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {(['active', 'on_hold', 'completed', 'cancelled', 'all'] as Filter[]).map((f) => <Chip key={f} label={f === 'all' ? 'All' : PROJECT_LABEL[f]} selected={filter === f} onPress={() => setFilter(f)} />)}
        </View>
        {rows.length ? (
          <Group>{rows.map(({ project: p, summary: s }) => (
            <ListRow key={p.id} icon={<Briefcase size={18} color={c.primary} />} iconTone={TONE[p.status]} title={`${p.no} · ${p.name}`}
              subtitle={`${p.customerId ? data.customers[p.customerId]?.name ?? '' : 'No customer'} · ${p.billing === 'hourly' ? 'Hourly' : 'Fixed fee'}`}
              meta={`${s.hours} h${s.unbilledHours ? ` · ${s.unbilledHours} h unbilled` : ''}`}
              value={inr(p.billing === 'hourly' ? s.unbilledAmount : s.fixedLeft, 0)} sub={p.billing === 'hourly' ? 'unbilled' : 'left to invoice'}
              badge={p.status !== 'active' ? <Badge tone={TONE[p.status]}>{PROJECT_LABEL[p.status]}</Badge> : undefined}
              onPress={() => router.push({ pathname: '/m/services/projects/[id]', params: { id: p.id } })} />
          ))}</Group>
        ) : <EmptyState icon={<Briefcase size={26} color={c.primary} />} title="No projects yet" hint="Start one to track tasks, time and billing." action="New project" onAction={() => router.push('/m/services/projects/new')} />}
      </View>
    </Screen>
  )
}
