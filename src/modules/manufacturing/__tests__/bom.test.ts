import { OpError } from '@/data/ops'
import { applyChanges, listOf } from '@/data/state'
import { batchesFor, costRecipe, findCycle, goodPerBatch, marginPct, rawMaterials, recipeFor, requirements } from '../bom'
import { deleteRecipe, planWorkOrder, saveRecipe, setRecipeActive } from '../ops'
import { convertQty, unitChoices } from '../units'
import { apply, at, bakery, cakeDraft, doughDraft, recipeIdOf, withRecipes } from './helpers'

describe('units', () => {
  test('converts within a family and refuses across families', () => {
    expect(convertQty(500, 'g', 'kg')).toBe(0.5)
    expect(convertQty(2, 'kg', 'g')).toBe(2000)
    expect(convertQty(250, 'ml', 'l')).toBe(0.25)
    expect(convertQty(2, 'dozen', 'pc')).toBe(24)
    expect(convertQty(3, undefined, 'pc')).toBe(3)
    expect(convertQty(3, 'box', 'box')).toBe(3)
    expect(convertQty(1, 'kg', 'l')).toBeNull()
    expect(convertQty(1, 'box', 'pc')).toBeNull()
  })
  test('lists the units an item can use', () => {
    expect(unitChoices('kg')).toEqual(['mg', 'g', 'kg'])
    expect(unitChoices('box')).toEqual(['box'])
  })
})

describe('recipes', () => {
  test('saving numbers the recipe and refuses nonsense', () => {
    const s = bakery()
    const r = saveRecipe(s, doughDraft(), undefined, at(1))
    expect(r.recipe).toMatchObject({ code: 'R-001', active: true, yieldPct: 100 })
    const b = apply(s, r)
    expect(saveRecipe(b, cakeDraft(), undefined, at(2)).recipe.code).toBe('R-002')
    expect(() => saveRecipe(s, doughDraft({ name: ' ' }), undefined, at(1))).toThrow('name')
    expect(() => saveRecipe(s, doughDraft({ outputQty: 0 }), undefined, at(1))).toThrow('batch')
    expect(() => saveRecipe(s, doughDraft({ yieldPct: 120 }), undefined, at(1))).toThrow('Yield')
    expect(() => saveRecipe(s, doughDraft({ lines: [] }), undefined, at(1))).toThrow('ingredient')
    expect(() => saveRecipe(s, doughDraft({ lines: [{ variantId: 'flour', qty: 1, wastagePct: 100 }] }), undefined, at(1))).toThrow('Wastage')
    expect(() => saveRecipe(s, doughDraft({ lines: [{ variantId: 'flour', qty: 1, wastagePct: 0 }, { variantId: 'flour', qty: 1, wastagePct: 0 }] }), undefined, at(1))).toThrow('twice')
    expect(() => saveRecipe(s, doughDraft({ lines: [{ variantId: 'dough', qty: 1, wastagePct: 0 }] }), undefined, at(1))).toThrow('item it makes')
    expect(() => saveRecipe(s, doughDraft({ lines: [{ variantId: 'flour', qty: 1, unit: 'l', wastagePct: 0 }] }), undefined, at(1))).toThrow('does not convert')
    expect(() => saveRecipe(s, doughDraft({ lines: [{ variantId: 'nope', qty: 1, wastagePct: 0 }] }), undefined, at(1))).toThrow(OpError)
  })

  test('only one active recipe per item; switch it off to make another', () => {
    const s = withRecipes()
    expect(() => saveRecipe(s, doughDraft({ name: 'Dough v2' }), undefined, at(3))).toThrow('already an active recipe')
    const off = apply(s, setRecipeActive(s, recipeIdOf(s, 'dough'), false, at(3)))
    expect(recipeFor(off, 'dough')).toBeUndefined()
    const v2 = apply(off, saveRecipe(off, doughDraft({ name: 'Dough v2' }), undefined, at(4)))
    expect(recipeFor(v2, 'dough')?.name).toBe('Dough v2')
    expect(() => setRecipeActive(v2, recipeIdOf(off, 'dough'), true, at(5))).toThrow('already an active')
  })

  test('a loop through a part’s own recipe is refused when the old recipe is switched off', () => {
    let s = withRecipes()
    s = apply(s, setRecipeActive(s, recipeIdOf(s, 'dough'), false, at(3)))
    expect(() => saveRecipe(s, doughDraft({ name: 'Dough v2', lines: [{ variantId: 'cake', qty: 1, wastagePct: 0 }] }), undefined, at(4))).toThrow('Dough → Chocolate cake → Dough')
    // an inactive draft is no loop yet, and cannot be switched on later
    const draft = apply(s, saveRecipe(s, doughDraft({ name: 'Dough v2', active: false, lines: [{ variantId: 'cake', qty: 1, wastagePct: 0 }] }), undefined, at(4)))
    const id = Object.values(draft.recipes).find((r) => r.name === 'Dough v2')!.id
    expect(() => setRecipeActive(draft, id, true, at(5))).toThrow('loop')
  })

  test('findCycle names the chain', () => {
    const s = withRecipes()
    const cake = Object.values(s.recipes).find((r) => r.outputVariantId === 'cake')!
    const bad = { ...Object.values(s.recipes).find((r) => r.outputVariantId === 'dough')!, lines: [{ variantId: 'cake', qty: 1, wastagePct: 0 }] }
    expect(findCycle(listOf(s.recipes), bad)).toEqual(['dough', 'cake', 'dough'])
    expect(findCycle(listOf(s.recipes), cake)).toBeNull()
    expect(() => saveRecipe(s, { ...doughDraft(), lines: [{ variantId: 'cake', qty: 1, wastagePct: 0 }] }, recipeIdOf(s, 'dough'), at(9))).toThrow('loop')
  })

  test('a recipe with work orders cannot be deleted', () => {
    let s = withRecipes()
    const id = recipeIdOf(s, 'cake')
    s = apply(s, planWorkOrder(s, { recipeId: id, qty: 10 }, at(3)))
    expect(() => deleteRecipe(s, id, at(4))).toThrow('switch it off')
    const d = recipeIdOf(s, 'dough')
    expect(applyChanges(s, deleteRecipe(s, d, at(4)).changes).recipes[d]).toBeUndefined()
  })
})

