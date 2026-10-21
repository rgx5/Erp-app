import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { forecastAll, minMaxSuggestions, variantName } from '@/modules/catalog/logic'
import { applyMinMax } from '@/modules/catalog/ops'
import { forecastCsv, minMaxCsv } from '@/modules/catalog/reports'
import { CsvButton, NoAccess } from '@/modules/catalog/ui/common'
import { Button } from '@/ui/Button'
import { Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Card, Chip, Tap } from '@/ui/primitives'
import { Delta, EmptyState, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check, TrendingUp } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { listOf } from '@/data/state'

const HORIZONS = [7, 14, 30, 60]

/** What is expected to sell, and the reorder levels that follow from it. */
export default function Forecast() {
  const { c } = useTheme()
  const can = useCan('reports')
  const canSet = useCan('inventory')
  const data = useApp((s) => s.data)
  const [tab, setTab] = useState<'forecast' | 'minmax'>('forecast')
  const [days, setDays] = useState(14)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const now = Date.now()
  const fc = useMemo(() => forecastAll(data, now, { horizonDays: days }), [data, now, days])
  const rows = useMemo(() => listOf(data.variants).flatMap((v) => { const f = fc.get(v.id); return f && f.sold > 0 ? [{ v, f }] : [] }).sort((a, b) => b.f.expected - a.f.expected), [data.variants, fc])
  const mm = useMemo(() => minMaxSuggestions(data, now), [data, now])
  const changes = mm.filter((r) => r.move !== 'same' || r.currentMax === undefined)

  if (!can) return <NoAccess title="Demand forecast" who="the owner and managers" />

  function apply() {
    const pick = changes.filter((r) => !skip.has(r.variantId))
    try {
      const r = perform((s, ctx) => applyMinMax(s, pick.map((x) => ({ variantId: x.variantId, min: x.min, max: x.max })), ctx))
      toast(`${r.count} items updated`, 'ok'); setSkip(new Set())
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not apply', 'err') }
  }

  return (
    <Screen title="Demand forecast" subtitle="From your own bills" back
      right={<CsvButton name={tab === 'forecast' ? `demand forecast ${days} days` : 'min max suggestions'} rows={() => (tab === 'forecast' ? forecastCsv(data, now, days) : minMaxCsv(data, now))} />}
      footer={tab === 'minmax' && canSet && changes.length ? <Button label={`Apply to ${changes.length - skip.size} items`} size="lg" block disabled={changes.length === skip.size} onPress={apply} /> : undefined}>
      <View style={{ gap: 12, paddingBottom: 24 }}>
        <Segmented value={tab} options={[{ value: 'forecast', label: 'Forecast' }, { value: 'minmax', label: 'Min–max' }]} onChange={setTab} />
        {tab === 'forecast' ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>{HORIZONS.map((d) => <Chip key={d} label={`${d} days`} selected={days === d} onPress={() => setDays(d)} />)}</View>
            {!rows.length ? <EmptyState icon={<TrendingUp size={26} color={c.primary} />} title="Nothing to forecast yet" hint="Once items have sold, this shows what to expect, day by day, from the last weeks of bills." /> : (
              <Card padded={false}>
                {rows.slice(0, 200).map(({ v, f }, i) => (
                  <View key={v.id} style={{ padding: 14, gap: 4, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{variantName(data, v)}</T>
                      <T v="num">{f.expected}</T>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <T v="caption" tone="mute" style={{ flex: 1 }}>{v.stock} in stock · sells {f.perDay}/day{f.daysOfCover !== null ? ` · lasts ${f.daysOfCover} days` : ''}</T>
                      {f.trendPct !== null ? <Delta pct={f.trendPct} /> : null}
                      {f.confidence === 'low' ? <Badge tone="default">Little history</Badge> : null}
                    </View>
                  </View>
                ))}
              </Card>
            )}
            <T v="caption" tone="mute">Units expected in {days} days: a moving average of the last weeks, lifted or lowered by the days of the week (and months, after a year) that sell more.</T>
          </>
        ) : (
          <>
            {!mm.length ? <EmptyState icon={<TrendingUp size={26} color={c.primary} />} title="Not enough sales yet" hint="Min–max suggestions need a couple of weeks of sales for an item." /> : (
              <Section title={`${mm.length} suggestions`} style={{ marginTop: 0 }}>
                <Card padded={false}>
                  {mm.slice(0, 200).map((r, i) => {
                    const off = skip.has(r.variantId)
                    const actionable = changes.includes(r)
                    return (
                      <Tap key={r.variantId} disabled={!actionable || !canSet} onPress={() => setSkip((cur) => { const n = new Set(cur); if (n.has(r.variantId)) n.delete(r.variantId); else n.add(r.variantId); return n })}
                        style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, opacity: off ? 0.5 : 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        {actionable && canSet ? <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: off ? c.lineStrong : c.primary, backgroundColor: off ? 'transparent' : c.primary, alignItems: 'center', justifyContent: 'center' }}>{off ? null : <Check size={14} color={c.onPrimary} />}</View> : null}
                        <View style={{ flex: 1 }}>
                          <T v="bodyStrong" numberOfLines={1}>{r.name}</T>
                          <T v="caption" tone="mute">Sells {r.perDay}/day · level {r.currentMin} → <T v="caption" tone={r.move === 'raise' ? 'warning' : r.move === 'lower' ? 'success' : 'mute'}>{r.min}</T> · order up to {r.max}</T>
                        </View>
                        {r.confidence === 'good' ? null : <Badge>Few sales</Badge>}
                      </Tap>
                    )
                  })}
                </Card>
              </Section>
            )}
            <T v="caption" tone="mute">Reorder level = what sells while an order is on its way plus the safety days. Order up to = that plus the days an order should cover. Set both in Auto-reorder settings; applying here changes the item’s reorder level.</T>
          </>
        )}
      </View>
    </Screen>
  )
}
