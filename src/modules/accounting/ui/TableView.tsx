import React from 'react'
import { ScrollView, View } from 'react-native'
import { inr } from '@/domain/money'
import { Card, Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import type { Table } from '../report-html'

const cell = (v: unknown) => (typeof v === 'number' ? inr(v, 2) : v === null || v === undefined ? '' : String(v))

/**
 * A statement on the screen. Narrow ones (two or three columns) fit the phone; wide ones (ledgers) scroll sideways with the
 * numbers kept in fixed columns. `links[i]` makes row i tappable (a trial-balance row opens that account's ledger).
 */
export function TableView({ table, links, onOpen }: { table: Table; links?: Array<string | undefined>; onOpen?: (link: string) => void }) {
  const { c } = useTheme()
  const wide = table.columns.length > 3
  const bold = new Set(table.bold ?? [])
  const width = (i: number) => (table.columns[i].align === 'right' ? 104 : /^(code|date)$/i.test(table.columns[i].label) ? 84 : 170)
  const rowStyle = (i: number) => ({ flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, paddingVertical: 9, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, backgroundColor: bold.has(i) ? c.surfaceAlt : undefined })
  const body = (
    <View style={wide ? undefined : { alignSelf: 'stretch' }}>
      <View style={{ ...rowStyle(0), borderTopWidth: 0, backgroundColor: c.sunken }}>
        {table.columns.map((col, k) => <T key={k} v="label" tone="soft" align={col.align} style={wide ? { width: width(k) } : { flex: k === 0 || col.align !== 'right' ? 1 : undefined, width: col.align === 'right' ? 104 : undefined }}>{col.label}</T>)}
      </View>
      {table.rows.map((r, i) => {
        const link = links?.[i]
        const row = (
          <View style={rowStyle(i + 1)}>
            {r.map((v, k) => {
              const col = table.columns[k]
              const isNum = col?.align === 'right'
              return (
                <T key={k} v={isNum ? 'num' : bold.has(i) ? 'bodyStrong' : 'body'} align={col?.align} numberOfLines={wide ? 3 : undefined}
                  style={wide ? { width: width(k) } : { flex: isNum ? undefined : 1, width: isNum ? 104 : undefined, fontWeight: bold.has(i) ? '700' : undefined }}>{cell(v)}</T>
              )
            })}
          </View>
        )
        return link && onOpen ? <Tap key={i} onPress={() => onOpen(link)}>{row}</Tap> : <View key={i}>{row}</View>
      })}
    </View>
  )
  return <Card padded={false}>{wide ? <ScrollView horizontal showsHorizontalScrollIndicator={false}>{body}</ScrollView> : body}</Card>
}
