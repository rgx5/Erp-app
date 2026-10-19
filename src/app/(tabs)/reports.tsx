import React, { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { useRouter } from 'expo-router'
import { computeReport, pctChange, type ReportAgg } from '@/domain/analytics'
import { toCsv, csvFileName } from '@/domain/csv'
import { DAY, endOfDay, fmtDate, fmtDayShort, fromInputDate, rangeBounds, startOfDay, toInputDate } from '@/domain/dates'
import { inr, inr0, inrShort, num, round2 } from '@/domain/money'
import { fmtQty } from '@/domain/qty'
import { reportRows, SECTION_LABEL, type ReportSection } from '@/domain/reportCsv'
import { useAnalyticsInput, useLabels, useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { Button } from '@/ui/Button'
import { Field, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Card, Chip, Group, IconWell, Row } from '@/ui/primitives'
import { EmptyState, KV, ListRow, Notice, Section, StatTile } from '@/ui/blocks'
import { AreaChart, Donut, HBars, Legend } from '@/ui/charts'
import { T } from '@/ui/Text'
import { ChartColumn, Clock, Download, Lock, Percent, Receipt, Rupee, TrendingUp, Users } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type RangeId = 'today' | 'yesterday' | '7d' | 'month' | 'lastmonth' | 'custom'

const RANGES: Array<{ id: RangeId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: '7 days' },
  { id: 'month', label: 'This month' },
  { id: 'lastmonth', label: 'Last month' },
  { id: 'custom', label: 'Custom' },
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const validDate = (s: string) => DATE_RE.test(s) && toInputDate(fromInputDate(s)) === s

function bounds(id: RangeId, customFrom: string, customTo: string, now: number): [number, number] | null {
  switch (id) {
    case 'today': return rangeBounds('today', now)
    case 'yesterday': return [startOfDay(now - DAY), endOfDay(now - DAY)]
    case '7d': return rangeBounds('7d', now)
    case 'month': return rangeBounds('month', now)
    case 'lastmonth': {
      const d = new Date(now)
      return [new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), endOfDay(new Date(d.getFullYear(), d.getMonth(), 0).getTime())]
    }
    default: {
      if (!validDate(customFrom) || !validDate(customTo)) return null
      const a = startOfDay(fromInputDate(customFrom)), b = endOfDay(fromInputDate(customTo))
      return a <= b ? [a, b] : null
    }
  }
}

const rangeTitle = (from: number, to: number) => (startOfDay(from) === startOfDay(to) ? fmtDate(from) : `${fmtDayShort(from)} – ${fmtDate(to)}`)

export default function Reports() {
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const allowed = useCan('reports')
  const canProfit = useCan('viewProfit')
  const input = useAnalyticsInput()
  const users = useList('users')

  const [rangeId, setRangeId] = useState<RangeId>('7d')
  const [customFrom, setCustomFrom] = useState(() => toInputDate(Date.now() - 6 * DAY))
  const [customTo, setCustomTo] = useState(() => toInputDate(Date.now()))
  const [section, setSection] = useState<ReportSection>('sales')
  const [itemSort, setItemSort] = useState<'qty' | 'sales' | 'profit'>('qty')
  const [showAll, setShowAll] = useState(false)

  const range = useMemo(() => bounds(rangeId, customFrom, customTo, Date.now()), [rangeId, customFrom, customTo])
  const report = useMemo(() => (allowed && range ? computeReport(input, users, range[0], range[1]) : null), [allowed, range, input, users])
  const prev = useMemo(() => {
    if (!allowed || !range) return null
    const len = range[1] - range[0] + 1
    return computeReport(input, users, range[0] - len, range[0] - 1)
  }, [allowed, range, input, users])

  if (!allowed) {
    return (
      <Screen large title="Reports">
        <EmptyState icon={<Lock size={26} color={c.primary} />} title="Reports are for managers and owners" hint="Ask the owner to sign you in with a manager account to see sales, GST and profit." />
      </Screen>
    )
  }

  const sections: Array<{ value: ReportSection; label: string }> = (['sales', 'gst', 'profit', 'items', 'staff'] as ReportSection[])
    .filter((s) => s !== 'profit' || canProfit)
    .map((s) => ({ value: s, label: SECTION_LABEL[s] }))
  const active: ReportSection = sections.some((s) => s.value === section) ? section : 'sales'

  async function exportCsv() {
    if (!report || !range) return
    const title = `${SECTION_LABEL[active]} ${rangeTitle(range[0], range[1])}`
    const rows = [[title], ...reportRows(active, report, { profit: canProfit, itemLabel: labels.item, staffLabel: labels.staff })]
    await shareFile(csvFileName(title), toCsv(rows), 'text/csv')
  }

  return (
    <Screen large title="Reports" subtitle={range ? rangeTitle(range[0], range[1]) : 'Choose a valid date range'}>
      <View style={{ gap: 12, paddingBottom: 6 }}>
        <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} data={RANGES} keyExtractor={(r) => r.id}
          renderItem={({ item }) => <Chip label={item.label} selected={rangeId === item.id} onPress={() => { setRangeId(item.id); setShowAll(false) }} />} />
        {rangeId === 'custom' ? (
          <Card flat>
            <Row gap={12} align="flex-start">
              <View style={{ flex: 1 }}><Field label="From" value={customFrom} onChangeText={setCustomFrom} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} error={customFrom && !validDate(customFrom) ? 'Use YYYY-MM-DD' : null} /></View>
              <View style={{ flex: 1 }}><Field label="To" value={customTo} onChangeText={setCustomTo} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} error={customTo && !validDate(customTo) ? 'Use YYYY-MM-DD' : null} /></View>
            </Row>
            {validDate(customFrom) && validDate(customTo) && !range ? <T v="caption" tone="danger" style={{ marginTop: 8 }}>The start date must be on or before the end date.</T> : null}
          </Card>
        ) : null}
        <Segmented<ReportSection> compact value={active} onChange={(s) => { setSection(s); setShowAll(false) }} options={sections} />
      </View>

      {!report || !range ? (
        <EmptyState icon={<Clock size={26} color={c.primary} />} title="Pick a date range" hint="Enter the first and last day as YYYY-MM-DD, for example 2026-04-01." compact />
      ) : (
        <View style={{ gap: 4, paddingBottom: 12 }}>
          {active === 'sales' ? <SalesSection r={report} p={prev} /> : null}
          {active === 'gst' ? <GstSection r={report} /> : null}
          {active === 'profit' && canProfit ? <ProfitSection r={report} p={prev} /> : null}
          {active === 'items' ? <ItemsSection r={report} sort={itemSort} onSort={setItemSort} showAll={showAll} onShowAll={() => setShowAll(true)} canProfit={canProfit} itemsLabel={labels.items} /> : null}
          {active === 'staff' ? <StaffSection r={report} label={labels.staff} /> : null}

          <View style={{ marginTop: 18, gap: 12 }}>
            <Button label={`Export ${SECTION_LABEL[active]} as CSV`} kind="outline" block icon={<Download size={18} color={c.ink} />} onPress={exportCsv} />
            <Card onPress={() => router.push('/dayclose')} flat>
              <Row gap={12}>
                <IconWell tone="accent"><Clock size={20} color={c.accent} /></IconWell>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong">Day close</T>
                  <T v="caption" tone="mute">Count the drawer and close today’s cash</T>
                </View>
              </Row>
            </Card>
          </View>
        </View>
      )}
    </Screen>
  )
}

