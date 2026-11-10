import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { DAY } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { itemName } from '@/modules/manufacturing/bom'
import { productionCostReport, productionSummary, wipReport, yieldReport } from '@/modules/manufacturing/reports'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskPage, DeskSegmented, KpiStrip, KpiTile, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Tab = 'cost' | 'yield' | 'wip'
const PERIODS: Array<[number, string]> = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, 'Year']]
type CostRow = { id: string; no: string; name: string; actualPerUnit: number; standardPerUnit: number; good: number; scrap: number; variance: number; matV: number; labV: number; ohV: number }
type YieldRow = { id: string; name: string; yieldPct: number | null; good: number; planned: number; scrap: number; qualityPct: number | null }
type WastageRow = { id: string; name: string; wastagePct: number | null; over: number; plannedWastagePct: number; actual: number; allowed: number }
type WipRow = { id: string; no: string; name: string; wipValue: number; good: number; qty: number; remaining: number }

/**
 * The desktop Production reports screen: a KPI strip for what was made and the headline figure for the chosen
 * tab, a period filter, and a dense grid per tab instead of the phone's stacked cards. Every figure comes from the
 * same `productionSummary`/`productionCostReport`/`yieldReport`/`wipReport` the phone
 * `m/manufacturing/reports.tsx` calls.
 */
