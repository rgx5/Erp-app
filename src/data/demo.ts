import type { BillItem, Customer, Expense, Payment, Product, StoreSettings, User, Variant } from '@/domain/types'
import { priceCart, type CartLine } from '@/domain/cart'
import { DAY, startOfDay } from '@/domain/dates'
import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import { DEFAULT_SLABS } from '@/domain/tax'
import { costFor } from '@/domain/pricing'
import { industryById, type DemoItem, type IndustryPack } from '@/industries'
import { applyChanges, emptyData, listOf, type DataState } from './state'
import {
  addExpense, closeDay, createItem, openDay, processReturn, receivePurchase, saveBill, saveCoupon, type OpCtx,
} from './ops'

/** A tiny seeded generator, so a demo workspace looks the same every time it is made (and tests are stable). */
export function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface NewBusiness {
  pack: IndustryPack
  name: string
  ownerName: string
  city?: string
  phone?: string
  email?: string
  gstin?: string
  tagline?: string
  /** Hash of the owner's PIN (see data/pin.ts). */
  pinHash?: string
}

/** A business with its settings, categories and owner — nothing sold yet. */
export function newBusinessState(b: NewBusiness, now = Date.now()): DataState {
  const s = emptyData()
  const settings: StoreSettings = {
    id: id('store', now), name: b.name.trim(), tagline: b.tagline ?? '', address: '', city: b.city ?? '', phone: b.phone ?? '', email: b.email ?? '',
    gstin: (b.gstin ?? '').toUpperCase(), invoicePrefix: 'INV-', nextInvoiceNo: 1, slabs: b.pack.tax.slabs ?? DEFAULT_SLABS,
    priceIncludesTax: b.pack.tax.inclusive, receiptWidth: '80mm', returnPolicy: '', footerNote: '', loyaltyEarnPct: 0, loyaltyRedeemValue: 0,
    maxCashierDiscountPct: 10, lowStockDefault: 3, costBasis: 'average', receiptShowTax: false, receiptShowHsn: false, receiptShowSavings: true,
    receiptShowLoyalty: true, ...b.pack.settings,
  }
  s.store = settings
  const owner: User = { id: id('usr', now), name: b.ownerName.trim(), role: 'owner', active: true, code: '01', ...(b.pinHash ? { pin: b.pinHash } : {}) }
  s.users = { [owner.id]: owner }
  for (const c of b.pack.categories) s.categories[c.id] = { id: c.id, name: c.name, group: c.group, config: c.config }
  return s
}

// ───────────────────────────── demo workspace ─────────────────────────────

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Rohan', 'Karan', 'Arjun', 'Rahul', 'Neha', 'Priya', 'Anjali', 'Pooja', 'Sneha', 'Kavya', 'Meera', 'Isha', 'Riya', 'Sanjay', 'Vikram', 'Deepak', 'Nikhil', 'Shreya', 'Divya', 'Tanvi', 'Manish', 'Suresh', 'Lakshmi', 'Farah', 'Imran', 'Harpreet', 'Gurpreet']
const LAST = ['Sharma', 'Verma', 'Patel', 'Gupta', 'Iyer', 'Nair', 'Reddy', 'Khan', 'Singh', 'Joshi', 'Mehta', 'Kulkarni', 'Das', 'Bose', 'Shah', 'Desai', 'Rao', 'Menon', 'Kapoor', 'Malhotra']
const STAFF_NAMES: Array<[string, 'manager' | 'cashier']> = [['Rohit Kale', 'manager'], ['Sunita Pawar', 'cashier'], ['Amit Jadhav', 'cashier']]

export interface DemoOptions {
  now?: number
  seed?: number
  days?: number
  pinHash?: string
  /** Names used on the demo business; defaults to the pack's sample business. */
  name?: string
  ownerName?: string
}

/** Weighted pick. */
function pickWeighted<T>(items: T[], weight: (t: T) => number, r: () => number): T {
  const total = items.reduce((s, i) => s + weight(i), 0)
  let x = r() * total
  for (const i of items) { x -= weight(i); if (x <= 0) return i }
  return items[items.length - 1]
}

const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo)
const intBetween = (r: () => number, lo: number, hi: number) => Math.floor(between(r, lo, hi + 1))

/**
 * Builds a complete, believable business for an industry by *running the real operations* — creating items, receiving
 * stock, selling, returning, opening and closing the till — day by day. Because nothing is faked, every figure on the
 * dashboard and in the reports is internally consistent, exactly as it would be for a real business.
 */
