import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { computeReport, pctChange, type ReportAgg } from '@/domain/analytics'
import { csvFileName, toCsv, type CsvCell } from '@/domain/csv'
import { RANGE_OPTIONS, rangeBounds, fmtDate, type RangeKey } from '@/domain/dates'
import { inr, inr0, num, round2 } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import { reportRows, SECTION_LABEL, type ReportSection } from '@/domain/reportCsv'
import { useAnalyticsInput, useLabels, useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import {
  gstr1B2bCsv, gstr1Data, gstr1HsnCsv, gstr3bCsv, gstr3bData, type Gstr1Data, type Gstr3bData,
} from '@/modules/tax/logic/gst'
import {
  balanceSheet, cashBook, dayBook, profitAndLoss, trialBalance, type BalanceSheet, type DayBookDay, type Ledger, type ProfitAndLoss, type TrialBalance,
} from '@/modules/accounting/ledger'
import {
  accountLedgerTable, balanceSheetTable, dayBookTable, profitAndLossTable, toCsvRows, trialBalanceTable, type Table,
} from '@/modules/accounting/report-html'
import { useLedger, usePeriod } from '@/modules/accounting/ui/hooks'
import { PERIOD_OPTIONS, type PeriodKey } from '@/modules/accounting/logic'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { Download, Lock } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, ROW_H, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

/**
 * The desktop Reports & GST centre: a command bar (which area), a sub-bar (which report within it, its own date
 * window, its own CSV export) and a dense grid underneath. Three areas, each reading the exact figures the phone
 * app already computes — nothing here is a second calculator:
 *   Sales   → `computeReport` / `reportRows`             (domain/analytics.ts, domain/reportCsv.ts)
 *   GST     → `gstr1Data` / `gstr3bData`                 (modules/tax/logic/gst.ts — export only, see the GST tab's note)
 *   Accounts → `buildLedger` and the statements built on it (modules/accounting/ledger.ts, report-html.ts)
 */

type Area = 'sales' | 'gst' | 'accounts'
type GstView = 'b2b' | 'hsn' | 'gstr3b'
type AccView = 'trial' | 'pl' | 'bs' | 'daybook' | 'cashbook'

// 'All time' is left off here on purpose: the sales chart caps at 90 days (`MAX_CHART_DAYS` in analytics.ts), so an
// 'all' window would show KPI totals that don't match the daily table under them. The fixed windows below never hit that cap.
const REPORT_RANGES = RANGE_OPTIONS.filter((o) => o.value !== 'all').map((o) => ({ id: o.value, label: o.label }))
// 'Custom' needs a date-typing field the kit doesn't have yet (see the report at the end of this file); the fixed periods cover every other case.
const ACC_PERIODS = PERIOD_OPTIONS.filter((o) => o.value !== 'custom').map((o) => ({ id: o.value, label: o.label }))

export function DesktopReports() {
  const { c } = useTheme()
  const store = useApp((s) => s.data.store)
  const allowed = useCan('reports')
  const canProfit = useCan('viewProfit')
  const canAcc = useCan('accounting')
  const labels = useLabels()
  const [area, setArea] = useState<Area>('sales')

  // ───────────────────────────── sales ─────────────────────────────
  const [salesRange, setSalesRange] = useState<RangeKey>('7d')
  const [section, setSection] = useState<ReportSection>('sales')
  const analyticsInput = useAnalyticsInput()
  const users = useList('users')
  const salesBounds = useMemo(() => rangeBounds(salesRange), [salesRange])
  const report = useMemo(() => computeReport(analyticsInput, users, salesBounds[0], salesBounds[1]), [analyticsInput, users, salesBounds])
  const prevReport = useMemo(() => {
    const len = salesBounds[1] - salesBounds[0] + 1
    return computeReport(analyticsInput, users, salesBounds[0] - len, salesBounds[0] - 1)
  }, [analyticsInput, users, salesBounds])
  const sections = (['sales', 'items', 'staff', 'profit'] as ReportSection[]).filter((s) => s !== 'profit' || canProfit)

  // ───────────────────────────── gst ─────────────────────────────
  const [gstRange, setGstRange] = useState<RangeKey>('month')
  const [gstView, setGstView] = useState<GstView>('b2b')
  const data = useApp((s) => s.data)
  const gstBounds = useMemo(() => rangeBounds(gstRange), [gstRange])
  const gstr1 = useMemo(() => gstr1Data(data, gstBounds[0], gstBounds[1]), [data, gstBounds])
  const gstr3b = useMemo(() => gstr3bData(data, gstBounds[0], gstBounds[1]), [data, gstBounds])

  // ───────────────────────────── accounts ─────────────────────────────
  const [accView, setAccView] = useState<AccView>('trial')
  const period = usePeriod('fy')
  const ledger = useLedger({ from: period.from, to: period.to })
  // Balance sheet balances are cumulative since day one — built without `from`, exactly as the mobile screen does.
  const ledgerCumulative = useLedger({ to: period.to })
  const tb = useMemo(() => trialBalance(ledger), [ledger])
  const pl = useMemo(() => profitAndLoss(ledger), [ledger])
  const bs = useMemo(() => balanceSheet(ledgerCumulative), [ledgerCumulative])
  const days = useMemo(() => dayBook(ledger), [ledger])
  const cashLedger = useMemo(() => cashBook(ledger), [ledger])

  if (!allowed) {
    return (
      <DeskPage toolbar={<Toolbar title="Reports & GST" subtitle={store?.name ?? ''} />}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Lock size={28} color={c.inkMute} />
          <T style={[dtext.cell, { color: c.inkMute }]}>Reports are for managers and owners.</T>
        </View>
      </DeskPage>
    )
  }

  const areaOptions: Array<{ id: Area; label: string }> = [
    { id: 'sales', label: 'Sales' },
    { id: 'gst', label: 'GST' },
    ...(canAcc ? [{ id: 'accounts' as const, label: 'Accounts' }] : []),
  ]

  async function exportSales() {
    const title = `${SECTION_LABEL[section]} ${fmtDate(salesBounds[0])}-${fmtDate(salesBounds[1])}`
    const rows = [[title], ...reportRows(section, report, { profit: canProfit, itemLabel: labels.item, staffLabel: labels.staff })]
    await shareFile(csvFileName(title), toCsv(rows))
  }
  async function exportGst() {
    const span = `${fmtDate(gstBounds[0])}-${fmtDate(gstBounds[1])}`
    if (gstView === 'b2b') await shareFile(csvFileName(`GSTR-1 B2B register ${span}`), gstr1B2bCsv(gstr1))
    else if (gstView === 'hsn') await shareFile(csvFileName(`GSTR-1 HSN summary ${span}`), gstr1HsnCsv(gstr1))
    else await shareFile(csvFileName(`GSTR-3B summary ${span}`), gstr3bCsv(gstr3b))
  }
  async function exportAcc() {
    if (accView === 'trial') await shareFile(csvFileName(`Trial balance ${fmtDate(period.from)}-${fmtDate(period.to)}`), toCsv(toCsvRows(trialBalanceTable(tb, period.from, period.to))))
    else if (accView === 'pl') await shareFile(csvFileName(`Profit and loss ${fmtDate(period.from)}-${fmtDate(period.to)}`), toCsv(toCsvRows(profitAndLossTable(pl, period.from, period.to))))
    else if (accView === 'bs') await shareFile(csvFileName(`Balance sheet ${fmtDate(period.to)}`), toCsv(toCsvRows(balanceSheetTable(bs, period.to))))
    else if (accView === 'daybook') await shareFile(csvFileName(`Day book ${fmtDate(period.from)}-${fmtDate(period.to)}`), toCsv(toCsvRows(dayBookTable(days, ledger, period.from, period.to))))
    else if (cashLedger) await shareFile(csvFileName(`Cash book ${fmtDate(period.from)}-${fmtDate(period.to)}`), toCsv(toCsvRows(accountLedgerTable(cashLedger, period.from, period.to))))
  }

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Reports & GST centre" subtitle={store?.name ?? ''} left={<DeskSegmented value={area} onChange={setArea} options={areaOptions} />} />
      }
    >
      {area === 'sales' ? (
        <SalesArea
          report={report} prev={prevReport} section={section} onSection={setSection} sections={sections}
          range={salesRange} onRange={setSalesRange} canProfit={canProfit} itemsLabel={labels.items} staffLabel={labels.staff} onExport={exportSales}
        />
      ) : null}
      {area === 'gst' ? <GstArea gstr1={gstr1} gstr3b={gstr3b} view={gstView} onView={setGstView} range={gstRange} onRange={setGstRange} onExport={exportGst} /> : null}
      {area === 'accounts' && canAcc ? (
        <AccountsArea
          view={accView} onView={setAccView} periodKey={period.key} onPeriod={period.setKey} onExport={exportAcc}
          tb={tb} pl={pl} bs={bs} days={days} ledger={ledger} cashLedger={cashLedger} from={period.from} to={period.to}
        />
      ) : null}
    </DeskPage>
  )
}

