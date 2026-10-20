import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { toCsv, csvFileName } from '@/domain/csv'
import { useCan } from '@/data/store'
import { useStore } from '@/data/hooks'
import { printHtml, sharePdf } from '@/features/share'
import { shareFile } from '@/features/shareFile'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, FileText, Printer } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { tableHtml, toCsvRows, type Table } from '../report-html'
import { PeriodBar } from './PeriodBar'
import type { PeriodState } from './hooks'
import { TableView } from './TableView'

/** The frame of every statement: period, the table, and Export / Print / PDF. The table is the single source for all three. */
export function ReportShell({ title, subtitle, period, table, links, children, emptyHint = 'Nothing was booked in this period.', footerNote, hideTable }: {
  title: string; subtitle?: string; period?: PeriodState; table: Table; links?: Array<string | undefined>; children?: React.ReactNode; emptyHint?: string; footerNote?: React.ReactNode
  /** The children already show the rows (the day book groups them by day); the table still feeds the exports. */
  hideTable?: boolean
}) {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('accounting')
  const store = useStore()
  if (!can) return <Screen title={title} back><T tone="mute">The books are for the owner and managers.</T></Screen>
  const name = store?.name ?? 'Kosh'
  return (
    <Screen title={title} subtitle={subtitle ?? table.subtitle} back>
      <View style={{ gap: 14, paddingBottom: 24 }}>
        {period ? <PeriodBar p={period} /> : null}
        {children}
        {hideTable && table.rows.length ? null : table.rows.length ? <TableView table={table} links={links} onOpen={(to) => router.push(to as never)} />
          : <EmptyState icon={<FileText size={26} color={c.primary} />} title="Nothing to show" hint={emptyHint} compact />}
        {footerNote}
        {table.rows.length ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="CSV" kind="outline" block icon={<Download size={18} color={c.ink} />} onPress={() => void shareFile(csvFileName(table.title), toCsv(toCsvRows(table)))} /></View>
            <View style={{ flex: 1 }}><Button label="Print" kind="outline" block icon={<Printer size={18} color={c.ink} />} onPress={() => void printHtml(tableHtml(name, table))} /></View>
            <View style={{ flex: 1 }}><Button label="PDF" kind="outline" block icon={<FileText size={18} color={c.ink} />} onPress={() => void sharePdf(tableHtml(name, table), csvFileName(table.title, 'pdf'))} /></View>
          </View>
        ) : null}
      </View>
    </Screen>
  )
}
