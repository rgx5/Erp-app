import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { itemName } from '@/modules/manufacturing/bom'
import { checksOf, entriesOf, isOpen, qualityPosition } from '@/modules/manufacturing/production'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskPage, Pill, SplitPane, Toolbar, dtext, type Column } from './kit'

type WaitRow = { id: string; no: string; name: string; passed: number; note: string }
type RecentRow = { id: string; no: string; woId: string; woNo: string; date: number; passed: number; checked: number; note: string; rejected: boolean }

/**
 * The desktop Quality checks screen: a grid of orders waiting for inspection alongside the recent-inspections
 * grid, instead of the phone's two stacked lists. Inspecting itself still happens on the work order. Figures come
 * from the same `qualityPosition`/`checksOf`/`entriesOf` the phone `m/manufacturing/quality/index.tsx` calls.
 */
export function DesktopQuality() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('inventory')
  const orders = useList('workOrders')
  const checks = useList('qualityChecks')
  const data = useApp((s) => s.data)

  const waitRows: WaitRow[] = useMemo(() => orders.filter((o) => isOpen(o) && o.checklist.length).map((o) => {
    const pos = qualityPosition(checksOf(data, o.id), entriesOf(data, o.id))
    return { id: o.id, no: o.no, name: `${itemName(data, o.outputVariantId)} × ${o.qty}`, passed: pos.passed, note: `${pos.passed} passed${pos.rework ? ` · ${pos.rework} to re-check after rework` : ''}${pos.pendingScrap ? ` · ${pos.pendingScrap} to scrap` : ''}` }
  }), [orders, data])
  const recentRows: RecentRow[] = useMemo(() => [...checks].sort((a, b) => b.date - a.date).slice(0, 30).map((q) => ({ id: q.id, no: q.no, woId: q.workOrderId, woNo: data.workOrders[q.workOrderId]?.no ?? '', date: q.date, passed: q.qtyPassed, checked: q.qtyChecked, rejected: q.qtyRejected > 0, note: q.qtyRejected ? `${q.qtyRejected} ${q.rejectAction === 'rework' ? 'to rework' : 'scrapped'}` : '' })), [checks, data])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Quality checks" />}>
        <View style={{ padding: 20 }}><T tone="mute">Quality checks are for the owner, managers and stock keepers.</T></View>
      </DeskPage>
    )
  }

  const waitColumns: Array<Column<WaitRow>> = [
    { key: 'name', label: 'Order', sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.no} · {r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.note}</T>
      </View>
    ) },
  ]
  const recentColumns: Array<Column<RecentRow>> = [
    { key: 'no', label: 'Inspection', sortValue: (r) => r.date, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.no} · {r.woNo}</T>
        <T style={[dtext.tiny, { color: r.rejected ? c.danger : c.inkMute }]} numberOfLines={1}>{fmtDayShort(r.date)} · {r.passed} of {r.checked} passed{r.note ? ` · ${r.note}` : ''}</T>
      </View>
    ) },
    { key: 'status', label: '', width: 90, render: (r) => (r.rejected ? <Pill tone="danger" label="Issue" /> : <Pill tone="success" label="Clean" />) },
  ]

  return (
    <DeskPage toolbar={<Toolbar title="Quality checks" />}>
      <SplitPane widths={['flex', 'flex']}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <View style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: c.line }}><T style={[dtext.label, { color: c.inkMute }]}>To inspect</T></View>
          <DataTable rows={waitRows} columns={waitColumns} onRowPress={(r) => router.push({ pathname: '/m/manufacturing/orders/[id]', params: { id: r.id } } as never)} emptyLabel="Nothing to inspect" />
        </View>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <View style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: c.line }}><T style={[dtext.label, { color: c.inkMute }]}>Recent inspections</T></View>
          <DataTable rows={recentRows} columns={recentColumns} onRowPress={(r) => router.push({ pathname: '/m/manufacturing/orders/[id]', params: { id: r.woId } } as never)} emptyLabel="No inspections yet" />
        </View>
      </SplitPane>
    </DeskPage>
  )
}
