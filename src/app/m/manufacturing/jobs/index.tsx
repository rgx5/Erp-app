import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { isJobLate, isOpenJob, JOB_KIND_LABEL, JOB_LABEL } from '@/modules/manufacturing/jobs'
import type { JobStatus } from '@/modules/manufacturing/types'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Plus, Scissors } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'

const TONE: Record<JobStatus, Tone> = { received: 'default', in_production: 'primary', ready: 'success', delivered: 'default', cancelled: 'danger' }

/** Customers' orders: made to order, and job work on their own material. */
export default function Jobs() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pos')
  const jobs = useList('jobOrders')
  const customers = useList('customers')
  const [show, setShow] = useState<'open' | 'all'>('open')
  const name = useMemo(() => new Map(customers.map((x) => [x.id, x.name])), [customers])
  const rows = useMemo(() => jobs.filter((j) => show === 'all' || isOpenJob(j)).sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) || b.createdAt - a.createdAt), [jobs, show])
  const now = Date.now()
  if (!can) return <Screen title="Job work" back><T tone="mute">Customer jobs are taken at the counter.</T></Screen>
  return (
    <Screen title="Job work & orders" subtitle={`${jobs.filter(isOpenJob).length} open`} back scroll={false}
      right={<IconButton label="New job" tone="dark" onPress={() => router.push('/m/manufacturing/jobs/new' as never)}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 10 }}>
        <Chip label="Open" selected={show === 'open'} onPress={() => setShow('open')} />
        <Chip label="All" selected={show === 'all'} onPress={() => setShow('all')} />
      </View>
      <FlatList data={rows} keyExtractor={(j) => j.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<Scissors size={26} color={c.primary} />} title="No jobs" hint="Take a customer’s order with measurements and stages, or job work on their material." action="New job" onAction={() => router.push('/m/manufacturing/jobs/new' as never)} />}
        renderItem={({ item: j }) => (
          <Tap onPress={() => router.push({ pathname: '/m/manufacturing/jobs/[id]', params: { id: j.id } } as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong" numberOfLines={1}>{j.title}</T>
              <T v="caption" tone="mute" numberOfLines={1}>{j.no} · {name.get(j.customerId) ?? 'Customer'} · {JOB_KIND_LABEL[j.kind]}{j.dueDate ? ` · due ${fmtDayShort(j.dueDate)}` : ''}</T>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                <Badge tone={TONE[j.status]}>{JOB_LABEL[j.status]}</Badge>
                {isJobLate(j, now) ? <Badge tone="danger">Late</Badge> : null}
              </View>
            </View>
            {j.charge > 0 ? <T v="num">{inr(j.charge, 0)}</T> : null}
            <ChevronRight size={16} color={c.inkMute} />
          </Tap>
        )} />
    </Screen>
  )
}
