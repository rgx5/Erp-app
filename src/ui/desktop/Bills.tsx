import React, { useMemo, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDateTime, rangeBounds, RANGE_OPTIONS, type RangeKey } from '@/domain/dates'
import { inr, inr0, round2 } from '@/domain/money'
import { payLabel } from '@/domain/receipt'
import type { Bill } from '@/domain/types'
import { useLabels, useList } from '@/data/hooks'
import { useApp } from '@/data/store'
import { syncNow } from '@/data/runtime'
import { SyncPill } from '@/features/SyncPill'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { Search as SearchIcon, Close, Refresh } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Status = '' | 'paid' | 'returned' | 'credit' | 'held'
const STATUS_OPTIONS: Array<{ id: Status; label: string }> = [
  { id: '', label: 'All' }, { id: 'paid', label: 'Paid' }, { id: 'returned', label: 'Returned' }, { id: 'credit', label: 'Credit notes' }, { id: 'held', label: 'Parked' },
]

type Row = Bill & { id: string; customerName: string }

/**
 * The desktop Bills (sales register) screen: a dense, flat, sortable grid rather than the phone list's per-day
 * subtotal headers. A day-grouped list reads well as a scroll of cards, but it fights a sortable `DataTable` — a
 * header row wedged between data rows cannot be clicked to sort, and sorting by Total or Customer would scatter
 * the day headers anyway. A register at a keyboard wants the opposite: sort by any column, narrow with the same
 * range/status filters the phone uses, and read the period's shape from a `KpiStrip` up top — closer to how
 * Tally/QuickBooks Desktop show a sales register than to a day-by-day phone feed. The filtering logic (range,
 * status, search) and every figure shown are copied from the phone screen (`src/app/bills/index.tsx`), not
 * recomputed.
 */
