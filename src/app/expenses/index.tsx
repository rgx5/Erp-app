import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { GST_PAYMENT_CATEGORY, pctChange } from '@/domain/analytics'
import { DAY, dayLabel, fmtMonth, startOfDay } from '@/domain/dates'
import { inr, inr0, inrShort, round2 } from '@/domain/money'
import type { Expense, ExpenseMode } from '@/domain/types'
import { useIndustry, useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card, Chip, IconWell, Tap } from '@/ui/primitives'
import { Delta, EmptyState } from '@/ui/blocks'
import { Donut, Legend } from '@/ui/charts'
import { T } from '@/ui/Text'
import { Banknote, ChevronRight, CreditCard, Landmark, Plus, QrCode, Wallet } from '@/ui/icons'
import { toneColor, useTheme, type Tone } from '@/ui/theme'

type Period = 'month' | 'last' | '90d' | 'all'

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'month', label: 'This month' }, { value: 'last', label: 'Last month' }, { value: '90d', label: '90 days' }, { value: 'all', label: 'All time' },
]

const MODE_ICON = { cash: Banknote, upi: QrCode, card: CreditCard, bank: Landmark }
const MODE_TONE: Record<ExpenseMode, Tone> = { cash: 'success', upi: 'primary', card: 'accent', bank: 'default' }
const MODE_LABEL: Record<ExpenseMode, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank' }

const monthStart = (ms: number, back = 0) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth() - back, 1).getTime() }

function bounds(p: Period, now: number): [number, number] {
  if (p === 'month') return [monthStart(now), Number.POSITIVE_INFINITY]
  if (p === 'last') return [monthStart(now, 1), monthStart(now) - 1]
  if (p === '90d') return [startOfDay(now - 89 * DAY), Number.POSITIVE_INFINITY]
  return [0, Number.POSITIVE_INFINITY]
}

type Row = { kind: 'head'; key: string; label: string; total: number; count: number } | { kind: 'row'; key: string; e: Expense }

