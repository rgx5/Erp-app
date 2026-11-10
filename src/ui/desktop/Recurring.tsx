import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useStore } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { docTotal } from '@/modules/sales-docs/logic/lines'
import { dueSubscriptions, endingSoon, FREQUENCY_LABEL } from '@/modules/sales-docs/logic/subscriptions'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Filter = '' | 'subscription' | 'amc' | 'paused'
type Row = { id: string; customer: string; no: string; kind: string; frequency: string; nextDate: number; active: boolean; due: boolean; total: number }

/**
 * The desktop Recurring & AMC screen: a due/ending-soon notice strip, a status filter and one dense sortable grid
 * instead of the phone's scrolling cards. Rows use the same `dueSubscriptions`/`endingSoon`/`docTotal` the phone
 * `m/sales-docs/recurring/index.tsx` calls.
 */
export function DesktopRecurring() {
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
  const rows: Row[] = useMemo(() => subs
    .filter((s) => (filter === '' ? true : filter === 'paused' ? !s.active : s.active && s.kind === filter))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.nextDate - b.nextDate)
    .map((s) => ({ id: s.id, customer: name.get(s.customerId) ?? 'Customer', no: s.no, kind: s.kind, frequency: FREQUENCY_LABEL[s.frequency], nextDate: s.nextDate, active: s.active, due: due.some((d) => d.sub.id === s.id), total: docTotal(s.items, 'amt', 0, store) })), [subs, filter, name, due, store])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Recurring & AMC" />}>
        <View style={{ padding: 20 }}><T tone="mute">Recurring billing is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const columns: Array<Column<Row>> = [
    { key: 'customer', label: 'Customer', sortValue: (r) => r.customer, render: (r) => cellText(r.customer, true) },
    { key: 'no', label: 'Plan', width: 190, sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cell} numberOfLines={1}>{r.no}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.frequency.toLowerCase()} · next {fmtDate(r.nextDate)}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 170, sortValue: (r) => r.kind, render: (r) => (
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Pill tone={r.kind === 'amc' ? 'accent' : 'primary'} label={r.kind === 'amc' ? 'AMC' : 'Subscription'} />
        {!r.active ? <Pill label="Paused" /> : r.due ? <Pill tone="warning" label="Due now" /> : null}
      </View>
    ) },
    { key: 'total', label: 'Each invoice', width: 130, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Recurring & AMC"
          subtitle={`${subs.filter((s) => s.active).length} active`}
          right={<DeskButton label="New plan" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/sales-docs/recurring/new')} />}
        />
      }
    >
      {due.length || ending.length ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 14, gap: 8 }}>
          {due.length ? <Notice tone="warning" title={`${due.length} plan${due.length === 1 ? '' : 's'} to invoice`} body={due.slice(0, 3).map((d) => d.sub.no).join(', ')} /> : null}
          {ending.length ? <Notice tone="accent" title={`${ending.length} ending within 30 days`} body="Call them about renewing" /> : null}
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented<Filter> value={filter} onChange={setFilter} options={[{ id: '', label: 'All' }, { id: 'subscription', label: 'Subscriptions' }, { id: 'amc', label: 'AMC' }, { id: 'paused', label: 'Paused' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/sales-docs/recurring/[id]', params: { id: r.id } })} emptyLabel="No recurring plans" />
      </View>
    </DeskPage>
  )
}
