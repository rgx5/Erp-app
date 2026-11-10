import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { forecastAll, minMaxSuggestions, variantName } from '@/modules/catalog/logic'
import { applyMinMax } from '@/modules/catalog/ops'
import { forecastCsv, minMaxCsv } from '@/modules/catalog/reports'
import { shareFile } from '@/features/shareFile'
import { csvFileName, toCsv } from '@/domain/csv'
import { listOf } from '@/data/state'
import { T } from '@/ui/Text'
import { Download } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

const HORIZONS = [7, 14, 30, 60]
type FRow = { id: string; name: string; stock: number; perDay: number; daysOfCover: number | null; expected: number; trendPct: number | null; confidence: 'good' | 'low' | 'ok' }
type MRow = { id: string; name: string; perDay: number; currentMin: number; min: number; max: number; move: 'raise' | 'lower' | 'same'; confidence: 'good' | 'low' | 'ok' }

/**
 * The desktop Demand forecast screen: a forecast/min-max tab, a horizon filter and a dense sortable grid instead
 * of the phone's scrolling cards. Figures come from the same `forecastAll`/`minMaxSuggestions` the phone
 * `m/catalog/forecast.tsx` calls; applying min–max still goes through `applyMinMax` unchanged.
 */
export function DesktopForecast() {
  const { c } = useTheme()
  const can = useCan('reports')
  const canSet = useCan('inventory')
  const data = useApp((s) => s.data)
  const [tab, setTab] = useState<'forecast' | 'minmax'>('forecast')
  const [days, setDays] = useState(14)
  const now = Date.now()
  const fc = useMemo(() => forecastAll(data, now, { horizonDays: days }), [data, now, days])
  const fRows: FRow[] = useMemo(() => listOf(data.variants).flatMap((v) => {
    const f = fc.get(v.id)
    return f && f.sold > 0 ? [{ id: v.id, name: variantName(data, v), stock: v.stock, perDay: f.perDay, daysOfCover: f.daysOfCover, expected: f.expected, trendPct: f.trendPct, confidence: f.confidence }] : []
  }).sort((a, b) => b.expected - a.expected), [data, fc])
  const mm = useMemo(() => minMaxSuggestions(data, now), [data, now])
  const changes = mm.filter((r) => r.move !== 'same' || r.currentMax === undefined)
  const mRows: MRow[] = mm.map((r) => ({ id: r.variantId, name: r.name, perDay: r.perDay, currentMin: r.currentMin, min: r.min, max: r.max, move: r.move, confidence: r.confidence }))

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Demand forecast" />}>
        <View style={{ padding: 20 }}><T tone="mute">Demand forecast is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  function apply() {
    try {
      const r = perform((s, ctx) => applyMinMax(s, changes.map((x) => ({ variantId: x.variantId, min: x.min, max: x.max })), ctx))
      toast(`${r.count} items updated`, 'ok')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not apply', 'err') }
  }

  const fColumns: Array<Column<FRow>> = [
    { key: 'name', label: 'Item', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.stock} in stock · sells {r.perDay}/day{r.daysOfCover !== null ? ` · lasts ${r.daysOfCover} days` : ''}{r.confidence === 'low' ? ' · little history' : ''}</T>
      </View>
    ) },
    { key: 'trend', label: 'Trend', width: 90, align: 'right', sortValue: (r) => r.trendPct ?? 0, render: (r) => (r.trendPct !== null ? cellText(`${r.trendPct > 0 ? '+' : ''}${r.trendPct}%`) : null) },
    { key: 'expected', label: `Expected (${days}d)`, width: 140, align: 'right', sortValue: (r) => r.expected, render: (r) => cellNum(String(r.expected), true) },
  ]
  const mColumns: Array<Column<MRow>> = [
    { key: 'name', label: 'Item', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>Sells {r.perDay}/day{r.confidence === 'good' ? '' : ' · few sales'}</T>
      </View>
    ) },
    { key: 'min', label: 'Level', width: 150, align: 'right', sortValue: (r) => r.min, render: (r) => cellText(`${r.currentMin} → ${r.min}`) },
    { key: 'max', label: 'Order up to', width: 110, align: 'right', sortValue: (r) => r.max, render: (r) => cellNum(String(r.max)) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Demand forecast" subtitle="From your own bills"
          right={
            <>
              <DeskButton label="CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName(tab === 'forecast' ? `demand forecast ${days} days` : 'min max suggestions'), toCsv(tab === 'forecast' ? forecastCsv(data, now, days) : minMaxCsv(data, now))).catch(() => toast('Could not export', 'err'))} />
              {tab === 'minmax' && canSet && changes.length ? <DeskButton label={`Apply to ${changes.length} items`} tone="primary" onPress={apply} /> : null}
            </>
          } />
      }
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <DeskSegmented value={tab} onChange={setTab} options={[{ id: 'forecast', label: 'Forecast' }, { id: 'minmax', label: 'Min–max' }]} />
        {tab === 'forecast' ? <DeskSegmented value={String(days)} onChange={(v) => setDays(Number(v))} options={HORIZONS.map((d) => ({ id: String(d), label: `${d} days` }))} /> : null}
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        {tab === 'forecast' ? (
          <DataTable rows={fRows} columns={fColumns} emptyLabel="Nothing to forecast yet" />
        ) : (
          <DataTable rows={mRows} columns={mColumns} rowTone={(r) => (changes.some((x) => x.variantId === r.id) ? (r.move === 'raise' ? 'warning' : 'success') : undefined)} emptyLabel="Not enough sales yet" />
        )}
      </View>
    </DeskPage>
  )
}
