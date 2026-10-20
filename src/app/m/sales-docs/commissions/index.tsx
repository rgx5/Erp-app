import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { toCsv, csvFileName } from '@/domain/csv'
import { fmtMonth } from '@/domain/dates'
import { inr } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import { useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { commissionCsvRows, commissionReport } from '@/modules/sales-docs/logic/commissions'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Card, Chip, ProgressBar } from '@/ui/primitives'
import { EmptyState, KV, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, Sliders, Target } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type Period = 'this' | 'last' | 'year'

/** What each salesperson sold, against their target, and the commission it earns. */
export default function Commissions() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('salesDocs')
  const data = useApp((s) => s.data)
  const [period, setPeriod] = useState<Period>('this')
  const now = Date.now()

  const range = useMemo(() => {
    const d = new Date(now)
    if (period === 'year') return { from: new Date(d.getFullYear(), 0, 1).getTime(), to: now, label: `${d.getFullYear()} so far` }
    const m = period === 'this' ? d.getMonth() : d.getMonth() - 1
    return { from: new Date(d.getFullYear(), m, 1).getTime(), to: period === 'this' ? now : new Date(d.getFullYear(), m + 1, 0, 23, 59, 59, 999).getTime(), label: fmtMonth(new Date(d.getFullYear(), m, 1).getTime()) }
  }, [period, now])
  const rep = useMemo(() => commissionReport(data, range.from, range.to), [data, range])

  if (!can) return <Screen title="Commissions" back><T tone="mute">Commissions and targets are for the owner and managers.</T></Screen>

  return (
    <Screen title="Commissions & targets" subtitle={range.label} back
      right={<Button label="Rules" kind="soft" size="sm" icon={<Sliders size={16} color={c.primary} />} onPress={() => router.push('/m/sales-docs/commissions/setup')} />}>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['this', 'This month'], ['last', 'Last month'], ['year', 'This year']] as Array<[Period, string]>).map(([k, l]) => <Chip key={k} label={l} selected={period === k} onPress={() => setPeriod(k)} />)}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile label="Sales (excl. GST)" value={inr(rep.totalSales, 0)} icon={<Target size={16} color={c.primary} />} style={{ flex: 1 }} />
          <StatTile label="Commission" value={inr(rep.totalCommission, 0)} tone="success" icon={<Target size={16} color={c.success} />} style={{ flex: 1 }} />
        </View>
        <FlatList scrollEnabled={false} data={rep.rows} keyExtractor={(r) => r.staffId}
          ListEmptyComponent={<EmptyState icon={<Target size={26} color={c.primary} />} title="No sales in this period" hint="Sales count for whoever was chosen as the seller on each item. Add a commission rule and a monthly target to see what each person earns." action="Set up rules" onAction={() => router.push('/m/sales-docs/commissions/setup')} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item: r }) => (
            <Card style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar name={r.name} size={40} />
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong">{r.name}</T>
                  <T v="caption" tone="mute">{r.bills} bills · {fmtQty(r.pieces)} pcs</T>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <T v="num">{inr(r.sales, 0)}</T>
                  <T v="caption" tone="success">{inr(r.commission, 0)} earned</T>
                </View>
              </View>
              {r.target > 0 ? (
                <View style={{ gap: 4 }}>
                  <ProgressBar value={Math.min(1, (r.achievementPct ?? 0) / 100)} tone={(r.achievementPct ?? 0) >= 100 ? 'success' : 'primary'} />
                  <T v="caption" tone="mute">{r.achievementPct}% of {inr(r.target, 0)} target</T>
                </View>
              ) : null}
              {r.lines.map((l) => <KV key={`${l.ruleId}${l.rate}`} k={l.ruleName} v={inr(l.amount)} sub={`rate ${l.rate} on ${fmtQty(l.base)}`} />)}
            </Card>
          )} />
        {rep.rows.length ? <Button label="Export to a spreadsheet" kind="outline" block icon={<Download size={18} color={c.ink} />} onPress={() => shareFile(csvFileName(`commission ${range.label}`), toCsv(commissionCsvRows(rep)))} /> : null}
      </View>
    </Screen>
  )
}