// ───────────────────────────── shared chrome ─────────────────────────────

/** The row under the Toolbar: which report within the area (left), its date window and export button (right). */
function SubBar({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, height: 42, borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.surfaceAlt }}>
      {left}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  const { c } = useTheme()
  return (
    <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 32, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <T style={dtext.label}>{title}</T>
      </View>
      {children}
    </View>
  )
}

/** A totals row pinned above a `DataTable`'s scrolling body — built from the same `columns` so cells line up exactly. */
function TotalsRow<T>({ columns, cells }: { columns: Array<Pick<Column<T>, 'key' | 'width' | 'align'>>; cells: React.ReactNode[] }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', height: ROW_H, alignItems: 'center', backgroundColor: c.sunken, borderBottomWidth: 1, borderColor: c.lineStrong }}>
      {columns.map((col, i) => (
        <View key={col.key} style={[{ paddingHorizontal: 10, justifyContent: 'center' }, col.width === 'flex' || col.width === undefined ? { flex: 1 } : { width: col.width }, col.align === 'right' ? { alignItems: 'flex-end' } : col.align === 'center' ? { alignItems: 'center' } : null]}>
          {cells[i]}
        </View>
      ))}
    </View>
  )
}

/** Adapts a statement's plain `Table` (report-html.ts — the same shape the phone's printed PDF and CSV use) into a
 * dense grid. No sorting: a trial balance or a P&L has a meaningful order (subtotals in place), so re-sorting it
 * would make it read wrong. */