// ───────────────────────────── Sales ─────────────────────────────

function SalesSection({ r, p }: { r: ReportAgg; p: ReportAgg | null }) {
  const { c } = useTheme()
  const avg = r.positive ? r.positiveTotal / r.positive : 0
  const prevAvg = p && p.positive ? p.positiveTotal / p.positive : 0
  const total = r.modes.reduce((s, [, v]) => s + Math.max(0, v), 0) || 1
  const modeColor = (m: string) => ({ cash: c.series[1], upi: c.series[0], card: c.series[2], credit: c.series[3] }[m] ?? c.inkMute)
  const multiDay = r.daily.length > 1

  return (
    <View style={{ gap: 12 }}>
      <Row gap={12} align="stretch">
        <StatTile label="Sales" value={inrShort(r.revenue)} icon={<Rupee size={16} color={c.primary} />} delta={p ? pctChange(r.revenue, p.revenue) : undefined} foot="vs previous" />
        <StatTile label="Bills" value={num(r.positive)} tone="success" icon={<Receipt size={16} color={c.success} />} delta={p ? pctChange(r.positive, p.positive) : undefined} foot={r.credits ? `${r.credits} returns` : 'no returns'} />
      </Row>
      <Row gap={12} align="stretch">
        <StatTile label="Average bill" value={inr0(avg)} tone="accent" icon={<TrendingUp size={16} color={c.accent} />} delta={p ? pctChange(avg, prevAvg) : undefined} />
        <StatTile label="Pieces sold" value={fmtQty(r.qty)} tone="primary" icon={<ChartColumn size={16} color={c.primary} />} foot={r.discount ? `${inr0(r.discount)} discounts` : undefined} />
      </Row>

      {multiDay ? (
        <Section title="Daily sales" style={{ marginTop: 10 }}>
          <Card>
            <AreaChart data={r.daily.map((d) => ({ label: fmtDayShort(d.start), value: d.total, note: `${d.bills} ${d.bills === 1 ? 'bill' : 'bills'}` }))} format={inr0} axisFormat={inrShort} />
          </Card>
        </Section>
      ) : null}

      <Section title="How customers paid" style={{ marginTop: 10 }}>
        <Card>
          {r.modes.length ? (
            <Row gap={18}>
              <Donut slices={r.modes.map(([m, v]) => ({ label: m, value: v, color: modeColor(m) }))} size={118} thickness={15} center={<View style={{ alignItems: 'center' }}><T v="micro" tone="mute">Total</T><T v="num" style={{ fontSize: 14 }}>{inrShort(total)}</T></View>} />
              <Legend items={r.modes.map(([m, v]) => ({ label: m, value: inr0(v), color: modeColor(m), pct: `${Math.round((Math.max(0, v) / total) * 100)}%` }))} />
            </Row>
          ) : <T tone="mute">No payments in this period.</T>}
        </Card>
      </Section>

      <Section title="Summary" style={{ marginTop: 10 }}>
        <Card>
          <KV k="Sales including GST" v={inr(r.revenue)} strong />
          <KV k="Before GST" v={inr(r.net)} />
          <KV k="GST collected" v={inr(r.gst)} />
          <KV k="Discounts given" v={inr(r.discount)} />
          <KV k="Returns" v={r.credits ? `${r.credits} · ${inr(Math.abs(r.creditTotal))}` : 'None'} tone={r.credits ? 'danger' : undefined} />
        </Card>
      </Section>
    </View>
  )
}

