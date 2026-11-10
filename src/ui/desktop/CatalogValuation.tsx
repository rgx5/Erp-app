import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { valuation, type ValuationGroup } from '@/modules/catalog/logic'
import { valuationCsv } from '@/modules/catalog/reports'
import { shareFile } from '@/features/shareFile'
import { csvFileName, toCsv } from '@/domain/csv'
import { T } from '@/ui/Text'
import { Download } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Toolbar, cellNum, cellText, type Column } from './kit'

type Row = { id: string; label: string; qty: number; retail: number; marginPct: number; cost: number }

/**
 * The desktop Stock valuation report: a KPI strip for cost/retail/margin, a group-by filter, and a dense sortable
 * grid, instead of the phone's stacked cards. Figures come from the same `valuation` the phone
 * `m/catalog/reports/valuation.tsx` calls.
 */
export function DesktopValuation() {
  const { c } = useTheme()
  const can = useCan('stock')
  const data = useApp((s) => s.data)
  const [by, setBy] = useState<ValuationGroup>('category')
  const v = useMemo(() => valuation(data, by), [data, by])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Stock valuation" />}>
        <View style={{ padding: 20 }}><T tone="mute">Stock valuation is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const rows: Row[] = v.rows.map((r) => ({ id: r.key, label: r.label, qty: r.qty, retail: r.retail, marginPct: r.marginPct, cost: r.cost }))
  const columns: Array<Column<Row>> = [
    { key: 'label', label: by === 'item' ? 'Item' : by === 'brand' ? 'Brand' : 'Category', sortValue: (r) => r.label, render: (r) => cellText(r.label, true) },
    { key: 'detail', label: 'Units / margin', width: 220, render: (r) => cellText(`${r.qty} units · selling value ${inr(r.retail, 0)} · ${r.marginPct}% margin`) },
    { key: 'cost', label: 'At cost', width: 130, align: 'right', sortValue: (r) => r.cost, render: (r) => cellNum(inr(r.cost, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Stock valuation" subtitle={`As on ${toInputDate(Date.now())} · ${data.store?.costBasis === 'latest' ? 'latest cost' : 'average cost'}`}
          right={v.rows.length ? <DeskButton label="CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName(`stock valuation by ${by} ${toInputDate(Date.now())}`), toCsv(valuationCsv(data, by))).catch(() => toast('Could not export', 'err'))} /> : undefined} />
      }
    >
      <KpiStrip>
        <KpiTile label="At cost" value={inr(v.cost, 0)} tone="primary" />
        <KpiTile label="At selling price" value={inr(v.retail, 0)} />
        <KpiTile label="Potential margin" value={`${inr(v.margin, 0)} · ${v.retail > 0 ? Math.round((v.margin / v.retail) * 100) : 0}%`} tone="success" />
        <KpiTile label="Units" value={String(v.qty)} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented<ValuationGroup> value={by} onChange={setBy} options={[{ id: 'category', label: 'Category' }, { id: 'brand', label: 'Brand' }, { id: 'item', label: 'Item' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} emptyLabel="No stock on hand" />
      </View>
    </DeskPage>
  )
}
