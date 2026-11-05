import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, Toolbar, cellText, type Column } from './kit'

type RfqRow = { id: string; no: string; title: string; date: number; got: number; asked: number; status: 'open' | 'closed' | 'awarded' }

/**
 * The desktop quotations screen: a KPI strip for open requests and the awarded count, and a dense grid of every
 * request for quotation — instead of the phone's single stacked list. Every row comes from the same `data.rfqs`/
 * `data.rfqQuotes` the phone `m/purchasing/rfq/index.tsx` reads.
 */
export function DesktopRfqs() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const list = useMemo(() => listOf(data.rfqs).sort((a, b) => b.date - a.date), [data.rfqs])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Quotations" />}>
        <View style={{ padding: 20 }}><T tone="mute">Quotations are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const rows: RfqRow[] = list.map((r) => ({
    id: r.id, no: r.no, title: r.title, date: r.date, got: listOf(data.rfqQuotes).filter((q) => q.rfqId === r.id).length, asked: r.supplierIds.length, status: r.status,
  }))
  const open = list.filter((r) => r.status === 'open').length
  const awarded = list.filter((r) => r.status === 'awarded').length

  const columns: Array<Column<RfqRow>> = [
    { key: 'no', label: 'Request', width: 220, sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.no}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.title}</T>
      </View>
    ) },
    { key: 'date', label: 'Made', width: 110, sortValue: (r) => r.date, render: (r) => cellText(fmtDayShort(r.date)) },
    { key: 'replies', label: 'Replies', width: 120, sortValue: (r) => r.got, render: (r) => cellText(`${r.got} of ${r.asked}`) },
    { key: 'status', label: 'Status', width: 120, sortValue: (r) => r.status, render: (r) => (
      <Pill tone={r.status === 'awarded' ? 'success' : r.status === 'closed' ? 'default' : 'primary'} label={r.status === 'awarded' ? 'Awarded' : r.status === 'closed' ? 'Closed' : 'Open'} />
    ) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Quotations" subtitle="Requests and comparison"
          right={<DeskButton label="New request" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/purchasing/rfq/new')} />} />
      }
    >
      <KpiStrip>
        <KpiTile label="Open requests" value={String(open)} tone="primary" delta={`${list.length} in all`} />
        <KpiTile label="Awarded" value={String(awarded)} tone="success" delta="Turned into draft orders" />
      </KpiStrip>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/purchasing/rfq/[id]', params: { id: r.id } })}
          emptyLabel="No requests yet"
        />
      </View>
    </DeskPage>
  )
}
