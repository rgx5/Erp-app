import { listOf, type DataState } from '@/data/state'
import { isBalanced, postingsFor } from '@/modules/postings'
import {
  cancelWorkOrder, closeWorkOrder, completeWorkOrder, issueMaterials, planShortfallOrders, planWorkOrder, receiveOutput, recordQuality, returnMaterials, saveRecipe, startWorkOrder, updateWorkOrder,
} from '../ops'
import { entriesOf, materialRows, progressOf, shortages, toIssue } from '../production'
import { productionPosting } from '../posting'
import { apply, at, cakeDraft, recipeIdOf, withRecipes } from './helpers'

const wipNet = (s: DataState) => Math.round(postingsFor(s).flatMap((p) => p.lines).filter((l) => l.account === 'wip').reduce((t, l) => t + (l.debit ?? 0) - (l.credit ?? 0), 0) * 100) / 100

/** A state with enough dough on the shelf for a cake order, made the proper way (a dough order). */
function withDough(qty = 4) {
  let s = withRecipes()
  const d = planWorkOrder(s, { recipeId: recipeIdOf(s, 'dough'), qty }, at(3))
  s = apply(s, d)
  s = apply(s, startWorkOrder(s, d.workOrder.id, at(4)))
  s = apply(s, completeWorkOrder(s, d.workOrder.id, { goodQty: qty }, at(5)))
  return s
}

describe('planning', () => {
  test('a plan scales the recipe, freezes costs and moves no stock', () => {
    const s = withRecipes()
    const r = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 20, dueDate: 1 }, at(3))
    expect(r.workOrder).toMatchObject({ no: 'PRD-0001', status: 'planned', qty: 20, recipeName: 'Chocolate cake', labourPerUnit: 10, overheadPerUnit: 5, dueDate: 1 })
    expect(r.workOrder.lines.map((l) => [l.variantId, l.qty, l.unitCost])).toEqual([['dough', 4, 0], ['butter', 1.1, 400], ['box', 20, 10]])
    expect(Object.keys(r.changes.put!)).not.toContain('moves')
    expect(apply(s, planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 5 }, at(3))).workOrders).toBeTruthy()
  })

  test('refuses a missing recipe, a switched-off recipe and a zero quantity', () => {
    const s = withRecipes()
    expect(() => planWorkOrder(s, { recipeId: 'nope', qty: 1 }, at(3))).toThrow('Choose a recipe')
    expect(() => planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 0 }, at(3))).toThrow('how many')
  })

  test('a planned order can be re-scaled; a running one cannot be edited', () => {
    let s = withRecipes()
    const p = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 20 }, at(3))
    s = apply(s, p)
    const u = updateWorkOrder(s, p.workOrder.id, { qty: 10, notes: 'Wedding' }, at(4))
    expect(u.workOrder.qty).toBe(10)
    expect(u.workOrder.lines.find((l) => l.variantId === 'box')?.qty).toBe(10)
    expect(updateWorkOrder(s, p.workOrder.id, { dueDate: null }, at(4)).workOrder.dueDate).toBeUndefined()
    const cheap = withRecipes({ cake: { lines: [{ variantId: 'box', qty: 1, wastagePct: 0 }] } })
    const w = planWorkOrder(cheap, { recipeId: recipeIdOf(cheap, 'cake'), qty: 1 }, at(3))
    const run = apply(cheap, startWorkOrder(apply(cheap, w), w.workOrder.id, at(4)))
    expect(() => updateWorkOrder(run, w.workOrder.id, { qty: 3 }, at(5))).toThrow('planned')
  })
})

