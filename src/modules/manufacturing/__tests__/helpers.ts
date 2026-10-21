import { baseState, ctx, NOW, product, variant } from '@/data/__tests__/helpers'
import { applyChanges, type Changes, type DataState } from '@/data/state'
import { saveRecipe, type RecipeDraft } from '../ops'
import '../replication'

export { baseState, ctx, NOW }
export const DAY = 86_400_000
export const at = (n: number) => ctx({ now: NOW + n })

/**
 * The base shop plus a small bakery: flour, sugar, butter (kg), boxes (pcs), dough (a semi-finished part, kg) and cakes (pcs).
 * Costs: flour 40, sugar 50, butter 400, box 10 — all per unit.
 */
export function bakery(): DataState {
  const s = baseState()
  const p = (id: string, name: string, unit: string) => product({ id, styleCode: id.toUpperCase(), name, unit, fractional: unit === 'kg' })
  s.products = {
    ...s.products,
    pf: p('pf', 'Flour', 'kg'), ps: p('ps', 'Sugar', 'kg'), pb: p('pb', 'Butter', 'kg'), px: p('px', 'Cake box', 'pc'), pd: p('pd', 'Dough', 'kg'), pc: p('pc', 'Chocolate cake', 'pc'),
  }
  const v = (id: string, productId: string, cost: number, stock: number, price = 0) => variant({ id, productId, sku: id.toUpperCase(), barcode: `21${id}`, size: '', color: '', cost, avgCost: cost, mrp: price, price, stock })
  s.variants = {
    ...s.variants,
    flour: v('flour', 'pf', 40, 100), sugar: v('sugar', 'ps', 50, 50), butter: v('butter', 'pb', 400, 20), box: v('box', 'px', 10, 100),
    dough: v('dough', 'pd', 0, 0), cake: v('cake', 'pc', 0, 0, 500),
  }
  return s
}

export const doughDraft = (over: Partial<RecipeDraft> = {}): RecipeDraft => ({
  name: 'Dough', outputVariantId: 'dough', outputQty: 5,
  lines: [{ variantId: 'flour', qty: 4, wastagePct: 5 }, { variantId: 'sugar', qty: 1, wastagePct: 0 }], ...over,
})

export const cakeDraft = (over: Partial<RecipeDraft> = {}): RecipeDraft => ({
  name: 'Chocolate cake', outputVariantId: 'cake', outputQty: 10, labourPerBatch: 100, overheadPerBatch: 50,
  lines: [{ variantId: 'dough', qty: 2, wastagePct: 0 }, { variantId: 'butter', qty: 500, unit: 'g', wastagePct: 10 }, { variantId: 'box', qty: 10, wastagePct: 0 }], ...over,
})

export const apply = (s: DataState, r: { changes: Changes }) => applyChanges(s, r.changes)

/** The bakery with both recipes saved. */
export function withRecipes(over: { cake?: Partial<RecipeDraft> } = {}): DataState {
  let s = bakery()
  s = apply(s, saveRecipe(s, doughDraft(), undefined, at(1)))
  s = apply(s, saveRecipe(s, cakeDraft(over.cake), undefined, at(2)))
  return s
}

export const recipeIdOf = (s: DataState, output: string) => Object.values(s.recipes).find((r) => r.outputVariantId === output)!.id