describe('costing', () => {
  test('rolls the cost of parts up through their own recipes', () => {
    const s = withRecipes()
    const cake = Object.values(s.recipes).find((r) => r.outputVariantId === 'cake')!
    const c = costRecipe(s, cake)
    // dough 2 kg @ 43.60 = 87.20; butter 0.55 kg @ 400 = 220; boxes 10 @ 10 = 100
    expect(c.lines.map((l) => [l.variantId, l.source, l.qty, l.cost])).toEqual([['dough', 'recipe', 2, 87.2], ['butter', 'stock', 0.55, 220], ['box', 'stock', 10, 100]])
    expect(c).toMatchObject({ materials: 407.2, labour: 100, overhead: 50, total: 557.2, perUnit: 55.72, qty: 10, warnings: [] })
    expect(c.lines[0].sub?.lines.map((l) => [l.variantId, l.qty])).toEqual([['flour', 1.68], ['sugar', 0.4]])
  })

  test('is live: a dearer ingredient raises the cost at once', () => {
    let s = withRecipes()
    const cake = Object.values(s.recipes).find((r) => r.outputVariantId === 'cake')!
    s = { ...s, variants: { ...s.variants, flour: { ...s.variants.flour, avgCost: 80 } } }
    // flour 1.68 @ 80 = 134.4, sugar 20 → dough 154.4 for 2 kg = 77.2/kg … cake materials 154.4 + 220 + 100
    expect(costRecipe(s, cake).materials).toBe(474.4)
  })

  test('a "buy" line uses the item’s own cost, not its recipe', () => {
    const s0 = withRecipes({ cake: { lines: [{ variantId: 'dough', qty: 2, wastagePct: 0, buy: true }, { variantId: 'box', qty: 10, wastagePct: 0 }] } })
    const s = { ...s0, variants: { ...s0.variants, dough: { ...s0.variants.dough, avgCost: 50, cost: 50 } } }
    const cake = Object.values(s.recipes).find((r) => r.outputVariantId === 'cake')!
    const c = costRecipe(s, cake)
    expect(c.lines[0]).toMatchObject({ source: 'stock', unitCost: 50, cost: 100 })
  })

  test('customer-supplied material costs nothing; items with no cost are flagged', () => {
    const s = withRecipes({ cake: { lines: [{ variantId: 'dough', qty: 2, wastagePct: 0, customerSupplied: true }, { variantId: 'box', qty: 10, wastagePct: 0 }] } })
    const cake = Object.values(s.recipes).find((r) => r.outputVariantId === 'cake')!
    expect(costRecipe(s, cake).lines[0]).toMatchObject({ source: 'customer', cost: 0 })
    const free = { ...s, variants: { ...s.variants, box: { ...s.variants.box, cost: 0, avgCost: 0 } } }
    expect(costRecipe(free, cake).warnings).toEqual(['Cake box has no cost yet'])
  })

  test('yield raises the cost of each good unit', () => {
    const s = withRecipes({ cake: { yieldPct: 80 } })
    const cake = Object.values(s.recipes).find((r) => r.outputVariantId === 'cake')!
    expect(goodPerBatch(cake)).toBe(8)
    expect(costRecipe(s, cake).perUnit).toBe(69.65)
    expect(batchesFor(cake, 16)).toBe(2)
  })

  test('scales requirements to the quantity with wastage', () => {
    const s = withRecipes()
    const cake = Object.values(s.recipes).find((r) => r.outputVariantId === 'cake')!
    expect(requirements(s, cake, 20).map((l) => [l.variantId, l.baseQty, l.qty])).toEqual([['dough', 4, 4], ['butter', 1, 1.1], ['box', 20, 20]])
  })

  test('opens every level down to the raw materials', () => {
    const s = withRecipes()
    const cake = Object.values(s.recipes).find((r) => r.outputVariantId === 'cake')!
    expect(rawMaterials(s, cake, 10)).toEqual([{ variantId: 'flour', qty: 1.68 }, { variantId: 'sugar', qty: 0.4 }, { variantId: 'butter', qty: 0.55 }, { variantId: 'box', qty: 10 }])
  })

  test('margin', () => {
    expect(marginPct(500, 55.72)).toBe(88.9)
    expect(marginPct(0, 5)).toBeNull()
  })
})
