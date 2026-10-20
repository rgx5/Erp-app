import { lineDiscount, type CartLine } from '@/domain/cart'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import type { Bill } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import { categoryOf, inScope, metaOf, priceLocked, type PromoHit } from './prices'
import { PROMO_LABEL, type Bundle, type BuyXGetY, type Markdown, type PromoScope, type Promotion } from './types'

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

/** Is the promotion running at this moment? (Its dates, weekdays and time of day, in the phone's own clock.) */
export function runsAt(p: Promotion, now: number): boolean {
  if (!p.active) return false
  if (p.validFrom && now < p.validFrom) return false
  if (p.validTo && now > p.validTo) return false
  const d = new Date(now)
  if (p.days?.length && !p.days.includes(d.getDay())) return false
  if (p.startTime && p.endTime && HHMM.test(p.startTime) && HHMM.test(p.endTime)) {
    const t = d.getHours() * 60 + d.getMinutes()
    const a = minutesOf(p.startTime)
    const b = minutesOf(p.endTime)
    // A window past midnight (22:00–02:00) runs from the evening until the small hours.
    return a <= b ? t >= a && t < b : t >= a || t < b
  }
  return true
}

const scopeEmpty = (s: PromoScope) => !s.all && !s.categoryIds?.length && !s.productIds?.length && !s.variantIds?.length

