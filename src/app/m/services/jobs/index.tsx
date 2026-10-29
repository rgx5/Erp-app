import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Group } from '@/ui/primitives'
import { EmptyState, ListRow, StatTile } from '@/ui/blocks'
import { ClipboardList, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { isLate, isOpenJob, jobAgeDays, JOB_LABEL, jobBoard, jobTotals, KIND_LABEL } from '@/modules/services/logic/jobs'
import { listOf } from '@/data/state'
import { Denied, JOB_TONE } from '@/modules/services/ui/common'

type Filter = 'open' | 'ready' | 'all'

/** Job cards: repairs and work orders in for intake, estimate, work, and pickup. */
export default function Jobs() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const [filter, setFilter] = useState<Filter>('open')
  const board = useMemo(() => jobBoard(data, now), [data, now])
  const all = listOf(data.jobCards ?? {}).sort((a, b) => b.receivedAt - a.receivedAt)
  const rows = filter === 'all' ? all : filter === 'ready' ? all.filter((j) => j.status === 'ready') : all.filter(isOpenJob)

  if (!can) return <Denied title="Job cards" who="Job cards are for people who work at the counter." />
  return (
    <Screen title="Job cards" subtitle="Repairs and work orders" back
      right={<Button label="Intake" size="sm" kind="dark" icon={<Plus size={15} color={c.bg} />} onPress={() => router.push('/m/services/jobs/new')} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile label="Open" value={String(board.open)} foot={board.late ? `${board.late} late` : 'None late'} tone={board.late ? 'danger' : 'primary'} icon={<ClipboardList size={16} color={c.primary} />} style={{ flex: 1 }} />
          <StatTile label="Open value" value={inr(board.openValue, 0)} foot={`${board.awaitingApproval} awaiting approval`} tone="success" style={{ flex: 1 }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label={`Open (${board.open})`} selected={filter === 'open'} onPress={() => setFilter('open')} />
          <Chip label={`Ready (${board.ready})`} selected={filter === 'ready'} onPress={() => setFilter('ready')} />
          <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
        </View>
        {rows.length ? (
          <Group>{rows.map((j) => (
            <ListRow key={j.id} icon={<ClipboardList size={18} color={c.primary} />} iconTone={isLate(j, now) ? 'danger' : JOB_TONE[j.status]} title={`${j.no} · ${j.title || KIND_LABEL[j.kind]}`}
              subtitle={`${j.partyName}${j.identifier ? ` · ${j.identifier}` : ''}`} meta={`${JOB_LABEL[j.status]}${isOpenJob(j) ? ` · ${jobAgeDays(j, now)} d` : ''}`}
              value={inr(jobTotals(j).total, 0)} badge={isLate(j, now) ? <Badge tone="danger">Late</Badge> : undefined}
              onPress={() => router.push({ pathname: '/m/services/jobs/[id]', params: { id: j.id } })} />
          ))}</Group>
        ) : <EmptyState icon={<ClipboardList size={26} color={c.primary} />} title="Nothing here" hint="Take in a repair or work order to get started." action="New intake" onAction={() => router.push('/m/services/jobs/new')} />}
      </View>
    </Screen>
  )
}
