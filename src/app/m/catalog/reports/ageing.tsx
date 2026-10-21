import React, { useMemo } from 'react'
import { View } from 'react-native'
import { toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { AGE_BUCKETS, stockAgeing } from '@/modules/catalog/logic'
import { ageingCsv } from '@/modules/catalog/reports'
import { CsvButton, NoAccess } from '@/modules/catalog/ui/common'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { EmptyState, KV, ListRow, Section } from '@/ui/blocks'
import { HBars } from '@/ui/charts'
import { Hourglass } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** How long today’s stock has been on the shelf, at cost. */
export default function StockAgeingScreen() {
  const { c } = useTheme()
  const can = useCan('stock')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const a = useMemo(() => stockAgeing(data, now), [data, now])

  if (!can) return <NoAccess title="Stock ageing" who="the owner and managers" />

  return (
    <Screen title="Stock ageing" subtitle="Value at cost, by how long it has been here" back
      right={a.rows.length ? <CsvButton name={`stock ageing ${toInputDate(now)}`} rows={() => ageingCsv(data, now)} /> : undefined}>
      {!a.rows.length ? <EmptyState icon={<Hourglass size={26} color={c.primary} />} title="No stock on hand" hint="Stock ageing shows how long what you hold has been here." /> : (
        <View style={{ gap: 12, paddingBottom: 24 }}>
          <Card>
            <KV k="Total stock" v={inr(a.total, 0)} strong big />
            {AGE_BUCKETS.map((b) => <KV key={b.key} k={b.label} v={inr(a.value[b.key], 0)} tone={b.key === 'older' && a.value.older > 0 ? 'danger' : b.key === 'd180' && a.value.d180 > 0 ? 'warning' : undefined} />)}
          </Card>
          <Section title="By age" style={{ marginTop: 0 }}><Card><HBars items={AGE_BUCKETS.map((b) => ({ label: b.label, value: a.value[b.key] }))} format={(n) => inr(n, 0)} /></Card></Section>
          <Section title="Oldest first" style={{ marginTop: 0 }}>
            <Card padded={false}>
              {a.rows.slice(0, 200).map((r) => (
                <ListRow key={r.variantId} title={r.name} subtitle={`${r.stock} units · oldest ${r.oldest} days${r.qty.older + r.qty.d180 > 0 ? ` · ${r.qty.older + r.qty.d180} over 90 days` : ''}`} value={inr(r.totalValue, 0)} />
              ))}
            </Card>
          </Section>
        </View>
      )}
    </Screen>
  )
}
