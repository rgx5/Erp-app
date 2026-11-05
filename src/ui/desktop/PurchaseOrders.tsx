import React, { useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { isOverdue, STATUS_LABEL } from '@/modules/purchasing/logic'
import type { PoStatus } from '@/modules/purchasing/types'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { Plus, Search as SearchIcon } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, type Column } from './kit'

type StatusFilter = '' | 'open' | PoStatus
type OrderRow = { id: string; no: string; supplierName: string; date: number; expectedDate?: number; total: number; status: PoStatus; late: boolean }

/**
 * The desktop purchase-orders screen: a KPI strip (what is open, what is overdue), a search bar with a status
 * filter, and one dense sortable grid — instead of the phone's filter chips and stacked cards. Every figure comes
 * from the same hooks and functions the phone `m/purchasing/orders/index.tsx` already calls (`useList`,
 * `isOverdue`, `STATUS_LABEL`); this file only lays the same rows out as a grid.
 */
export function DesktopPurchaseOrders() {
  const { c } = useTheme()
  const router = useRouter()
  const canBuy = useCan('purchases')
  const orders = useList('purchaseOrders')
  const suppliers = useList('suppliers')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const now = Date.now()

  const name = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers])
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return orders
      .filter((o) => (status === '' ? true : status === 'open' ? o.status === 'sent' || o.status === 'partial' : o.status === status))
      .filter((o) => !n || o.no.toLowerCase().includes(n) || (name.get(o.supplierId) ?? '').toLowerCase().includes(n))
      .sort((a, b) => b.date - a.date)
  }, [orders, q, status, name])
  const open = useMemo(() => orders.filter((o) => o.status === 'sent' || o.status === 'partial'), [orders])
  const openValue = useMemo(() => open.reduce((s, o) => s + o.total, 0), [open])
  const overdue = useMemo(() => orders.filter((o) => isOverdue(o, now)), [orders, now])

  if (!canBuy) {
    return (
      <DeskPage toolbar={<Toolbar title="Purchase orders" />}>
        <View style={{ padding: 20 }}><T tone="mute">Purchase orders are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const tableRows: OrderRow[] = rows.map((o) => ({
    id: o.id, no: o.no, supplierName: name.get(o.supplierId) ?? 'Supplier', date: o.date, expectedDate: o.expectedDate, total: o.total, status: o.status, late: isOverdue(o, now),
  }))

  const columns: Array<Column<OrderRow>> = [
    { key: 'supplier', label: 'Supplier', sortValue: (r) => r.supplierName, render: (r) => cellText(r.supplierName, true) },
    { key: 'no', label: 'Order', width: 150, sortValue: (r) => r.no, render: (r) => cellText(r.no) },
    { key: 'date', label: 'Ordered', width: 110, sortValue: (r) => r.date, render: (r) => cellText(fmtDayShort(r.date)) },
    { key: 'expected', label: 'Expected', width: 110, sortValue: (r) => r.expectedDate ?? 0, render: (r) => cellText(r.expectedDate ? fmtDayShort(r.expectedDate) : '—') },
    { key: 'total', label: 'Total', width: 110, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
    { key: 'status', label: 'Status', width: 190, sortValue: (r) => r.status, render: (r) => (
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <Pill tone={r.status === 'received' ? 'success' : r.status === 'cancelled' ? 'danger' : r.status === 'partial' ? 'warning' : r.status === 'sent' ? 'primary' : 'default'} label={STATUS_LABEL[r.status]} />
        {r.late ? <Pill tone="danger" label="Overdue" /> : null}
      </View>
    ) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Purchase orders"
          subtitle={`${orders.length} orders`}
          right={<DeskButton label="New purchase order" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/purchasing/orders/new')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Open orders" value={inr(openValue, 0)} tone="primary" delta={`${open.length} ${open.length === 1 ? 'order' : 'orders'}`} />
        <KpiTile label="Overdue" value={String(overdue.length)} tone={overdue.length ? 'danger' : 'success'} delta={overdue.length ? 'Past their expected date' : 'Nothing late'} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, maxWidth: 320, flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search order or supplier"
            placeholderTextColor={c.inkMute}
            autoCorrect={false}
            autoCapitalize="none"
            style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
          />
        </View>
        <DeskSegmented<StatusFilter> value={status} onChange={setStatus} options={[{ id: '', label: 'All' }, { id: 'open', label: 'Open' }, { id: 'draft', label: 'Drafts' }, { id: 'received', label: 'Received' }, { id: 'cancelled', label: 'Cancelled' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={tableRows}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/purchasing/orders/[id]', params: { id: r.id } })}
          emptyLabel={q || status ? 'No orders match' : 'No purchase orders yet'}
        />
      </View>
    </DeskPage>
  )
}