export function DesktopProductionReports() {
  const { c } = useTheme()
  const params = useLocalSearchParams<{ tab?: string }>()
  const can = useCan('manufacturing')
  const data = useApp((s) => s.data)
  const [tab, setTab] = useState<Tab>(params.tab === 'yield' || params.tab === 'wip' ? params.tab : 'cost')
  const [days, setDays] = useState(30)
  const to = Date.now(), from = to - days * DAY
  const sum = useMemo(() => productionSummary(data, from, to), [data, from, to])
  const cost = useMemo(() => productionCostReport(data, from, to), [data, from, to])
  const yr = useMemo(() => yieldReport(data, from, to), [data, from, to])
  const wip = useMemo(() => wipReport(data), [data])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Production reports" />}>
        <View style={{ padding: 20 }}><T tone="mute">Production reports are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const costRows: CostRow[] = cost.rows.map((r) => ({ id: r.workOrderId, no: r.no, name: itemName(data, r.outputVariantId), actualPerUnit: r.actualPerUnit, standardPerUnit: r.standardPerUnit, good: r.good, scrap: r.scrap, variance: r.variance, matV: r.materialVariance, labV: r.labourVariance, ohV: r.overheadVariance }))
  const yieldRows: YieldRow[] = yr.yields.map((y) => ({ id: y.outputVariantId, name: itemName(data, y.outputVariantId), yieldPct: y.yieldPct, good: y.good, planned: y.planned, scrap: y.scrap, qualityPct: y.qualityPct }))
  const wastageRows: WastageRow[] = yr.wastage.map((w) => ({ id: w.variantId, name: itemName(data, w.variantId), wastagePct: w.wastagePct, over: w.over, plannedWastagePct: w.plannedWastagePct ?? 0, actual: w.actual, allowed: w.allowed }))
  const wipRows: WipRow[] = wip.rows.map((r) => ({ id: r.workOrderId, no: r.no, name: itemName(data, r.outputVariantId), wipValue: r.wipValue, good: r.good, qty: r.qty, remaining: r.remaining }))

  const costColumns: Array<Column<CostRow>> = [
    { key: 'name', label: 'Work order', sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.no} · {r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>Standard {inr(r.standardPerUnit)} · {r.good} good{r.scrap ? `, ${r.scrap} scrap` : ''}</T>
      </View>
    ) },
    { key: 'actual', label: 'Actual / unit', width: 120, align: 'right', sortValue: (r) => r.actualPerUnit, render: (r) => cellNum(inr(r.actualPerUnit), true) },
    { key: 'variance', label: 'Variance (M/L/O)', width: 190, align: 'right', sortValue: (r) => r.matV + r.labV + r.ohV, render: (r) => cellText(`${inr(r.matV)} / ${inr(r.labV)} / ${inr(r.ohV)}`) },
  ]
  const yieldColumns: Array<Column<YieldRow>> = [
    { key: 'name', label: 'Output', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'detail', label: 'Good / planned', width: 170, render: (r) => cellText(`${r.good} of ${r.planned} · ${r.scrap} scrap · quality ${r.qualityPct ?? '—'}%`) },
    { key: 'yield', label: 'Yield', width: 90, align: 'right', sortValue: (r) => r.yieldPct ?? -1, render: (r) => cellNum(r.yieldPct === null ? '—' : `${r.yieldPct}%`, true) },
  ]
  const wastageColumns: Array<Column<WastageRow>> = [
    { key: 'name', label: 'Material', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'detail', label: 'Used / allowed', width: 180, render: (r) => cellText(`Planned ${r.plannedWastagePct}% · used ${r.actual} against ${r.allowed} allowed`) },
    { key: 'pct', label: 'Wastage', width: 100, align: 'right', sortValue: (r) => r.wastagePct ?? -1, render: (r) => cellNum(r.wastagePct === null ? '—' : `${r.wastagePct}%`, true) },
  ]
  const wipColumns: Array<Column<WipRow>> = [
    { key: 'name', label: 'Work order', sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.no} · {r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.good} of {r.qty} made · {r.remaining} to go</T>
      </View>
    ) },
    { key: 'wip', label: 'In progress value', width: 150, align: 'right', sortValue: (r) => r.wipValue, render: (r) => cellNum(inr(r.wipValue, 0), true) },
  ]

  return (
    <DeskPage toolbar={<Toolbar title="Production reports" />}>
      <KpiStrip>
        <KpiTile label="Made" value={String(sum.good)} tone="primary" delta={`${sum.orders} orders`} />
        <KpiTile label={tab === 'wip' ? 'In progress' : 'Variance'} value={inr(tab === 'wip' ? sum.wip : sum.variance, 0)} tone={tab !== 'wip' && sum.variance > 0 ? 'danger' : 'success'} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <DeskSegmented<Tab> value={tab} onChange={setTab} options={[{ id: 'cost', label: 'Cost & variance' }, { id: 'yield', label: 'Yield & wastage' }, { id: 'wip', label: 'In progress' }]} />
        {tab !== 'wip' ? <DeskSegmented value={String(days)} onChange={(v) => setDays(Number(v))} options={PERIODS.map(([d, l]) => ({ id: String(d), label: l }))} /> : null}
      </View>

      {tab === 'cost' ? (
        <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={costRows} columns={costColumns} emptyLabel="No orders finished in this period" />
        </View>
      ) : null}

      {tab === 'yield' ? (
        <SplitPaneReports left={<DataTable rows={yieldRows} columns={yieldColumns} emptyLabel="No orders finished in this period" />} right={<DataTable rows={wastageRows} columns={wastageColumns} emptyLabel="No wastage data" />} />
      ) : null}

      {tab === 'wip' ? (
        <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={wipRows} columns={wipColumns} emptyLabel="Nothing is in progress" />
        </View>
      ) : null}
    </DeskPage>
  )
}

/** Two bordered grids side by side, each with its own heading — used for the yield/wastage tab only. */
function SplitPaneReports({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const { c } = useTheme()
  return (
    <View style={{ flex: 1, flexDirection: 'row', marginHorizontal: 14, marginBottom: 14, gap: 14 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <T style={[dtext.label, { color: c.inkMute, paddingHorizontal: 4 }]}>Output: planned against actual</T>
        <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>{left}</View>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <T style={[dtext.label, { color: c.inkMute, paddingHorizontal: 4 }]}>Material wastage</T>
        <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>{right}</View>
      </View>
    </View>
  )
}
