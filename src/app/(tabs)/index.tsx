import React, { useMemo, useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { computeDashboard, DASH_RANGES, pctChange, type DashRange } from '@/domain/analytics'
import { greeting, fmtDayShort, fmtLongDate, fmtDateTime } from '@/domain/dates'
import { inr, inrShort, num } from '@/domain/money'
import { variantLabel } from '@/domain/codes'
import { UNPRICED_WARN_DAYS } from '@/domain/pricing'
import { useAnalyticsInput, useIndustry, useLabels } from '@/data/hooks'
import { useApp, useCan, useUser } from '@/data/store'
import { syncNow } from '@/data/runtime'
import { SyncPill } from '@/features/SyncPill'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card, Group, IconWell, Row, Tap } from '@/ui/primitives'
import { Segmented } from '@/ui/Inputs'
import { EmptyState, ListRow, Notice, Section, StatTile } from '@/ui/blocks'
import { AreaChart, Donut, HBars, Legend, Sparkline } from '@/ui/charts'
import { T } from '@/ui/Text'
import { Alert, Boxes, ChartColumn, Clock, Package, Percent, Plus, Receipt, ReceiptText, Scan, Tags, Truck, Users, Wallet } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

const RANGE_WORD: Record<DashRange, string> = { today: 'today', '7d': 'last 7 days', '30d': 'last 30 days' }
const VS_WORD: Record<DashRange, string> = { today: 'vs same time yesterday', '7d': 'vs previous 7 days', '30d': 'vs previous 30 days' }