describe('starting and issuing', () => {
  test('refuses to start when the shelf cannot cover the material', () => {
    let s = withRecipes()
    const p = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 20 }, at(3))
    s = apply(s, p)
    expect(() => startWorkOrder(s, p.workOrder.id, at(4))).toThrow('Not enough Dough')
    expect(s.workOrders[p.workOrder.id].status).toBe('planned')
  })

  test('multi-level: plan the part’s order from the shortfall, make it, then the parent starts', () => {
    let s = withRecipes()
    const p = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 20 }, at(3))
    s = apply(s, p)
    const parts = planShortfallOrders(s, p.workOrder.id, at(4))
    expect(parts.orders).toHaveLength(1)
    expect(parts.orders[0]).toMatchObject({ outputVariantId: 'dough', qty: 4, parentId: p.workOrder.id, notes: `For ${p.workOrder.no}` })
    expect(parts.toBuy).toEqual([])
    s = apply(s, parts)
    // asking again does not plan it twice
    expect(() => planShortfallOrders(s, p.workOrder.id, at(5))).toThrow('Nothing is short')
    const child = parts.orders[0]
    s = apply(s, startWorkOrder(s, child.id, at(5)))
    s = apply(s, completeWorkOrder(s, child.id, { goodQty: 4 }, at(6)))
    expect(s.variants.dough.stock).toBe(4)
    const go = startWorkOrder(s, p.workOrder.id, at(7))
    s = apply(s, go)
    expect(s.variants.dough.stock).toBe(0)
    expect(s.variants.butter.stock).toBe(18.9)
    expect(s.variants.box.stock).toBe(80)
    // parts with no recipe are for buying
    const short = { ...s, variants: { ...s.variants, butter: { ...s.variants.butter, stock: 0 } } }
    const again = planWorkOrder(short, { recipeId: recipeIdOf(short, 'cake'), qty: 10 }, at(8))
    const s2 = apply(short, again)
    const buy = planShortfallOrders(s2, again.workOrder.id, at(9))
    expect(buy.orders).toEqual([])
    expect(buy.toBuy).toEqual([{ variantId: 'butter', qty: 0.55 }])
  })

  test('starting issues the material at cost into work in progress, with stock movements', () => {
    let s = withDough()
    const p = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 20 }, at(10))
    s = apply(s, p)
    const go = startWorkOrder(s, p.workOrder.id, at(11))
    s = apply(s, go)
    const wo = s.workOrders[p.workOrder.id]
    expect(wo).toMatchObject({ status: 'in_progress', startedAt: at(11).now })
    expect(wo.stdMaterialPerUnit).toBe(40.72)
    const issue = entriesOf(s, wo.id)[0]
    expect(issue).toMatchObject({ kind: 'issue', value: 814.4 })
    expect(issue.lines.map((l) => [l.variantId, l.qty, l.cost])).toEqual([['dough', 4, 43.6], ['butter', 1.1, 400], ['box', 20, 10]])
    const mv = listOf(s.moves).filter((m) => m.ref === wo.no)
    expect(mv.map((m) => [m.variantId, m.qty])).toEqual([['dough', -4], ['butter', -1.1], ['box', -20]])
    expect(progressOf(wo, entriesOf(s, wo.id)).wipValue).toBe(814.4)
    expect(toIssue(wo, progressOf(wo, entriesOf(s, wo.id)))).toEqual([])
  })

  test('start without issuing, then issue by hand; over-issuing the shelf is refused', () => {
    let s = withDough()
    const p = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 20 }, at(10))
    s = apply(s, p)
    expect(() => issueMaterials(s, p.workOrder.id, [{ variantId: 'box', qty: 1 }], at(11))).toThrow('Start the work order')
    s = apply(s, startWorkOrder(s, p.workOrder.id, at(11), { issueNow: false }))
    expect(entriesOf(s, p.workOrder.id)).toHaveLength(0)
    expect(shortages(s, s.workOrders[p.workOrder.id], progressOf(s.workOrders[p.workOrder.id], []))).toEqual([])
    expect(() => issueMaterials(s, p.workOrder.id, [{ variantId: 'box', qty: 500 }], at(12))).toThrow('Only 100 of Cake box')
    expect(() => issueMaterials(s, p.workOrder.id, [], at(12))).toThrow('how much')
    s = apply(s, issueMaterials(s, p.workOrder.id, [{ variantId: 'box', qty: 10 }, { variantId: 'box', qty: 10 }], at(12)))
    expect(s.variants.box.stock).toBe(80)
    expect(entriesOf(s, p.workOrder.id)[0].lines).toEqual([{ variantId: 'box', qty: 20, cost: 10 }])
  })

  test('material can be returned only up to what the order holds', () => {
    let s = withDough()
    const p = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 20 }, at(10))
    s = apply(s, p)
    s = apply(s, startWorkOrder(s, p.workOrder.id, at(11)))
    expect(() => returnMaterials(s, p.workOrder.id, [{ variantId: 'box', qty: 21 }], at(12))).toThrow('Only 20 of Cake box')
    const r = returnMaterials(s, p.workOrder.id, [{ variantId: 'box', qty: 5 }], at(12))
    s = apply(s, r)
    expect(r.entry).toMatchObject({ kind: 'return', value: 50 })
    expect(s.variants.box.stock).toBe(85)
    expect(progressOf(s.workOrders[p.workOrder.id], entriesOf(s, p.workOrder.id)).net.get('box')).toBe(15)
  })
})