export function DesktopBills() {
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const bills = useList('bills')
  const customers = useList('customers')
  const mode = useApp((s) => s.workspace?.mode)
  const [range, setRange] = useState<RangeKey>('30d')
  const [status, setStatus] = useState<Status>('')
  const [q, setQ] = useState('')
  const [syncing, setSyncing] = useState(false)

  const [from, to] = useMemo(() => rangeBounds(range), [range])
  const cust = useMemo(() => new Map(customers.map((x) => [x.id, x])), [customers])

  const rows = useMemo<Row[]>(() => {
    const n = q.trim().toLowerCase()
    return bills.filter((b) => {
      if (b.date < from || b.date > to) return false
      const credit = !!b.refundOfBillId
      if (status === 'held' ? b.status !== 'held' : b.status === 'held' && status !== '') return false
      if (status === 'paid' && (b.status !== 'paid' || credit)) return false
      if (status === 'returned' && !(b.status === 'returned' || b.status === 'partial-return')) return false
      if (status === 'credit' && !credit) return false
      if (!n) return true
      const cu = b.customerId ? cust.get(b.customerId) : undefined
      return b.no.toLowerCase().includes(n) || (cu?.name.toLowerCase().includes(n) ?? false) || (cu?.phone.includes(n) ?? false) || b.items.some((i) => i.name.toLowerCase().includes(n) || i.sku.toLowerCase().includes(n))
    }).map((b) => ({ ...b, id: b.id, customerName: (b.customerId ? cust.get(b.customerId)?.name : undefined) ?? 'Walk-in' })).sort((a, b) => b.date - a.date)
  }, [bills, from, to, status, q, cust])

  // The period's shape, same arithmetic the phone screen's per-day subtotal uses — held bills are parked, not sales.
  const sold = useMemo(() => rows.filter((b) => b.status !== 'held'), [rows])
  const netSales = round2(sold.reduce((s, b) => s + b.total, 0))
  const creditCount = useMemo(() => rows.filter((b) => !!b.refundOfBillId).length, [rows])
  const parkedCount = useMemo(() => rows.filter((b) => b.status === 'held').length, [rows])
  const positive = sold.filter((b) => b.total > 0)
  const avg = positive.length ? positive.reduce((s, b) => s + b.total, 0) / positive.length : 0

  async function refresh() { if (mode !== 'remote') return; setSyncing(true); await syncNow(); setSyncing(false) }

  const columns: Array<Column<Row>> = [
    { key: 'no', label: 'No.', width: 100, sortValue: (r) => r.no, render: (r) => cellText(r.no, true) },
    { key: 'when', label: 'When', width: 160, sortValue: (r) => r.date, render: (r) => cellText(fmtDateTime(r.date)) },
    { key: 'customer', label: labels.customer, sortValue: (r) => r.customerName, render: (r) => cellText(r.customerName) },
    { key: 'mode', label: 'Paid via', width: 110, render: (r) => cellText(r.payments.length ? [...new Set(r.payments.map(payLabel))].join(' + ') : '—') },
    { key: 'status', label: 'Status', width: 130, render: (r) => <StatusPill bill={r} /> },
    { key: 'items', label: 'Items', width: 70, align: 'right', sortValue: (r) => r.items.length, render: (r) => cellNum(String(r.items.length)) },
    { key: 'total', label: 'Total', width: 120, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={labels.sales}
          subtitle={`${rows.length} ${rows.length === 1 ? labels.sale.toLowerCase() : labels.sales.toLowerCase()}`}
          left={<DeskSegmented value={range} onChange={setRange} options={RANGE_OPTIONS.map((o) => ({ id: o.value, label: o.label }))} />}
          right={mode === 'remote' ? (
            <>
              <DeskButton label="Refresh" icon={<Refresh size={14} color={c.ink} />} onPress={refresh} disabled={syncing} />
              <SyncPill compact />
            </>
          ) : undefined}
        />
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, height: 46, borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.surfaceAlt }}>
        <View style={{ width: 280, flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.bg }}>
          <SearchIcon size={13} color={c.inkMute} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={`Search number, ${labels.customer.toLowerCase()}, mobile or item`}
            placeholderTextColor={c.inkMute}
            autoCorrect={false}
            autoCapitalize="none"
            style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
          />
          {q ? <Pressable onPress={() => setQ('')} accessibilityLabel="Clear search"><Close size={13} color={c.inkMute} /></Pressable> : null}
        </View>
        <DeskSegmented value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <View style={{ flex: 1 }} />
        {mode === 'remote' && syncing ? <T style={[dtext.tiny, { color: c.inkMute }]}>Syncing…</T> : null}
      </View>

      <KpiStrip>
        <KpiTile label={labels.sales} value={String(positive.length)} tone="primary" delta={`${rows.length} rows in range`} />
        <KpiTile label="Net sales" value={inr0(netSales)} tone={netSales >= 0 ? 'success' : 'danger'} />
        <KpiTile label="Average bill" value={inr0(avg)} tone="accent" />
        <KpiTile label="Credit notes" value={String(creditCount)} tone={creditCount ? 'danger' : 'default'} />
        <KpiTile label="Parked" value={String(parkedCount)} tone={parkedCount ? 'warning' : 'default'} />
      </KpiStrip>

      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/bills/[id]', params: { id: r.id } })}
          rowTone={(r) => (r.total < 0 || r.refundOfBillId ? 'danger' : undefined)}
          emptyLabel={`No ${labels.sales.toLowerCase()} found — try a longer date range or clear the filters`}
        />
      </View>
    </DeskPage>
  )
}

/** The same status read the phone row's badge uses. */
function StatusPill({ bill: b }: { bill: Bill }) {
  const credit = !!b.refundOfBillId
  if (credit) return <Pill tone="danger" label="Credit note" />
  if (b.status === 'held') return <Pill tone="accent" label="Parked" />
  if (b.status === 'partial-return') return <Pill tone="warning" label="Part returned" />
  if (b.status === 'returned') return <Pill tone="danger" label="Returned" />
  return <Pill tone="success" label="Paid" />
}
