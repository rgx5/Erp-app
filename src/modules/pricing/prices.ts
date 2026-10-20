import type { CartLine } from '@/domain/cart'
import type { BillTaxInfo } from '@/domain/gst'
import { round2 } from '@/domain/money'
import type { DataState } from '@/data/state'
import { listOf } from '@/data/state'
import type { PriceList, PriceListItem, PromoScope, QtyBreak, QtyBreakRule, Tier } from './types'
import { priceListItemId } from './types'

/** What the pricing module records on a cart line (copied onto the bill line as `ext.pricing`). */
export interface LineMeta {
  /** The selling price before any list or break touched it. */
  basePrice?: number
  listId?: string
  /** The quantity-break rule that set the price, and the step reached. */
  breakId?: string
  breakMinQty?: number
  promos?: PromoHit[]
}
export interface PromoHit { id: string; name: string; amount: number }

export const metaOf = (l: Pick<CartLine, 'ext'>): LineMeta => ((l.ext?.pricing ?? {}) as LineMeta)
const withMeta = (l: CartLine, patch: LineMeta): CartLine => ({ ...l, ext: { ...l.ext, pricing: { ...metaOf(l), ...patch } } })

/** A line whose price the pricing module must leave alone: typed by a manager, or an item with no price yet. */
export const priceLocked = (l: CartLine) => !!l.priceOverridden || !!l.unpricedSale

const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

// ───────────────────────────── price lists and tiers ─────────────────────────────

/** The list this bill is priced on: the one picked at checkout, else the customer's, else the shop's default. Inactive lists do not count. */
export function listForCart(state: DataState, customerId: string | null, extras: Record<string, unknown>): PriceList | null {
  const info = extras.pricing as BillTaxInfo | undefined
  const customer = customerId ? state.customers[customerId] : undefined
  const id = info?.priceListId || customer?.priceListId || state.pricingSettings?.settings?.defaultListId
  const list = id ? state.priceLists?.[id] : undefined
  return list && list.active ? list : null
}

export const tierOf = (list: PriceList | null | undefined): Tier => list?.tier ?? 'retail'

/** Rounds to the nearest multiple of `to` (0 = to the paisa). */
export function roundPrice(price: number, to: number): number {
  const p = Math.max(0, price)
  return to > 0 ? round2(Math.round(p / to) * to) : round2(p)
}

/** The list's price for an item: its own entry, else the list's rule worked on the item's price, MRP or cost. */
export function listPrice(list: PriceList, line: Pick<CartLine, 'price' | 'mrp' | 'cost'>, own?: PriceListItem): number {
  if (own && isFiniteNum(own.price) && own.price >= 0) return round2(own.price)
  const basis = list.basis === 'mrp' ? line.mrp : list.basis === 'cost' ? line.cost : line.price
  // No cost recorded (or no MRP): the rule has nothing to work on, so the item keeps its selling price.
  if (!(basis !== undefined && basis > 0)) return round2(line.price)
  return roundPrice(basis * (1 + list.pct / 100), list.roundTo)
}

/** Prices every line on the bill's list. Lines a manager priced by hand are left alone. */
export function adjustListPrices(lines: CartLine[], state: DataState, list: PriceList | null): CartLine[] {
  if (!list) return lines
  const items = state.priceListItems ?? {}
  return lines.map((l) => {
    if (priceLocked(l)) return l
    const price = listPrice(list, l, items[priceListItemId(list.id, l.variantId)])
    return withMeta({ ...l, price }, { basePrice: metaOf(l).basePrice ?? l.price, listId: list.id })
  })
}

// ───────────────────────────── quantity breaks ─────────────────────────────

export const categoryOf = (state: DataState, l: Pick<CartLine, 'productId' | 'variantId'>): string => {
  const productId = l.productId ?? state.variants[l.variantId]?.productId
  return (productId ? state.products[productId]?.categoryId : undefined) ?? ''
}

/** Does an item fall under a promotion's scope? */
export function inScope(scope: PromoScope, l: Pick<CartLine, 'productId' | 'variantId'>, categoryId: string): boolean {
  if (scope.all) return true
  return !!(scope.variantIds?.includes(l.variantId) || (l.productId && scope.productIds?.includes(l.productId)) || (categoryId && scope.categoryIds?.includes(categoryId)))
}

