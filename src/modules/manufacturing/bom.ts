import { variantLabel } from '@/domain/codes'
import { round2 } from '@/domain/money'
import { costFor } from '@/domain/pricing'
import { round3 } from '@/domain/qty'
import { listOf, type DataState } from '@/data/state'
import { convertQty } from './units'
import type { Recipe, RecipeLine, WoLine } from './types'

// ───────────────────────────── items ─────────────────────────────

export function itemName(state: DataState, variantId: string): string {
  const v = state.variants[variantId]
  if (!v) return 'Unknown item'
  const p = state.products[v.productId]
  const opt = variantLabel(v.size, v.color)
  return `${p?.name ?? v.sku}${opt ? ` · ${opt}` : ''}`
}

/** The unit an item's stock is counted in. */
export const stockUnitOf = (state: DataState, variantId: string): string => {
  const v = state.variants[variantId]
  return (v && state.products[v.productId]?.unit) || 'pc'
}

/** Whether stock is kept for the item (a service or a charge is not). */
export const tracksStock = (state: DataState, variantId: string): boolean => {
  const v = state.variants[variantId]
  return !!v && state.products[v.productId]?.trackStock !== false
}

/** What one unit of the item costs now, on the store's cost basis. */
export const currentCost = (state: DataState, variantId: string): number => {
  const v = state.variants[variantId]
  return v ? costFor(v, state.store?.costBasis) : 0
}

/** A recipe line's quantity in the item's own unit, or `null` when its unit does not fit the item. */
export const lineQtyInStockUnit = (state: DataState, line: Pick<RecipeLine, 'variantId' | 'qty' | 'unit'>): number | null =>
  convertQty(line.qty, line.unit, stockUnitOf(state, line.variantId))

// ───────────────────────────── recipes ─────────────────────────────