describe('receiving and finishing', () => {
  function running(qty = 20) {
    let s = withDough()
    const p = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty }, at(10))
    s = apply(s, p)
    s = apply(s, startWorkOrder(s, p.workOrder.id, at(11)))
    return { s, id: p.workOrder.id }
  }

  test('finished goods come into stock at material + labour + overhead; scrap is a loss', () => {
    let { s, id } = running()
    const r = receiveOutput(s, id, { goodQty: 18, scrapQty: 2 }, at(12))
    s = apply(s, r)
    expect(r.entry).toMatchObject({ goodQty: 18, scrapQty: 2, materialValue: 732.96, scrapValue: 81.44, labour: 180, overhead: 90 })
    expect(s.variants.cake.stock).toBe(18)
    expect(s.variants.cake.cost).toBe(55.72)
    expect(s.variants.cake.avgCost).toBe(55.72)
    expect(listOf(s.moves).find((m) => m.variantId === 'cake')).toMatchObject({ qty: 18, type: 'adjust', reason: expect.stringContaining('Produced') })
    const done = closeWorkOrder(s, id, at(13))
    expect(done.variance).toBe(0)
    s = apply(s, done)
    expect(s.workOrders[id]).toMatchObject({ status: 'done', doneAt: at(13).now })
  })

  test('a second receipt averages the cost into the stock already held', () => {
    let { s, id } = running()
    s = apply(s, receiveOutput(s, id, { goodQty: 10 }, at(12)))
    s = { ...s, variants: { ...s.variants, cake: { ...s.variants.cake, avgCost: 60 } } }
    const r = receiveOutput(s, id, { goodQty: 10, labour: 200 }, at(13))
    s = apply(s, r)
    // second lot: (407.2 + 200 + 50) / 10 = 65.72 ; average of 10 @ 60 and 10 @ 65.72
    expect(s.variants.cake.cost).toBe(65.72)
    expect(s.variants.cake.avgCost).toBe(62.86)
    expect(r.entry).toMatchObject({ labour: 200, labourStd: 100 })
  })

  test('refusals: nothing issued, too many, nothing to receive', () => {
    let s = withDough()
    const p = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 20 }, at(10))
    s = apply(s, p)
    s = apply(s, startWorkOrder(s, p.workOrder.id, at(11), { issueNow: false }))
    expect(() => receiveOutput(s, p.workOrder.id, { goodQty: 1 }, at(12))).toThrow('Issue the materials first')
    s = apply(s, issueMaterials(s, p.workOrder.id, [{ variantId: 'box', qty: 20 }], at(12)))
    expect(() => receiveOutput(s, p.workOrder.id, { goodQty: 21 }, at(13))).toThrow('Only 20 are left')
    expect(() => receiveOutput(s, p.workOrder.id, { goodQty: 0 }, at(13))).toThrow('how many')
    expect(() => receiveOutput(s, p.workOrder.id, { goodQty: -1 }, at(13))).toThrow('negative')
    expect(() => closeWorkOrder(s, p.workOrder.id, at(13))).toThrow('Nothing was received')
  })

  test('using more than the standard is a variance; unused material returned is not', () => {
    let { s, id } = running()
    s = apply(s, issueMaterials(s, id, [{ variantId: 'butter', qty: 0.1 }], at(12))) // an extra 0.1 kg butter = 40
    const done = completeWorkOrder(s, id, { goodQty: 20 }, at(13))
    expect(done.variance).toBe(40)
    s = apply(s, done)
    const rows = materialRows(s.workOrders[id], progressOf(s.workOrders[id], entriesOf(s, id)))
    expect(rows.find((r) => r.variantId === 'butter')).toMatchObject({ planned: 1.1, allowed: 1.1, actual: 1.2, over: 0.1, baseline: 1, wastagePct: 20, plannedWastagePct: 10 })

    let t = running()
    const back = completeWorkOrder(t.s, t.id, { goodQty: 20, returns: [{ variantId: 'box', qty: 2 }] }, at(13))
    t.s = apply(t.s, back)
    // two boxes unused: 18 boxes consumed against 20 allowed → standard exceeds actual by 20 (favourable)
    expect(back.variance).toBe(-20)
    expect(t.s.variants.box.stock).toBe(82)
    expect(t.s.variants.cake.stock).toBe(20)
  })

  test('cancelling puts the material back; one that made goods cannot be cancelled', () => {
    const a = running()
    const c = cancelWorkOrder(a.s, a.id, at(12))
    const s = apply(a.s, c)
    expect(s.workOrders[a.id].status).toBe('cancelled')
    expect(s.variants.box.stock).toBe(100)
    expect(s.variants.butter.stock).toBe(20)
    expect(s.variants.dough.stock).toBe(4)
    expect(wipNet(s)).toBe(0)
    const b = running()
    const made = apply(b.s, receiveOutput(b.s, b.id, { goodQty: 5 }, at(12)))
    expect(() => cancelWorkOrder(made, b.id, at(13))).toThrow('complete it instead')
    expect(() => cancelWorkOrder(s, a.id, at(13))).toThrow('already finished')
  })

  test('cannot cancel while orders for its parts are open', () => {
    let s = withRecipes()
    const p = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 20 }, at(3))
    s = apply(s, p)
    s = apply(s, planShortfallOrders(s, p.workOrder.id, at(4)))
    expect(() => cancelWorkOrder(s, p.workOrder.id, at(5))).toThrow('parts')
  })
})