function StatementTable({ table, emptyLabel }: { table: Table; emptyLabel: string }) {
  type Row = { id: string; cells: CsvCell[]; bold: boolean }
  const bold = new Set(table.bold ?? [])
  const rows: Row[] = table.rows.map((cells, i) => ({ id: String(i), cells, bold: bold.has(i) }))
  const columns: Array<Column<Row>> = table.columns.map((col, ci) => ({
    key: String(ci),
    label: col.label,
    align: col.align,
    width: ci === 0 ? 'flex' : 150,
    render: (r) => {
      const v = r.cells[ci]
      return typeof v === 'number' ? cellNum(inr(v, 2), r.bold) : cellText(v === null || v === undefined ? '' : String(v), r.bold)
    },
  }))
  return <DataTable rows={rows} columns={columns} rowTone={(r) => (r.bold ? 'accent' : undefined)} emptyLabel={emptyLabel} />
}

// ───────────────────────────── Sales ─────────────────────────────

function SalesArea({ report, prev, section, onSection, sections, range, onRange, canProfit, itemsLabel, staffLabel, onExport }: {
  report: ReportAgg; prev: ReportAgg; section: ReportSection; onSection: (s: ReportSection) => void; sections: ReportSection[]
  range: RangeKey; onRange: (r: RangeKey) => void; canProfit: boolean; itemsLabel: string; staffLabel: string; onExport: () => void
}) {
  const { c } = useTheme()
  const avg = report.positive ? report.positiveTotal / report.positive : 0
  const prevAvg = prev.positive ? prev.positiveTotal / prev.positive : 0
  const delta = (cur: number, p: number) => { const pc = pctChange(cur, p); return pc === null ? undefined : `${pc >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(pc * 10) / 10)}%` }

  return (
    <View style={{ flex: 1 }}>
      <SubBar
        left={<DeskSegmented value={section} onChange={onSection} options={sections.map((s) => ({ id: s, label: SECTION_LABEL[s] }))} />}
        right={<>
          <DeskSegmented value={range} onChange={onRange} options={REPORT_RANGES} />
          <DeskButton label="Export CSV" icon={<Download size={14} color={c.ink} />} onPress={onExport} />
        </>}
      />
      <KpiStrip>
        <KpiTile label="Sales" value={inr0(report.revenue)} delta={delta(report.revenue, prev.revenue)} tone="primary" />
        <KpiTile label="Bills" value={num(report.positive)} delta={report.credits ? `${report.credits} returns` : 'No returns'} />
        <KpiTile label="Average bill" value={inr0(avg)} delta={delta(avg, prevAvg)} tone="accent" />
        <KpiTile label="GST collected" value={inr0(report.gst)} delta={`${inr0(report.net)} before GST`} tone="success" />
      </KpiStrip>
      {section === 'sales' ? <SalesDaily r={report} /> : null}
      {section === 'items' ? <ItemsTable r={report} canProfit={canProfit} itemsLabel={itemsLabel} /> : null}
      {section === 'staff' ? <StaffTable r={report} staffLabel={staffLabel} /> : null}
      {section === 'profit' && canProfit ? <ProfitTables r={report} /> : null}
    </View>
  )
}

