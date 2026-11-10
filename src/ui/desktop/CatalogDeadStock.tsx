import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { fmtDate, toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { catalogSettings, deadStock } from '@/modules/catalog/logic'
import { deadStockCsv } from '@/modules/catalog/reports'
import { shareFile } from '@/features/shareFile'
import { csvFileName, toCsv } from '@/domain/csv'
import { T } from '@/ui/Text'
import { Download } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, dtext, type Column } from './kit'

const WINDOWS = [30, 60, 90, 180, 365]
type Row = { id: string; name: string; stock: number; lastSold: number | null; idleDays: number; value: number }

/**
 * The desktop Dead stock report: a KPI strip for what is stuck and a window filter, then a dense sortable grid
 * instead of the phone's scrolling cards. Figures come from the same `deadStock` the phone
 * `m/catalog/reports/dead.tsx` calls.
 */
export function DesktopDeadStock() {
  const { c } = useTheme()
  const can = useCan('stock')
  const data = useApp((s) => s.data)
  const [days, setDays] = useState(catalogSettings(data).deadDays)
  const now = Date.now()
  const d = useMemo(() => deadStock(data, now, days), [data, now, days])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Dead stock" />}>
        <View style={{ padding: 20 }}><T tone="mute">Dead stock is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const rows: Row[] = d.rows.map((r) => ({ id: r.variantId, name: r.name, stock: r.stock, lastSold: r.lastSold, idleDays: r.idleDays, value: r.value }))
  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Item', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.stock} units · {r.lastSold ? `last sold ${fmtDate(r.lastSold)}` : 'never sold'}</T>
      </View>
    ) },
    { key: 'idle', label: 'Idle', width: 90, align: 'right', sortValue: (r) => r.idleDays, render: (r) => <Pill tone={r.idleDays > 180 ? 'danger' : 'warning'} label={`${r.idleDays}d`} /> },
    { key: 'value', label: 'Stuck at cost', width: 140, align: 'right', sortValue: (r) => r.value, render: (r) => cellNum(inr(r.value, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Dead stock" subtitle={`Nothing sold in ${days} days`}
          right={d.rows.length ? <DeskButton label="CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName(`dead stock ${days} days ${toInputDate(now)}`), toCsv(deadStockCsv(data, now, days))).catch(() => toast('Could not export', 'err'))} /> : undefined} />
      }
    >
      <KpiStrip>
        <KpiTile label="Stuck at cost" value={inr(d.value, 0)} tone={d.value ? 'danger' : 'success'} delta={`${d.rows.length} items · ${d.qty} units`} />
      </KpiStrip>
      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented value={String(days)} onChange={(v) => setDays(Number(v))} options={[...new Set([...WINDOWS, days])].sort((a, b) => a - b).map((w) => ({ id: String(w), label: `${w} days` }))} />
      </View>
      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} emptyLabel={`Everything in stock sold within the last ${days} days, or arrived more recently.`} />
      </View>
    </DeskPage>
  )
}