/** The active recipe that makes this item (the most recently changed, if there are several). */
export function recipeFor(state: DataState, variantId: string, recipes: Recipe[] = listOf(state.recipes)): Recipe | undefined {
  return recipes.filter((r) => r.active && r.outputVariantId === variantId).sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

/**
 * If `candidate` (as it would be saved) makes something that is, directly or through its parts' own recipes, one of its own
 * ingredients, the chain of items that closes the loop (starting and ending at the output); otherwise `null`.
 */
export function findCycle(recipes: Recipe[], candidate: Recipe): string[] | null {
  const all = recipes.filter((r) => r.id !== candidate.id).concat(candidate)
  const makerOf = (variantId: string) => all.filter((r) => r.active && r.outputVariantId === variantId).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const walk = (variantId: string, path: string[]): string[] | null => {
    const r = makerOf(variantId)
    if (!r) return null
    for (const l of r.lines) {
      if (l.customerSupplied) continue
      if (l.variantId === candidate.outputVariantId) return [...path, l.variantId]
      if (path.includes(l.variantId)) continue
      const hit = walk(l.variantId, [...path, l.variantId])
      if (hit) return hit
    }
    return null
  }
  return walk(candidate.outputVariantId, [candidate.outputVariantId])
}

/** Good units one batch is meant to give. */
export const goodPerBatch = (r: Pick<Recipe, 'outputQty' | 'yieldPct'>) => round3((r.outputQty * r.yieldPct) / 100)

/** How many batches it takes to get `qty` good units. */
export const batchesFor = (r: Pick<Recipe, 'outputQty' | 'yieldPct'>, qty: number) => {
  const per = goodPerBatch(r)
  return per > 0 ? qty / per : 0
}

/** The materials needed for `qty` good units, wastage included, as work-order lines (costs at today's stock cost). */
export function requirements(state: DataState, recipe: Recipe, qty: number): WoLine[] {
  const b = batchesFor(recipe, qty)
  const out: WoLine[] = []
  for (const l of recipe.lines) {
    const per = lineQtyInStockUnit(state, l)
    if (per === null) continue
    const base = round3(per * b)
    const need = round3(base * (1 + l.wastagePct / 100))
    out.push({
      variantId: l.variantId, baseQty: base, qty: need, wastagePct: l.wastagePct,
      unitCost: l.customerSupplied ? 0 : currentCost(state, l.variantId),
      ...(l.customerSupplied ? { customerSupplied: true } : {}),
    })
  }
  return out
}

// ───────────────────────────── costing ─────────────────────────────

export interface CostLine {
  variantId: string
  /** Quantity needed with wastage, in the item's own unit. */
  qty: number
  baseQty: number
  wastagePct: number
  unitCost: number
  cost: number
  /** Where the unit cost comes from: the item's stock cost, its own recipe rolled up, or the customer's material (free). */
  source: 'stock' | 'recipe' | 'customer'
  /** For `recipe`: the costing of the part, for the quantity needed. */
  sub?: RecipeCost
}

export interface RecipeCost {
  recipeId: string
  /** The good units this costing is for. */
  qty: number
  lines: CostLine[]
  materials: number
  labour: number
  overhead: number
  total: number
  perUnit: number
  /** Things a person should look at: an item with no cost, a unit that does not fit. */
  warnings: string[]
}

/**
 * Live cost of making `qty` good units (default: one batch's worth) from today's item costs. A line whose item has a recipe of
 * its own is costed from that recipe, all the way down, unless the line says `buy`.
 */
export function costRecipe(state: DataState, recipe: Recipe, qty = goodPerBatch(recipe), seen: string[] = []): RecipeCost {
  const warnings: string[] = []
  const b = batchesFor(recipe, qty)
  const lines: CostLine[] = []
  for (const l of recipe.lines) {
    const per = lineQtyInStockUnit(state, l)
    if (per === null) { warnings.push(`${itemName(state, l.variantId)}: the unit ${l.unit} does not fit`); continue }
    const base = round3(per * b)
    const need = round3(base * (1 + l.wastagePct / 100))
    if (l.customerSupplied) {
      lines.push({ variantId: l.variantId, qty: need, baseQty: base, wastagePct: l.wastagePct, unitCost: 0, cost: 0, source: 'customer' })
      continue
    }
    const sub = !l.buy && !seen.includes(recipe.id) ? recipeFor(state, l.variantId) : undefined
    if (sub && !seen.includes(sub.id) && sub.id !== recipe.id) {
      const c = costRecipe(state, sub, need, [...seen, recipe.id])
      warnings.push(...c.warnings)
      lines.push({ variantId: l.variantId, qty: need, baseQty: base, wastagePct: l.wastagePct, unitCost: need > 0 ? round2(c.total / need) : 0, cost: c.total, source: 'recipe', sub: c })
      continue
    }
    const unit = currentCost(state, l.variantId)
    if (!(unit > 0)) warnings.push(`${itemName(state, l.variantId)} has no cost yet`)
    lines.push({ variantId: l.variantId, qty: need, baseQty: base, wastagePct: l.wastagePct, unitCost: unit, cost: round2(need * unit), source: 'stock' })
  }
  const materials = round2(lines.reduce((s, l) => s + l.cost, 0))
  const labour = round2(recipe.labourPerBatch * b)
  const overhead = round2(recipe.overheadPerBatch * b)
  const total = round2(materials + labour + overhead)
  return { recipeId: recipe.id, qty, lines, materials, labour, overhead, total, perUnit: qty > 0 ? round2(total / qty) : 0, warnings: [...new Set(warnings)] }
}

/** Every raw material (items with no recipe of their own, or marked `buy`) needed for `qty`, found by opening every level. */
export function rawMaterials(state: DataState, recipe: Recipe, qty: number, seen: string[] = []): Array<{ variantId: string; qty: number }> {
  const totals = new Map<string, number>()
  const add = (variantId: string, q: number) => totals.set(variantId, round3((totals.get(variantId) ?? 0) + q))
  const b = batchesFor(recipe, qty)
  for (const l of recipe.lines) {
    if (l.customerSupplied) continue
    const per = lineQtyInStockUnit(state, l)
    if (per === null) continue
    const need = round3(per * b * (1 + l.wastagePct / 100))
    const sub = !l.buy ? recipeFor(state, l.variantId) : undefined
    if (sub && !seen.includes(sub.id) && sub.id !== recipe.id) for (const x of rawMaterials(state, sub, need, [...seen, recipe.id])) add(x.variantId, x.qty)
    else add(l.variantId, need)
  }
  return [...totals.entries()].map(([variantId, q]) => ({ variantId, qty: q }))
}

/** Selling price against cost: margin as a % of the price (null when the item has no price). */
export function marginPct(price: number, cost: number): number | null {
  return price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null
}
