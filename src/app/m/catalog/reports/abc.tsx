import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { DAY, toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { abcAnalysis, type AbcBasis, type AbcClass } from '@/modules/catalog/logic'
import { abcCsv } from '@/modules/catalog/reports'
import { CsvButton, NoAccess } from '@/modules/catalog/ui/common'
import { Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Card, Chip } from '@/ui/primitives'
import { EmptyState, KV, ListRow } from '@/ui/blocks'
import { ChartColumn } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'

const PERIODS = [30, 90, 180, 365]
const TONE: Record<AbcClass, Tone> = { A: 'success', B: 'primary', C: 'default' }
const MEANING: Record<AbcClass, string> = { A: 'the few that make most of your sales', B: 'the middle', C: 'the long tail' }

/** ABC analysis: which items make the business. */
export default function AbcScreen() {
  const { c } = useTheme()
  const can = useCan('reports')
  const profitOk = useCan('viewProfit')
  const data = useApp((s) => s.data)
  const [days, setDays] = useState(90)
  const [basis, setBasis] = useState<AbcBasis>('revenue')
  const now = Date.now()
  const from = now - days * DAY
  const a = useMemo(() => abcAnalysis(data, from, now, basis), [data, from, now, basis])

  if (!can) return <NoAccess title="ABC analysis" who="the owner and managers" />
  const fmt = (n: number) => (basis === 'qty' ? String(n) : inr(n, 0))

  return (
    <Screen title="ABC analysis" subtitle={`Last ${days} days`} back
      right={a.rows.length ? <CsvButton name={`abc analysis ${days} days ${toInputDate(now)}`} rows={() => abcCsv(data, from, now, basis)} /> : undefined}>
      <View style={{ gap: 12, paddingBottom: 24 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>{PERIODS.map((p) => <Chip key={p} label={`${p} days`} selected={days === p} onPress={() => setDays(p)} />)}</View>
        <Segmented value={basis} options={[{ value: 'revenue', label: 'Sales' }, ...(profitOk ? [{ value: 'profit' as const, label: 'Profit' }] : []), { value: 'qty', label: 'Units' }]} onChange={setBasis} />
        {!a.rows.length ? <EmptyState icon={<ChartColumn size={26} color={c.primary} />} title="No sales in this period" hint="Sell something, or choose a longer period." /> : (
          <>
            <Card>
              {(['A', 'B', 'C'] as const).map((k) => <KV key={k} k={`Class ${k} · ${a.classes[k].items} items`} sub={MEANING[k]} v={`${a.classes[k].share}% · ${fmt(a.classes[k].metric)}`} tone={k === 'A' ? 'success' : undefined} />)}
              {a.unsold ? <KV k="In stock, not sold" v={`${a.unsold} items`} tone="warning" /> : null}
            </Card>
            <Card padded={false}>
              {a.rows.slice(0, 300).map((r) => (
                <ListRow key={r.variantId} title={r.name} subtitle={`${r.share}% of the total · running ${r.cumulative}% · ${r.stock} in stock`} value={fmt(r.metric)} badge={<Badge tone={TONE[r.cls]}>{r.cls}</Badge>} />
              ))}
            </Card>
          </>
        )}
      </View>
    </Screen>
  )
}
