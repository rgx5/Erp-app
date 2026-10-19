import type { Bill, DaySession, Expense, Product, StoreSettings, User, Variant } from './types'
import { billFigures } from './figures'
import { hsnSummary, rateSummary } from './tax'
import { round2 } from './money'
import { round3 } from './qty'
import { DAY, fmtDayShort, startOfDay } from './dates'
import { costFor, isOverdue, needsPricing, unpricedDays } from './pricing'
import { variantLabel } from './codes'

/** Expense category used for GST paid to the government — a liability settlement, kept out of profit. */
export const GST_PAYMENT_CATEGORY = 'GST / Taxes'

export interface AnalyticsInput {
  bills: Bill[]
  expenses: Expense[]
  variants: Variant[]
  products: Product[]
  store: Pick<StoreSettings, 'costBasis'> | null
}

export type DashRange = 'today' | '7d' | '30d'
export const DASH_RANGES: Array<{ value: DashRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]
export const RANGE_DAYS: Record<DashRange, number> = { today: 1, '7d': 7, '30d': 30 }

/** `sales` is what customers paid (GST included); `net` is sales excluding GST, which is what profit is worked out on. */
export interface PeriodTotals {
  sales: number
  net: number
  bills: number
  pieces: number
  cost: number
  expenses: number
  profit: number
  /** Total of the sale bills alone (returns not taken off) — the figure "average bill" is worked out from. */
  billsTotal: number
}

export interface DashboardData {
  cur: PeriodTotals
  prev: PeriodTotals
  series: Array<{ start: number; label: string; total: number; bills: number }>
  byMode: Array<[string, number]>
  topItems: Array<{ name: string; qty: number; value: number }>
  recent: Bill[]
  stock: {
    value: number
    units: number
    outOfStock: number
    lowCount: number
    low: Array<{ id: string; name: string; sku: string; size: string; color: string; stock: number; reorderLevel: number }>
  }
  /** Items received but still without a selling price. `overdue` have waited longer than the warning period. */
  unpriced: { count: number; overdue: number; oldestDays: number }
  hasAnyBills: boolean
}

const blank = (): PeriodTotals => ({ sales: 0, net: 0, bills: 0, pieces: 0, cost: 0, expenses: 0, profit: 0, billsTotal: 0 })

/**
 * Everything the home dashboard shows, computed in a single pass over the period's bills. The comparison window is the
 * same length shifted back, ending at the same clock time — so a half-finished trading day isn't compared with a full one.
 */
