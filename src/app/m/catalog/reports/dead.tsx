import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { fmtDate, toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { catalogSettings, deadStock } from '@/modules/catalog/logic'
import { deadStockCsv } from '@/modules/catalog/reports'
import { CsvButton, NoAccess } from '@/modules/catalog/ui/common'
import { Screen } from '@/ui/Screen'
import { Badge, Card, Chip } from '@/ui/primitives'
import { EmptyState, KV, ListRow } from '@/ui/blocks'
import { Check } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

const WINDOWS = [30, 60, 90, 180, 365]

/** Stock that has stopped selling: money sitting on a shelf. */
export default function DeadStockScreen() {
  const { c } = useTheme()
  const can = useCan('stock')
  const data = useApp((s) => s.data)
  const [days, setDays] = useState(catalogSettings(data).deadDays)
  const now = Date.now()
  const d = useMemo(() => deadStock(data, now, days), [data, now, days])

  if (!can) return <NoAccess title="Dead stock" who="the owner and managers" />

  return (
    <Screen title="Dead stock" subtitle={`Nothing sold in ${days} days`} back
      right={d.rows.length ? <CsvButton name={`dead stock ${days} days ${toInputDate(now)}`} rows={() => deadStockCsv(data, now, days)} /> : undefined}>
      <View style={{ gap: 12, paddingBottom: 24 }}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{[...new Set([...WINDOWS, days])].sort((a, b) => a - b).map((w) => <Chip key={w} label={`${w} days`} selected={days === w} onPress={() => setDays(w)} />)}</View>
        {!d.rows.length ? <EmptyState icon={<Check size={26} color={c.success} />} title="No dead stock" hint={`Everything in stock sold within the last ${days} days, or arrived more recently.`} /> : (
          <>
            <Card>
              <KV k="Stuck at cost" v={inr(d.value, 0)} strong big tone="danger" />
              <KV k="Items" v={String(d.rows.length)} />
              <KV k="Units" v={String(d.qty)} />
            </Card>
            <Card padded={false}>
              {d.rows.slice(0, 200).map((r) => (
                <ListRow key={r.variantId} title={r.name} subtitle={`${r.stock} units · ${r.lastSold ? `last sold ${fmtDate(r.lastSold)}` : 'never sold'}`} value={inr(r.value, 0)}
                  badge={<Badge tone={r.idleDays > 180 ? 'danger' : 'warning'}>{r.idleDays}d</Badge>} />
              ))}
            </Card>
          </>
        )}
      </View>
    </Screen>
  )
}