/** What is wrong with a promotion, in words a shopkeeper understands, or null. */
export function promotionProblem(p: Promotion): string | null {
  if (!p.name.trim()) return 'Give the promotion a name.'
  if (p.validFrom && p.validTo && p.validTo < p.validFrom) return 'It ends before it starts.'
  if (p.startTime || p.endTime) {
    if (!(p.startTime && p.endTime && HHMM.test(p.startTime) && HHMM.test(p.endTime))) return 'Write the times as HH:MM, for example 16:00 and 18:00.'
    if (p.startTime === p.endTime) return 'The start and the end of the time window are the same.'
  }
  if (p.days?.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Days are Sunday to Saturday.'
  switch (p.kind) {
    case 'buy_x_get_y':
      if (scopeEmpty(p.scope)) return 'Choose which items it covers.'
      if (!(Number.isInteger(p.buyQty) && p.buyQty >= 1)) return 'Buy quantity is a whole number, at least 1.'
      if (!(Number.isInteger(p.getQty) && p.getQty >= 1)) return 'Get quantity is a whole number, at least 1.'
      if (!(p.getPct > 0 && p.getPct <= 100)) return 'The discount on the free items is between 1% and 100%.'
      return null
    case 'bundle': {
      if (p.items.length < 2) return 'A bundle needs at least two different items.'
      if (new Set(p.items.map((i) => i.variantId)).size !== p.items.length) return 'An item appears twice in the bundle.'
      if (p.items.some((i) => !(Number.isInteger(i.qty) && i.qty >= 1))) return 'Each item in a bundle is a whole number of pieces.'
      if (!(p.price > 0)) return 'Set the bundle price.'
      return null
    }
    case 'category_sale':
    case 'happy_hour':
      if (scopeEmpty(p.scope)) return 'Choose which items it covers.'
      if (!(p.off.value > 0)) return 'Set how much it takes off.'
      if (p.off.type === 'pct' && p.off.value > 100) return 'A percentage cannot be more than 100.'
      if (p.kind === 'happy_hour' && !(p.startTime && p.endTime)) return 'A happy hour needs a start and an end time.'
      return null
  }
}

/** The promotion in one line, for lists and the receipt. */
export function describePromotion(p: Promotion): string {
  switch (p.kind) {
    case 'buy_x_get_y': return `Buy ${p.buyQty} get ${p.getQty} ${p.getPct >= 100 ? 'free' : `at ${p.getPct}% off`}${p.sameItem ? ' (same item)' : ''}`
    case 'bundle': return `${p.items.length} items for ₹${p.price}`
    case 'category_sale':
    case 'happy_hour': return `${p.off.type === 'pct' ? `${p.off.value}%` : `₹${p.off.value}`} off${p.startTime && p.endTime ? ` · ${p.startTime}–${p.endTime}` : ''}`
  }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** When it runs, in words: "Mon, Tue · 16:00–18:00 · until 31 Oct". */
export function describeSchedule(p: Promotion): string {
  const parts: string[] = []
  if (p.days?.length && p.days.length < 7) parts.push([...p.days].sort().map((d) => DAYS[d]).join(', '))
  if (p.startTime && p.endTime) parts.push(`${p.startTime}–${p.endTime}`)
  const fmt = (ms: number) => { const d = new Date(ms); return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}` }
  if (p.validFrom && p.validTo) parts.push(`${fmt(p.validFrom)} – ${fmt(p.validTo)}`)
  else if (p.validTo) parts.push(`until ${fmt(p.validTo)}`)
  else if (p.validFrom) parts.push(`from ${fmt(p.validFrom)}`)
  return parts.join(' · ') || 'Always'
}

export const promoStatus = (p: Promotion, now: number): 'off' | 'running' | 'scheduled' | 'ended' => {
  if (!p.active) return 'off'
  if (p.validTo && now > p.validTo) return 'ended'
  if (p.validFrom && now < p.validFrom) return 'scheduled'
  return runsAt(p, now) ? 'running' : 'scheduled'
}

export const promoTitle = (p: Promotion) => `${p.name} · ${PROMO_LABEL[p.kind]}`

/**
 * Applies every running promotion to the cart. Pure: the same lines, state and time always give the same result, and it never
 * adds or removes a line — a promotion only takes money off a line, as extra line discount (so the tax is worked out on what
 * the customer pays).
 *
 *  • Promotions go in `priority` order (then by name). Each unit of an item can be used by one promotion only, so offers never
 *    pile onto the same piece; what an earlier offer left over is open to the next.
 *  • Items marked "no discount" and lines a manager priced by hand are never discounted.
 *  • Buy X get Y: the items it covers are ranked by price; of every X+Y of them the cheapest Y get the discount.
 *  • A bundle takes the difference between the items' prices and the bundle price, for every complete set in the cart.
 */
export function applyPromotions(lines: CartLine[], state: DataState, now: number, opts: { retail?: boolean } = {}): CartLine[] {
  const retail = opts.retail !== false
  const promos = listOf(state.promotions ?? {})
    .filter((p) => runsAt(p, now) && !(p.retailOnly && !retail) && !promotionProblem(p))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  if (!promos.length || !lines.length) return lines

  const cats = lines.map((l) => categoryOf(state, l))
  /** Quantity of each line no promotion has used yet. */
  const free = lines.map((l) => (l.noDiscount || priceLocked(l) || !(l.price > 0) ? 0 : l.qty))
  const off = lines.map(() => 0)
  const hits: PromoHit[][] = lines.map(() => [])
  const credit = (i: number, p: Promotion, amount: number) => {
    const a = round2(amount)
    if (!(a > 0)) return
    off[i] = round2(off[i] + a)
    const h = hits[i].find((x) => x.id === p.id)
    if (h) h.amount = round2(h.amount + a)
    else hits[i].push({ id: p.id, name: p.name, amount: a })
  }

  const markdown = (p: Markdown) => {
    lines.forEach((l, i) => {
      if (free[i] <= 0 || !inScope(p.scope, l, cats[i])) return
      const unit = p.off.type === 'pct' ? (l.price * p.off.value) / 100 : Math.min(p.off.value, l.price)
      credit(i, p, unit * free[i])
      free[i] = 0
    })
  }

  const buyXGetY = (p: BuyXGetY) => {
    const pools = new Map<string, Array<{ i: number; price: number }>>()
    lines.forEach((l, i) => {
      if (free[i] < 1 || !inScope(p.scope, l, cats[i])) return
      const key = p.sameItem ? l.variantId : 'all'
      const pool = pools.get(key) ?? []
      for (let u = 0; u < Math.floor(round3(free[i])); u++) pool.push({ i, price: l.price })
      pools.set(key, pool)
    })
    const size = p.buyQty + p.getQty
    for (const pool of pools.values()) {
      const groups = Math.floor(pool.length / size)
      if (!groups) continue
      // Most expensive first: the first `groups × buyQty` are the ones bought, the next `groups × getQty` (the cheapest of those in play) get the offer.
      pool.sort((a, b) => b.price - a.price || a.i - b.i)
      const bought = groups * p.buyQty
      pool.slice(0, groups * size).forEach((u, n) => {
        free[u.i] = round3(free[u.i] - 1)
        if (n >= bought) credit(u.i, p, (u.price * p.getPct) / 100)
      })
    }
  }

  const bundle = (p: Bundle) => {
    const idx = p.items.map((it) => lines.findIndex((l) => l.variantId === it.variantId))
    if (idx.some((i) => i < 0)) return
    const sets = Math.min(...p.items.map((it, n) => Math.floor(round3(free[idx[n]]) / it.qty)))
    if (!(sets >= 1)) return
    const normal = round2(p.items.reduce((s, it, n) => s + lines[idx[n]].price * it.qty, 0))
    const perSet = round2(normal - p.price)
    if (!(perSet > 0)) return
    const total = round2(perSet * sets)
    // Spread the saving over the items in proportion to their value; the last item takes the rounding remainder.
    const worth = p.items.map((it, n) => lines[idx[n]].price * it.qty * sets)
    const sum = worth.reduce((s, w) => s + w, 0)
    let given = 0
    p.items.forEach((it, n) => {
      const share = n === p.items.length - 1 ? round2(total - given) : round2((total * worth[n]) / sum)
      given = round2(given + share)
      credit(idx[n], p, share)
      free[idx[n]] = round3(free[idx[n]] - it.qty * sets)
    })
  }

  for (const p of promos) {
    if (p.kind === 'buy_x_get_y') buyXGetY(p)
    else if (p.kind === 'bundle') bundle(p)
    else markdown(p)
  }

  return lines.map((l, i) => {
    if (!(off[i] > 0)) return l
    const gross = round2(l.price * l.qty)
    const total = round2(Math.min(lineDiscount(l) + off[i], gross))
    return { ...l, discountType: 'amt', discountValue: total, ext: { ...l.ext, pricing: { ...metaOf(l), promos: hits[i] } } }
  })
}

// ───────────────────────────── what the promotions did ─────────────────────────────

export interface PromoResult { id: string; name: string; bills: number; discount: number }

/** How much each promotion has taken off, over a set of bills (before returns: credit notes are left out). Reads the record on the bill lines, so it holds even after a promotion is edited or deleted. */
export function promoResults(bills: Bill[]): PromoResult[] {
  const by = new Map<string, PromoResult & { seen: Set<string> }>()
  for (const b of bills) {
    if (b.status === 'held' || b.refundOfBillId || b.total < 0) continue
    for (const it of b.items) {
      for (const h of metaOf(it).promos ?? []) {
        const r = by.get(h.id) ?? { id: h.id, name: h.name, bills: 0, discount: 0, seen: new Set<string>() }
        r.discount = round2(r.discount + h.amount)
        if (!r.seen.has(b.id)) { r.seen.add(b.id); r.bills++ }
        by.set(h.id, r)
      }
    }
  }
  return [...by.values()].map(({ seen: _s, ...r }) => r).sort((a, b) => b.discount - a.discount)
}