export function computeDashboard(input: AnalyticsInput, range: DashRange, now = Date.now()): DashboardData {
  const n = RANGE_DAYS[range]
  const curStart = startOfDay(now - (n - 1) * DAY)
  const prevStart = curStart - n * DAY
  const prevEnd = now - n * DAY
  const chartDays = Math.max(n, 7)
  const chartStart = startOfDay(now - (chartDays - 1) * DAY)
  const since = Math.min(prevStart, chartStart)
  const basis = input.store?.costBasis

  const costOf = new Map<string, number>()
  for (const v of input.variants) costOf.set(v.id, costFor(v, basis))

  const cur = blank()
  const prev = blank()
  const modes = new Map<string, number>()
  const items = new Map<string, { name: string; qty: number; value: number }>()
  const series = Array.from({ length: chartDays }, (_, i) => {
    const start = chartStart + i * DAY
    return { start, label: fmtDayShort(start), total: 0, bills: 0 }
  })

  const live = input.bills.filter((b) => b.status !== 'held')
  for (const b of live) {
    if (b.date < since) continue
    const inCur = b.date >= curStart && b.date <= now
    const inPrev = b.date >= prevStart && b.date <= prevEnd
    const t: PeriodTotals | null = inCur ? cur : inPrev ? prev : null
    const f = billFigures(b, (vid) => costOf.get(vid) ?? 0)
    if (t) {
      t.sales += b.total
      t.net += f.net
      t.pieces += f.pieces
      t.cost += f.cost
      if (b.total > 0) { t.bills++; t.billsTotal += b.total }
    }
    if (inCur) {
      for (const p of b.payments) modes.set(p.mode, (modes.get(p.mode) ?? 0) + p.amount)
      // Returns count against the item, so top sellers agree with the Items report.
      for (const it of b.items) {
        const row = items.get(it.name) ?? { name: it.name, qty: 0, value: 0 }
        row.qty += it.qty * f.sign
        row.value += it.lineTotal * f.sign
        items.set(it.name, row)
      }
    }
    const idx = Math.floor((startOfDay(b.date) - chartStart) / DAY)
    if (idx >= 0 && idx < chartDays) {
      series[idx].total += b.total
      if (b.total > 0) series[idx].bills++
    }
  }

  for (const e of input.expenses) {
    // Paying GST to the government settles a liability — it is not a cost of running the business.
    if (e.category === GST_PAYMENT_CATEGORY) continue
    if (e.date >= curStart && e.date <= now) cur.expenses += e.amount
    else if (e.date >= prevStart && e.date <= prevEnd) prev.expenses += e.amount
  }
  for (const t of [cur, prev]) {
    t.sales = round2(t.sales); t.billsTotal = round2(t.billsTotal); t.net = round2(t.net); t.cost = round2(t.cost); t.expenses = round2(t.expenses)
    t.profit = round2(t.net - t.cost - t.expenses)
  }

  const pmap = new Map(input.products.map((p) => [p.id, p]))
  let value = 0
  let units = 0
  let outOfStock = 0
  let unpricedCount = 0, overdue = 0, oldestDays = 0
  const lowVariants: Variant[] = []
  for (const v of input.variants) {
    const p = pmap.get(v.productId)
    if (p && p.active === false) continue
    if (p?.trackStock === false) { if (needsPricing(v)) unpricedCount++; continue } // services hold no stock
    value += costFor(v, basis) * v.stock
    if (needsPricing(v)) { unpricedCount++; if (isOverdue(v, now)) overdue++; oldestDays = Math.max(oldestDays, unpricedDays(v, now)) }
    units += v.stock
    if (v.stock <= 0) outOfStock++
    if (v.stock <= v.reorderLevel) lowVariants.push(v)
  }
  lowVariants.sort((a, b) => a.stock - b.stock)
  const shown = lowVariants.slice(0, 8)

  const recent = [...live].sort((a, b) => b.date - a.date).slice(0, 8)

  return {
    unpriced: { count: unpricedCount, overdue, oldestDays },
    cur, prev,
    series: series.map((s) => ({ ...s, total: round2(s.total) })),
    byMode: [...modes.entries()].map(([m, v]) => [m, round2(v)] as [string, number]).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]),
    topItems: [...items.values()].filter((r) => r.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 6).map((r) => ({ ...r, value: round2(r.value) })),
    recent,
    stock: {
      value: round2(value), units: round3(units), outOfStock, lowCount: lowVariants.length,
      low: shown.map((v) => ({
        id: v.id, name: pmap.get(v.productId)?.name ?? 'Unknown item', sku: v.sku, size: v.size, color: v.color,
        stock: v.stock, reorderLevel: v.reorderLevel,
      })),
    },
    hasAnyBills: live.length > 0,
  }
}

/** Percentage change, guarding the divide-by-zero a first trading day produces. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

// ───────────────────────────── Reports ─────────────────────────────

export interface ReportAgg {
  revenue: number
  net: number
  gst: number
  qty: number
  discount: number
  cogs: number
  positive: number
  credits: number
  creditTotal: number
  positiveTotal: number
  modes: Array<[string, number]>
  items: Array<{ id: string; name: string; sku: string; variant: string; qty: number; revenue: number; cost: number }>
  staff: Array<{ userId: string; user: User | undefined; bills: number; qty: number; revenue: number; discount: number }>
  lines: Array<{ hsn: string; taxable: number; cgst: number; sgst: number; taxRate: number; qty: number }>
  hsn: ReturnType<typeof hsnSummary>
  rates: ReturnType<typeof rateSummary>
  daily: Array<{ start: number; total: number; bills: number; qty: number }>
  expenses: number
  gstPaid: number
  grossProfit: number
  netProfit: number
  expenseByCategory: Array<[string, number]>
}

export const MAX_CHART_DAYS = 90

/**
 * One pass over a period's bills builds everything the report tabs need. Every figure comes from billFigures(), so a
 * return (credit note) subtracts consistently from sales, tax, pieces, cost and discount.
 */