function SalesDaily({ r }: { r: ReportAgg }) {
  type Row = { id: string; start: number; total: number; bills: number; qty: number }
  const rows: Row[] = r.daily.map((d) => ({ id: String(d.start), ...d }))
  const cols: Array<Column<Row>> = [
    { key: 'date', label: 'Date', render: (x) => cellText(fmtDate(x.start)) },
    { key: 'bills', label: 'Bills', width: 90, align: 'right', sortValue: (x) => x.bills, render: (x) => cellNum(num(x.bills)) },
    { key: 'qty', label: 'Pieces', width: 100, align: 'right', sortValue: (x) => x.qty, render: (x) => cellNum(fmtQty(x.qty)) },
    { key: 'total', label: 'Sales', width: 130, align: 'right', sortValue: (x) => x.total, render: (x) => cellNum(inr0(x.total), true) },
  ]
  const totals = { bills: r.daily.reduce((s, d) => s + d.bills, 0), qty: round2(r.daily.reduce((s, d) => s + d.qty, 0)), total: round2(r.daily.reduce((s, d) => s + d.total, 0)) }
  type ModeRow = { id: string; mode: string; amount: number }
  const modeRows: ModeRow[] = r.modes.map(([mode, amount]) => ({ id: mode, mode, amount }))
  const modeCols: Array<Column<ModeRow>> = [
    { key: 'mode', label: 'Mode', render: (x) => cellText(x.mode) },
    { key: 'amount', label: 'Amount', width: 120, align: 'right', sortValue: (x) => x.amount, render: (x) => cellNum(inr0(x.amount), true) },
  ]
  const modeTotal = round2(r.modes.reduce((s, [, v]) => s + v, 0))

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <Panel title={`Daily sales · ${r.daily.length} ${r.daily.length === 1 ? 'day' : 'days'}`}>
        <DataTable rows={rows} columns={cols} emptyLabel="No sales in this period"
          footer={<TotalsRow columns={cols} cells={[cellText('Total', true), cellNum(num(totals.bills), true), cellNum(fmtQty(totals.qty), true), cellNum(inr0(totals.total), true)]} />} />
      </Panel>
      <View style={{ width: 340 }}>
        <Panel title="How customers paid">
          <DataTable rows={modeRows} columns={modeCols} compact emptyLabel="No payments in this period"
            footer={modeRows.length ? <TotalsRow columns={modeCols} cells={[cellText('Total', true), cellNum(inr0(modeTotal), true)]} /> : undefined} />
        </Panel>
      </View>
    </View>
  )
}

function ItemsTable({ r, canProfit, itemsLabel }: { r: ReportAgg; canProfit: boolean; itemsLabel: string }) {
  const rows = useMemo(() => r.items.filter((i) => i.qty !== 0 || i.revenue !== 0), [r.items])
  const margin = (rev: number, cost: number) => (rev > 0 ? round2(((rev - cost) / rev) * 100) : 0)
  const cols: Array<Column<ReportAgg['items'][number]>> = [
    { key: 'name', label: itemsLabel.replace(/s$/, '') || 'Item', render: (x) => cellText(x.name) },
    { key: 'sku', label: 'Code', width: 110, render: (x) => cellText(x.sku || '—') },
    { key: 'variant', label: 'Option', width: 110, render: (x) => cellText(x.variant || '—') },
    { key: 'qty', label: 'Qty', width: 90, align: 'right', sortValue: (x) => x.qty, render: (x) => cellNum(fmtQty(x.qty)) },
    { key: 'revenue', label: 'Sales', width: 120, align: 'right', sortValue: (x) => x.revenue, render: (x) => cellNum(inr0(x.revenue), true) },
    ...(canProfit ? [
      { key: 'cost', label: 'Cost', width: 110, align: 'right' as const, sortValue: (x: ReportAgg['items'][number]) => x.cost, render: (x: ReportAgg['items'][number]) => cellNum(inr0(x.cost)) },
      { key: 'profit', label: 'Profit', width: 110, align: 'right' as const, sortValue: (x: ReportAgg['items'][number]) => x.revenue - x.cost, render: (x: ReportAgg['items'][number]) => cellNum(inr0(x.revenue - x.cost), true) },
      { key: 'margin', label: 'Margin %', width: 90, align: 'right' as const, sortValue: (x: ReportAgg['items'][number]) => margin(x.revenue, x.cost), render: (x: ReportAgg['items'][number]) => cellNum(`${margin(x.revenue, x.cost).toFixed(1)}%`) },
    ] : []),
  ]
  const totQty = round2(rows.reduce((s, i) => s + i.qty, 0)), totRev = round2(rows.reduce((s, i) => s + i.revenue, 0)), totCost = round2(rows.reduce((s, i) => s + i.cost, 0))
  const footerCells = [cellText('Total', true), cellText(''), cellText(''), cellNum(fmtQty(totQty), true), cellNum(inr0(totRev), true), ...(canProfit ? [cellNum(inr0(totCost), true), cellNum(inr0(totRev - totCost), true), cellText(totRev > 0 ? `${round2(((totRev - totCost) / totRev) * 100).toFixed(1)}%` : '—')] : [])]
  return (
    <View style={{ flex: 1 }}>
      <Panel title={`${itemsLabel} sold · ${rows.length}`}>
        <DataTable rows={rows} columns={cols} emptyLabel={`No ${itemsLabel.toLowerCase()} sold in this period`} footer={<TotalsRow columns={cols} cells={footerCells} />} />
      </Panel>
    </View>
  )
}