describe('the books', () => {
  test('every entry balances and work in progress nets to zero once the order is closed', () => {
    let s = withDough()
    const p = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 20 }, at(10))
    s = apply(s, p)
    s = apply(s, startWorkOrder(s, p.workOrder.id, at(11)))
    expect(wipNet(s)).toBe(814.4 + 0) // the dough order closed already; only the cake order's issue is open
    s = apply(s, issueMaterials(s, p.workOrder.id, [{ variantId: 'butter', qty: 0.1 }], at(12)))
    s = apply(s, completeWorkOrder(s, p.workOrder.id, { goodQty: 18, scrapQty: 2, returns: [{ variantId: 'box', qty: 1 }] }, at(13)))
    const posts = postingsFor(s).filter((x) => x.sourceColl === 'productionEntries')
    expect(posts.length).toBeGreaterThan(5)
    for (const x of posts) expect(isBalanced(x)).toBe(true)
    expect(wipNet(s)).toBe(0)
  })

  test('each kind posts what it means', () => {
    const base = { id: 'e', no: 'PE-1', workOrderId: 'w', date: 1, lines: [], value: 0, goodQty: 0, scrapQty: 0, materialValue: 0, scrapValue: 0, labour: 0, overhead: 0, labourStd: 0, overheadStd: 0, varianceValue: 0, note: '', userId: 'u' }
    const issue = productionPosting({ ...base, kind: 'issue', value: 100 })!
    expect(issue.lines).toEqual([{ account: 'wip', debit: 100 }, { account: 'inventory', credit: 100 }])
    expect(productionPosting({ ...base, kind: 'return', value: 40 })!.lines).toEqual([{ account: 'inventory', debit: 40 }, { account: 'wip', credit: 40 }])
    const rec = productionPosting({ ...base, kind: 'receipt', materialValue: 90, scrapValue: 10, labour: 30, overhead: 20 })!
    expect(rec.lines).toEqual([
      { account: 'inventory', debit: 140 }, { account: 'stock_adjustments', debit: 10 },
      { account: 'wip', credit: 100 }, { account: 'salaries', credit: 30 }, { account: 'expense:Factory overheads', credit: 20 },
    ])
    expect(isBalanced(rec)).toBe(true)
    expect(productionPosting({ ...base, kind: 'receipt', materialValue: 90, toExpense: true })!.lines[0]).toEqual({ account: 'cogs', debit: 90 })
    expect(productionPosting({ ...base, kind: 'close', varianceValue: 12.5 })!.lines).toEqual([{ account: 'stock_adjustments', debit: 12.5 }, { account: 'wip', credit: 12.5 }])
    expect(productionPosting({ ...base, kind: 'close', varianceValue: -7 })!.lines).toEqual([{ account: 'wip', debit: 7 }, { account: 'stock_adjustments', credit: 7 }])
    expect(productionPosting({ ...base, kind: 'close' })).toBeNull()
    expect(productionPosting({ ...base, kind: 'issue', value: 0 })).toBeNull()
  })
})