export function computeReport(input: AnalyticsInput, users: User[], from: number, to: number, now = Date.now()): ReportAgg {
  const basis = input.store?.costBasis
  const costOf = new Map(input.variants.map((v) => [v.id, costFor(v, basis)]))
  const currentCost = (variantId: string) => costOf.get(variantId) ?? 0
  const sales = input.bills.filter((b) => b.status !== 'held' && b.date >= from && b.date <= to)

  let revenue = 0, net = 0, gst = 0, qty = 0, discount = 0, cogs = 0, creditTotal = 0, positive = 0, credits = 0, positiveTotal = 0
  const modes = new Map<string, number>()
  const items = new Map<string, { id: string; name: string; sku: string; variant: string; qty: number; revenue: number; cost: number }>()
  const staff = new Map<string, { bills: number; qty: number; revenue: number; discount: number }>()
  const lines: ReportAgg['lines'] = []

  const chartEnd = startOfDay(Math.min(to, now))
  const earliest = sales.reduce((m, b) => Math.min(m, b.date), Infinity)
  const chartStart = Math.max(startOfDay(Math.max(from, Number.isFinite(earliest) ? earliest : from)), chartEnd - (MAX_CHART_DAYS - 1) * DAY)
  const nDays = Math.max(1, Math.round((chartEnd - chartStart) / DAY) + 1)
  const daily = Array.from({ length: nDays }, (_, i) => ({ start: chartStart + i * DAY, total: 0, bills: 0, qty: 0 }))

  for (const b of sales) {
    const f = billFigures(b, currentCost)
    const isCredit = f.sign === -1
    revenue += f.total; net += f.net; gst += f.gst; qty = round3(qty + f.pieces); discount += f.discount; cogs += f.cost
    if (isCredit) { credits++; creditTotal += b.total } else { positive++; positiveTotal += b.total }

    for (const i of b.items) {
      const it = items.get(i.variantId) ?? { id: i.variantId, name: i.name, sku: i.sku, variant: variantLabel(i.size, i.color), qty: 0, revenue: 0, cost: 0 }
      it.qty += i.qty * f.sign
      it.revenue += i.taxable * f.sign // sales value excluding GST, so margin is a real margin
      it.cost += (i.cost ?? currentCost(i.variantId)) * i.qty * f.sign
      items.set(i.variantId, it)
      lines.push({ hsn: i.hsn, taxable: i.taxable * f.sign, cgst: i.cgst * f.sign, sgst: i.sgst * f.sign, taxRate: i.taxRate, qty: i.qty * f.sign })
    }
    for (const p of b.payments) modes.set(p.mode, (modes.get(p.mode) ?? 0) + p.amount)

    // Credit per seller: each item counts for whoever sold it (older bills: the cashier), so a shared bill is split fairly.
    const seen = new Set<string>()
    for (const i of b.items) {
      const sid = i.soldBy ?? b.soldBy ?? b.cashierId
      const st = staff.get(sid) ?? { bills: 0, qty: 0, revenue: 0, discount: 0 }
      st.revenue += i.lineTotal * f.sign; st.qty += i.qty * f.sign; st.discount += i.discountAmount * f.sign
      if (!isCredit && !seen.has(sid)) { st.bills++; seen.add(sid) }
      staff.set(sid, st)
    }

    const idx = Math.floor((startOfDay(b.date) - chartStart) / DAY)
    if (idx >= 0 && idx < nDays) { daily[idx].total += b.total; daily[idx].qty += f.pieces; if (!isCredit) daily[idx].bills++ }
  }

  const periodExp = input.expenses.filter((e) => e.date >= from && e.date <= to)
  // GST paid to the government settles what the business collected for it — it is not a running cost.
  const expenses = round2(periodExp.filter((e) => e.category !== GST_PAYMENT_CATEGORY).reduce((s, e) => s + e.amount, 0))
  const gstPaid = round2(periodExp.filter((e) => e.category === GST_PAYMENT_CATEGORY).reduce((s, e) => s + e.amount, 0))
  const byCat = new Map<string, number>()
  for (const e of periodExp) if (e.category !== GST_PAYMENT_CATEGORY) byCat.set(e.category, round2((byCat.get(e.category) ?? 0) + e.amount))

  const netR = round2(net), cogsR = round2(cogs)
  const grossProfit = round2(netR - cogsR)
  const userMap = new Map(users.map((u) => [u.id, u]))

  return {
    revenue: round2(revenue), net: netR, gst: round2(gst), qty, discount: round2(discount), cogs: cogsR,
    positive, credits, creditTotal: round2(creditTotal), positiveTotal: round2(positiveTotal),
    modes: [...modes.entries()].map(([m, v]) => [m, round2(v)] as [string, number]).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]),
    items: [...items.values()].map((r) => ({ ...r, revenue: round2(r.revenue), cost: round2(r.cost) })).sort((a, b) => b.qty - a.qty),
    // Includes people who have since been removed, so the staff rows always add up to the period's sales.
    staff: [...staff.entries()].map(([userId, s]) => ({ userId, user: userMap.get(userId), bills: s.bills, qty: s.qty, revenue: round2(s.revenue), discount: round2(s.discount) }))
      .filter((r) => r.bills > 0 || r.revenue !== 0).sort((a, b) => b.revenue - a.revenue),
    lines,
    hsn: hsnSummary(lines),
    rates: rateSummary(lines),
    daily: daily.map((d) => ({ ...d, total: round2(d.total) })),
    expenses, gstPaid, grossProfit, netProfit: round2(grossProfit - expenses),
    expenseByCategory: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
  }
}

