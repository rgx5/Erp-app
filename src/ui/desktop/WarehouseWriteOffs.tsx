import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort, rangeBounds, RANGE_OPTIONS, type RangeKey } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { lossesByReason, REASON_LABEL } from '@/modules/warehouse/logic'
import type { WriteOff } from '@/modules/warehouse/types'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { Plus } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Toolbar, cellNum, cellText, type Column } from './kit'

/**
 * The desktop Write-offs screen: a KPI strip for what was lost in the chosen period, a range toggle in place of
 * the phone's `Chip` row, and a dense grid of documents instead of a card list. Reads the exact same
 * `lossesByReason` the phone screen computes; this file only lays the same rows out as a grid.
 */
export function DesktopWriteOffs() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('warehouse')
  const writeOffs = useList('writeOffs')
  const [range, setRange] = useState<RangeKey>('30d')
  const [from, to] = rangeBounds(range)
  const by = useMemo(() => lossesByReason(writeOffs, from, to), [writeOffs, from, to])
  const rows = useMemo(() => writeOffs.filter((w) => w.date >= from && w.date <= to).sort((a, b) => b.date - a.date), [writeOffs, from, to])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Write-offs" />}>
        <View style={{ padding: 20 }}><T tone="mute">Write-offs are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const total = by.reduce((s, x) => s + x.total, 0)

  const columns: Array<Column<WriteOff>> = [
    { key: 'no', label: 'No.', width: 140, sortValue: (r) => r.no, render: (r) => cellText(r.no, true) },
    { key: 'reason', label: 'Reason', width: 120, sortValue: (r) => REASON_LABEL[r.reason], render: (r) => cellText(REASON_LABEL[r.reason]) },
    { key: 'date', label: 'Date', width: 110, sortValue: (r) => r.date, render: (r) => cellText(fmtDayShort(r.date)) },
    { key: 'lines', label: 'Lines', width: 70, align: 'right', sortValue: (r) => r.lines.length, render: (r) => cellNum(String(r.lines.length)) },
    { key: 'total', label: 'Value lost', width: 120, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Write-offs"
          subtitle="Stock taken off at cost"
          right={<DeskButton label="New write-off" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/warehouse/writeoffs/new')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Lost in this period" value={inr(total, 0)} tone={total ? 'danger' : 'default'} delta={by.map((x) => `${REASON_LABEL[x.reason]} ${inr(x.total, 0)}`).join(' · ') || 'Nothing written off'} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented value={range} onChange={setRange} options={RANGE_OPTIONS.map((o) => ({ id: o.value, label: o.label }))} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/warehouse/writeoffs/[id]', params: { id: r.id } })}
          emptyLabel="No write-offs"
        />
      </View>
    </DeskPage>
  )
}