// ───────────────────────────── GST ─────────────────────────────

function GstSection({ r }: { r: ReportAgg }) {
  const { c } = useTheme()
  const payable = round2(r.gst - r.gstPaid)
  return (
    <View style={{ gap: 12 }}>
      <Row gap={12} align="stretch">
        <StatTile label="GST collected" value={inrShort(r.gst)} icon={<Percent size={16} color={c.primary} />} foot="CGST + SGST" />
        <StatTile label="Taxable value" value={inrShort(r.net)} tone="success" icon={<Rupee size={16} color={c.success} />} foot="sales before GST" />
      </Row>
      <Card tone={payable > 0 ? 'warning' : 'success'} flat>
        <Row gap={12}>
          <View style={{ flex: 1 }}>
            <T v="label" tone={payable > 0 ? 'warning' : 'success'}>{payable > 0 ? 'STILL TO PAY' : 'SETTLED'}</T>
            <T v="caption" tone="soft">{r.gstPaid > 0 ? `${inr0(r.gstPaid)} paid to the government in this period` : 'No GST payment recorded in this period'}</T>
          </View>
          <T v="numLg" tone={payable > 0 ? 'warning' : 'success'}>{inr0(Math.max(0, payable))}</T>
        </Row>
      </Card>

      <Section title="By GST rate" style={{ marginTop: 10 }}>
        {r.rates.length ? (
          <Group>
            {r.rates.map((x) => (
              <ListRow key={x.rate} dense icon={<Percent size={18} color={c.primary} />} title={`${x.rate}% GST`} subtitle={`Taxable ${inr0(x.taxable)} · CGST ${inr(x.cgst)} · SGST ${inr(x.sgst)}`} value={inr(round2(x.cgst + x.sgst))} />
            ))}
          </Group>
        ) : <T tone="mute">No taxable sales in this period.</T>}
      </Section>

      <Section title="By HSN code" style={{ marginTop: 10 }}>
        {r.hsn.length ? (
          <Group>
            {r.hsn.map((h) => (
              <ListRow key={`${h.hsn}|${h.rate}`} dense title={`HSN ${h.hsn}`} subtitle={`${h.rate}% · qty ${fmtQty(h.qty)} · taxable ${inr0(h.taxable)}`} value={inr(round2(h.cgst + h.sgst))} sub="tax" />
            ))}
          </Group>
        ) : <T tone="mute">No sales in this period.</T>}
      </Section>
      <T v="caption" tone="mute" style={{ marginTop: 6 }}>Returns are subtracted, so these figures match what you file. The export has both tables for your accountant.</T>
    </View>
  )
}

