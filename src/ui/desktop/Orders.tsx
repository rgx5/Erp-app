import React, { useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort, startOfDay } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { isOpenOrder, layawayStatus, moneyOf, ORDER_LABEL } from '@/modules/sales-docs/logic/orders'
import { orderBook } from '@/modules/sales-docs/logic/pipeline'
import { ORDER_TONE } from '@/modules/sales-docs/ui/tones'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { Plus, Search as SearchIcon } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Filter = 'open' | 'ready' | 'layaway' | 'late' | 'delivered' | 'cancelled' | ''
type Row = { id: string; customer: string; no: string; date: number; expectedDate: number | undefined; status: string; layaway: boolean; late: boolean; total: number; toPay: number; paidIn: number }

/**
 * The desktop Orders & layaway screen: a KPI strip for advance held and still to pay, a search bar with the status
 * filter, and one dense grid instead of the phone's scrolling cards. Every figure comes from the same `orderBook`/
 * `moneyOf`/`layawayStatus` the phone `m/sales-docs/orders/index.tsx` calls.
 */
export function DesktopOrders() {
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
  const rows: Row[] = useMemo(() => {
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
      .map(({ o, m }) => ({
        id: o.id, customer: name.get(o.customerId) ?? 'Customer', no: o.no, date: o.date, expectedDate: o.expectedDate, status: o.status, layaway: !!o.instalments?.length,
        late: isOpenOrder(o) && ((!!o.expectedDate && o.expectedDate < startOfDay(now)) || (!!o.instalments?.length && layawayStatus(o, m.paidIn, now).overdue > 0)),
        total: o.total, toPay: m.toPay, paidIn: m.paidIn,
      }))
  }, [orders, data, filter, q, name, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Orders & layaway" />}>
        <View style={{ padding: 20 }}><T tone="mute">Orders are for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }

  const columns: Array<Column<Row>> = [
    { key: 'customer', label: 'Customer', sortValue: (r) => r.customer, render: (r) => cellText(r.customer, true) },
    { key: 'no', label: 'Order', width: 190, sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cell} numberOfLines={1}>{r.no}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{fmtDayShort(r.date)}{r.expectedDate ? ` · by ${fmtDayShort(r.expectedDate)}` : ''}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 170, sortValue: (r) => r.status, render: (r) => (
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Pill tone={ORDER_TONE[r.status as keyof typeof ORDER_TONE]} label={ORDER_LABEL[r.status as keyof typeof ORDER_LABEL]} />
        {r.layaway ? <Pill tone="accent" label="Layaway" /> : null}
        {r.late ? <Pill tone="danger" label="Late" /> : null}
      </View>
    ) },
    { key: 'total', label: 'Total', width: 110, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
    { key: 'due', label: 'Due', width: 120, align: 'right', sortValue: (r) => r.toPay, render: (r) => (r.toPay ? <Pill tone="warning" label={inr(r.toPay, 0)} /> : <Pill tone="success" label="Paid" />) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Orders & layaway"
          subtitle={`${book.open.count} open`}
          right={<DeskButton label="New order" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/sales-docs/orders/new')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Advance held" value={inr(book.advanceHeld, 0)} tone="primary" delta={`${book.open.count} open order${book.open.count === 1 ? '' : 's'}`} />
        <KpiTile label="Still to pay" value={inr(book.balanceDue, 0)} tone={book.layawayOverdue.count ? 'warning' : 'default'} delta={book.layawayOverdue.count ? `${inr(book.layawayOverdue.amount, 0)} overdue` : book.pastDue ? `${book.pastDue} past delivery date` : 'On track'} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, maxWidth: 320, flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search order or customer" placeholderTextColor={c.inkMute} autoCorrect={false} autoCapitalize="none"
            style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }} />
        </View>
        <DeskSegmented<Filter> value={filter} onChange={setFilter} options={[{ id: 'open', label: 'Open' }, { id: 'ready', label: 'Ready' }, { id: 'layaway', label: 'Layaway' }, { id: 'late', label: 'Late' }, { id: 'delivered', label: 'Delivered' }, { id: 'cancelled', label: 'Cancelled' }, { id: '', label: 'All' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/sales-docs/orders/[id]', params: { id: r.id } })} emptyLabel={q || filter !== 'open' ? 'No orders match' : 'No open orders'} />
      </View>
    </DeskPage>
  )
}