const SPECIFICITY = { all: 0, category: 1, product: 2, variant: 3 } as const

const ruleCovers = (r: QtyBreakRule, state: DataState, l: CartLine): boolean => {
  switch (r.target) {
    case 'all': return true
    case 'variant': return l.variantId === r.targetId
    case 'product': return (l.productId ?? state.variants[l.variantId]?.productId) === r.targetId
    case 'category': return categoryOf(state, l) === r.targetId
  }
}

/** The step of a ladder that a quantity reaches (the highest `minQty` not above it), or null. */
export function breakFor(breaks: QtyBreak[], qty: number): QtyBreak | null {
  let best: QtyBreak | null = null
  for (const b of breaks) if (b.minQty > 0 && qty >= b.minQty && (!best || b.minQty > best.minQty)) best = b
  return best
}

/** The unit price once a break applies. A break never raises a price. */
export const breakPrice = (price: number, b: QtyBreak): number =>
  b.kind === 'pct' ? round2(price * (1 - Math.min(Math.max(b.value, 0), 100) / 100)) : Math.min(price, round2(Math.max(b.value, 0)))

/**
 * Applies quantity breaks. A rule counts the quantity of everything it covers (a rule on a category counts every item of the
 * category together). Where several rules reach a line, the most specific wins (item over product over category over everything),
 * and a rule made for the customer's price list beats one made for everyone. Items marked "no discount" and hand-priced lines are skipped.
 */
export function adjustBreaks(lines: CartLine[], state: DataState, list: PriceList | null): CartLine[] {
  const rules = listOf(state.qtyBreakRules ?? {}).filter((r) => r.active && r.breaks.length && (!r.listId || r.listId === list?.id))
  if (!rules.length) return lines
  const usable = (l: CartLine) => !l.noDiscount && !priceLocked(l)
  // For each rule: the quantity it covers and the step that reaches.
  const reached = rules.map((r) => {
    const qty = lines.reduce((s, l) => s + (usable(l) && ruleCovers(r, state, l) ? l.qty : 0), 0)
    return { rule: r, step: breakFor(r.breaks, qty) }
  }).filter((x) => x.step)
  if (!reached.length) return lines
  return lines.map((l) => {
    if (!usable(l)) return l
    let pick: { rule: QtyBreakRule; step: QtyBreak; rank: number } | null = null
    for (const x of reached) {
      if (!ruleCovers(x.rule, state, l)) continue
      const rank = SPECIFICITY[x.rule.target] * 2 + (x.rule.listId ? 1 : 0)
      if (!pick || rank > pick.rank) pick = { rule: x.rule, step: x.step as QtyBreak, rank }
    }
    if (!pick) return l
    const price = breakPrice(l.price, pick.step)
    if (price >= l.price) return l
    return withMeta({ ...l, price }, { basePrice: metaOf(l).basePrice ?? l.price, breakId: pick.rule.id, breakMinQty: pick.step.minQty })
  })
}

/** "10+ → 5% off · 50+ → ₹90 each", for a rule's row. */
export const describeBreaks = (breaks: QtyBreak[]): string =>
  [...breaks].sort((a, b) => a.minQty - b.minQty).map((b) => `${b.minQty}+ → ${b.kind === 'pct' ? `${b.value}% off` : `₹${b.value} each`}`).join(' · ')

/** What is wrong with a rule's ladder, in words, or null. */
export function breakRuleProblem(r: Pick<QtyBreakRule, 'target' | 'targetId' | 'breaks'>): string | null {
  if (r.target !== 'all' && !r.targetId) return 'Choose what the rule is for.'
  if (!r.breaks.length) return 'Add at least one step, such as 10 or more at 5% off.'
  const seen = new Set<number>()
  for (const b of r.breaks) {
    if (!(b.minQty > 0)) return 'Every step needs a quantity above zero.'
    if (seen.has(b.minQty)) return `Two steps start at ${b.minQty}.`
    seen.add(b.minQty)
    if (!isFiniteNum(b.value) || b.value < 0) return 'A step cannot be negative.'
    if (b.kind === 'pct' && b.value > 100) return 'A percentage cannot be more than 100.'
  }
  return null
}