export function buildDemo(packId: string, opts: DemoOptions = {}): DataState {
  const pack = industryById(packId)
  const now = opts.now ?? Date.now()
  const r = rng(opts.seed ?? 20261019)
  const days = opts.days ?? 45
  const d = pack.demo
  const hoursOpen = d.hours

  let state = newBusinessState({ pack, name: opts.name ?? d.storeName, ownerName: opts.ownerName ?? d.ownerName, city: d.city, tagline: d.tagline, pinHash: opts.pinHash,
    email: 'owner@example.com', phone: '98' + String(intBetween(r, 10000000, 99999999)) }, now - (days + 2) * DAY)
  const owner = listOf(state.users)[0]
  state = applyChanges(state, { store: { gstin: '27AAAAA0000A1Z5' } })

  // Staff
  const staff: User[] = [owner]
  STAFF_NAMES.forEach(([name, role], i) => {
    const u: User = { id: id('usr', now - 30 * DAY + i), name, role, active: true, code: String(i + 2).padStart(2, '0'), ...(opts.pinHash ? { pin: opts.pinHash } : {}) }
    staff.push(u)
  })
  state = applyChanges(state, { put: { users: staff } })
  const sellers = staff // everyone sells

  const ctxAt = (ts: number, user: User = owner): OpCtx => ({ now: ts, userId: user.id, series: '', barcodeBase: 1 })

  // Suppliers
  const supplierIds: string[] = []
  state = applyChanges(state, { put: { suppliers: d.suppliers.map((s, i) => {
    const sid = id('sup', now - 60 * DAY + i)
    supplierIds.push(sid)
    return { id: sid, name: s.name, phone: '98' + String(intBetween(r, 10000000, 99999999)), gstin: s.gstin ?? '', address: d.city, openingBalance: i === 0 ? 18500 : 0 }
  }) } })

  // Items + opening stock, long before the first sale
  const t0 = startOfDay(now - days * DAY) - 6 * 3600_000
  const itemOf = new Map<string, DemoItem>() // product id → sample definition
  const optionOf = new Map<string, number>() // variant id → option index
  const hasStock = (it: DemoItem) => !!it.stock
  d.items.forEach((it, idx) => {
    const cat = pack.categories.find((c) => c.id === it.cat)
    const cfg = cat?.config ?? {}
    const tracked = hasStock(it) && cfg.trackStock !== false
    const options = it.options?.length ? it.options : ['']
    const options2 = it.options2?.length ? it.options2 : ['']
    const res = createItem(state, {
      name: it.name, styleCode: `${cfg.prefix ?? 'IT'}-${101 + idx}`, categoryId: it.cat, brand: it.brand ?? '', fabric: it.attr1 ?? '', season: it.attr2 ?? '',
      hsn: it.hsn ?? cfg.hsn ?? pack.tax.defaultHsn, sizes: options, colors: options2, cost: it.cost, mrp: it.mrp || it.price, price: it.price,
      unit: it.unit ?? cfg.unit ?? 'pc', ...(cfg.step ? { step: cfg.step } : {}), ...(cfg.minQty ? { minQty: cfg.minQty } : {}),
      trackStock: tracked ? undefined : false, gstRate: it.gst ?? cfg.gstRate, reorderLevel: cfg.reorderLevel ?? pack.settings.lowStockDefault ?? 3,
    }, ctxAt(t0 + idx))
    // Per-option prices (a Full portion, a 5 kg bag…), cost and MRP scaling with the price.
    const variants = res.variants.map((v) => {
      const oi = options.indexOf(v.size)
      const p = it.optionPrice?.[oi] ?? it.price
      const ratio = it.price > 0 ? p / it.price : 1
      optionOf.set(v.id, Math.max(0, oi))
      const stock = tracked ? round3(intBetween(r, it.stock![0], it.stock![1])) : 0
      return { ...v, price: p, mrp: round2((it.mrp || it.price) * ratio), cost: round2(it.cost * ratio), avgCost: round2(it.cost * ratio), stock }
    })
    const moves = variants.filter((v) => v.stock > 0).map((v) => ({ id: id('mv', t0 + idx), variantId: v.id, qty: v.stock, type: 'opening' as const, ref: 'OPENING', reason: 'Opening stock', at: t0 + idx, userId: owner.id }))
    state = applyChanges(state, { put: { products: [res.product], variants, moves } })
    itemOf.set(res.product.id, it)
  })

  // Customers
  const customers: Customer[] = []
  const thisMonth = new Date(now).getMonth() + 1
  for (let i = 0; i < 30; i++) {
    const name = `${FIRST[intBetween(r, 0, FIRST.length - 1)]} ${LAST[intBetween(r, 0, LAST.length - 1)]}`
    const bday = i < 4 ? `${1985 + intBetween(r, 0, 14)}-${String(thisMonth).padStart(2, '0')}-${String(intBetween(r, 1, 28)).padStart(2, '0')}` : ''
    customers.push({
      id: id('cus', now - 40 * DAY + i), name, phone: `${[98, 97, 99, 96, 70, 80][intBetween(r, 0, 5)]}${String(intBetween(r, 10000000, 99999999))}`,
      email: i % 3 === 0 ? `${name.split(' ')[0].toLowerCase()}@example.com` : '', dob: bday, anniversary: '', address: d.city, gstin: '',
      loyaltyPoints: pack.settings.loyaltyEarnPct ? intBetween(r, 0, 220) : 0, storeCredit: i === 5 || i === 11 ? [350, 120][i === 5 ? 0 : 1] : 0,
      createdAt: now - intBetween(r, 5, 40) * DAY, notes: '',
    })
  }
  // Distinct phone numbers, always.
  const seen = new Set<string>()
  for (const c of customers) { while (seen.has(c.phone)) c.phone = String(Number(c.phone) + 1); seen.add(c.phone) }
  state = applyChanges(state, { put: { customers } })

  // Coupons
  for (const [code, type, value, minBill] of [['WELCOME10', 'pct', 10, 500], ['FESTIVE100', 'amt', 100, 1000]] as const) {
    state = applyChanges(state, saveCoupon(state, { code, type, value, minBill, maxUses: 0, active: true, expiresAt: now + 30 * DAY }, undefined, ctxAt(now - 20 * DAY)).changes)
  }

  const productViews = () => listOf(state.products).filter((p) => itemOf.has(p.id))
  const variantsOf = (p: Product) => listOf(state.variants).filter((v) => v.productId === p.id).sort((a, b) => (optionOf.get(a.id) ?? 0) - (optionOf.get(b.id) ?? 0))

  // Day loop
  const dueReturns: Array<{ day: number; billId: string }> = []
  const today = startOfDay(now)
  const pendingExpenseDays = new Map<number, Array<(typeof d.expenses)[number]>>()
  d.expenses.forEach((e, ei) => {
    // Spread each recurring expense across the window, offset so they do not all land on the same day.
    const offset = intBetween(r, 0, Math.max(0, e.every - 1)) + ei
    for (let day = -days + (offset % e.every); day <= 0; day += e.every) {
      const key = startOfDay(now + day * DAY)
      pendingExpenseDays.set(key, [...(pendingExpenseDays.get(key) ?? []), e])
    }
  })

  for (let dayIx = -days + 1; dayIx <= 0; dayIx++) {
    const dayStart = startOfDay(now + dayIx * DAY)
    const isToday = dayStart === today
    const dow = new Date(dayStart).getDay()
    const weekend = dow === 0 || dow === 6
    const growth = 0.88 + ((dayIx + days) / days) * 0.24
    const open = dayStart + hoursOpen[0] * 3600_000
    const close = dayStart + hoursOpen[1] * 3600_000

    // Open the till
    state = applyChanges(state, openDay(state, round2(intBetween(r, 15, 50) * 100), ctxAt(open + 120_000)).changes)

    // Restock mornings (not in the last few days, so a few items are genuinely low by "today")
    if (dayIx < -4 && (dayIx + days) % 6 === 2) {
      const lines: Array<{ variantId: string; qty: number; cost: number }> = []
      for (const v of listOf(state.variants)) {
        const p = state.products[v.productId]
        if (!p || p.trackStock === false) continue
        if (v.stock <= v.reorderLevel * 1.6) {
          const qty = Math.max(v.reorderLevel * 3, Math.round((itemOf.get(p.id)?.stock?.[1] ?? 10) * 0.8))
          lines.push({ variantId: v.id, qty: round3(qty), cost: round2(costFor(v) * between(r, 0.97, 1.05)) })
        }
      }
      if (lines.length) {
        const total = round2(lines.reduce((s, l) => s + l.qty * l.cost, 0))
        const sup = supplierIds[intBetween(r, 0, supplierIds.length - 1)]
        const paid = r() < 0.55 ? total : r() < 0.5 ? round2(total * 0.5) : 0
        state = applyChanges(state, receivePurchase(state, { supplierId: sup, date: open + 600_000, invoiceRef: `B-${intBetween(r, 1000, 9999)}`, items: lines, total, paid, notes: '' }, ctxAt(open + 600_000)).changes)
      }
    }

    // Bills
    const [lo, hi] = d.billsPerDay
    const base = weekend ? between(r, (lo + hi) / 2, hi) : between(r, lo, (lo + hi) / 1.7)
    let n = Math.max(1, Math.round(base * growth))
    const stamps: number[] = []
    for (let i = 0; i < n; i++) {
      // Two soft peaks: late morning and evening.
      const peak = r() < 0.5 ? between(r, 0.15, 0.4) : between(r, 0.62, 0.9)
      const ts = open + Math.floor(peak * (close - open)) + intBetween(r, 0, 540) * 1000
      if (!isToday || ts <= now - 60_000) stamps.push(ts)
    }
    n = stamps.length
    stamps.sort((a, b) => a - b)

    for (const ts of stamps) {
      const seller = sellers[intBetween(r, 0, sellers.length - 1)]
      const lineCount = intBetween(r, d.lines[0], d.lines[1])
      const chosen: CartLine[] = []
      const used = new Set<string>()
      for (let k = 0; k < lineCount; k++) {
        const prod = pickWeighted(productViews(), (p) => itemOf.get(p.id)?.weight ?? 1, r)
        const def = itemOf.get(prod.id)!
        const vs = variantsOf(prod).filter((v) => v.price > 0 && !used.has(v.id))
        if (!vs.length) continue
        const v = vs[intBetween(r, 0, vs.length - 1)]
        const frac = prod.unit !== 'pc' && (def.qty || (prod.fractional ?? ['kg', 'm', 'l'].includes(prod.unit ?? '')))
        const qty = def.qty ? round3(Math.round(between(r, def.qty[0], def.qty[1]) * 4) / 4) : frac ? round3(Math.round(between(r, 0.5, 2.5) * 2) / 2) : r() < 0.82 ? 1 : r() < 0.8 ? 2 : 3
        const tracked = prod.trackStock !== false
        if (tracked && v.stock < qty) continue
        used.add(v.id)
        const pct = r() < 0.1 && !prod.noDiscount
        chosen.push({
          variantId: v.id, productId: prod.id, sku: v.sku, barcode: v.barcode, name: prod.name, size: v.size, color: v.color, hsn: prod.hsn, mrp: v.mrp, price: v.price,
          qty, stock: v.stock, discountType: pct ? 'pct' : 'amt', discountValue: pct ? [5, 10][intBetween(r, 0, 1)] : 0, unit: prod.unit, fractional: prod.fractional,
          step: prod.step, minQty: prod.minQty, noStock: !tracked, noDiscount: prod.noDiscount, fixedRate: prod.gstRate, cost: costFor(v, state.store!.costBasis),
        })
      }
      if (!chosen.length) continue

      const useCoupon = r() < 0.06
      const coupon = useCoupon ? 'WELCOME10' : ''
      let billType: 'pct' | 'amt' = 'amt'
      let billVal = 0
      const sub0 = chosen.reduce((s, l) => s + l.price * l.qty, 0)
      if (useCoupon && sub0 >= 500) { billType = 'pct'; billVal = 10 } else if (r() < 0.09) { billType = 'pct'; billVal = [5, 7.5, 10][intBetween(r, 0, 2)] }
      const t = priceCart(chosen, billType, billVal, state.store!.slabs, state.store!.priceIncludesTax)
      if (t.total <= 0) continue

      const cust = r() < 0.42 ? customers[intBetween(r, 0, customers.length - 1)] : null
      const live = cust ? state.customers[cust.id] : undefined
      const earned = live ? Math.floor((t.total * (state.store!.loyaltyEarnPct || 0)) / 100) : 0
      const pointValue = state.store!.loyaltyRedeemValue || 0
      let redeem = live && pointValue > 0 && live.loyaltyPoints >= 60 && r() < 0.07 ? Math.min(50, live.loyaltyPoints) : 0
      // Points can never pay for more than the bill itself.
      if (redeem && redeem * pointValue > t.total) redeem = Math.floor(t.total / pointValue)
      const redeemValue = round2(redeem * pointValue)
      const toPay = round2(Math.max(0, t.total - redeemValue))

      const m = r()
      const mix = d.payMix
      const mode: 'cash' | 'upi' | 'card' = m < mix.cash ? 'cash' : m < mix.cash + mix.upi ? 'upi' : 'card'
      let payments: Payment[]
      if (toPay > 400 && r() < 0.08) {
        const first = Math.round(toPay * 0.5)
        payments = [{ mode: 'cash', amount: first }, { mode: 'upi', amount: round2(toPay - first) }]
      } else {
        payments = toPay > 0 ? [{ mode, amount: toPay, ...(mode === 'upi' ? { ref: `UPI${intBetween(r, 100000, 999999)}` } : {}) }] : []
      }
      if (redeemValue > 0) payments.push({ mode: 'credit', amount: redeemValue })

      const items: BillItem[] = t.items.map((it) => ({ ...it, soldBy: seller.id }))
      const res = saveBill(state, {
        date: ts, customerId: cust?.id ?? null, items, grossMrp: t.grossMrp, itemDiscount: t.itemDiscount, billDiscountType: billType, billDiscountValue: billVal,
        billDiscount: t.billDiscount, coupon: useCoupon && billVal === 10 && billType === 'pct' && sub0 >= 500 ? coupon : '', subtotal: t.subtotal,
        taxableTotal: t.taxableTotal, cgstTotal: t.cgstTotal, sgstTotal: t.sgstTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total, payments,
        paid: round2(payments.reduce((s, p) => s + p.amount, 0)), changeDue: 0, loyaltyEarned: earned, loyaltyRedeemed: redeem, creditUsed: 0,
        cashierId: seller.id, soldBy: seller.id, status: 'paid', notes: '',
      }, ctxAt(ts, seller))
      state = applyChanges(state, res.changes)
      if (r() < 0.025) dueReturns.push({ day: dayIx + intBetween(r, 0, 3), billId: res.bill.id })
    }

    // Returns that fall due today
    for (const dr of dueReturns.filter((x) => x.day === dayIx)) {
      const bill = state.bills[dr.billId]
      if (!bill || bill.status === 'returned') continue
      const it = bill.items[0]
      const qtyBack = it.qty >= 2 && !Number.isInteger(it.qty) ? round3(it.qty / 2) : 1
      const ts = Math.min(now - 30_000, Math.max(bill.date + 3600_000, open + 4 * 3600_000))
      try {
        const ret = processReturn(state, bill.id, [{ variantId: it.variantId, qty: Math.min(qtyBack, it.qty) }], 'cash', ctxAt(ts), pack.returnReasons[0])
        state = applyChanges(state, ret.changes)
      } catch { /* a return that cannot be made is simply skipped */ }
    }

    // Expenses for the day
    for (const e of pendingExpenseDays.get(dayStart) ?? []) {
      const ts = open + intBetween(r, 0, 6) * 3600_000
      if (isToday && ts > now) continue
      const draft: Omit<Expense, 'id' | 'userId'> = {
        date: ts, category: e.category, amount: round2(between(r, e.amount[0], e.amount[1])), mode: e.mode ?? 'cash', vendor: e.vendor ?? '', note: '', recurring: e.every >= 28,
      }
      state = applyChanges(state, addExpense(draft, ctxAt(ts)).changes)
    }

    // Close the till (today stays open)
    if (!isToday) {
      const session = listOf(state.sessions).find((s) => !s.closedAt)!
      const figures = closeDay(state, session.id, 0, ctxAt(close + 600_000))
      const expected = figures.session.expectedCash ?? 0
      const variance = r() < 0.72 ? 0 : [-50, -20, 10, 30, -120, 200][intBetween(r, 0, 5)]
      state = applyChanges(state, closeDay(state, session.id, round2(expected + variance), ctxAt(close + 600_000)).changes)
    }
  }

  // A couple of items received but not priced yet — the "price later" flow the dashboard nudges about.
  const counted = listOf(state.variants).filter((v) => state.products[v.productId]?.trackStock !== false)
  const picked = counted.slice(-Math.min(2, counted.length)) as Variant[]
  state = applyChanges(state, { put: { variants: picked.map((v) => ({ ...v, price: 0, mrp: 0, unpricedSince: now - 3 * DAY })) } })

  return state
}
