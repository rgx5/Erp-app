import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { listOf } from '@/data/state'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { MapPin, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { missedVisits, VISIT_LABEL } from '@/modules/services/logic/visits'
import { Denied, VISIT_TONE } from '@/modules/services/ui/common'
import type { VisitStatus } from '@/modules/services/types'

type Filter = VisitStatus | 'all'

/** Field visits: plan, check in, the report and the signature. */
export default function Visits() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const [filter, setFilter] = useState<Filter>('all')
  const missed = useMemo(() => missedVisits(data, now), [data, now])
  const all = listOf(data.fieldVisits ?? {}).sort((a, b) => b.plannedAt - a.plannedAt)
  const rows = filter === 'all' ? all : all.filter((v) => v.status === filter)

  if (!can) return <Denied title="Field visits" who="Field visits are for people who work at the counter." />
  return (
    <Screen title="Field visits" subtitle="Check in, report and sign" back
      right={<Button label="Plan" size="sm" kind="dark" icon={<Plus size={15} color={c.bg} />} onPress={() => router.push('/m/services/visits/new')} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        {missed.length ? <Badge tone="danger">{missed.length} visit{missed.length === 1 ? '' : 's'} not checked in</Badge> : null}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {(['all', 'planned', 'checked_in', 'completed', 'cancelled'] as Filter[]).map((f) => <Chip key={f} label={f === 'all' ? 'All' : VISIT_LABEL[f]} selected={filter === f} onPress={() => setFilter(f)} />)}
        </View>
        {rows.length ? (
          <Group>{rows.map((v) => (
            <ListRow key={v.id} icon={<MapPin size={18} color={c.primary} />} iconTone={VISIT_TONE[v.status]} title={v.partyName} subtitle={`${v.purpose || v.address || '—'}`}
              meta={fmtDateTime(v.plannedAt)} badge={<Badge tone={VISIT_TONE[v.status]}>{VISIT_LABEL[v.status]}</Badge>}
              onPress={() => router.push({ pathname: '/m/services/visits/[id]', params: { id: v.id } })} />
          ))}</Group>
        ) : <EmptyState icon={<MapPin size={26} color={c.primary} />} title="No visits yet" hint="Plan a visit to a customer's place." action="Plan a visit" onAction={() => router.push('/m/services/visits/new')} />}
      </View>
    </Screen>
  )
}