function StaffTable({ r, staffLabel }: { r: ReportAgg; staffLabel: string }) {
  type Row = ReportAgg['staff'][number] & { id: string; name: string }
  const rows: Row[] = r.staff.map((s) => ({ ...s, id: s.userId, name: s.user?.name ?? 'Former staff' }))
  const cols: Array<Column<Row>> = [
    { key: 'name', label: staffLabel, render: (x) => cellText(x.name) },
    { key: 'bills', label: 'Bills', width: 90, align: 'right', sortValue: (x) => x.bills, render: (x) => cellNum(num(x.bills)) },
    { key: 'qty', label: 'Qty', width: 90, align: 'right', sortValue: (x) => x.qty, render: (x) => cellNum(fmtQty(x.qty)) },
    { key: 'revenue', label: 'Sales', width: 120, align: 'right', sortValue: (x) => x.revenue, render: (x) => cellNum(inr0(x.revenue), true) },
    { key: 'discount', label: 'Discount', width: 110, align: 'right', sortValue: (x) => x.discount, render: (x) => cellNum(inr0(x.discount)) },
  ]
  const totals = { bills: rows.reduce((s, x) => s + x.bills, 0), qty: round2(rows.reduce((s, x) => s + x.qty, 0)), revenue: round2(rows.reduce((s, x) => s + x.revenue, 0)), discount: round2(rows.reduce((s, x) => s + x.discount, 0)) }
  return (
    <View style={{ flex: 1 }}>
      <Panel title={`${staffLabel} breakdown`}>
        <DataTable rows={rows} columns={cols} emptyLabel={`No ${staffLabel.toLowerCase()} sales in this period`}
          footer={<TotalsRow columns={cols} cells={[cellText('Total', true), cellNum(num(totals.bills), true), cellNum(fmtQty(totals.qty), true), cellNum(inr0(totals.revenue), true), cellNum(inr0(totals.discount), true)]} />} />
      </Panel>
    </View>
  )
}

function ProfitTables({ r }: { r: ReportAgg }) {
  const { c } = useTheme()
  type LineRow = { id: string; label: string; amount: number }
  const lines: LineRow[] = [
    { id: '1', label: 'Sales before GST', amount: r.net },
    { id: '2', label: 'Cost of goods sold', amount: -r.cogs },
    { id: '3', label: 'Gross profit', amount: r.grossProfit },
    { id: '4', label: 'Expenses', amount: -r.expenses },
    { id: '5', label: 'Net profit', amount: r.netProfit },
  ]
  const lineCols: Array<Column<LineRow>> = [
    { key: 'label', label: 'Line', render: (x) => cellText(x.label, x.label === 'Gross profit' || x.label === 'Net profit') },
    { key: 'amount', label: 'Amount', width: 130, align: 'right', render: (x) => cellNum(inr0(x.amount), x.label === 'Gross profit' || x.label === 'Net profit') },
  ]
  type CatRow = { id: string; category: string; amount: number }
  const catRows: CatRow[] = r.expenseByCategory.map(([category, amount]) => ({ id: category, category, amount }))
  const catCols: Array<Column<CatRow>> = [
    { key: 'category', label: 'Expense category', render: (x) => cellText(x.category) },
    { key: 'amount', label: 'Amount', width: 130, align: 'right', sortValue: (x) => x.amount, render: (x) => cellNum(inr0(x.amount), true) },
  ]
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <Panel title="Expenses by category">
        <DataTable rows={catRows} columns={catCols} emptyLabel="No expenses in this period"
          footer={catRows.length ? <TotalsRow columns={catCols} cells={[cellText('Total', true), cellNum(inr0(r.expenses), true)]} /> : undefined} />
      </Panel>
      <View style={{ width: 340 }}>
        <Panel title="Where the money went">
          <DataTable rows={lines} columns={lineCols} emptyLabel="Nothing to show" />
        </Panel>
        {r.gstPaid > 0 ? (
          <View style={{ marginHorizontal: 14, marginTop: -8, marginBottom: 10 }}>
            <T style={[dtext.tiny, { color: c.inkMute }]}>{inr0(r.gstPaid)} paid to the government is left out — it settles tax already collected, not a cost.</T>
          </View>
        ) : null}
      </View>
    </View>
  )
}

// ───────────────────────────── GST ─────────────────────────────