export default function Expenses() {
  const { c } = useTheme()
  const router = useRouter()
  const pack = useIndustry()
  const canExp = useCan('expenses')
  const expenses = useList('expenses')
  const [period, setPeriod] = useState<Period>('month')
  const [cat, setCat] = useState('')

  const now = useMemo(() => Date.now(), [])
  const [from, to] = bounds(period, now)
  const inPeriod = useMemo(() => expenses.filter((e) => e.date >= from && e.date <= to).sort((a, b) => b.date - a.date), [expenses, from, to])

  // Tax paid to the government is money out, but it is not a running cost of the business, so it is kept apart in the totals.
  const costs = useMemo(() => inPeriod.filter((e) => e.category !== GST_PAYMENT_CATEGORY), [inPeriod])
  const gstPaid = useMemo(() => round2(inPeriod.filter((e) => e.category === GST_PAYMENT_CATEGORY).reduce((s, e) => s + e.amount, 0)), [inPeriod])
  const total = useMemo(() => round2(costs.reduce((s, e) => s + e.amount, 0)), [costs])

  // The month so far, against the same stretch of last month.
  const delta = useMemo(() => {
    if (period !== 'month') return null
    const prevFrom = monthStart(now, 1)
    const prevTo = Math.min(monthStart(now) - 1, prevFrom + (now - monthStart(now)))
    const prev = expenses.filter((e) => e.category !== GST_PAYMENT_CATEGORY && e.date >= prevFrom && e.date <= prevTo).reduce((s, e) => s + e.amount, 0)
    return pctChange(total, round2(prev))
  }, [expenses, period, total, now])

  const byCat = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>()
    for (const e of inPeriod) { const cur = m.get(e.category) ?? { total: 0, count: 0 }; m.set(e.category, { total: round2(cur.total + e.amount), count: cur.count + 1 }) }
    // The industry's own categories lead, in its order; anything else the books hold follows by size.
    const order = new Map(pack.expenseCategories.map((n, i) => [n, i]))
    return [...m.entries()].sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999) || b[1].total - a[1].total)
  }, [inPeriod, pack.expenseCategories])

  const slices = useMemo(() => {
    const ranked = byCat.filter(([name]) => name !== GST_PAYMENT_CATEGORY).sort((a, b) => b[1].total - a[1].total)
    const top = ranked.slice(0, 5).map(([name, v], i) => ({ label: name, value: v.total, color: c.series[i % c.series.length] }))
    const rest = round2(ranked.slice(5).reduce((s, [, v]) => s + v.total, 0))
    return rest > 0 ? [...top, { label: 'Other', value: rest, color: c.inkMute }] : top
  }, [byCat, c.series, c.inkMute])

  const shown = useMemo(() => (cat ? inPeriod.filter((e) => e.category === cat) : inPeriod), [inPeriod, cat])
  const shownTotal = useMemo(() => round2(shown.reduce((s, e) => s + e.amount, 0)), [shown])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const multi = period === '90d' || period === 'all'
    let key = ''
    let head: Extract<Row, { kind: 'head' }> | null = null
    for (const e of shown) {
      if (multi) {
        const k = fmtMonth(e.date)
        if (k !== key) { key = k; head = { kind: 'head', key: `h${k}`, label: k, total: 0, count: 0 }; out.push(head) }
        head!.total = round2(head!.total + e.amount); head!.count++
      }
      out.push({ kind: 'row', key: e.id, e })
    }
    return out
  }, [shown, period])

  if (!canExp) return <Screen title="Expenses" back><EmptyState icon={<Wallet size={26} color={c.primary} />} title="Not available" hint="Your role cannot see expenses. Ask the owner or a manager." /></Screen>

  const header = (
    <View style={{ gap: 12, paddingBottom: 10 }}>
      <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} data={PERIODS} keyExtractor={(p) => p.value}
        renderItem={({ item }) => <Chip label={item.label} selected={period === item.value} onPress={() => { setPeriod(item.value); setCat('') }} />} />

      <Card style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ gap: 2 }}>
            <T v="label" tone="mute">SPENT · {PERIODS.find((p) => p.value === period)!.label.toUpperCase()}</T>
            <T v="display">{inr0(total)}</T>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Delta pct={delta} invert />
            <T v="caption" tone="mute">{costs.length} {costs.length === 1 ? 'entry' : 'entries'}</T>
          </View>
        </View>
        {slices.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Donut slices={slices} size={118} thickness={15} center={<T v="num" style={{ fontSize: 13 }}>{inrShort(total)}</T>} />
            <Legend items={slices.map((s) => ({ label: s.label, value: inrShort(s.value), color: s.color, pct: total > 0 ? `${Math.round((s.value / total) * 100)}%` : '' }))} />
          </View>
        ) : null}
        {gstPaid > 0 ? <T v="caption" tone="mute">Plus {inr0(gstPaid)} of GST paid to the government (not counted above).</T> : null}
      </Card>

      {byCat.length > 1 ? (
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyExtractor={(x) => x[0]} data={[['', { total, count: inPeriod.length }], ...byCat] as Array<[string, { total: number; count: number }]>}
          renderItem={({ item }) => <Chip label={item[0] || 'All'} count={item[1].count} selected={cat === item[0]} onPress={() => setCat(item[0])} />} />
      ) : null}
      {cat ? <T v="caption" tone="soft">{cat}: {shown.length} {shown.length === 1 ? 'entry' : 'entries'} · {inr(shownTotal, shownTotal % 1 ? 2 : 0)}</T> : null}
    </View>
  )

  return (
    <Screen title="Expenses" subtitle="Money going out" back scroll={false}
      right={<IconButton label="Add expense" tone="dark" onPress={() => router.push('/expenses/new')}><Plus size={22} color={c.bg} /></IconButton>}>
      <FlatList
        data={rows} keyExtractor={(r) => r.key} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }} initialNumToRender={14} windowSize={9}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState icon={<Wallet size={26} color={c.primary} />} title={cat ? `No ${cat.toLowerCase()} expenses` : 'No expenses here'}
          hint={period === 'month' ? 'Rent, wages, electricity — add what you spend so profit is worked out properly.' : 'Nothing recorded in this period.'} action="Add expense" onAction={() => router.push('/expenses/new')} />}
        renderItem={({ item }) => {
          if (item.kind === 'head') {
            return (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 6, paddingHorizontal: 2 }}>
                <T v="label" tone="soft">{item.label.toUpperCase()}</T>
                <T v="caption" tone="mute">{item.count} · {inr0(item.total)}</T>
              </View>
            )
          }
          const e = item.e
          const Icon = MODE_ICON[e.mode] ?? Banknote
          return (
            <Tap onPress={() => router.push({ pathname: '/expenses/new', params: { id: e.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
              <IconWell tone={MODE_TONE[e.mode] ?? 'default'}><Icon size={19} color={toneColor(c, MODE_TONE[e.mode] ?? 'default')} /></IconWell>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <T v="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{e.category}</T>
                  {e.recurring ? <Badge>Regular</Badge> : null}
                </View>
                <T v="caption" tone="mute" numberOfLines={1}>{[dayLabel(e.date), MODE_LABEL[e.mode], e.vendor || e.note].filter(Boolean).join(' · ')}</T>
              </View>
              <T v="num">{inr(e.amount, e.amount % 1 ? 2 : 0)}</T>
              <ChevronRight size={16} color={c.inkMute} />
            </Tap>
          )
        }}
      />
    </Screen>
  )
}
