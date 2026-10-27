import { listOf } from '@/data/state'
import { ROLE_PERMISSIONS } from '@/domain/permissions'
import { mutationsFromChanges } from '@/replication/client'
import { actorWith, rig } from '@/replication/testkit'
import { allCollectionMetas } from '@/replication/registry'
import { baseState } from '@/data/__tests__/helpers'
import {
  cancelWorkOrder, completeWorkOrder, createJobOrder, issueMaterials, planShortfallOrders, planWorkOrder, receiveCustomerMaterial, receiveOutput, recordQuality, saveRecipe, setJobStage, startWorkOrder,
} from '../ops'
import type { ProductionEntry } from '../types'
import { apply, at, bakery, cakeDraft, doughDraft, recipeIdOf } from './helpers'

const COLLS = ['recipes', 'workOrders', 'productionEntries', 'qualityChecks', 'jobOrders', 'variants', 'moves'] as const

async function same(r: ReturnType<typeof rig>) {
  const server = await r.serverView()
  for (const c of COLLS) expect({ [c]: server[c] }).toEqual({ [c]: r.phone[c] })
  return server
}

describe('manufacturing replication', () => {
  test('collections are registered once', () => {
    const names = allCollectionMetas().map((m) => m.name)
    for (const c of ['recipes', 'workOrders', 'productionEntries', 'qualityChecks', 'jobOrders']) expect(names.filter((n) => n === c)).toHaveLength(1)
  })

  test('a work order from recipe to finished goods: server and phone agree, and stock is exact', async () => {
    const r = rig(bakery())
    await r.seed()
    await r.run((s) => saveRecipe(s, doughDraft(), undefined, at(1)))
    await r.run((s) => saveRecipe(s, cakeDraft({ checklist: [{ label: 'Baked through', critical: true }] }), undefined, at(2)))
    const cake = recipeIdOf(r.phone, 'cake')
    const plan = await r.run((s) => planWorkOrder(s, { recipeId: cake, qty: 20 }, at(3)))
    const parts = await r.run((s) => planShortfallOrders(s, plan.workOrder.id, at(4)))
    const dough = parts.orders[0]
    await r.run((s) => startWorkOrder(s, dough.id, at(5)))
    await r.run((s) => completeWorkOrder(s, dough.id, { goodQty: 4 }, at(6)))
    let server = await same(r)
    expect(server.variants.dough.stock).toBe(4)
    expect(server.variants.flour.stock).toBe(100 - 3.36)

    await r.run((s) => startWorkOrder(s, plan.workOrder.id, at(7)))
    server = await same(r)
    expect(server.variants.dough.stock).toBe(0)
    expect(server.variants.butter.stock).toBe(18.9)
    await r.run((s) => recordQuality(s, plan.workOrder.id, { results: [{ itemId: r.phone.workOrders[plan.workOrder.id].checklist[0].id, pass: true }], qtyChecked: 20 }, at(8)))
    await r.run((s) => completeWorkOrder(s, plan.workOrder.id, { goodQty: 20, returns: [{ variantId: 'box', qty: 0 }] }, at(9)))
    server = await same(r)
    expect(server.variants.cake.stock).toBe(20)
    expect(server.workOrders[plan.workOrder.id].status).toBe('done')
    // stock on the server equals what the movements add up to
    for (const v of listOf(server.variants)) {
      const moved = listOf(server.moves).filter((m) => m.variantId === v.id).reduce((n, m) => n + m.qty, 0)
      expect(Math.round((v.stock - moved) * 1000) / 1000).toBe(bakery().variants[v.id].stock)
    }
  })

  test('cancel returns material; issue and receive replicate; job work and customer jobs replicate', async () => {
    const r = rig(bakery())
    await r.seed()
    await r.run((s) => saveRecipe(s, doughDraft(), undefined, at(1)))
    const rid = recipeIdOf(r.phone, 'dough')
    const a = await r.run((s) => planWorkOrder(s, { recipeId: rid, qty: 5 }, at(2)))
    await r.run((s) => startWorkOrder(s, a.workOrder.id, at(3), { issueNow: false }))
    await r.run((s) => issueMaterials(s, a.workOrder.id, [{ variantId: 'flour', qty: 4 }], at(4)))
    await r.run((s) => receiveOutput(s, a.workOrder.id, { goodQty: 1 }, at(5)))
    await same(r)
    const b = await r.run((s) => planWorkOrder(s, { recipeId: rid, qty: 5 }, at(6)))
    await r.run((s) => startWorkOrder(s, b.workOrder.id, at(7)))
    await r.run((s) => cancelWorkOrder(s, b.workOrder.id, at(8)))
    const server = await same(r)
    expect(server.variants.flour.stock).toBe(96)

    const job = await r.run((s) => createJobOrder(s, { kind: 'job_work', customerId: 'c1', title: 'Stitch 5 shirts', qty: 5, charge: 1000, recipeId: rid, stages: ['Cut', 'Sew'] }, at(9)))
    await r.run((s) => receiveCustomerMaterial(s, job.job.id, { description: 'Cloth', unit: 'm', qty: 10 }, at(10)))
    await r.run((s) => setJobStage(s, job.job.id, 0, true, at(11)))
    await same(r)
  })

  test('the floor and the counter: who may write what', async () => {
    const r = rig(bakery())
    await r.seed()
    await r.run((s) => saveRecipe(s, doughDraft(), undefined, at(1)))
    const rid = recipeIdOf(r.phone, 'dough')
    const cashier = actorWith(ROLE_PERMISSIONS.cashier, 'u_cash')
    const keeper = actorWith(['inventory'], 'u_keeper')
    const base = baseState()
    let seq = 100
    const muts = (c: Parameters<typeof mutationsFromChanges>[1]) => mutationsFromChanges(base, c, { deviceId: 'x', nextSeq: () => ++seq })
    const wo = planWorkOrder(r.phone, { recipeId: rid, qty: 5 }, at(2))
    const forgedRecipe = muts(saveRecipe(r.phone, doughDraft({ name: 'Forged', outputVariantId: 'flour', lines: [{ variantId: 'sugar', qty: 1, wastagePct: 0 }] }), undefined, at(3)).changes).filter((m) => m.coll === 'recipes')
    // a cashier cannot see or plan production
    await expect(r.send(muts(wo.changes).filter((m) => m.coll === 'workOrders'), cashier)).rejects.toThrow(/forbidden/)
    expect(listOf((await r.serverView(cashier)).recipes)).toHaveLength(0)
    expect(listOf((await r.serverView(cashier)).workOrders)).toHaveLength(0)
    // a stock keeper may run orders but not change recipes
    await r.send(muts(wo.changes).filter((m) => m.coll === 'workOrders'), keeper)
    await expect(r.send(forgedRecipe, keeper)).rejects.toThrow(/forbidden/)
    expect(listOf((await r.serverView(keeper)).recipes)).toHaveLength(1)
    // the counter may take a customer's job
    const job = createJobOrder(r.phone, { kind: 'made_to_order', customerId: 'c1', title: 'Cake', qty: 1 }, at(4))
    await r.send(muts(job.changes).filter((m) => m.coll === 'jobOrders'), cashier)
    expect(listOf((await r.serverView()).jobOrders)).toHaveLength(1)
    // production entries are never edited
    const started = startWorkOrder(apply(r.phone, wo), wo.workOrder.id, at(5))
    const entry = (started.changes.put!.productionEntries as unknown as ProductionEntry[])[0]
    await r.send(muts({ put: { productionEntries: [entry] } }), keeper)
    const edit = muts({ put: { productionEntries: [{ ...entry, value: 1 }] } })
    await r.send(edit, keeper).catch(() => undefined)
    expect((await r.serverView()).productionEntries[entry.id].value).toBe(entry.value)
  })
})