function GstArea({ gstr1, gstr3b, view, onView, range, onRange, onExport }: {
  gstr1: Gstr1Data; gstr3b: Gstr3bData; view: GstView; onView: (v: GstView) => void; range: RangeKey; onRange: (r: RangeKey) => void; onExport: () => void
}) {
  const { c } = useTheme()
  const b2bGst = round2(gstr1.b2bTotals.cgst + gstr1.b2bTotals.sgst + gstr1.b2bTotals.igst)
  const netPayable = round2(gstr3b.netPayable.cgst + gstr3b.netPayable.sgst + gstr3b.netPayable.igst)
  const viewOptions: Array<{ id: GstView; label: string }> = [{ id: 'b2b', label: 'GSTR-1 · B2B' }, { id: 'hsn', label: 'HSN summary' }, { id: 'gstr3b', label: 'GSTR-3B' }]

  return (
    <View style={{ flex: 1 }}>
      <SubBar
        left={<DeskSegmented value={view} onChange={onView} options={viewOptions} />}
        right={<>
          <DeskSegmented value={range} onChange={onRange} options={REPORT_RANGES} />
          <DeskButton label="Export CSV" icon={<Download size={14} color={c.ink} />} onPress={onExport} />
        </>}
      />
      <KpiStrip>
        <KpiTile label="B2B taxable value" value={inr0(gstr1.b2bTotals.taxable)} delta={`${gstr1.b2b.length} invoices`} tone="primary" />
        <KpiTile label="B2B tax (CGST+SGST+IGST)" value={inr0(b2bGst)} />
        <KpiTile label="B2C taxable value" value={inr0(gstr1.b2c.taxable)} delta={`${gstr1.billOfSupplyCount} bills of supply`} tone="accent" />
        <KpiTile label="Net GST payable (3B)" value={inr0(netPayable)} tone={netPayable > 0 ? 'warning' : 'success'} delta={gstr3b.itc.source === 'none' ? 'ITC not recorded' : 'after eligible ITC'} />
      </KpiStrip>
      {view === 'b2b' ? <B2bTable gstr1={gstr1} /> : null}
      {view === 'hsn' ? <HsnTable gstr1={gstr1} /> : null}
      {view === 'gstr3b' ? <Gstr3bView gstr3b={gstr3b} /> : null}
      <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
        <T style={[dtext.tiny, { color: c.inkMute }]}>Export only — nothing here is filed or sent to the GST portal. Check buyer GSTINs and HSN codes against your invoices before using this in a return.</T>
      </View>
    </View>
  )
}

function B2bTable({ gstr1 }: { gstr1: Gstr1Data }) {
  type Row = Gstr1Data['b2b'][number] & { id: string }
  const rows: Row[] = gstr1.b2b.map((r) => ({ ...r, id: r.billId }))
  const cols: Array<Column<Row>> = [
    { key: 'no', label: 'Invoice no', width: 110, render: (x) => cellText(x.no, true) },
    { key: 'date', label: 'Date', width: 100, sortValue: (x) => x.date, render: (x) => cellText(fmtDate(x.date)) },
    { key: 'kind', label: 'Type', width: 100, render: (x) => cellText(x.kind) },
    { key: 'gstin', label: 'Buyer GSTIN', width: 130, render: (x) => cellText(x.buyerGstin) },
    { key: 'buyer', label: 'Buyer', render: (x) => cellText(x.buyerName || '—') },
    { key: 'pos', label: 'Place', width: 70, render: (x) => cellText(x.placeOfSupply || '—') },
    { key: 'taxable', label: 'Taxable', width: 110, align: 'right', sortValue: (x) => x.taxable, render: (x) => cellNum(inr0(x.taxable)) },
    { key: 'cgst', label: 'CGST', width: 90, align: 'right', sortValue: (x) => x.cgst, render: (x) => cellNum(inr0(x.cgst)) },
    { key: 'sgst', label: 'SGST', width: 90, align: 'right', sortValue: (x) => x.sgst, render: (x) => cellNum(inr0(x.sgst)) },
    { key: 'igst', label: 'IGST', width: 90, align: 'right', sortValue: (x) => x.igst, render: (x) => cellNum(inr0(x.igst)) },
    { key: 'total', label: 'Total', width: 110, align: 'right', sortValue: (x) => x.total, render: (x) => cellNum(inr0(x.total), true) },
    { key: 'rc', label: 'RC', width: 50, align: 'center', render: (x) => cellText(x.reverseCharge ? 'Y' : '—') },
  ]
  const totalInvoice = round2(rows.reduce((s, x) => s + x.total, 0))
  return (
    <View style={{ flex: 1 }}>
      <Panel title={`B2B register (GSTR-1) · ${rows.length}`}>
        <DataTable rows={rows} columns={cols} emptyLabel="No GST-registered-buyer invoices in this period"
          footer={rows.length ? <TotalsRow columns={cols} cells={[cellText('Total', true), cellText(''), cellText(''), cellText(''), cellText(''), cellText(''), cellNum(inr0(gstr1.b2bTotals.taxable), true), cellNum(inr0(gstr1.b2bTotals.cgst), true), cellNum(inr0(gstr1.b2bTotals.sgst), true), cellNum(inr0(gstr1.b2bTotals.igst), true), cellNum(inr0(totalInvoice), true), cellText('')]} /> : undefined} />
      </Panel>
    </View>
  )
}

