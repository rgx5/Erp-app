import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort, rangeBounds, RANGE_OPTIONS, type RangeKey } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { lossesByReason, REASON_LABEL } from '@/modules/warehouse/logic'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Chip, Group } from '@/ui/primitives'
import { EmptyState, ListRow, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Write-offs: damage, expiry, samples and losses at cost, with the total lost in a period. */
export default function WriteOffs() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('warehouse')
  const writeOffs = useList('writeOffs')
  const [range, setRange] = useState<RangeKey>('30d')
  if (!can) return <Screen title="Write-offs" back><T tone="mute">Write-offs are for the owner and managers.</T></Screen>
  const [from, to] = rangeBounds(range)
  const by = lossesByReason(writeOffs, from, to)
  const total = by.reduce((s, x) => s + x.total, 0)
  const rows = writeOffs.filter((w) => w.date >= from && w.date <= to).sort((a, b) => b.date - a.date)
  return (
    <Screen title="Write-offs" subtitle="Stock taken off at cost" back right={<IconButton label="New write-off" tone="dark" onPress={() => router.push('/m/warehouse/writeoffs/new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{RANGE_OPTIONS.map((o) => <Chip key={o.value} label={o.label} selected={range === o.value} onPress={() => setRange(o.value)} />)}</View>
        <StatTile label="Lost in this period" value={inr(total, 0)} tone="danger" foot={by.map((x) => `${REASON_LABEL[x.reason]} ${inr(x.total, 0)}`).join(' · ') || 'Nothing written off'} />
        {rows.length ? (
          <Section title="Documents">
            <Group>{rows.map((w) => <ListRow key={w.id} title={w.no} subtitle={`${REASON_LABEL[w.reason]} · ${fmtDayShort(w.date)} · ${w.lines.length} ${w.lines.length === 1 ? 'line' : 'lines'}`} value={inr(w.total, 0)} onPress={() => router.push({ pathname: '/m/warehouse/writeoffs/[id]', params: { id: w.id } })} />)}</Group>
          </Section>
        ) : <EmptyState icon={<Trash size={26} color={c.primary} />} title="No write-offs" hint="Record damaged, expired or sample stock here so the shelf and the books agree." action="New write-off" onAction={() => router.push('/m/warehouse/writeoffs/new')} />}
      </View>
    </Screen>
  )
}
