import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { DAY } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { itemName } from '@/modules/manufacturing/bom'
import { productionCostReport, productionSummary, wipReport, yieldReport } from '@/modules/manufacturing/reports'
import { Screen } from '@/ui/Screen'
import { Card, Chip } from '@/ui/primitives'
import { KV, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'

type Tab = 'cost' | 'yield' | 'wip'
const PERIODS: Array<[number, string]> = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, 'Year']]

/** Production reports: cost per unit and variance, yield and wastage, and work in progress. */
export default function ProductionReports() {
  const params = useLocalSearchParams<{ tab?: string }>()
  const can = useCan('manufacturing')
  const data = useApp((s) => s.data)
  const [tab, setTab] = useState<Tab>(params.tab === 'yield' || params.tab === 'wip' ? params.tab : 'cost')
  const [days, setDays] = useState(30)
  const to = Date.now(), from = to - days * DAY
  const sum = useMemo(() => productionSummary(data, from, to), [data, from, to])
  const cost = useMemo(() => productionCostReport(data, from, to), [data, from, to])
  const yr = useMemo(() => yieldReport(data, from, to), [data, from, to])
  const wip = useMemo(() => wipReport(data), [data])

  if (!can) return <Screen title="Production reports" back><T tone="mute">Production reports are for the owner and managers.</T></Screen>
  return (
    <Screen title="Production reports" back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {([['cost', 'Cost & variance'], ['yield', 'Yield & wastage'], ['wip', 'In progress']] as Array<[Tab, string]>).map(([k, l]) => <Chip key={k} label={l} selected={tab === k} onPress={() => setTab(k)} />)}
        </View>
        {tab !== 'wip' ? <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{PERIODS.map(([d, l]) => <Chip key={d} label={l} selected={days === d} onPress={() => setDays(d)} />)}</View> : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><StatTile label="Made" value={String(sum.good)} foot={`${sum.orders} orders`} /></View>
          <View style={{ flex: 1 }}><StatTile label={tab === 'wip' ? 'In progress' : 'Variance'} value={inr(tab === 'wip' ? sum.wip : sum.variance, 0)} tone={tab !== 'wip' && sum.variance > 0 ? 'danger' : 'success'} /></View>
        </View>

        {tab === 'cost' ? (
          <Section title="Per work order">
            {cost.rows.length ? cost.rows.map((r) => (
              <Card key={r.workOrderId} style={{ gap: 4 }}>
                <KV k={`${r.no} · ${itemName(data, r.outputVariantId)}`} v={`${inr(r.actualPerUnit)} each`} sub={`Standard ${inr(r.standardPerUnit)} · ${r.good} good${r.scrap ? `, ${r.scrap} scrap` : ''}`} strong />
                <KV k="Material / labour / overhead variance" v={`${inr(r.materialVariance)} / ${inr(r.labourVariance)} / ${inr(r.overheadVariance)}`} tone={r.variance > 0 ? 'danger' : 'success'} />
              </Card>
            )) : <T tone="mute">No orders finished in this period.</T>}
          </Section>
        ) : null}

        {tab === 'yield' ? (
          <View style={{ gap: 14 }}>
            <Section title="Output: planned against actual">
              {yr.yields.length ? yr.yields.map((y) => <Card key={y.outputVariantId}><KV k={itemName(data, y.outputVariantId)} v={y.yieldPct === null ? '—' : `${y.yieldPct}%`} sub={`${y.good} good of ${y.planned} wanted · ${y.scrap} scrap · quality ${y.qualityPct ?? '—'}%`} /></Card>) : <T tone="mute">No orders finished in this period.</T>}
            </Section>
            <Section title="Material wastage">
              {yr.wastage.map((w) => <Card key={w.variantId}><KV k={itemName(data, w.variantId)} v={w.wastagePct === null ? '—' : `${w.wastagePct}%`} tone={w.over > 0 ? 'danger' : undefined} sub={`Planned ${w.plannedWastagePct ?? 0}% · used ${w.actual} against ${w.allowed} allowed`} /></Card>)}
            </Section>
          </View>
        ) : null}

        {tab === 'wip' ? (
          <Section title="On the floor">
            {wip.rows.length ? wip.rows.map((r) => <Card key={r.workOrderId}><KV k={`${r.no} · ${itemName(data, r.outputVariantId)}`} v={inr(r.wipValue)} sub={`${r.good} of ${r.qty} made · ${r.remaining} to go`} /></Card>) : <T tone="mute">Nothing is in progress.</T>}
          </Section>
        ) : null}
      </View>
    </Screen>
  )
}