function HsnTable({ gstr1 }: { gstr1: Gstr1Data }) {
  type Row = Gstr1Data['hsn'][number] & { id: string }
  const rows: Row[] = gstr1.hsn.map((h) => ({ ...h, id: `${h.hsn}|${h.rate}` }))
  const cols: Array<Column<Row>> = [
    { key: 'hsn', label: 'HSN', width: 120, render: (x) => cellText(x.hsn, true) },
    { key: 'rate', label: 'Rate %', width: 80, align: 'right', sortValue: (x) => x.rate, render: (x) => cellNum(num(x.rate, 1)) },
    { key: 'qty', label: 'Qty', width: 90, align: 'right', sortValue: (x) => x.qty, render: (x) => cellNum(fmtQty(x.qty)) },
    { key: 'taxable', label: 'Taxable', width: 120, align: 'right', sortValue: (x) => x.taxable, render: (x) => cellNum(inr0(x.taxable), true) },
    { key: 'cgst', label: 'CGST', width: 100, align: 'right', sortValue: (x) => x.cgst, render: (x) => cellNum(inr0(x.cgst)) },
    { key: 'sgst', label: 'SGST', width: 100, align: 'right', sortValue: (x) => x.sgst, render: (x) => cellNum(inr0(x.sgst)) },
    { key: 'igst', label: 'IGST', width: 100, align: 'right', sortValue: (x) => x.igst, render: (x) => cellNum(inr0(x.igst)) },
  ]
  const sum = (f: (r: Row) => number) => round2(rows.reduce((s, r) => s + f(r), 0))
  return (
    <View style={{ flex: 1 }}>
      <Panel title={`HSN summary · ${rows.length}`}>
        <DataTable rows={rows} columns={cols} emptyLabel="No sales in this period"
          footer={rows.length ? <TotalsRow columns={cols} cells={[cellText('Total', true), cellText(''), cellNum(fmtQty(sum((r) => r.qty)), true), cellNum(inr0(sum((r) => r.taxable)), true), cellNum(inr0(sum((r) => r.cgst)), true), cellNum(inr0(sum((r) => r.sgst)), true), cellNum(inr0(sum((r) => r.igst)), true)]} /> : undefined} />
      </Panel>
    </View>
  )
}

function Gstr3bView({ gstr3b }: { gstr3b: Gstr3bData }) {
  const { c } = useTheme()
  type Row = { id: string; label: string; taxable?: number; cgst: number; sgst: number; igst: number; strong?: boolean }
  const rows: Row[] = [
    { id: 'out', label: '3.1 Outward taxable supplies', taxable: gstr3b.outward.taxable, cgst: gstr3b.outward.cgst, sgst: gstr3b.outward.sgst, igst: gstr3b.outward.igst, strong: true },
    { id: 'elig', label: '4. Eligible ITC', cgst: gstr3b.itc.eligible.cgst, sgst: gstr3b.itc.eligible.sgst, igst: gstr3b.itc.eligible.igst },
    { id: 'blocked', label: 'Blocked / ineligible ITC', cgst: gstr3b.itc.blocked.cgst, sgst: gstr3b.itc.blocked.sgst, igst: gstr3b.itc.blocked.igst },
    { id: 'net', label: 'Net payable (outward − eligible ITC)', cgst: gstr3b.netPayable.cgst, sgst: gstr3b.netPayable.sgst, igst: gstr3b.netPayable.igst, strong: true },
  ]
  const cols: Array<Column<Row>> = [
    { key: 'label', label: 'Section', render: (x) => cellText(x.label, x.strong) },
    { key: 'taxable', label: 'Taxable value', width: 130, align: 'right', render: (x) => (x.taxable === undefined ? cellText('—') : cellNum(inr0(x.taxable), x.strong)) },
    { key: 'cgst', label: 'CGST', width: 110, align: 'right', render: (x) => cellNum(inr0(x.cgst), x.strong) },
    { key: 'sgst', label: 'SGST', width: 110, align: 'right', render: (x) => cellNum(inr0(x.sgst), x.strong) },
    { key: 'igst', label: 'IGST', width: 110, align: 'right', render: (x) => cellNum(inr0(x.igst), x.strong) },
  ]
  return (
    <View style={{ flex: 1 }}>
      <Panel title="GSTR-3B summary">
        <DataTable rows={rows} columns={cols} rowTone={(x) => (x.strong ? 'accent' : undefined)} emptyLabel="Nothing to show" />
      </Panel>
      {gstr3b.itc.source === 'none' ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 6 }}>
          <T style={[dtext.tiny, { color: c.warning }]}>No purchase-invoice register found — section 4 (ITC) is blank. Record purchase invoices in Purchasing to fill it.</T>
        </View>
      ) : null}
      <View style={{ paddingHorizontal: 14 }}>
        <T style={[dtext.tiny, { color: c.inkMute }]}>Reverse-charge inward supplies and nil-rated / exempt sales are not tracked here — add them by hand if they apply.</T>
      </View>
    </View>
  )
}

// ───────────────────────────── Accounts ─────────────────────────────

