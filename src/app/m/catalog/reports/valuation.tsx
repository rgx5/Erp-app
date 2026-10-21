import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { toInputDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { valuation, type ValuationGroup } from '@/modules/catalog/logic'
import { valuationCsv } from '@/modules/catalog/reports'
import { CsvButton, NoAccess } from '@/modules/catalog/ui/common'
import { Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { EmptyState, KV, ListRow } from '@/ui/blocks'
import { Layers } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** What the stock on hand is worth, at cost and at selling price. */
export default function StockValuation() {
  const { c } = useTheme()
  const can = useCan('stock')
  const data = useApp((s) => s.data)
  const [by, setBy] = useState<ValuationGroup>('category')
  const v = useMemo(() => valuation(data, by), [data, by])

  if (!can) return <NoAccess title="Stock valuation" who="the owner and managers" />

  return (
    <Screen title="Stock valuation" subtitle={`As on ${toInputDate(Date.now())} · ${data.store?.costBasis === 'latest' ? 'latest cost' : 'average cost'}`} back
      right={v.rows.length ? <CsvButton name={`stock valuation by ${by} ${toInputDate(Date.now())}`} rows={() => valuationCsv(data, by)} /> : undefined}>
      {!v.rows.length ? <EmptyState icon={<Layers size={26} color={c.primary} />} title="No stock on hand" hint="Receive goods or add opening stock and the value shows here." /> : (
        <View style={{ gap: 12, paddingBottom: 24 }}>
          <Card>
            <KV k="At cost" v={inr(v.cost, 0)} strong big />
            <KV k="At selling price" v={inr(v.retail, 0)} />
            <KV k="Potential margin" v={`${inr(v.margin, 0)} · ${v.retail > 0 ? Math.round((v.margin / v.retail) * 100) : 0}%`} tone="success" />
            <KV k="Units" v={String(v.qty)} />
          </Card>
          <Segmented value={by} options={[{ value: 'category', label: 'Category' }, { value: 'brand', label: 'Brand' }, { value: 'item', label: 'Item' }]} onChange={setBy} />
          <Card padded={false}>
            {v.rows.slice(0, 300).map((r) => <ListRow key={r.key} title={r.label} subtitle={`${r.qty} units · selling value ${inr(r.retail, 0)} · ${r.marginPct}% margin`} value={inr(r.cost, 0)} />)}
          </Card>
        </View>
      )}
    </Screen>
  )
}
