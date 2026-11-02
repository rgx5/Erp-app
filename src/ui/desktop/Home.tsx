import React, { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { computeDashboard, DASH_RANGES, pctChange, type DashRange } from '@/domain/analytics'
import { fmtDateTime, fmtDayShort, greeting } from '@/domain/dates'
import { inr, inr0, inrShort, num } from '@/domain/money'
import { variantLabel } from '@/domain/codes'
import { UNPRICED_WARN_DAYS } from '@/domain/pricing'
import { firstName } from '@/domain/people'
import { useAnalyticsInput, useIndustry, useLabels } from '@/data/hooks'
import { useApp, useCan, useUser } from '@/data/store'
import { useModuleNotices } from '@/modules/hooks'
import { SyncPill } from '@/features/SyncPill'
import { Avatar, Tap } from '@/ui/primitives'
import { AreaChart, Donut, HBars, Legend } from '@/ui/charts'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { Alert, Boxes, Package, Percent, Plus, Receipt, ReceiptText, Scan, Tags, Truck, Wallet } from '@/ui/icons'
import { DataTable, DeskPage, DeskSegmented, DeskButton, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, cellText, dtext } from './kit'

const RANGE_WORD: Record<DashRange, string> = { today: 'today', '7d': 'last 7 days', '30d': 'last 30 days' }

/**
 * The desktop dashboard: a command centre, not a scaled-up phone screen. One screenful — KPI strip, the sales trend
 * and top sellers on the left, payment mix / stock / recent bills as dense tables on the right. Reads the exact
 * same `computeDashboard` the phone Home screen does; nothing about the figures differs, only the arrangement.
 */
export function DesktopHome() {
  const { c } = useTheme()
  const router = useRouter()
  const user = useUser()
  const store = useApp((s) => s.data.store)
  const labels = useLabels()
  const pack = useIndustry()
  const canProfit = useCan('viewProfit')
  const canPos = useCan('pos')
  const canInv = useCan('inventory')
  const canBuy = useCan('purchases')
  const canExp = useCan('expenses')
  const canStock = useCan('stock')
  const [range, setRange] = useState<DashRange>('today')
  const input = useAnalyticsInput()
  const d = useMemo(() => computeDashboard(input, range), [input, range])
  const notices = useModuleNotices()

  const avg = (t: typeof d.cur) => (t.bills ? t.billsTotal / t.bills : 0)
  const total = d.byMode.reduce((s, [, v]) => s + Math.max(0, v), 0) || 1
  const modeColor = (m: string) => ({ cash: c.series[1], upi: c.series[0], card: c.series[2], credit: c.series[3] }[m] ?? c.inkMute)

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={`${greeting()}, ${firstName(user?.name) || 'there'}`}
          subtitle={`${store?.name ?? ''} · ${pack.name}`}
          left={<DeskSegmented value={range} onChange={setRange} options={DASH_RANGES.map((r) => ({ id: r.value, label: r.label }))} />}
          right={
            <>
              <SyncPill compact />
              {canPos ? <DeskButton label={labels.newSale} tone="primary" icon={<Plus size={14} color={c.onPrimary} />} hint="F2" onPress={() => router.push('/(tabs)/sell')} /> : null}
              {canPos ? <DeskButton label="Scan" icon={<Scan size={14} color={c.ink} />} onPress={() => router.push('/scan')} /> : null}
              <Tap onPress={() => router.push('/(tabs)/more')} accessibilityLabel="Account"><Avatar name={user?.name ?? '?'} size={30} /></Tap>
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label={`${labels.sales} · ${RANGE_WORD[range]}`} value={inr0(d.cur.sales)} delta={pctChange(d.cur.sales, d.prev.sales) !== null ? `${pctChange(d.cur.sales, d.prev.sales)! >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(pctChange(d.cur.sales, d.prev.sales)! * 10) / 10)}%` : `${d.cur.bills} so far`} tone="primary" />
        <KpiTile label="Bills" value={num(d.cur.bills)} delta={`Avg ${inrShort(avg(d.cur))}`} />
        {canProfit ? (
          <KpiTile label="Profit" value={inrShort(d.cur.profit)} tone={d.cur.profit >= 0 ? 'success' : 'danger'} delta={`After ${inrShort(d.cur.expenses)} expenses`} />
        ) : (
          <KpiTile label="Reorder alerts" value={String(d.stock.lowCount)} tone="accent" delta={`${d.stock.outOfStock} out of stock`} onPress={canStock ? () => router.push('/stock') : undefined} />
        )}
        <KpiTile label="Stock at cost" value={inrShort(d.stock.value)} delta={`${num(d.stock.units, d.stock.units % 1 ? 1 : 0)} units`} onPress={canStock ? () => router.push('/stock') : undefined} />
        <KpiTile label="Expenses" value={inrShort(d.cur.expenses)} tone="warning" delta={RANGE_WORD[range]} onPress={canExp ? () => router.push('/expenses') : undefined} />
        <KpiTile label={`${labels.items} needing a price`} value={String(d.unpriced.count)} tone={d.unpriced.overdue ? 'danger' : 'default'} delta={d.unpriced.overdue ? `${d.unpriced.overdue} over ${UNPRICED_WARN_DAYS} days` : 'All current'} onPress={canInv ? () => router.push('/items/pricing') : undefined} />
      </KpiStrip>

      <SplitPane widths={['flex', 420]}>
        {/* Left: trend + top sellers */}
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <Panel title={`${labels.sales} trend`}>
            {!d.hasAnyBills ? (
              <View style={{ padding: 24, alignItems: 'center' }}><T style={[dtext.cell, { color: c.inkMute }]}>No {labels.sales.toLowerCase()} yet.</T></View>
            ) : (
              <View style={{ padding: 14 }}>
                <AreaChart data={d.series.map((s) => ({ label: fmtDayShort(s.start), value: s.total, note: `${s.bills} ${s.bills === 1 ? labels.sale.toLowerCase() : labels.sales.toLowerCase()}` }))} format={(n) => inr(n, 0)} axisFormat={inrShort} />
              </View>
            )}
          </Panel>
          <Panel title="Top sellers" action={d.topItems.length ? undefined : undefined}>
            <DataTable
              compact
              emptyLabel="No sales in this period"
              rows={d.topItems.map((t, i) => ({ id: String(i), ...t }))}
              columns={[
                { key: 'name', label: 'Item', render: (r) => cellText(r.name) },
                { key: 'qty', label: 'Qty', width: 90, align: 'right', sortValue: (r) => r.qty, render: (r) => cellNum(num(r.qty, r.qty % 1 ? 1 : 0)) },
                { key: 'value', label: 'Sales', width: 130, align: 'right', sortValue: (r) => r.value, render: (r) => cellNum(inr(r.value, 0), true) },
              ]}
            />
          </Panel>
          {canStock && d.stock.low.length ? (
            <Panel title="Needs attention" action="Stock" onAction={() => router.push('/stock')}>
              <DataTable
                compact
                rows={d.stock.low.slice(0, 8)}
                columns={[
                  { key: 'name', label: 'Item', render: (r) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Package size={13} color={r.stock <= 0 ? c.danger : c.accent} />{cellText(`${r.name}${variantLabel(r.size, r.color) ? ` (${variantLabel(r.size, r.color)})` : ''}`)}</View> },
                  { key: 'sku', label: 'Code', width: 110, render: (r) => cellText(r.sku ?? '—') },
                  { key: 'stock', label: 'Stock', width: 110, align: 'right', render: (r) => <Pill tone={r.stock <= 0 ? 'danger' : 'warning'} label={r.stock <= 0 ? 'Out' : `${num(r.stock, r.stock % 1 ? 1 : 0)} left`} /> },
                ]}
              />
            </Panel>
          ) : null}
        </ScrollView>

        {/* Right: payment mix, alerts, recent bills */}
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <Panel title="How customers paid">
            {!d.byMode.length ? (
              <View style={{ padding: 18 }}><T style={[dtext.cell, { color: c.inkMute }]}>Nothing collected {range === 'today' ? 'yet today' : 'in this period'}.</T></View>
            ) : (
              <View style={{ padding: 16, alignItems: 'center', gap: 12 }}>
                <Donut slices={d.byMode.map(([m, v]) => ({ label: m, value: Math.max(0, v), color: modeColor(m) }))} size={104} thickness={13}
                  center={<View style={{ alignItems: 'center' }}><T style={[dtext.tiny, { color: c.inkMute }]}>TOTAL</T><T style={dtext.numStrong}>{inrShort(total)}</T></View>} />
                <Legend items={d.byMode.map(([m, v]) => ({ label: m, value: inrShort(v), color: modeColor(m), pct: `${Math.round((Math.max(0, v) / total) * 100)}%` }))} />
              </View>
            )}
          </Panel>
          {notices.length ? (
            <Panel title="Alerts">
              <View style={{ padding: 10, gap: 6 }}>
                {notices.map((n) => (
                  <Tap key={n.id} onPress={n.to ? () => router.push(n.to as never) : undefined} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 6, backgroundColor: c.sunken }}>
                    <Alert size={14} color={n.tone === 'danger' ? c.danger : n.tone === 'warning' ? c.warning : c.primary} />
                    <View style={{ flex: 1 }}>
                      <T style={dtext.cellStrong} numberOfLines={1}>{n.title}</T>
                      {n.body ? <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{n.body}</T> : null}
                    </View>
                  </Tap>
                ))}
              </View>
            </Panel>
          ) : null}
          <Panel title={`Recent ${labels.sales.toLowerCase()}`} action="All" onAction={() => router.push('/bills')}>
            <DataTable
              compact
              emptyLabel={`No ${labels.sales.toLowerCase()} yet`}
              rows={d.recent.slice(0, 10)}
              onRowPress={(b) => router.push({ pathname: '/bills/[id]', params: { id: b.id } })}
              rowTone={(b) => (b.total < 0 ? 'danger' : undefined)}
              columns={[
                { key: 'no', label: 'No.', width: 90, render: (r) => cellText(r.no, true) },
                { key: 'when', label: 'When', render: (r) => cellText(fmtDateTime(r.date)) },
                { key: 'mode', label: 'Paid', width: 80, render: (r) => cellText(r.payments.map((p) => p.mode).join('+') || '—') },
                { key: 'total', label: 'Total', width: 100, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
              ]}
            />
          </Panel>
        </ScrollView>
      </SplitPane>
    </DeskPage>
  )
}

function Panel({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  const { c } = useTheme()
  return (
    <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 34, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <T style={dtext.label}>{title}</T>
        <View style={{ flex: 1 }} />
        {action ? <Tap onPress={onAction}><T style={[dtext.tiny, { color: c.primary, fontWeight: '600' }]}>{action}</T></Tap> : null}
      </View>
      {children}
    </View>
  )
}