// ───────────────────────────── Profit ─────────────────────────────

function ProfitSection({ r, p }: { r: ReportAgg; p: ReportAgg | null }) {
  const { c } = useTheme()
  const margin = r.net > 0 ? (r.grossProfit / r.net) * 100 : 0
  const cats = r.expenseByCategory
  return (
    <View style={{ gap: 12 }}>
      <Row gap={12} align="stretch">
        <StatTile label="Gross profit" value={inrShort(r.grossProfit)} icon={<TrendingUp size={16} color={c.success} />} tone="success" delta={p ? pctChange(r.grossProfit, p.grossProfit) : undefined} foot={`${margin.toFixed(1)}% margin`} />
        <StatTile label="Net profit" value={inrShort(r.netProfit)} icon={<Rupee size={16} color={r.netProfit < 0 ? c.danger : c.primary} />} tone={r.netProfit < 0 ? 'danger' : 'primary'} delta={p ? pctChange(r.netProfit, p.netProfit) : undefined} foot="after expenses" />
      </Row>
      <Section title="Where the money went" style={{ marginTop: 10 }}>
        <Card>
          <KV k="Sales before GST" v={inr(r.net)} strong />
          <KV k="Cost of goods sold" v={`-${inr(r.cogs)}`} />
          <KV k="Gross profit" v={inr(r.grossProfit)} strong tone={r.grossProfit < 0 ? 'danger' : undefined} />
          <KV k="Expenses" v={`-${inr(r.expenses)}`} />
          <KV k="Net profit" v={inr(r.netProfit)} big tone={r.netProfit < 0 ? 'danger' : 'success'} />
        </Card>
      </Section>
      <Section title="Expenses by category" style={{ marginTop: 10 }}>
        <Card>
          {cats.length ? <HBars items={cats.slice(0, 8).map(([label, value], i) => ({ label, value, color: c.series[i % c.series.length] }))} format={inr0} /> : <T tone="mute">No expenses in this period.</T>}
        </Card>
      </Section>
      {r.gstPaid > 0 ? <Notice tone="primary" title={`${inr0(r.gstPaid)} GST payment left out`} body="Paying GST settles tax you collected for the government. It is not a cost, so it is not counted in expenses." /> : null}
      <T v="caption" tone="mute">Cost uses each item’s purchase cost at the time of sale. Items without a cost count as zero, which makes profit look higher.</T>
    </View>
  )
}

// ───────────────────────────── Items ─────────────────────────────

