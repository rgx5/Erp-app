import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useStore } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { docTotal } from '@/modules/sales-docs/logic/lines'
import { quotePipeline } from '@/modules/sales-docs/logic/pipeline'
import { daysLeft, effectiveStatus, QUOTE_LABEL } from '@/modules/sales-docs/logic/quotes'
import { QUOTE_TONE } from '@/modules/sales-docs/ui/tones'
import type { QuoteStatus } from '@/modules/sales-docs/types'
import { IconButton } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, FileText, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type Filter = '' | 'open' | QuoteStatus

/** Quotations: what has been offered to customers, what is still open and what turned into a bill. */
export default function Quotations() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pos')
  const store = useStore()
  const quotes = useList('quotations')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const now = Date.now()

  const pipe = useMemo(() => quotePipeline(data, now), [data, now])
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return quotes
      .map((x) => ({ q: x, status: effectiveStatus(x, now) }))
      .filter((r) => (filter === '' ? true : filter === 'open' ? r.status === 'draft' || r.status === 'sent' || r.status === 'accepted' : r.status === filter))
      .filter((r) => !n || r.q.no.toLowerCase().includes(n) || r.q.partyName.toLowerCase().includes(n) || r.q.partyPhone.includes(n))
      .sort((a, b) => b.q.date - a.q.date)
  }, [quotes, q, filter, now])

  if (!can) return <Screen title="Quotations" back><T tone="mute">Quotations are for people who use the billing counter.</T></Screen>

  return (
    <Screen title="Quotations" subtitle={`${quotes.length} in all`} back scroll={false}
      right={<IconButton label="New quotation" tone="dark" onPress={() => router.push('/m/sales-docs/quotations/new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ gap: 12, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile label="Open" value={inr(pipe.open.value, 0)} foot={`${pipe.open.count} quotation${pipe.open.count === 1 ? '' : 's'}${pipe.expiringSoon ? ` · ${pipe.expiringSoon} expiring` : ''}`} icon={<FileText size={16} color={c.primary} />} style={{ flex: 1 }} />
          <StatTile label="Billed" value={inr(pipe.converted.value, 0)} foot={pipe.winRatePct === null ? 'No decided quotes yet' : `${pipe.winRatePct}% won`} icon={<FileText size={16} color={c.success} />} tone="success" style={{ flex: 1 }} />
        </View>
        <SearchBar value={q} onChange={setQ} placeholder="Search number, name or phone" />
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['open', 'Open'], ['', 'All'], ['draft', 'Drafts'], ['accepted', 'Accepted'], ['converted', 'Billed'], ['expired', 'Expired'], ['rejected', 'Rejected']] as Array<[Filter, string]>}
          renderItem={({ item }) => <Chip label={item[1]} selected={filter === item[0]} onPress={() => setFilter(item[0])} />} />
      </View>
      <FlatList
        data={rows} keyExtractor={(r) => r.q.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<FileText size={26} color={c.primary} />} title={q || filter !== 'open' ? 'No quotations match' : 'No open quotations'}
          hint="Send a customer a price in writing. When they say yes, turn it into a bill in one tap." action={!q ? 'New quotation' : undefined} onAction={() => router.push('/m/sales-docs/quotations/new')} />}
        renderItem={({ item: { q: x, status } }) => {
          const left = daysLeft(x, now)
          return (
            <Tap onPress={() => router.push({ pathname: '/m/sales-docs/quotations/[id]', params: { id: x.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <Avatar name={x.partyName} size={42} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong" numberOfLines={1}>{x.partyName}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{x.no} · {fmtDayShort(x.date)} · valid till {fmtDayShort(x.validUntil)}</T>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                  <Badge tone={QUOTE_TONE[status]}>{QUOTE_LABEL[status]}</Badge>
                  {(status === 'sent' || status === 'draft' || status === 'accepted') && left <= 2 ? <Badge tone="warning">{left <= 0 ? 'Last day' : `${left} day${left === 1 ? '' : 's'} left`}</Badge> : null}
                </View>
              </View>
              <T v="num">{inr(docTotal(x.items, x.billDiscountType, x.billDiscountValue, store), 0)}</T>
              <ChevronRight size={16} color={c.inkMute} />
            </Tap>
          )
        }}
      />
    </Screen>
  )
}
