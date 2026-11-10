import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { itemName } from '@/modules/manufacturing/bom'
import { isLate, WO_LABEL } from '@/modules/manufacturing/production'
import type { WoStatus } from '@/modules/manufacturing/types'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, Pill, Toolbar, dtext, type Column } from './kit'

const TONE: Record<WoStatus, Tone> = { planned: 'default', in_progress: 'primary', done: 'success', cancelled: 'danger' }
type Row = { id: string; name: string; no: string; recipeName: string; dueDate: number | undefined; status: WoStatus; late: boolean; part: boolean }

/**
 * The desktop Work orders screen: a status filter and one dense sortable grid instead of the phone's scrolling
 * cards. Rows use the same `isLate`/`itemName` the phone `m/manufacturing/orders/index.tsx` calls.
 */
export function DesktopWorkOrders() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('inventory')
  const orders = useList('workOrders')
  const data = useApp((s) => s.data)
  const [status, setStatus] = useState<'' | 'open' | WoStatus>('open')
  const now = Date.now()

  const rows: Row[] = useMemo(() => orders
    .filter((o) => (status === '' ? true : status === 'open' ? o.status === 'planned' || o.status === 'in_progress' : o.status === status))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((o) => ({ id: o.id, name: `${itemName(data, o.outputVariantId)} × ${o.qty}`, no: o.no, recipeName: o.recipeName, dueDate: o.dueDate, status: o.status, late: isLate(o, now), part: !!o.parentId })), [orders, status, data, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Work orders" />}>
        <View style={{ padding: 20 }}><T tone="mute">Work orders are for the owner, managers and stock keepers.</T></View>
      </DeskPage>
    )
  }

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Output', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.no} · {r.recipeName}{r.dueDate ? ` · due ${fmtDayShort(r.dueDate)}` : ''}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 170, sortValue: (r) => r.status, render: (r) => (
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Pill tone={TONE[r.status]} label={WO_LABEL[r.status]} />
        {r.late ? <Pill tone="danger" label="Late" /> : null}
        {r.part ? <Pill tone="accent" label="Part" /> : null}
      </View>
    ) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Work orders" subtitle={`${orders.length} orders`}
          right={<DeskButton label="New work order" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/manufacturing/orders/new' as never)} />} />
      }
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 }}>
        <DeskSegmented value={status} onChange={setStatus} options={[{ id: 'open', label: 'Open' }, { id: 'planned', label: 'Planned' }, { id: 'in_progress', label: 'In progress' }, { id: 'done', label: 'Done' }, { id: 'cancelled', label: 'Cancelled' }, { id: '', label: 'All' }]} />
      </View>
      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/manufacturing/orders/[id]', params: { id: r.id } } as never)} emptyLabel="No work orders" />
      </View>
    </DeskPage>
  )
}
