import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { toCsv, csvFileName } from '@/domain/csv'
import { fmtMonth } from '@/domain/dates'
import { inr } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import { useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { commissionCsvRows, commissionReport } from '@/modules/sales-docs/logic/commissions'
import { T } from '@/ui/Text'
import { Download, Sliders } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Period = 'this' | 'last' | 'year'
type Row = { id: string; name: string; bills: number; pieces: number; sales: number; commission: number; achievementPct: number | null; target: number; lines: string }

/**
 * The desktop Commissions & targets screen: a KPI strip for total sales and commission, a period filter, and one
 * dense grid of every salesperson instead of the phone's stacked cards. Figures come from the same
 * `commissionReport` the phone `m/sales-docs/commissions/index.tsx` calls.
 */
export function DesktopCommissions() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('salesDocs')
  const data = useApp((s) => s.data)
  const [period, setPeriod] = useState<Period>('this')
  const now = Date.now()

  const range = useMemo(() => {
    const d = new Date(now)
    if (period === 'year') return { from: new Date(d.getFullYear(), 0, 1).getTime(), to: now, label: `${d.getFullYear()} so far` }
    const m = period === 'this' ? d.getMonth() : d.getMonth() - 1
    return { from: new Date(d.getFullYear(), m, 1).getTime(), to: period === 'this' ? now : new Date(d.getFullYear(), m + 1, 0, 23, 59, 59, 999).getTime(), label: fmtMonth(new Date(d.getFullYear(), m, 1).getTime()) }
  }, [period, now])
  const rep = useMemo(() => commissionReport(data, range.from, range.to), [data, range])
  const rows: Row[] = rep.rows.map((r) => ({ id: r.staffId, name: r.name, bills: r.bills, pieces: r.pieces, sales: r.sales, commission: r.commission, achievementPct: r.achievementPct, target: r.target, lines: r.lines.map((l) => `${l.ruleName} ${inr(l.amount)}`).join(' · ') }))

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Commissions & targets" />}>
        <View style={{ padding: 20 }}><T tone="mute">Commissions and targets are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Salesperson', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.bills} bills · {fmtQty(r.pieces)} pcs{r.lines ? ` · ${r.lines}` : ''}</T>
      </View>
    ) },
    { key: 'sales', label: 'Sales', width: 130, align: 'right', sortValue: (r) => r.sales, render: (r) => cellNum(inr(r.sales, 0)) },
    { key: 'target', label: 'Target', width: 140, align: 'right', sortValue: (r) => r.achievementPct ?? -1, render: (r) => cellText(r.target > 0 ? `${r.achievementPct}% of ${inr(r.target, 0)}` : '—') },
    { key: 'commission', label: 'Commission', width: 130, align: 'right', sortValue: (r) => r.commission, render: (r) => cellNum(inr(r.commission, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Commissions & targets"
          subtitle={range.label}
          right={
            <>
              {rep.rows.length ? <DeskButton label="Export" icon={<Download size={14} color={c.ink} />} onPress={() => shareFile(csvFileName(`commission ${range.label}`), toCsv(commissionCsvRows(rep)))} /> : null}
              <DeskButton label="Rules" icon={<Sliders size={14} color={c.primary} />} onPress={() => router.push('/m/sales-docs/commissions/setup')} />
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Sales (excl. GST)" value={inr(rep.totalSales, 0)} tone="primary" />
        <KpiTile label="Commission" value={inr(rep.totalCommission, 0)} tone="success" />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented<Period> value={period} onChange={setPeriod} options={[{ id: 'this', label: 'This month' }, { id: 'last', label: 'Last month' }, { id: 'year', label: 'This year' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} emptyLabel="No sales in this period" />
      </View>
    </DeskPage>
  )
}
