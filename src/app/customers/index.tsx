import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort, isThisMonth, monthDay, timeAgo } from '@/domain/dates'
import { inr0, num } from '@/domain/money'
import { customerStats, filterCustomers, type CustomerStats, type CustomerView } from '@/domain/stock'
import type { Bill, Customer } from '@/domain/types'
import { useLabels, useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Chip, Tap } from '@/ui/primitives'
import { SearchBar, Segmented } from '@/ui/Inputs'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Cake, ChevronRight, Plus, Users } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type Sort = 'name' | 'spend' | 'recent'

/** "1990-03-15" → "15 Mar": birthdays and anniversaries ignore the year. */
const dayOf = (s: string) => {
  const md = monthDay(s)
  return md ? fmtDayShort(new Date(2000, Number(md.slice(0, 2)) - 1, Number(md.slice(3, 5))).getTime()) : ''
}

const NONE: CustomerStats = { bills: 0, spent: 0, last: null, avg: 0 }

export default function Customers() {
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const canEdit = useCan('customers')
  const customers = useList('customers')
  const bills = useList('bills')
  const [q, setQ] = useState('')
  const [view, setView] = useState<CustomerView>('')
  const [sort, setSort] = useState<Sort>('name')

  // One pass over the bills; each customer then only looks at their own.
  const stats = useMemo(() => {
    const by = new Map<string, Bill[]>()
    for (const b of bills) if (b.customerId) by.set(b.customerId, [...(by.get(b.customerId) ?? []), b])
    const out = new Map<string, CustomerStats>()
    for (const [id, list] of by) out.set(id, customerStats(id, list))
    return out
  }, [bills])

  const counts = useMemo(() => ({
    birthday: customers.filter((x) => isThisMonth(x.dob) || isThisMonth(x.anniversary)).length,
    credit: customers.filter((x) => x.storeCredit > 0).length,
    points: customers.filter((x) => x.loyaltyPoints > 0).length,
  }), [customers])

  const rows = useMemo(() => {
    const list = filterCustomers(customers, q, view)
    if (sort === 'spend') return [...list].sort((a, b) => (stats.get(b.id)?.spent ?? 0) - (stats.get(a.id)?.spent ?? 0) || a.name.localeCompare(b.name))
    if (sort === 'recent') return [...list].sort((a, b) => (stats.get(b.id)?.last ?? 0) - (stats.get(a.id)?.last ?? 0) || a.name.localeCompare(b.name))
    return list
  }, [customers, q, view, sort, stats])

  const filtered = !!q || !!view
  const plural = labels.customers.toLowerCase()
  const one = labels.customer.toLowerCase()

  return (
    <Screen title={labels.customers} subtitle={`${num(customers.length)} ${customers.length === 1 ? one : plural}`} back scroll={false}
      right={canEdit ? <IconButton label={`Add ${one}`} tone="dark" onPress={() => router.push('/customers/new')}><Plus size={22} color={c.bg} /></IconButton> : undefined}>
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <SearchBar value={q} onChange={setQ} placeholder="Search name or mobile number" />
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['', 'All', 0], ['birthday', 'This month’s dates', counts.birthday], ['credit', 'Store credit', counts.credit], ['points', 'Has points', counts.points]] as Array<[CustomerView, string, number]>}
          renderItem={({ item }) => <Chip label={item[1]} count={item[2] || undefined} selected={view === item[0]} onPress={() => setView(item[0])} />} />
        <Segmented<Sort> compact value={sort} onChange={setSort} options={[{ value: 'name', label: 'A – Z' }, { value: 'spend', label: 'Top spenders' }, { value: 'recent', label: 'Recent visit' }]} />
      </View>
      <FlatList
        data={rows} keyExtractor={(x) => x.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }} initialNumToRender={14} windowSize={9}
        ListEmptyComponent={<EmptyState icon={<Users size={26} color={c.primary} />} title={filtered ? `No ${plural} match` : `No ${plural} yet`}
          hint={filtered ? 'Try clearing the search or the filter.' : `${labels.customers} are added at the counter or here. Their history and rewards build up over time.`}
          action={canEdit && !filtered ? `Add ${one}` : undefined} onAction={() => router.push('/customers/new')} />}
        renderItem={({ item: x }: { item: Customer }) => {
          const st = stats.get(x.id) ?? NONE
          const dates = view === 'birthday' ? [isThisMonth(x.dob) ? `Birthday ${dayOf(x.dob)}` : '', isThisMonth(x.anniversary) ? `Anniversary ${dayOf(x.anniversary)}` : ''].filter(Boolean).join(' · ') : ''
          return (
            <Tap onPress={() => router.push({ pathname: '/customers/[id]', params: { id: x.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <Avatar name={x.name} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <T v="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{x.name}</T>
                  {isThisMonth(x.dob) || isThisMonth(x.anniversary) ? <Cake size={14} color={c.accent} /> : null}
                </View>
                <T v="caption" tone="mute" numberOfLines={1}>{dates || [x.phone, st.bills ? `${st.bills} ${st.bills === 1 ? 'visit' : 'visits'}` : 'No visits yet'].join(' · ')}</T>
                {x.storeCredit > 0 || x.loyaltyPoints > 0 ? (
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                    {x.storeCredit > 0 ? <Badge tone="success">{inr0(x.storeCredit)} credit</Badge> : null}
                    {x.loyaltyPoints > 0 ? <Badge tone="primary">{num(x.loyaltyPoints)} pts</Badge> : null}
                  </View>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <T v="num">{st.spent ? inr0(st.spent) : '—'}</T>
                <T v="caption" tone="mute">{st.last ? timeAgo(st.last) : 'spent'}</T>
              </View>
              <ChevronRight size={16} color={c.inkMute} />
            </Tap>
          )
        }}
      />
    </Screen>
  )
}
