import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { fmtDayShort } from '@/domain/dates'
import { inr, inrShort } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { IconButton } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Download, Handshake, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { followUpState, isOpenLead, pipelineSummary, STAGES, STAGE_LABEL } from '@/modules/crm/leads'
import { leadsCsv } from '@/modules/crm/reports'
import type { LeadStage } from '@/modules/crm/types'
import { STAGE_TONE } from '@/modules/crm/ui/tones'

type Filter = 'open' | 'due' | LeadStage

/** Leads and the sales pipeline: who is interested, how far along, and who to follow up today. */
export default function Leads() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('customers')
  const leads = useList('crmLeads')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const now = Date.now()
  const pipe = useMemo(() => pipelineSummary(data, now), [data, now])
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return leads
      .filter((l) => (filter === 'open' ? isOpenLead(l) : filter === 'due' ? ['overdue', 'today'].includes(followUpState(l, now)) : l.stage === filter))
      .filter((l) => !n || l.name.toLowerCase().includes(n) || l.phone.includes(n) || l.no.toLowerCase().includes(n) || l.source.toLowerCase().includes(n))
      .sort((a, b) => (a.nextFollowUp ?? Infinity) - (b.nextFollowUp ?? Infinity) || b.createdAt - a.createdAt)
  }, [leads, q, filter, now])

  if (!can) return <Screen title="Leads" back><T tone="mute">Leads are for people who use the billing counter.</T></Screen>
  const dueCount = pipe.overdue + pipe.dueToday
  return (
    <Screen title="Leads & pipeline" subtitle={`${leads.length} in all`} back scroll={false}
      right={<View style={{ flexDirection: 'row', gap: 8 }}>
        <IconButton label="Export leads" onPress={() => void shareFile(csvFileName('leads'), leadsCsv(data))}><Download size={20} color={c.ink} /></IconButton>
        <IconButton label="New lead" tone="dark" onPress={() => router.push('/m/crm/leads/edit')}><Plus size={22} color={c.bg} /></IconButton>
      </View>}>
      <View style={{ gap: 12, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile label="Open" value={inrShort(pipe.open.value)} foot={`${pipe.open.count} lead${pipe.open.count === 1 ? '' : 's'} · likely ${inrShort(pipe.weighted)}`} icon={<Handshake size={16} color={c.primary} />} style={{ flex: 1 }} />
          <StatTile label="Won" value={inrShort(pipe.won.value)} tone="success" foot={pipe.winRatePct === null ? 'None decided yet' : `${pipe.winRatePct}% of decided`} icon={<Handshake size={16} color={c.success} />} style={{ flex: 1 }} />
        </View>
        <SearchBar value={q} onChange={setQ} placeholder="Search name, phone, source" />
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['open', 'Open'], ['due', `Follow up${dueCount ? ` (${dueCount})` : ''}`], ...STAGES.map((s) => [s.id, `${s.label} (${pipe.byStage[s.id].count})`])] as Array<[Filter, string]>}
          renderItem={({ item }) => <Chip label={item[1]} selected={filter === item[0]} onPress={() => setFilter(item[0])} />} />
      </View>
      <FlatList
        data={rows} keyExtractor={(l) => l.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<Handshake size={26} color={c.primary} />} title={q || filter !== 'open' ? 'No leads match' : 'No open leads'} hint="Write down everyone who asks about your goods but does not buy yet. Set a follow-up date and the app reminds you." action={!q ? 'New lead' : undefined} onAction={() => router.push('/m/crm/leads/edit')} />}
        renderItem={({ item: l }) => {
          const f = followUpState(l, now)
          return (
            <Tap onPress={() => router.push({ pathname: '/m/crm/leads/[id]', params: { id: l.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <Avatar name={l.name} size={42} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong" numberOfLines={1}>{l.name}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{l.no}{l.source ? ` · ${l.source}` : ''}{l.phone ? ` · ${l.phone}` : ''}</T>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                  <Badge tone={STAGE_TONE[l.stage]}>{STAGE_LABEL[l.stage]}</Badge>
                  {f === 'overdue' ? <Badge tone="danger">Late · {fmtDayShort(l.nextFollowUp as number)}</Badge> : f === 'today' ? <Badge tone="warning">Follow up today</Badge> : f === 'later' ? <Badge>{fmtDayShort(l.nextFollowUp as number)}</Badge> : null}
                </View>
              </View>
              {l.value > 0 ? <T v="num">{inr(l.value, 0)}</T> : null}
              <ChevronRight size={16} color={c.inkMute} />
            </Tap>
          )
        }}
      />
    </Screen>
  )
}