export default function HomeScreen() {
  const { c, radius } = useTheme()
  const router = useRouter()
  const user = useUser()
  const store = useApp((s) => s.data.store)
  const labels = useLabels()
  const pack = useIndustry()
  const mode = useApp((s) => s.workspace?.mode)
  const canProfit = useCan('viewProfit')
  const canPos = useCan('pos')
  const canInv = useCan('inventory')
  const canBuy = useCan('purchases')
  const canExp = useCan('expenses')
  const canStock = useCan('stock')
  const canReports = useCan('reports')
  const [range, setRange] = useState<DashRange>('today')
  const [refreshing, setRefreshing] = useState(false)
  const input = useAnalyticsInput()
  const d = useMemo(() => computeDashboard(input, range), [input, range])

  const first = (user?.name ?? '').split(' ')[0]
  const spark = d.series.map((s) => s.total)
  const avg = (t: typeof d.cur) => (t.bills ? t.billsTotal / t.bills : 0)
  const total = d.byMode.reduce((s, [, v]) => s + Math.max(0, v), 0) || 1
  const modeColor = (m: string) => ({ cash: c.series[1], upi: c.series[0], card: c.series[2], credit: c.series[3] }[m] ?? c.inkMute)

  async function refresh() {
    if (mode !== 'remote') return
    setRefreshing(true)
    await syncNow()
    setRefreshing(false)
  }

  const quick = [
    canPos && { key: 'bill', label: labels.newSale, icon: <Plus size={18} color="#fff" />, tone: 'dark', go: () => router.push('/(tabs)/sell') },
    canPos && { key: 'scan', label: 'Scan', icon: <Scan size={18} color={c.primary} />, tone: 'soft', go: () => router.push('/scan') },
    canInv && { key: 'item', label: `Add ${labels.item.toLowerCase()}`, icon: <Package size={18} color={c.primary} />, tone: 'soft', go: () => router.push('/items/new') },
    canBuy && { key: 'recv', label: 'Receive stock', icon: <Truck size={18} color={c.primary} />, tone: 'soft', go: () => router.push('/purchases/new') },
    canExp && { key: 'exp', label: 'Add expense', icon: <Wallet size={18} color={c.primary} />, tone: 'soft', go: () => router.push('/expenses/new') },
  ].filter(Boolean) as Array<{ key: string; label: string; icon: React.ReactNode; tone: 'dark' | 'soft'; go: () => void }>

  const modules = [
    { label: 'Bills', icon: Receipt, to: '/bills', ok: true },
    { label: labels.items, icon: Package, to: '/(tabs)/items', ok: canInv },
    { label: 'Stock', icon: Boxes, to: '/stock', ok: canStock },
    { label: 'Purchases', icon: Truck, to: '/purchases', ok: canBuy },
    { label: labels.customers, icon: Users, to: '/customers', ok: true },
    { label: 'Expenses', icon: Wallet, to: '/expenses', ok: canExp },
    { label: 'Reports', icon: ChartColumn, to: '/(tabs)/reports', ok: canReports },
    { label: 'Day close', icon: Clock, to: '/dayclose', ok: canReports },
  ].filter((m) => m.ok)

  return (
    <Screen
      scroll={false}
      padded={false}
      header={
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, gap: 12 }}>
          <View style={{ flex: 1 }}>
            <T v="caption" tone="mute" numberOfLines={1}>{greeting()} · {store?.name}</T>
            <T v="h1" numberOfLines={1}>{first || 'Welcome'}</T>
          </View>
          <SyncPill compact />
          <Tap onPress={() => router.push('/(tabs)/more')} accessibilityLabel="Account"><Avatar name={user?.name ?? '?'} size={38} /></Tap>
        </View>
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={mode === 'remote' ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} colors={[c.primary]} /> : undefined}>
        <View style={{ paddingHorizontal: 20, gap: 0 }}>
          <Segmented<DashRange> value={range} options={DASH_RANGES} onChange={setRange} />

          {/* Hero */}
          <LinearGradient colors={c.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ marginTop: 16, borderRadius: radius.xl, padding: 20, overflow: 'hidden' }}>
            <View style={{ position: 'absolute', right: -50, top: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.07)' }} />
            <View style={{ position: 'absolute', right: 40, bottom: -90, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.05)' }} />
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="label" style={{ color: 'rgba(255,255,255,0.72)' }}>SALES · {RANGE_WORD[range].toUpperCase()}</T>
              <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.16)' }}>
                {pctChange(d.cur.sales, d.prev.sales) !== null ? <HeroDelta pct={pctChange(d.cur.sales, d.prev.sales)!} /> : <T v="micro" style={{ color: '#fff' }}>New</T>}
              </View>
            </Row>
            <T v="display" style={{ color: '#fff', marginTop: 8, fontSize: 40, lineHeight: 46 }} adjustsFontSizeToFit numberOfLines={1}>{inr(d.cur.sales, 0)}</T>
            <T v="caption" style={{ color: 'rgba(255,255,255,0.7)' }}>{pctChange(d.cur.sales, d.prev.sales) !== null ? VS_WORD[range] : `${d.cur.bills} ${labels.sales.toLowerCase()} so far`}</T>
            <View style={{ marginTop: 14, opacity: 0.95 }}><Sparkline data={spark} height={44} color="#FFFFFF" /></View>
            <View style={{ flexDirection: 'row', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.16)' }}>
              <HeroStat label={labels.sales} value={num(d.cur.bills)} />
              <HeroStat label="Units" value={num(d.cur.pieces, d.cur.pieces % 1 ? 1 : 0)} />
              <HeroStat label={`Avg ${labels.sale.toLowerCase()}`} value={inrShort(avg(d.cur))} />
            </View>
          </LinearGradient>

          {/* Quick actions */}
          {quick.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 16 }} style={{ marginHorizontal: -20 }} contentInset={{ left: 20, right: 20 }}>
              <View style={{ width: 10 }} />
              {quick.map((q) => (
                <Tap key={q.key} onPress={q.go} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: q.tone === 'dark' ? c.ink : c.surface, borderWidth: 1, borderColor: q.tone === 'dark' ? c.ink : c.line }}>
                  {q.tone === 'dark' ? <Plus size={18} color={c.bg} /> : q.icon}
                  <T v="bodyStrong" style={{ color: q.tone === 'dark' ? c.bg : c.ink, fontSize: 14 }}>{q.label}</T>
                </Tap>
              ))}
              <View style={{ width: 10 }} />
            </ScrollView>
          ) : <View style={{ height: 16 }} />}

          {/* Needs a look */}
          <View style={{ gap: 10 }}>
            {d.unpriced.count > 0 && canInv ? (
              <Notice tone={d.unpriced.overdue ? 'danger' : 'warning'} icon={<Tags size={20} color={d.unpriced.overdue ? c.danger : c.warning} />}
                title={`${d.unpriced.count} ${d.unpriced.count === 1 ? 'item needs' : 'items need'} a price`}
                body={d.unpriced.overdue ? `${d.unpriced.overdue} waiting over ${UNPRICED_WARN_DAYS} days · can’t be sold yet` : 'Can’t be sold until priced'}
                action="Price" onAction={() => router.push('/items/pricing')} />
            ) : null}
            {d.stock.lowCount > 0 && canStock ? (
              <Notice tone="accent" icon={<Alert size={20} color={c.accent} />} title={`${d.stock.lowCount} to reorder`} body={`${d.stock.outOfStock} out of stock`} action="Restock" onAction={() => router.push('/stock')} />
            ) : null}
          </View>

          {/* Tiles */}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
            <StatTile label={`Avg ${labels.sale.toLowerCase()}`} value={inr(avg(d.cur), 0)} icon={<ReceiptText size={16} color={c.primary} />} delta={pctChange(avg(d.cur), avg(d.prev))} foot={RANGE_WORD[range]} />
            {canProfit ? (
              <StatTile label="Profit" value={inrShort(d.cur.profit)} icon={<Percent size={16} color={d.cur.profit >= 0 ? c.success : c.danger} />} tone={d.cur.profit >= 0 ? 'success' : 'danger'}
                delta={pctChange(d.cur.profit, d.prev.profit)} foot={`After ${inrShort(d.cur.expenses)} expenses`} />
            ) : (
              <StatTile label="Reorder alerts" value={String(d.stock.lowCount)} icon={<Alert size={16} color={c.accent} />} tone="accent" foot={`${d.stock.outOfStock} out of stock`} />
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
            <StatTile label="Stock at cost" value={inrShort(d.stock.value)} icon={<Boxes size={16} color={c.series[3]} />} tone="primary" foot={`${num(d.stock.units, d.stock.units % 1 ? 1 : 0)} units`} onPress={canStock ? () => router.push('/stock') : undefined} />
            <StatTile label="Expenses" value={inrShort(d.cur.expenses)} icon={<Wallet size={16} color={c.warning} />} tone="warning" delta={pctChange(d.cur.expenses, d.prev.expenses)} deltaInvert foot={RANGE_WORD[range]} onPress={canExp ? () => router.push('/expenses') : undefined} />
          </View>

          {/* Trend */}
          <Section title={`${labels.sales} trend`} action={canReports ? 'Reports' : undefined} onAction={() => router.push('/(tabs)/reports')}>
            <Card>
              {!d.hasAnyBills ? (
                <EmptyState compact icon={<ReceiptText size={26} color={c.primary} />} title={`No ${labels.sales.toLowerCase()} yet`} hint={`Your first ${labels.sale.toLowerCase()} starts the trend line.`} />
              ) : (
                <AreaChart data={d.series.map((s) => ({ label: fmtDayShort(s.start), value: s.total, note: `${s.bills} ${s.bills === 1 ? labels.sale.toLowerCase() : labels.sales.toLowerCase()}` }))} format={(n) => inr(n, 0)} axisFormat={inrShort} />
              )}
            </Card>
          </Section>

          {/* How paid */}
          <Section title="How customers paid">
            <Card>
              {!d.byMode.length ? <T tone="mute">Nothing collected {range === 'today' ? 'yet today' : 'in this period'}.</T> : (
                <Row gap={18} style={{ alignItems: 'center' }}>
                  <Donut slices={d.byMode.map(([m, v]) => ({ label: m, value: Math.max(0, v), color: modeColor(m) }))} size={124} thickness={15}
                    center={<View style={{ alignItems: 'center' }}><T v="micro" tone="mute">TOTAL</T><T v="num" style={{ fontSize: 15 }}>{inrShort(total)}</T></View>} />
                  <Legend items={d.byMode.map(([m, v]) => ({ label: m, value: inrShort(v), color: modeColor(m), pct: `${Math.round((Math.max(0, v) / total) * 100)}%` }))} />
                </Row>
              )}
            </Card>
          </Section>

          {/* Top sellers */}
          <Section title="Top sellers" action={canReports ? 'All' : undefined} onAction={() => router.push('/(tabs)/reports')}>
            <Card>
              {!d.topItems.length ? <T tone="mute">No sales in this period.</T> : (
                <HBars items={d.topItems.map((t) => ({ label: t.name, value: t.value, sub: `${num(t.qty, t.qty % 1 ? 1 : 0)} sold` }))} format={(n) => inr(n, 0)} color={c.series[2]} />
              )}
            </Card>
          </Section>

          {/* Needs attention */}
          {canStock && d.stock.low.length ? (
            <Section title="Needs attention" action="Stock" onAction={() => router.push('/stock')}>
              <Group>
                {d.stock.low.slice(0, 5).map((v) => (
                  <ListRow key={v.id} icon={<Package size={18} color={v.stock <= 0 ? c.danger : c.accent} />} iconTone={v.stock <= 0 ? 'danger' : 'accent'} title={v.name}
                    subtitle={[variantLabel(v.size, v.color), v.sku].filter(Boolean).join(' · ')}
                    badge={<Badge tone={v.stock <= 0 ? 'danger' : 'warning'}>{v.stock <= 0 ? 'Out' : `${num(v.stock, v.stock % 1 ? 1 : 0)} left`}</Badge>} />
                ))}
              </Group>
            </Section>
          ) : null}

          {/* Recent */}
          <Section title={`Recent ${labels.sales.toLowerCase()}`} action="All" onAction={() => router.push('/bills')}>
            {!d.recent.length ? (
              <Card><EmptyState compact icon={<Receipt size={26} color={c.primary} />} title={`No ${labels.sales.toLowerCase()} yet`} /></Card>
            ) : (
              <Group>
                {d.recent.slice(0, 6).map((b) => (
                  <ListRow key={b.id} icon={<ReceiptText size={18} color={b.total < 0 ? c.danger : c.primary} />} iconTone={b.total < 0 ? 'danger' : 'primary'} title={b.no}
                    subtitle={`${fmtDateTime(b.date)} · ${b.payments.map((p) => p.mode).join(' + ') || '—'}`} value={inr(b.total, 0)} valueTone={b.total < 0 ? 'danger' : 'default'} onPress={() => router.push({ pathname: '/bills/[id]', params: { id: b.id } })} />
                ))}
              </Group>
            )}
          </Section>

          {/* Modules */}
          <Section title="Everything else">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {modules.map((m) => (
                <Tap key={m.label} onPress={() => router.push(m.to as never)} style={{ width: '23%', flexGrow: 1, alignItems: 'center', gap: 8, paddingVertical: 14, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
                  <IconWell tone="primary" size={38}><m.icon size={19} color={c.primary} /></IconWell>
                  <T v="micro" style={{ fontSize: 11.5 }} numberOfLines={1}>{m.label}</T>
                </Tap>
              ))}
            </View>
          </Section>
          <T v="caption" tone="mute" align="center" style={{ marginTop: 22 }}>{pack.name} · {mode === 'remote' ? 'Connected' : 'Stored on this phone'}</T>
        </View>
      </ScrollView>
    </Screen>
  )
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <T v="micro" style={{ color: 'rgba(255,255,255,0.65)' }} numberOfLines={1}>{label}</T>
      <T v="numLg" style={{ color: '#fff', fontSize: 19 }} numberOfLines={1}>{value}</T>
    </View>
  )
}

function HeroDelta({ pct }: { pct: number }) {
  return <T v="micro" style={{ color: '#fff' }}>{pct >= 0 ? '▲' : '▼'} {Math.abs(Math.round(pct * 10) / 10)}%</T>
}
