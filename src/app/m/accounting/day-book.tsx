import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtLongDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { dayBook } from '@/modules/accounting/ledger'
import { sourceRoute } from '@/modules/accounting/logic'
import { dayBookTable } from '@/modules/accounting/report-html'
import { ReportShell } from '@/modules/accounting/ui/ReportShell'
import { useLedger, usePeriod } from '@/modules/accounting/ui/hooks'
import { Card, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'

/** Every entry of the period, a day at a time: sales, purchases, expenses and vouchers in one list. Tap an entry to open its document. */
export default function DayBookPage() {
  const { c } = useTheme()
  const router = useRouter()
  const p = usePeriod('month')
  const ledger = useLedger({ from: p.from, to: p.to })
  const days = useMemo(() => dayBook(ledger), [ledger])
  const table = useMemo(() => dayBookTable(days, ledger, p.from, p.to), [days, ledger, p.from, p.to])
  return (
    <ReportShell title="Day book" period={p} table={table} hideTable emptyHint="No entries in this period.">
      {days.slice(0, 31).map((d) => (
        <View key={d.day} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T v="label" tone="soft">{fmtLongDate(d.day).toUpperCase()}</T>
            <T v="caption" tone="mute">{inr(d.total, 2)}</T>
          </View>
          <Card padded={false}>
            {d.postings.map((post, i) => {
              const to = sourceRoute(post.sourceColl, post.sourceId)
              const body = (
                <View style={{ padding: 12, gap: 4, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <T v="bodyStrong" numberOfLines={1}>{post.memo}</T>
                  {post.lines.map((l, k) => (
                    <View key={k} style={{ flexDirection: 'row', gap: 8 }}>
                      <T v="caption" tone="soft" style={{ flex: 1, paddingLeft: l.credit ? 14 : 0 }} numberOfLines={1}>{l.credit ? 'To ' : 'Dr '}{ledger.byId.get(l.accountId)?.name ?? ''}</T>
                      <T v="caption" tone="soft">{inr(l.debit || l.credit, 2)}</T>
                    </View>
                  ))}
                </View>
              )
              return to ? <Tap key={post.index} onPress={() => router.push(to as never)}>{body}</Tap> : <View key={post.index}>{body}</View>
            })}
          </Card>
        </View>
      ))}
      {days.length > 31 ? <T v="caption" tone="mute">Showing the latest 31 days. The CSV and PDF include every entry.</T> : null}
    </ReportShell>
  )
}