function AccountsArea({ view, onView, periodKey, onPeriod, onExport, tb, pl, bs, days, ledger, cashLedger, from, to }: {
  view: AccView; onView: (v: AccView) => void; periodKey: PeriodKey; onPeriod: (k: PeriodKey) => void; onExport: () => void
  tb: TrialBalance; pl: ProfitAndLoss; bs: BalanceSheet; days: DayBookDay[]; ledger: Ledger; cashLedger: ReturnType<typeof cashBook>; from: number; to: number
}) {
  const { c } = useTheme()
  const viewOptions: Array<{ id: AccView; label: string }> = [
    { id: 'trial', label: 'Trial balance' }, { id: 'pl', label: 'Profit & loss' }, { id: 'bs', label: 'Balance sheet' }, { id: 'daybook', label: 'Day book' }, { id: 'cashbook', label: 'Cash book' },
  ]
  return (
    <View style={{ flex: 1 }}>
      <SubBar
        left={<DeskSegmented value={view} onChange={onView} options={viewOptions} />}
        right={<>
          <DeskSegmented value={periodKey} onChange={onPeriod} options={ACC_PERIODS} />
          <DeskButton label="Export CSV" icon={<Download size={14} color={c.ink} />} onPress={onExport} />
        </>}
      />
      {view === 'trial' ? (
        <>
          <KpiStrip>
            <KpiTile label="Total debit" value={inr0(tb.totalDebit)} />
            <KpiTile label="Total credit" value={inr0(tb.totalCredit)} />
            <KpiTile label={tb.balanced ? 'Balanced' : 'Out of balance'} value={tb.balanced ? '✓' : '✗'} tone={tb.balanced ? 'success' : 'danger'} />
          </KpiStrip>
          <TrialBalanceTable tb={tb} />
        </>
      ) : null}
      {view === 'pl' ? (
        <>
          <KpiStrip>
            <KpiTile label="Total income" value={inr0(pl.totalIncome)} tone="primary" />
            <KpiTile label="Gross profit" value={inr0(pl.grossProfit)} tone={pl.grossProfit >= 0 ? 'success' : 'danger'} />
            <KpiTile label="Net profit" value={inr0(pl.netProfit)} tone={pl.netProfit >= 0 ? 'success' : 'danger'} />
          </KpiStrip>
          <View style={{ flex: 1 }}><Panel title="Profit & loss"><StatementTable table={profitAndLossTable(pl, from, to)} emptyLabel="No sales or expenses were booked in this period" /></Panel></View>
        </>
      ) : null}
      {view === 'bs' ? (
        <>
          <KpiStrip>
            <KpiTile label="Total assets" value={inr0(bs.totalAssets)} tone="primary" />
            <KpiTile label="Total liabilities" value={inr0(bs.totalLiabilities)} tone="warning" />
            <KpiTile label="Total equity" value={inr0(bs.totalEquity)} tone="success" />
          </KpiStrip>
          <View style={{ flex: 1 }}><Panel title="Balance sheet"><StatementTable table={balanceSheetTable(bs, to)} emptyLabel="Nothing has been booked yet" /></Panel></View>
        </>
      ) : null}
      {view === 'daybook' ? (
        <View style={{ flex: 1 }}><Panel title="Day book"><StatementTable table={dayBookTable(days, ledger, from, to)} emptyLabel="No entries in this period" /></Panel></View>
      ) : null}
      {view === 'cashbook' ? (
        cashLedger ? (
          <View style={{ flex: 1 }}><Panel title="Cash book"><StatementTable table={accountLedgerTable(cashLedger, from, to)} emptyLabel="No cash moved in this period" /></Panel></View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><T style={[dtext.cell, { color: c.inkMute }]}>No cash account in the chart of accounts.</T></View>
        )
      ) : null}
    </View>
  )
}

function TrialBalanceTable({ tb }: { tb: TrialBalance }) {
  type Row = { id: string; code: string; name: string; debit: number; credit: number }
  const rows: Row[] = tb.rows.map((r) => ({ id: r.account.id, code: r.account.code, name: r.account.name, debit: r.closing > 0 ? r.closing : 0, credit: r.closing < 0 ? -r.closing : 0 }))
  const cols: Array<Column<Row>> = [
    { key: 'code', label: 'Code', width: 90, sortValue: (x) => x.code, render: (x) => cellText(x.code) },
    { key: 'name', label: 'Account', sortValue: (x) => x.name, render: (x) => cellText(x.name) },
    { key: 'debit', label: 'Debit', width: 140, align: 'right', sortValue: (x) => x.debit, render: (x) => cellNum(x.debit ? inr(x.debit, 2) : '—') },
    { key: 'credit', label: 'Credit', width: 140, align: 'right', sortValue: (x) => x.credit, render: (x) => cellNum(x.credit ? inr(x.credit, 2) : '—') },
  ]
  return (
    <View style={{ flex: 1 }}>
      <Panel title="Trial balance">
        <DataTable rows={rows} columns={cols} emptyLabel="Nothing has been booked yet"
          footer={<TotalsRow columns={cols} cells={[cellText('Total', true), cellText(''), cellNum(inr(tb.totalDebit, 2), true), cellNum(inr(tb.totalCredit, 2), true)]} />} />
      </Panel>
    </View>
  )
}
