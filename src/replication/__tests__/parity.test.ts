import { listOf, type DataState } from '@/data/state'
import {
  adjustStock, createItem, deleteProduct, processReturn, receivePurchase, saveBill, saveCustomer, saveSupplier, updateProduct, updateSettings, updateVariant, addExpense, openDay, closeDay,
} from '@/data/ops'
import { baseState, billInput, ctx, line, NOW } from '@/data/__tests__/helpers'
import { applyMutations, pullChanges, mutationsFromChanges, MemoryDocStore, type Actor, type Mutation } from '..'
import { rig as rigKit } from '../testkit'

const owner: Actor = { userId: 'u_owner', can: () => true, branches: 'all' }
const cashierActor: Actor = { userId: 'u_cash', can: (p) => ['pos', 'customers'].includes(p), branches: 'all' }

const rig = (initial: DataState = baseState()) => rigKit(initial, owner)

const without = (d: DataState) => ({ ...d, users: {} })

describe('what the server derives equals what the phone computed', () => {
  test('a day of trading: sales, a return as cash, a return as store credit, receiving, counting', async () => {
    const r = rig()
    await r.seed()

    // a registered customer buys, earns points and uses store credit
    const s0 = r.phone
    const sale1 = await r.run((s) => saveBill(s, billInput(s, [line(s.variants.v1, 3), line(s.variants.v2, 1)], { customerId: 'c1', loyaltyEarned: 25, loyaltyRedeemed: 10, creditUsed: 0 }), ctx({ now: NOW + 1000 })))
    // a walk-in sale
    await r.run((s) => saveBill(s, billInput(s, [line(s.variants.v1, 2)]), ctx({ now: NOW + 2000 })))
    // part of the first sale comes back as cash, then the rest as store credit
    await r.run((s) => processReturn(s, sale1.bill.id, [{ variantId: 'v1', qty: 1 }], 'cash', ctx({ now: NOW + 3000 })))
    await r.run((s) => processReturn(s, sale1.bill.id, [{ variantId: 'v1', qty: 2 }, { variantId: 'v2', qty: 1 }], 'credit', ctx({ now: NOW + 4000 })))
    // goods arrive; a correction; a count
    await r.run((s) => receivePurchase(s, { supplierId: 's1', date: NOW + 5000, invoiceRef: 'B1', items: [{ variantId: 'v1', qty: 6, cost: 420 }, { variantId: 'v2', qty: 4, cost: 410 }], total: 6 * 420 + 4 * 410, paid: 1000, notes: '' }, ctx({ now: NOW + 5000 })))
    await r.run((s) => adjustStock(s, 'v2', -1, 'adjust', 'MANUAL', 'Damaged', ctx({ now: NOW + 6000 })))

    const server = await r.serverView()
    const phone = r.phone
    expect(s0.variants.v1.stock).toBe(10)
    for (const coll of ['variants', 'customers', 'bills', 'moves', 'purchases'] as const) {
      expect(server[coll]).toEqual(phone[coll])
    }
    // the numbers that used to be the server's own job
    expect(server.variants.v1.stock).toBe(phone.variants.v1.stock)
    expect(server.customers.c1.loyaltyPoints).toBe(phone.customers.c1.loyaltyPoints)
    expect(server.customers.c1.storeCredit).toBe(phone.customers.c1.storeCredit)
    expect(server.bills[sale1.bill.id].status).toBe('returned')
    expect(without(server).bills).toEqual(without(phone).bills)
  })

  test('catalogue and people: items, edits, deletes, customers, suppliers, settings, the cash drawer', async () => {
    const r = rig()
    await r.seed()
    const made = await r.run((s) => createItem(s, { name: 'Tee', styleCode: 'TE-1', categoryId: 'cat_mshirt', brand: '', fabric: '', season: '', hsn: '6109', sizes: ['M', 'L'], colors: [''], cost: 100, mrp: 400, price: 300, openingStock: 5 }, ctx({ now: NOW + 100 })))
    await r.run((s) => updateVariant(s, made.variants[0].id, { price: 350 }, ctx({ now: NOW + 200 })))
    await r.run((s) => updateProduct(s, made.product.id, { brand: 'Acme' }, ctx({ now: NOW + 300 })))
    await r.run((s) => saveCustomer(s, { name: 'Nina', phone: '9000000099', email: '', dob: '', anniversary: '', address: '', gstin: '', notes: '' }, undefined, ctx({ now: NOW + 400 })))
    await r.run((s) => saveSupplier(s, { name: 'New Mills', phone: '', gstin: '', address: '', openingBalance: 0 }, undefined, ctx({ now: NOW + 500 })))
    await r.run((s) => ({ changes: updateSettings({ footerNote: 'Thanks!' }, ctx()) }))
    await r.run((_s) => addExpense({ date: NOW, category: 'Rent', amount: 500, mode: 'cash', vendor: '', note: '', recurring: false }, ctx()))
    const day = await r.run((s) => openDay(s, 1000, ctx({ now: NOW + 600 })))
    await r.run((s) => closeDay(s, day.session.id, 1000, ctx({ now: NOW + 700 })))
    await r.run((s) => deleteProduct(s, made.product.id, ctx({ now: NOW + 800 })))

    const server = await r.serverView()
    const phone = r.phone
    for (const coll of ['products', 'variants', 'customers', 'suppliers', 'expenses', 'sessions', 'categories'] as const) expect(server[coll]).toEqual(phone[coll])
    expect(server.store?.footerNote).toBe('Thanks!')
    expect(server.products[made.product.id]).toBeUndefined() // the delete reached the server
    expect(listOf(server.moves).length).toBeGreaterThan(0) // ledger documents survive a product delete
  })

  test('a held (parked) bill never leaves the phone', async () => {
    const r = rig()
    await r.seed()
    await r.run((s) => saveBill(s, billInput(s, [line(s.variants.v1, 1)], { status: 'held' }), ctx({ now: NOW + 10 })))
    expect(listOf((await r.serverView()).bills)).toHaveLength(0)
    expect(r.phone.variants.v1.stock).toBe(10)
  })

  test('a duplicate delivery changes nothing (a retry after a lost reply)', async () => {
    const r = rig()
    await r.seed()
    const sale = await r.run((s) => saveBill(s, billInput(s, [line(s.variants.v1, 2)], { customerId: 'c1', loyaltyEarned: 10 }), ctx({ now: NOW + 10 })))
    const before = await r.serverView()
    await r.send(mutationsFromChanges({ ...r.phone, bills: {}, moves: {} }, { put: { bills: [sale.bill] } }, { deviceId: 'dev1', nextSeq: (() => { let n = 0; return () => ++n })() }).map((m) => ({ ...m, mid: 'dev1:1' })))
    const after = await r.serverView()
    expect(after.variants.v1.stock).toBe(before.variants.v1.stock)
    expect(after.customers.c1.loyaltyPoints).toBe(before.customers.c1.loyaltyPoints)
  })
})

