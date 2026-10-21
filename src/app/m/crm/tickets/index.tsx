import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { IconButton } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Download, Plus, Ticket } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { ticketsCsv } from '@/modules/crm/reports'
import { isOpenTicket, KIND_LABEL, slaLabel, slaState, STATUS_LABEL, ticketSummary } from '@/modules/crm/tickets'
import type { TicketKind } from '@/modules/crm/types'
import { PRIORITY_TONE, SLA_TONE, STATUS_TONE } from '@/modules/crm/ui/tones'

type Filter = 'open' | 'late' | 'settled' | TicketKind

/** Complaints, after-sales requests and warranty claims, most urgent first. */
export default function Tickets() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('customers')
  const tickets = useList('crmTickets')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const now = Date.now()
  const sum = useMemo(() => ticketSummary(data, now), [data, now])
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return tickets
      .filter((t) => (filter === 'open' ? isOpenTicket(t) : filter === 'late' ? slaState(t, now) === 'breached' : filter === 'settled' ? !isOpenTicket(t) : t.kind === filter))
      .filter((t) => !n || t.no.toLowerCase().includes(n) || t.partyName.toLowerCase().includes(n) || t.subject.toLowerCase().includes(n))
      .sort((a, b) => (isOpenTicket(a) === isOpenTicket(b) ? (isOpenTicket(a) ? a.slaDue - b.slaDue : b.openedAt - a.openedAt) : isOpenTicket(a) ? -1 : 1))
  }, [tickets, q, filter, now])

  if (!can) return <Screen title="Tickets" back><T tone="mute">Tickets are for people who use the billing counter.</T></Screen>
  return (
    <Screen title="Complaints & warranty" subtitle={`${tickets.length} in all`} back scroll={false}
      right={<View style={{ flexDirection: 'row', gap: 8 }}>
        <IconButton label="Export tickets" onPress={() => void shareFile(csvFileName('tickets'), ticketsCsv(data, now))}><Download size={20} color={c.ink} /></IconButton>
        <IconButton label="New ticket" tone="dark" onPress={() => router.push('/m/crm/tickets/new')}><Plus size={22} color={c.bg} /></IconButton>
      </View>}>
      <View style={{ gap: 12, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile label="Open" value={String(sum.open)} foot={sum.dueSoon ? `${sum.dueSoon} due soon` : 'None due soon'} icon={<Ticket size={16} color={c.primary} />} style={{ flex: 1 }} />
          <StatTile label="Past due time" value={String(sum.breached)} tone={sum.breached ? 'danger' : 'success'} foot={sum.slaMetPct === null ? 'No settled tickets yet' : `${sum.slaMetPct}% settled in time`} icon={<Ticket size={16} color={sum.breached ? c.danger : c.success} />} style={{ flex: 1 }} />
        </View>
        <SearchBar value={q} onChange={setQ} placeholder="Search number, customer or problem" />
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['open', 'Open'], ['late', 'Late'], ['complaint', 'Complaints'], ['service', 'After-sales'], ['warranty', 'Warranty'], ['settled', 'Settled']] as Array<[Filter, string]>}
          renderItem={({ item }) => <Chip label={item[1]} selected={filter === item[0]} onPress={() => setFilter(item[0])} />} />
      </View>
      <FlatList
        data={rows} keyExtractor={(t) => t.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<Ticket size={26} color={c.primary} />} title={q || filter !== 'open' ? 'No tickets match' : 'No open tickets'} hint="Write down every complaint or warranty claim. Each gets a due time so none is forgotten." action={!q ? 'New ticket' : undefined} onAction={() => router.push('/m/crm/tickets/new')} />}
        renderItem={({ item: t }) => (
          <Tap onPress={() => router.push({ pathname: '/m/crm/tickets/[id]', params: { id: t.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="bodyStrong" numberOfLines={1}>{t.subject}</T>
              <T v="caption" tone="mute" numberOfLines={1}>{t.no} · {t.partyName} · {KIND_LABEL[t.kind]}</T>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                {t.priority === 'high' ? <Badge tone={PRIORITY_TONE.high}>High</Badge> : null}
                <Badge tone={SLA_TONE[slaState(t, now)]}>{slaLabel(t, now)}</Badge>
              </View>
            </View>
            <ChevronRight size={16} color={c.inkMute} />
          </Tap>
        )}
      />
    </Screen>
  )
}
