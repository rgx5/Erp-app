import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useStore } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { docTotal } from '@/modules/sales-docs/logic/lines'
import { dueSubscriptions, endingSoon, FREQUENCY_LABEL } from '@/modules/sales-docs/logic/subscriptions'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Chip, Tap } from '@/ui/primitives'
import { EmptyState, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, Plus, Repeat } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type Filter = '' | 'subscription' | 'amc' | 'paused'

/** Recurring invoices and AMC contracts: what bills itself on a schedule, and what is due now. */
export default function Recurring() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('salesDocs')
  const store = useStore()
  const subs = useList('subscriptions')
  const customers = useList('customers')
  const data = useApp((s) => s.data)
  const [filter, setFilter] = useState<Filter>('')
  const now = Date.now()

  const due = useMemo(() => dueSubscriptions(data, now), [data, now])
  const ending = useMemo(() => endingSoon(data, now).filter((x) => x.daysLeft >= 0), [data, now])
  const name = useMemo(() => new Map(customers.map((x) => [x.id, x.name])), [customers])
  const rows = useMemo(() => subs
    .filter((s) => (filter === '' ? true : filter === 'paused' ? !s.active : s.active && s.kind === filter))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.nextDate - b.nextDate), [subs, filter])

  if (!can) return <Screen title="Recurring & AMC" back><T tone="mute">Recurring billing is for the owner and managers.</T></Screen>

  return (
    <Screen title="Recurring & AMC" subtitle={`${subs.filter((s) => s.active).length} active`} back scroll={false}
      right={<IconButton label="New plan" tone="dark" onPress={() => router.push('/m/sales-docs/recurring/new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ gap: 12, paddingBottom: 10 }}>
        {due.length ? <Notice tone="warning" title={`${due.length} plan${due.length === 1 ? '' : 's'} to invoice`} body={due.slice(0, 3).map((d) => d.sub.no).join(', ')} /> : null}
        {ending.length ? <Notice tone="accent" title={`${ending.length} ending within 30 days`} body="Call them about renewing" /> : null}
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['', 'All'], ['subscription', 'Subscriptions'], ['amc', 'AMC'], ['paused', 'Paused']] as Array<[Filter, string]>}
          renderItem={({ item }) => <Chip label={item[1]} selected={filter === item[0]} onPress={() => setFilter(item[0])} />} />
      </View>
      <FlatList
        data={rows} keyExtractor={(x) => x.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<Repeat size={26} color={c.primary} />} title="No recurring plans" hint="Bill a customer every month, quarter or year for a subscription or an annual maintenance contract." action="New plan" onAction={() => router.push('/m/sales-docs/recurring/new')} />}
        renderItem={({ item: s }) => {
          const isDue = due.some((d) => d.sub.id === s.id)
          return (
            <Tap onPress={() => router.push({ pathname: '/m/sales-docs/recurring/[id]', params: { id: s.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <Avatar name={name.get(s.customerId) ?? 'Customer'} size={42} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong" numberOfLines={1}>{name.get(s.customerId) ?? 'Customer'}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{s.no} · {FREQUENCY_LABEL[s.frequency].toLowerCase()} · next {fmtDate(s.nextDate)}</T>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                  <Badge tone={s.kind === 'amc' ? 'accent' : 'primary'}>{s.kind === 'amc' ? 'AMC' : 'Subscription'}</Badge>
                  {!s.active ? <Badge>Paused</Badge> : isDue ? <Badge tone="warning">Due now</Badge> : null}
                </View>
              </View>
              <T v="num">{inr(docTotal(s.items, 'amt', 0, store), 0)}</T>
              <ChevronRight size={16} color={c.inkMute} />
            </Tap>
          )
        }}
      />
    </Screen>
  )
}
