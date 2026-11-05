import React, { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { toCsv, csvFileName, type CsvCell } from '@/domain/csv'
import { useStore } from '@/data/hooks'
import { printHtml, sharePdf } from '@/features/share'
import { shareFile } from '@/features/shareFile'
import { tableHtml, toCsvRows, type Table } from '@/modules/accounting/report-html'
import { PeriodBar } from '@/modules/accounting/ui/PeriodBar'
import type { PeriodState } from '@/modules/accounting/ui/hooks'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, FileText, Printer } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

export type DesktopReportShellProps = import('@/modules/accounting/ui/ReportShell').ReportShellProps

/**
 * The desktop frame for every statement under `src/app/m/accounting/`: a `Table` (`report-html.ts` — the exact same
 * rows the phone's CSV/PDF/print already use) laid out either as an aligned statement (narrow tables with grouped
 * subtotals: profit & loss, balance sheet, trial balance) or a dense ledger grid (wide, transaction-per-row tables:
 * cash book, day book, account and party ledgers). Nothing here recomputes a figure — every number is read straight
 * out of the `table` the page already built; this file only re-lays the same rows out for a keyboard-and-mouse screen.
 */
export function DesktopReportShell({ title, subtitle, period, table, links, children, emptyHint = 'Nothing was booked in this period.', footerNote }: DesktopReportShellProps) {
  const { c } = useTheme()
  const router = useRouter()
  const store = useStore()
  const wide = table.columns.length > 4
  const name = store?.name ?? 'OneSyncERP'

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={title}
          subtitle={subtitle ?? table.subtitle}
          right={table.rows.length ? (
            <>
              <DeskButton label="CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName(table.title), toCsv(toCsvRows(table)))} />
              <DeskButton label="Print" icon={<Printer size={14} color={c.ink} />} onPress={() => void printHtml(tableHtml(name, table))} />
              <DeskButton label="PDF" icon={<FileText size={14} color={c.ink} />} onPress={() => void sharePdf(tableHtml(name, table), csvFileName(table.title, 'pdf'))} />
            </>
          ) : undefined}
        />
      }
    >
      {period ? <View style={{ paddingHorizontal: 20, paddingTop: 14 }}><PeriodBar p={period} /></View> : null}
      {!wide && children ? <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>{children}</View> : null}

      {table.rows.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState icon={<FileText size={26} color={c.primary} />} title="Nothing to show" hint={emptyHint} compact />
        </View>
      ) : wide ? (
        <>
          <LedgerKpis table={table} />
          <LedgerGrid table={table} links={links} onOpen={(to) => router.push(to as never)} />
        </>
      ) : (
        <StatementBody table={table} links={links} onOpen={(to) => router.push(to as never)} />
      )}

      {footerNote ? <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}>{footerNote}</View> : null}
    </DeskPage>
  )
}

// ───────────────────────────── wide tables: a dense ledger grid ─────────────────────────────

interface GridRow { id: string; cells: CsvCell[]; strong: boolean; link?: string }

function toGridRows(table: Table, links?: Array<string | undefined>): GridRow[] {
  const bold = new Set(table.bold ?? [])
  return table.rows.map((cells, i) => ({ id: String(i), cells, strong: bold.has(i), link: links?.[i] }))
}

function LedgerGrid({ table, links, onOpen }: { table: Table; links?: Array<string | undefined>; onOpen: (to: string) => void }) {
  const { c } = useTheme()
  const rows = toGridRows(table, links)
  const hasLinks = rows.some((r) => r.link)
  const columns: Array<Column<GridRow>> = table.columns.map((col, k) => ({
    key: String(k),
    label: col.label,
    align: col.align,
    width: col.align === 'right' ? 120 : k === 0 ? 90 : k === 1 ? 'flex' : 200,
    render: (r) => {
      const v = r.cells[k]
      const display = typeof v === 'number' ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v === null || v === undefined ? '' : String(v)
      return col.align === 'right' ? cellNum(display, r.strong) : cellText(display, r.strong)
    },
  }))
  return (
    <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
      <DataTable rows={rows} columns={columns} rowTone={(r) => (r.strong ? 'accent' : undefined)}
        onRowPress={hasLinks ? (r) => (r.link ? onOpen(r.link) : undefined) : undefined} emptyLabel="Nothing here yet" />
    </View>
  )
}