describe('the rules the server enforces', () => {
  const m = (mid: string, coll: string, id: string, op: Mutation['op'], data?: Record<string, unknown>): Mutation => ({ mid, coll, id, op, data, at: 1 })

  test('posted documents cannot be edited or deleted; unknown and managed collections are refused', async () => {
    const db = new MemoryDocStore()
    const bill = { id: 'b1', no: 'INV-1', items: [], total: 10, payments: [], status: 'paid' }
    expect((await applyMutations(db, [m('a:1', 'bills', 'b1', 'create', bill)], owner))[0].status).toBe('ok')
    expect((await applyMutations(db, [m('a:2', 'bills', 'b1', 'patch', { total: 1 })], owner))[0]).toMatchObject({ status: 'rejected', code: 'immutable' })
    expect((await applyMutations(db, [m('a:3', 'bills', 'b1', 'delete')], owner))[0]).toMatchObject({ status: 'rejected', code: 'immutable' })
    expect((await applyMutations(db, [m('a:4', 'bills', 'b1', 'patch', { notes: 'ok' })], owner))[0].status).toBe('ok')
    expect((await applyMutations(db, [m('a:5', 'nothing', 'x', 'create', { id: 'x' })], owner))[0]).toMatchObject({ code: 'unknown_collection' })
    expect((await applyMutations(db, [m('a:6', 'users', 'u', 'create', { id: 'u' })], owner))[0]).toMatchObject({ code: 'managed' })
    expect((await applyMutations(db, [m('a:7', 'bills', 'b2', 'create', { id: 'b2' })], owner))[0]).toMatchObject({ code: 'invalid' })
  })

  test('a role without the permission is refused, and a patch cannot set a field the server owns', async () => {
    const db = new MemoryDocStore()
    expect((await applyMutations(db, [m('c:1', 'products', 'p1', 'create', { id: 'p1', name: 'X' })], cashierActor))[0]).toMatchObject({ code: 'forbidden' })
    await applyMutations(db, [m('o:1', 'variants', 'v1', 'create', { id: 'v1', stock: 0, price: 5 })], owner)
    await applyMutations(db, [m('o:2', 'variants', 'v1', 'patch', { stock: 999, price: 9 })], owner)
    expect((await db.get('variants', 'v1'))!.data).toMatchObject({ stock: 0, price: 9 })
  })

  test('a pull only carries what the role may read', async () => {
    const db = new MemoryDocStore()
    await applyMutations(db, [m('o:1', 'suppliers', 's1', 'create', { id: 's1', name: 'S' }), m('o:2', 'products', 'p1', 'create', { id: 'p1', name: 'P' })], owner)
    const seen = (await pullChanges(db, cashierActor, 0)).upserts.map((u) => u.coll)
    expect(seen).toEqual(['products'])
  })

  test('pulling resumes from a cursor and tells about deletes', async () => {
    const db = new MemoryDocStore()
    await applyMutations(db, [m('o:1', 'products', 'p1', 'create', { id: 'p1', name: 'P' }), m('o:2', 'products', 'p2', 'create', { id: 'p2', name: 'Q' })], owner)
    const first = await pullChanges(db, owner, 0, 1)
    expect(first.upserts).toHaveLength(1)
    expect(first.hasMore).toBe(true)
    await applyMutations(db, [m('o:3', 'products', 'p1', 'delete')], owner)
    const next = await pullChanges(db, owner, first.cursor)
    expect(next.upserts.map((u) => u.id)).toEqual(['p2'])
    expect(next.deletes.map((u) => u.id)).toEqual(['p1'])
    expect(next.hasMore).toBe(false)
  })

  test('one refusal does not hold up the writes behind it, and leaves no trace', async () => {
    const db = new MemoryDocStore()
    const res = await applyMutations(db, [m('o:1', 'products', 'p1', 'patch', { name: 'ghost' }), m('o:2', 'products', 'p2', 'create', { id: 'p2' })], owner)
    expect(res.map((r) => r.status)).toEqual(['rejected', 'ok'])
    expect(await db.get('products', 'p1')).toBeUndefined()
  })
})