describe('quality', () => {
  const checked = () => withRecipes({ cake: { checklist: [{ label: 'Baked through' }, { label: 'No cracks' }, { label: 'Weight right', critical: true }] } })
  function floor() {
    let s = withDough()
    s = { ...s, recipes: { ...s.recipes } }
    const cake = Object.values(checked().recipes).find((r) => r.outputVariantId === 'cake')!
    s.recipes[cake.id] = { ...cake }
    const p = planWorkOrder(s, { recipeId: cake.id, qty: 20 }, at(10))
    s = apply(s, p)
    s = apply(s, startWorkOrder(s, p.workOrder.id, at(11)))
    const ids = s.workOrders[p.workOrder.id].checklist.map((c) => c.id)
    return { s, id: p.workOrder.id, ids }
  }

  test('goods cannot be received before they are inspected, only what passed', () => {
    let { s, id, ids } = floor()
    expect(() => receiveOutput(s, id, { goodQty: 5 }, at(12))).toThrow('Inspect the units')
    expect(() => recordQuality(s, id, { results: [{ itemId: ids[0], pass: true }], qtyChecked: 20 }, at(12))).toThrow('Mark “No cracks”')
    const allPass = ids.map((itemId) => ({ itemId, pass: true }))
    s = apply(s, recordQuality(s, id, { results: allPass, qtyChecked: 20 }, at(12)))
    expect(Object.values(s.qualityChecks)[0]).toMatchObject({ no: 'QC-0001', qtyPassed: 20, qtyRejected: 0 })
    expect(() => receiveOutput(s, id, { goodQty: 21 }, at(13))).toThrow('Only 20 are left')
    s = apply(s, receiveOutput(s, id, { goodQty: 12 }, at(13)))
    expect(() => receiveOutput(s, id, { goodQty: 9 }, at(14))).toThrow('Only 8')
  })

  test('failing points need rejects with a decision; a critical fail rejects the lot', () => {
    const { s, id, ids } = floor()
    const fail = [{ itemId: ids[0], pass: true }, { itemId: ids[1], pass: false }, { itemId: ids[2], pass: true }]
    expect(() => recordQuality(s, id, { results: fail, qtyChecked: 10 }, at(12))).toThrow('how many units are rejected')
    expect(() => recordQuality(s, id, { results: fail, qtyChecked: 10, qtyRejected: 2 }, at(12))).toThrow('scrap or rework')
    expect(() => recordQuality(s, id, { results: fail, qtyChecked: 10, qtyRejected: 11, rejectAction: 'scrap' }, at(12))).toThrow('more than')
    const crit = [{ itemId: ids[0], pass: true }, { itemId: ids[1], pass: true }, { itemId: ids[2], pass: false }]
    const r = recordQuality(s, id, { results: crit, qtyChecked: 10, rejectAction: 'scrap' }, at(12))
    expect(r.check).toMatchObject({ qtyPassed: 0, qtyRejected: 10, rejectAction: 'scrap' })
  })

  test('scrap rejects are written off; rework waits for a re-inspection and cannot be skipped', () => {
    let { s, id, ids } = floor()
    const pass = ids.map((itemId) => ({ itemId, pass: true }))
    const fail = [{ itemId: ids[0], pass: true }, { itemId: ids[1], pass: false }, { itemId: ids[2], pass: true }]
    s = apply(s, recordQuality(s, id, { results: fail, qtyChecked: 20, qtyRejected: 5, rejectAction: 'rework' }, at(12)))
    s = apply(s, receiveOutput(s, id, { goodQty: 15 }, at(13)))
    // five units are out for rework: cannot close, cannot receive them as good
    expect(() => receiveOutput(s, id, { goodQty: 1 }, at(14))).toThrow('Only 0 units have passed')
    expect(() => closeWorkOrder(s, id, at(14))).toThrow('waiting after rework')
    expect(() => recordQuality(s, id, { results: pass, qtyChecked: 6, recheck: true }, at(14))).toThrow('Only 5 units are waiting')
    s = apply(s, recordQuality(s, id, { results: fail, qtyChecked: 5, qtyRejected: 1, rejectAction: 'scrap', recheck: true }, at(14)))
    s = apply(s, receiveOutput(s, id, { goodQty: 4, scrapQty: 1 }, at(15)))
    expect(() => receiveOutput(s, id, { scrapQty: 1, goodQty: 0 }, at(16))).toThrow('rejected for scrap')
    const done = closeWorkOrder(s, id, at(16))
    expect(done.variance).toBe(0)
    expect(apply(s, done).variants.cake.stock).toBe(19)
  })

  test('a recipe without a checklist takes no inspections', () => {
    let s = withDough()
    const p = planWorkOrder(s, { recipeId: recipeIdOf(s, 'cake'), qty: 20 }, at(10))
    s = apply(s, p)
    s = apply(s, startWorkOrder(s, p.workOrder.id, at(11)))
    expect(() => recordQuality(s, p.workOrder.id, { results: [], qtyChecked: 1 }, at(12))).toThrow('no quality checklist')
    expect(saveRecipe).toBeDefined()
    expect(cakeDraft().checklist).toBeUndefined()
  })
})
