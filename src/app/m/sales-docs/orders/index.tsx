import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort, startOfDay } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { isOpenOrder, layawayStatus, moneyOf, ORDER_LABEL } from '@/modules/sales-docs/logic/orders'
import { orderBook } from '@/modules/sales-docs/logic/pipeline'
import { ORDER_TONE } from '@/modules/sales-docs/ui/tones'
import { IconButton } from '@/ui/Button'
import { SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Chip, ProgressBar, Tap } from '@/ui/primitives'
import { EmptyState, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ChevronRight, ClipboardList, Plus, Wallet } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type Filter = 'open' | 'ready' | 'layaway' | 'late' | 'delivered' | 'cancelled' | ''

/** Sales orders, advance bookings and layaway plans: what customers are waiting for and what they have paid so far. */
export default function Orders() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pos')
  const orders = useList('salesOrders')
  const customers = useList('customers')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const now = Date.now()

  const book = useMemo(() => orderBook(data, now), [data, now])
  const name = useMemo(() => new Map(customers.map((x) => [x.id, x.name])), [customers])
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return orders
      .map((o) => ({ o, m: moneyOf(data, o) }))
      .filter(({ o, m }) => {
        switch (filter) {
          case 'open': return isOpenOrder(o)
          case 'ready': return o.status === 'ready'
          case 'layaway': return isOpenOrder(o) && !!o.instalments?.length
          case 'late': return isOpenOrder(o) && ((!!o.expectedDate && o.expectedDate < startOfDay(now)) || (!!o.instalments?.length && layawayStatus(o, m.paidIn, now).overdue > 0))
          case 'delivered': return o.status === 'delivered'
          case 'cancelled': return o.status === 'cancelled'
          default: return true
        }
      })
      .filter(({ o }) => !n || o.no.toLowerCase().includes(n) || (name.get(o.customerId) ?? '').toLowerCase().includes(n))
      .sort((a, b) => b.o.date - a.o.date)
  }, [orders, data, filter, q, name, now])

  if (!can) return <Screen title="Orders" back><T tone="mute">Orders are for people who use the billing counter.</T></Screen>

  return (
    <Screen title="Orders & layaway" subtitle={`${book.open.count} open`} back scroll={false}
      right={<IconButton label="New order" tone="dark" onPress={() => router.push('/m/sales-docs/orders/new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ gap: 12, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile label="Advance held" value={inr(book.advanceHeld, 0)} foot={`${book.open.count} open order${book.open.count === 1 ? '' : 's'}`} icon={<Wallet size={16} color={c.primary} />} style={{ flex: 1 }} />
          <StatTile label="Still to pay" value={inr(book.balanceDue, 0)} tone={book.layawayOverdue.count ? 'warning' : 'accent'} foot={book.layawayOverdue.count ? `${inr(book.layawayOverdue.amount, 0)} overdue` : book.pastDue ? `${book.pastDue} past delivery date` : 'On track'} icon={<ClipboardList size={16} color={c.accent} />} style={{ flex: 1 }} />
        </View>
        <SearchBar value={q} onChange={setQ} placeholder="Search order or customer" />
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]}
          data={[['open', 'Open'], ['ready', 'Ready'], ['layaway', 'Layaway'], ['late', 'Late'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['', 'All']] as Array<[Filter, string]>}
          renderItem={({ item }) => <Chip label={item[1]} selected={filter === item[0]} onPress={() => setFilter(item[0])} />} />
      </View>
      <FlatList
        data={rows} keyExtractor={(r) => r.o.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyState icon={<ClipboardList size={26} color={c.primary} />} title={q || filter !== 'open' ? 'No orders match' : 'No open orders'}
          hint="Take an order with an advance, or let a customer pay over time. The goods are kept aside until they are billed." action={!q ? 'New order' : undefined} onAction={() => router.push('/m/sales-docs/orders/new')} />}
        renderItem={({ item: { o, m } }) => {
          const late = isOpenOrder(o) && ((!!o.expectedDate && o.expectedDate < startOfDay(now)) || (!!o.instalments?.length && layawayStatus(o, m.paidIn, now).overdue > 0))
          return (
            <Tap onPress={() => router.push({ pathname: '/m/sales-docs/orders/[id]', params: { id: o.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <Avatar name={name.get(o.customerId) ?? 'Customer'} size={42} />
              <View style={{ flex: 1, gap: 3 }}>
                <T v="bodyStrong" numberOfLines={1}>{name.get(o.customerId) ?? 'Customer'}</T>
                <T v="caption" tone="mute" numberOfLines={1}>{o.no} · {fmtDayShort(o.date)}{o.expectedDate ? ` · by ${fmtDayShort(o.expectedDate)}` : ''}</T>
                <ProgressBar value={o.total ? m.paidIn / o.total : 0} tone={m.toPay === 0 ? 'success' : 'primary'} />
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 1 }}>
                  <Badge tone={ORDER_TONE[o.status]}>{ORDER_LABEL[o.status]}</Badge>
                  {o.instalments?.length ? <Badge tone="accent">Layaway</Badge> : null}
                  {late ? <Badge tone="danger">Late</Badge> : null}
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T v="num">{inr(o.total, 0)}</T>
                {isOpenOrder(o) ? <T v="caption" tone={m.toPay ? 'warning' : 'success'}>{m.toPay ? `${inr(m.toPay, 0)} due` : 'Paid'}</T> : null}
              </View>
              <ChevronRight size={16} color={c.inkMute} />
            </Tap>
          )
        }}
      />
    </Screen>
  )
}