// ───────────────────────────── Day close (Z-report) ─────────────────────────────

export interface DayCloseFigures {
  bills: number
  totalSales: number
  cashIn: number
  digital: number
  cashExpenses: number
  opening: number
  expected: number
}

/**
 * What should be in the cash drawer at close, versus what was counted. A closed session is frozen — only sales and
 * expenses between its opening and closing are used, so its figures never change after the fact.
 */
export function computeDayClose(bills: Bill[], expenses: Expense[], session: DaySession | undefined, now = Date.now()): DayCloseFigures {
  const dayStart = session?.openedAt ?? startOfDay(now)
  const dayEnd = session?.closedAt ?? Number.POSITIVE_INFINITY
  const today = bills.filter((b) => b.status !== 'held' && b.date >= dayStart && b.date <= dayEnd)
  // Cash payments are already net of change given back, and a cash refund on a return is a negative cash payment.
  const cashIn = round2(today.reduce((s, b) => s + b.payments.filter((p) => p.mode === 'cash').reduce((t, p) => t + p.amount, 0), 0))
  const digital = round2(today.reduce((s, b) => s + b.payments.filter((p) => p.mode === 'upi' || p.mode === 'card').reduce((t, p) => t + p.amount, 0), 0))
  const cashExpenses = round2(expenses.filter((e) => e.mode === 'cash' && e.date >= dayStart && e.date <= dayEnd).reduce((s, e) => s + e.amount, 0))
  const opening = session?.openingCash ?? 0
  return {
    bills: today.filter((b) => b.total >= 0).length,
    totalSales: round2(today.reduce((s, b) => s + b.total, 0)),
    cashIn, digital, cashExpenses, opening,
    expected: round2(opening + cashIn - cashExpenses),
  }
}