function ItemsSection({ r, sort, onSort, showAll, onShowAll, canProfit, itemsLabel }: { r: ReportAgg; sort: 'qty' | 'sales' | 'profit'; onSort: (s: 'qty' | 'sales' | 'profit') => void; showAll: boolean; onShowAll: () => void; canProfit: boolean; itemsLabel: string }) {
  const { c } = useTheme()
  const sorted = useMemo(() => {
    const rows = r.items.filter((i) => i.qty !== 0 || i.revenue !== 0)
    const key = (i: ReportAgg['items'][number]) => (sort === 'qty' ? i.qty : sort === 'sales' ? i.revenue : i.revenue - i.cost)
    return [...rows].sort((a, b) => key(b) - key(a))
  }, [r.items, sort])
  const shown = showAll ? sorted : sorted.slice(0, 15)
  const opts = [{ value: 'qty' as const, label: 'Most sold' }, { value: 'sales' as const, label: 'Sales' }, ...(canProfit ? [{ value: 'profit' as const, label: 'Profit' }] : [])]
  const effective = opts.some((o) => o.value === sort) ? sort : 'qty'

  if (!sorted.length) return <EmptyState icon={<ChartColumn size={26} color={c.primary} />} title={`No ${itemsLabel.toLowerCase()} sold`} hint="Nothing was sold in this period." compact />
  return (
    <View style={{ gap: 12 }}>
      <Segmented compact value={effective} onChange={onSort} options={opts} />
      <Card>
        <HBars
          items={sorted.slice(0, 6).map((i) => ({
            label: i.variant ? `${i.name} · ${i.variant}` : i.name,
            value: effective === 'qty' ? i.qty : effective === 'sales' ? i.revenue : i.revenue - i.cost,
            sub: effective === 'qty' ? `${inr0(i.revenue)} sales` : `${fmtQty(i.qty)} sold`,
          }))}
          format={effective === 'qty' ? (n) => fmtQty(n) : inr0}
        />
      </Card>
      <Section title={`All ${itemsLabel.toLowerCase()} · ${sorted.length}`} style={{ marginTop: 10 }}>
        <Group>
          {shown.map((i) => {
            const profit = i.revenue - i.cost
            const pct = i.revenue > 0 ? (profit / i.revenue) * 100 : 0
            return (
              <ListRow key={i.id} dense title={i.name} subtitle={[i.variant, i.sku].filter(Boolean).join(' · ')} value={inr0(i.revenue)} sub={`${fmtQty(i.qty)} sold`}
                badge={canProfit && i.revenue > 0 ? <Badge tone={pct < 0 ? 'danger' : pct < 15 ? 'warning' : 'success'}>{Math.round(pct)}%</Badge> : undefined} />
            )
          })}
        </Group>
        {!showAll && sorted.length > shown.length ? <View style={{ marginTop: 12 }}><Button label={`Show all ${sorted.length}`} kind="soft" block onPress={onShowAll} /></View> : null}
      </Section>
    </View>
  )
}

// ───────────────────────────── Staff ─────────────────────────────

function StaffSection({ r, label }: { r: ReportAgg; label: string }) {
  const { c } = useTheme()
  if (!r.staff.length) return <EmptyState icon={<Users size={26} color={c.primary} />} title={`No ${label.toLowerCase()} sales`} hint="Nothing was sold in this period." compact />
  const total = r.staff.reduce((s, x) => s + Math.max(0, x.revenue), 0) || 1
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <HBars items={r.staff.map((s, i) => ({ label: s.user?.name ?? 'Former staff', value: s.revenue, color: c.series[i % c.series.length], sub: `${s.bills} ${s.bills === 1 ? 'bill' : 'bills'} · ${fmtQty(s.qty)} sold` }))} format={inr0} />
      </Card>
      <Section title={`${label} breakdown`} style={{ marginTop: 10 }}>
        <Group>
          {r.staff.map((s) => (
            <ListRow key={s.userId} avatar={s.user?.name ?? 'Former staff'} title={s.user?.name ?? 'Former staff'} subtitle={`${Math.round((Math.max(0, s.revenue) / total) * 100)}% of sales${s.discount ? ` · ${inr0(s.discount)} discounts` : ''}`} value={inr0(s.revenue)} sub={`${s.bills} ${s.bills === 1 ? 'bill' : 'bills'}`} />
          ))}
        </Group>
      </Section>
      <T v="caption" tone="mute">Each item counts for whoever sold it, so a bill shared between two people is split between them.</T>
    </View>
  )
}
