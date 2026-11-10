import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { DAY, toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { abcAnalysis, type AbcBasis, type AbcClass } from '@/modules/catalog/logic'
import { abcCsv } from '@/modules/catalog/reports'
import { shareFile } from '@/features/shareFile'
import { csvFileName, toCsv } from '@/domain/csv'
import { T } from '@/ui/Text'
import { Download } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme, type Tone } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, dtext, type Column } from './kit'

const PERIODS = [30, 90, 180, 365]
const TONE: Record<AbcClass, Tone> = { A: 'success', B: 'primary', C: 'default' }
const MEANING: Record<AbcClass, string> = { A: 'the few that make most of your sales', B: 'the middle', C: 'the long tail' }
type Row = { id: string; name: string; share: number; cumulative: number; stock: number; metric: number; cls: AbcClass }

/**
 * The desktop ABC analysis report: a KPI strip for each class and a period/basis filter, then a dense sortable
 * grid instead of the phone's scrolling cards. Figures come from the same `abcAnalysis` the phone
 * `m/catalog/reports/abc.tsx` calls.
 */
export function DesktopAbc() {
  const { c } = useTheme()
  const can = useCan('reports')
  const profitOk = useCan('viewProfit')
  const data = useApp((s) => s.data)
  const [days, setDays] = useState(90)
  const [basis, setBasis] = useState<AbcBasis>('revenue')
  const now = Date.now()
  const from = now - days * DAY
  const a = useMemo(() => abcAnalysis(data, from, now, basis), [data, from, now, basis])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="ABC analysis" />}>
        <View style={{ padding: 20 }}><T tone="mute">ABC analysis is for the owner and managers.</T></View>
      </DeskPage>
    )
  }
  const fmt = (n: number) => (basis === 'qty' ? String(n) : inr(n, 0))

  const rows: Row[] = a.rows.map((r) => ({ id: r.variantId, name: r.name, share: r.share, cumulative: r.cumulative, stock: r.stock, metric: r.metric, cls: r.cls }))
  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Item', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.share}% of the total · running {r.cumulative}% · {r.stock} in stock</T>
      </View>
    ) },
    { key: 'cls', label: 'Class', width: 80, align: 'center', sortValue: (r) => r.cls, render: (r) => <Pill tone={TONE[r.cls]} label={r.cls} /> },
    { key: 'metric', label: basis === 'qty' ? 'Units' : basis === 'profit' ? 'Profit' : 'Sales', width: 130, align: 'right', sortValue: (r) => r.metric, render: (r) => cellNum(fmt(r.metric), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar title="ABC analysis" subtitle={`Last ${days} days`}
          right={a.rows.length ? <DeskButton label="CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName(`abc analysis ${days} days ${toInputDate(now)}`), toCsv(abcCsv(data, from, now, basis))).catch(() => toast('Could not export', 'err'))} /> : undefined} />
      }
    >
      <KpiStrip>
        {(['A', 'B', 'C'] as const).map((k) => <KpiTile key={k} label={`Class ${k} · ${a.classes[k].items} items`} value={`${a.classes[k].share}%`} tone={k === 'A' ? 'success' : 'default'} delta={`${MEANING[k]} · ${fmt(a.classes[k].metric)}`} />)}
        {a.unsold ? <KpiTile label="In stock, not sold" value={String(a.unsold)} tone="warning" /> : null}
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <DeskSegmented value={String(days)} onChange={(v) => setDays(Number(v))} options={PERIODS.map((p) => ({ id: String(p), label: `${p} days` }))} />
        <DeskSegmented value={basis} onChange={setBasis} options={[{ id: 'revenue', label: 'Sales' }, ...(profitOk ? [{ id: 'profit' as const, label: 'Profit' }] : []), { id: 'qty', label: 'Units' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} emptyLabel="No sales in this period" />
      </View>
    </DeskPage>
  )
}