function LedgerKpis({ table }: { table: Table }) {
  const bold = table.bold ?? []
  const lastCol = table.columns.length - 1
  const firstRow = bold.length ? table.rows[bold[0]] : undefined
  const isBalanceStyle = !!firstRow && String(firstRow[1]).toLowerCase() === 'opening balance'

  if (isBalanceStyle && bold.length >= 2) {
    const opening = Number(table.rows[bold[0]][lastCol]) || 0
    const closing = Number(table.rows[bold[bold.length - 1]][lastCol]) || 0
    const moved = Math.round((closing - opening) * 100) / 100
    return (
      <KpiStrip>
        <KpiTile label="Opening balance" value={opening.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
        <KpiTile label="Closing balance" value={closing.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tone="primary" />
        <KpiTile label="Net movement" value={`${moved >= 0 ? '+' : ''}${moved.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} tone={moved >= 0 ? 'success' : 'warning'} />
      </KpiStrip>
    )
  }

  const debitIdx = table.columns.findIndex((c) => /^debit$/i.test(c.label))
  const creditIdx = table.columns.findIndex((c) => /^credit$/i.test(c.label))
  const sum = (idx: number) => (idx < 0 ? 0 : Math.round(table.rows.reduce((s, r) => s + (Number(r[idx]) || 0), 0) * 100) / 100)
  const debit = sum(debitIdx), credit = sum(creditIdx)
  return (
    <KpiStrip>
      <KpiTile label="Entries" value={String(table.rows.length)} />
      <KpiTile label="Total debit" value={debit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tone="primary" />
      <KpiTile label="Total credit" value={credit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tone="accent" />
    </KpiStrip>
  )
}

// ───────────────────────────── narrow tables: an aligned statement ─────────────────────────────

function StatementBody({ table, links, onOpen }: { table: Table; links?: Array<string | undefined>; onOpen: (to: string) => void }) {
  const { c } = useTheme()
  const bold = new Set(table.bold ?? [])
  const twoCol = table.columns.length === 2
  const widthFor = (k: number, align?: 'left' | 'right' | 'center') => (align === 'right' ? 140 : k === 0 && !twoCol ? 64 : undefined)

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', paddingVertical: 28, paddingHorizontal: 40 }} showsVerticalScrollIndicator={false}>
      <View style={{ width: '100%', maxWidth: 820 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.lineStrong }}>
          {table.columns.map((col, k) => {
            const w = widthFor(k, col.align)
            return (
              <T key={k} style={[dtext.label, { color: c.inkMute }, col.align === 'right' ? { textAlign: 'right' as const } : null, w ? { width: w } : { flex: 1 }]}>{col.label}</T>
            )
          })}
        </View>

        {table.rows.map((row, i) => {
          const strong = bold.has(i)
          const isHeading = twoCol && strong && (row[1] === '' || row[1] === undefined || row[1] === null)
          const link = links?.[i]

          const rowCells = row.map((v, k) => {
            const col = table.columns[k]
            const text = typeof v === 'number' ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v === null || v === undefined ? '' : String(v)
            const w = widthFor(k, col?.align)
            const isNum = col?.align === 'right'
            return (
              <T key={k} numberOfLines={isHeading ? undefined : 1}
                style={[
                  isHeading ? [dtext.label, { color: c.inkMute, marginTop: i > 0 ? 4 : 0 }] : isNum ? (strong ? dtext.numStrong : dtext.num) : (strong ? dtext.cellStrong : dtext.cell),
                  isNum ? { textAlign: 'right' as const } : null,
                  w ? { width: w } : { flex: 1 },
                ]}
              >{text}</T>
            )
          })
          const rowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: strong ? 10 : 7, paddingTop: strong && i > 0 ? 14 : strong ? 10 : 7, borderTopWidth: strong && i > 0 ? 1 : 0, borderTopColor: c.lineStrong, borderRadius: 4 }
          return link ? <StatementRow key={i} style={rowStyle} onPress={() => onOpen(link)}>{rowCells}</StatementRow> : <View key={i} style={rowStyle}>{rowCells}</View>
        })}
      </View>
    </ScrollView>
  )
}

/** A clickable statement row (e.g. a trial-balance line opening its ledger) — tracks hover itself, the same way
 * `kit.tsx`'s `DataRow` does, since a plain `View`'s style cannot be a function. */
function StatementRow({ style, onPress, children }: { style: object; onPress: () => void; children: React.ReactNode }) {
  const { c } = useTheme()
  const [hovered, setHovered] = useState(false)
  return (
    <Pressable onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[style, hovered ? { backgroundColor: c.primaryTint } : null]}>
      {children}
    </Pressable>
  )
}
