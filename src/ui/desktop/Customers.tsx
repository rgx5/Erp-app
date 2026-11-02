import React, { useMemo, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort, isThisMonth, monthDay, timeAgo } from '@/domain/dates'
import { inr0, num } from '@/domain/money'
import { customerStats, filterCustomers, type CustomerStats, type CustomerView } from '@/domain/stock'
import type { Bill, Customer } from '@/domain/types'
import { useLabels, useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { Cake, Close, Plus, Search as SearchIcon } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

/**
 * The desktop Customers screen: a KPI strip, a filter/sort bar and one dense, sortable grid — the same customer
 * list the phone app's card list shows, laid out the "dense data-grid classic" way instead of scrolling cards.
 * Every figure comes from the exact functions the phone screen uses (`src/app/customers/index.tsx`):
 * `customerStats`/`filterCustomers` for the numbers, `isThisMonth`/`monthDay`/`timeAgo`/`fmtDayShort` for the dates.
 * Nothing about what counts as "this month's dates" or "top spenders" is recomputed here.
 */

type Sort = 'name' | 'spend' | 'recent'

/** "1990-03-15" → "15 Mar": birthdays and anniversaries ignore the year. Copied verbatim from the mobile screen. */
const dayOf = (s: string) => {
  const md = monthDay(s)
  return md ? fmtDayShort(new Date(2000, Number(md.slice(0, 2)) - 1, Number(md.slice(3, 5))).getTime()) : ''
}

const NONE: CustomerStats = { bills: 0, spent: 0, last: null, avg: 0 }

/** A customer row plus its computed stats — the shape the grid's columns read from. */
type Row = Customer & { st: CustomerStats }

export function DesktopCustomers() {
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const canEdit = useCan('customers')
  const customers = useList('customers')
  const bills = useList('bills')
  const [q, setQ] = useState('')
  const [view, setView] = useState<CustomerView>('')
  const [sort, setSort] = useState<Sort>('name')

  // One pass over the bills; each customer then only looks at their own. Identical to the mobile screen's grouping.
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

  const creditTotal = useMemo(() => customers.reduce((s, x) => s + Math.max(0, x.storeCredit), 0), [customers])
  const pointsTotal = useMemo(() => customers.reduce((s, x) => s + Math.max(0, x.loyaltyPoints), 0), [customers])

  const rows: Row[] = useMemo(() => {
    const list = filterCustomers(customers, q, view)
    const sorted = sort === 'spend'
      ? [...list].sort((a, b) => (stats.get(b.id)?.spent ?? 0) - (stats.get(a.id)?.spent ?? 0) || a.name.localeCompare(b.name))
      : sort === 'recent'
      ? [...list].sort((a, b) => (stats.get(b.id)?.last ?? 0) - (stats.get(a.id)?.last ?? 0) || a.name.localeCompare(b.name))
      : list
    return sorted.map((x) => ({ ...x, st: stats.get(x.id) ?? NONE }))
  }, [customers, q, view, sort, stats])

  const filtered = !!q || !!view
  const plural = labels.customers.toLowerCase()
  const one = labels.customer.toLowerCase()

  const viewOptions: Array<{ id: CustomerView; label: string }> = [
    { id: '', label: 'All' },
    { id: 'birthday', label: counts.birthday ? `This month’s dates (${counts.birthday})` : 'This month’s dates' },
    { id: 'credit', label: counts.credit ? `Store credit (${counts.credit})` : 'Store credit' },
    { id: 'points', label: counts.points ? `Has points (${counts.points})` : 'Has points' },
  ]
  const sortOptions: Array<{ id: Sort; label: string }> = [
    { id: 'name', label: 'A – Z' },
    { id: 'spend', label: 'Top spenders' },
    { id: 'recent', label: 'Recent visit' },
  ]

  const columns: Array<Column<Row>> = [
    {
      key: 'name',
      label: labels.customer,
      sortValue: (r) => r.name,
      render: (r) => {
        const birthdayMonth = isThisMonth(r.dob) || isThisMonth(r.anniversary)
        const dates = view === 'birthday' ? [isThisMonth(r.dob) ? `Birthday ${dayOf(r.dob)}` : '', isThisMonth(r.anniversary) ? `Anniversary ${dayOf(r.anniversary)}` : ''].filter(Boolean).join(' · ') : ''
        return (
          <View style={{ gap: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
              {birthdayMonth ? <Cake size={13} color={c.accent} /> : null}
            </View>
            {dates ? <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{dates}</T> : null}
          </View>
        )
      },
    },
    { key: 'phone', label: 'Phone', width: 130, render: (r) => cellText(r.phone || '—') },
    { key: 'visits', label: 'Visits', width: 80, align: 'right', sortValue: (r) => r.st.bills, render: (r) => cellNum(r.st.bills ? num(r.st.bills) : '—') },
    { key: 'last', label: 'Last visit', width: 110, align: 'right', sortValue: (r) => r.st.last ?? 0, render: (r) => cellText(r.st.last ? timeAgo(r.st.last) : '—') },
    {
      key: 'credit', label: 'Store credit', width: 120, align: 'right', sortValue: (r) => r.storeCredit,
      render: (r) => (r.storeCredit > 0 ? <Pill tone="success" label={inr0(r.storeCredit)} /> : cellText('—')),
    },
    {
      key: 'points', label: 'Loyalty pts', width: 100, align: 'right', sortValue: (r) => r.loyaltyPoints,
      render: (r) => (r.loyaltyPoints > 0 ? <Pill tone="primary" label={num(r.loyaltyPoints)} /> : cellText('—')),
    },
    { key: 'spent', label: 'Total spent', width: 130, align: 'right', sortValue: (r) => r.st.spent, render: (r) => cellNum(r.st.spent ? inr0(r.st.spent) : '—', true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={labels.customers}
          subtitle={`${num(customers.length)} ${customers.length === 1 ? one : plural}`}
          right={canEdit ? <DeskButton label={`Add ${one}`} tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/customers/new')} /> : undefined}
        />
      }
    >
      {/* Second bar: search + the view filter on the left, the sort order on the right — the desktop equivalent of
          the mobile screen's search field, filter chips and segmented sort control, all in one row since there is
          room for it here. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, height: 42, borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.surfaceAlt }}>
        <View style={{ width: 260, flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.bg }}>
          <SearchIcon size={13} color={c.inkMute} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search name or mobile number"
            placeholderTextColor={c.inkMute}
            autoCorrect={false}
            autoCapitalize="none"
            style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
          />
          {q ? <Pressable onPress={() => setQ('')} accessibilityLabel="Clear search" hitSlop={6}><Close size={13} color={c.inkMute} /></Pressable> : null}
        </View>
        <DeskSegmented value={view} onChange={setView} options={viewOptions} />
        <View style={{ flex: 1 }} />
        <DeskSegmented value={sort} onChange={setSort} options={sortOptions} />
      </View>

      <KpiStrip>
        <KpiTile label={labels.customers} value={num(customers.length)} />
        <KpiTile label="Birthdays this month" value={String(counts.birthday)} tone="accent" onPress={() => setView('birthday')} />
        <KpiTile label="Holding store credit" value={String(counts.credit)} tone="success" delta={creditTotal ? `${inr0(creditTotal)} total` : undefined} onPress={() => setView('credit')} />
        <KpiTile label="Holding points" value={String(counts.points)} tone="primary" delta={pointsTotal ? `${num(pointsTotal)} pts total` : undefined} onPress={() => setView('points')} />
      </KpiStrip>

      <DataTable
        rows={rows}
        columns={columns}
        onRowPress={(r) => router.push({ pathname: '/customers/[id]', params: { id: r.id } })}
        emptyLabel={filtered ? `No ${plural} match` : `No ${plural} yet`}
      />
    </DeskPage>
  )
}
