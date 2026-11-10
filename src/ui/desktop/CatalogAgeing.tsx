import React, { useMemo } from 'react'
import { View } from 'react-native'
import { toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { AGE_BUCKETS, stockAgeing } from '@/modules/catalog/logic'
import { ageingCsv } from '@/modules/catalog/reports'
import { shareFile } from '@/features/shareFile'
import { csvFileName, toCsv } from '@/domain/csv'
import { HBars } from '@/ui/charts'
import { T } from '@/ui/Text'
import { Download } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Toolbar, cellNum, dtext, type Column } from './kit'

type Row = { id: string; name: string; stock: number; oldest: number; over90: number; totalValue: number }

/**
 * The desktop Stock ageing report: a KPI strip per age bucket, a horizontal-bar chart (reusing the shared
 * `HBars` chart component) and a dense sortable grid, instead of the phone's stacked cards. Figures come from the
 * same `stockAgeing` the phone `m/catalog/reports/ageing.tsx` calls.
 */
export function DesktopAgeing() {
  const { c } = useTheme()
  const can = useCan('stock')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const a = useMemo(() => stockAgeing(data, now), [data, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Stock ageing" />}>
        <View style={{ padding: 20 }}><T tone="mute">Stock ageing is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const rows: Row[] = a.rows.map((r) => ({ id: r.variantId, name: r.name, stock: r.stock, oldest: r.oldest, over90: r.qty.older + r.qty.d180, totalValue: r.totalValue }))
  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Item', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.stock} units · oldest {r.oldest} days{r.over90 > 0 ? ` · ${r.over90} over 90 days` : ''}</T>
      </View>
    ) },
    { key: 'value', label: 'Value at cost', width: 140, align: 'right', sortValue: (r) => r.totalValue, render: (r) => cellNum(inr(r.totalValue, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Stock ageing" subtitle="Value at cost, by how long it has been here"
          right={a.rows.length ? <DeskButton label="CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName(`stock ageing ${toInputDate(now)}`), toCsv(ageingCsv(data, now))).catch(() => toast('Could not export', 'err'))} /> : undefined} />
      }
    >
      {!a.rows.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><T tone="mute">No stock on hand.</T></View>
      ) : (
        <>
          <KpiStrip>
            <KpiTile label="Total stock" value={inr(a.total, 0)} tone="primary" />
            {AGE_BUCKETS.map((b) => <KpiTile key={b.key} label={b.label} value={inr(a.value[b.key], 0)} tone={b.key === 'older' && a.value.older > 0 ? 'danger' : b.key === 'd180' && a.value.d180 > 0 ? 'warning' : 'default'} />)}
          </KpiStrip>
          <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 14, flex: 1 }}>
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, maxWidth: 560 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 8 }]}>By age</T>
              <HBars items={AGE_BUCKETS.map((b) => ({ label: b.label, value: a.value[b.key] }))} format={(n) => inr(n, 0)} />
            </View>
            <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
              <DataTable rows={rows} columns={columns} emptyLabel="No stock on hand" />
            </View>
          </View>
        </>
      )}
    </DeskPage>
  )
}
