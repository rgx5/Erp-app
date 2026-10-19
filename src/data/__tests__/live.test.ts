/**
 * Live integration test against a real Krishna Collection API (NestJS + PostgreSQL).
 *
 * Skipped unless KOSH_LIVE_API is set, so `npm test` stays hermetic. To run it:
 *
 *   1. Start the Krishna backend on a throwaway database, migrate it, provision a store and (optionally) run its
 *      `seed-demo` script so there is realistic data to hydrate.
 *   2. KOSH_LIVE_API=http://localhost:8081/api KOSH_LIVE_EMAIL=owner@x.in KOSH_LIVE_PASSWORD=... npx jest live
 *
 * It drives the app's real API client, snapshot hydration, ops and sync engine — the same code the phone runs — and
 * then reads the server's own view back to prove the two agree.
 */
import { createApi, type Snapshot } from '../api'
import { connectWithPassword, getApi, getToken, setToken } from '../auth'
import { listOf } from '../state'
import { MemoryStorage } from '../memory'
import { setStorage } from '../storage'
import { flushWrites, perform, useApp } from '../store'
import { createSyncEngine, initialSyncState, type SyncState } from '../sync'
import { snapshotToData } from '../snapshot'
import {
  addExpense, adjustStock, closeDay, createItem, openDay, processReturn, receivePurchase, saveBill, saveCategory, saveCoupon, saveCustomer, saveStaff, saveSupplier, updateSettings,
} from '../ops'
import { priceCart } from '@/domain/cart'
import { round2 } from '@/domain/money'
import type { BillItem, OutboxEntry } from '@/domain/types'

jest.mock('expo-crypto', () => ({}))
jest.mock('../secure', () => {
  const mem = new Map<string, string>()
  return {
    secureGet: async (k: string) => mem.get(k) ?? null,
    secureSet: async (k: string, v: string) => { mem.set(k, v) },
    secureDelete: async (k: string) => { mem.delete(k) },
  }
})

const API = process.env.KOSH_LIVE_API
const EMAIL = process.env.KOSH_LIVE_EMAIL ?? ''
const PASSWORD = process.env.KOSH_LIVE_PASSWORD ?? ''
const suite = API ? describe : describe.skip
/** Makes every run's records unique, so the test can be run again against the same database. */
const RUN = Date.now().toString(36).slice(-5).toUpperCase()
const PHONE = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`

suite('live: the app against a real Krishna server', () => {
  let state: SyncState = initialSyncState()
  const engine = () => createSyncEngine({
    api: () => getApi(),
    token: () => getToken(),
    setToken: (t) => { void setToken(t) },
    outbox: () => useApp.getState().outbox,
    updateOutbox: (id, patch) => useApp.getState().updateOutbox(id, patch),
    applySnapshot: async (snap) => { const s = useApp.getState(); await s.replaceData(snapshotToData(snap, s.data), { keepOutbox: true }) },
    isOnline: () => true,
    getState: () => state,
    setState: (p) => { state = { ...state, ...p } },
  })
  const data = () => useApp.getState().data
  const server = async (): Promise<Snapshot> => createApi(API!, getToken).snapshot()

  beforeAll(async () => {
    setStorage(new MemoryStorage())
    await useApp.getState().boot()
    await connectWithPassword(API!, EMAIL, PASSWORD)
    await flushWrites()
  })

  test('signing in downloads the whole business', async () => {
    const snap = await server()
    const d = data()
    expect(useApp.getState().workspace).toMatchObject({ mode: 'remote', storeId: snap.store!.id })
    expect(listOf(d.products)).toHaveLength(snap.products.length)
    expect(listOf(d.variants)).toHaveLength(snap.variants.length)
    expect(listOf(d.customers)).toHaveLength(snap.customers.length)
    expect(listOf(d.bills).filter((b) => b.status !== 'held')).toHaveLength(snap.bills.length)
    expect(d.store!.name).toBe(snap.store!.name)
    expect(snap.products.length).toBeGreaterThan(0)
  })

  test('bills the server holds re-price to the same totals with the ported engine', async () => {
    const store = data().store!
    let checked = 0
    const bad: string[] = []
    for (const b of listOf(data().bills)) {
      if (b.status === 'held' || b.refundOfBillId || !b.items.length || b.total <= 0) continue
      const lines = b.items.map((i: BillItem) => ({
        variantId: i.variantId, sku: i.sku, barcode: i.barcode, name: i.name, size: i.size, color: i.color, hsn: i.hsn, mrp: i.mrp, price: i.price, qty: i.qty, stock: 9999,
        discountType: i.discountType, discountValue: i.discountValue, unit: i.unit, priceOverridden: i.priceOverridden,
      }))
      const t = priceCart(lines, b.billDiscountType, b.billDiscountValue, store.slabs, store.priceIncludesTax)
      checked++
      if (round2(t.total) !== round2(b.total)) bad.push(`${b.no}: server ${b.total} vs app ${t.total}`)
    }
    expect(checked).toBeGreaterThan(20)
    // Report every mismatch at once rather than stopping at the first.
    expect(bad).toEqual([])
  })

  test('everything a phone can do uploads cleanly and the server ends up agreeing', async () => {
    const eng = engine()
    const base = listOf(data().variants).find((v) => v.price > 0 && v.stock >= 10)!
    const cat = listOf(data().categories)[0]
    const customer = listOf(data().customers)[0]

    // new catalogue
    const made = perform((s, c) => createItem(s, { name: 'Live Test Shirt', styleCode: `LT-${RUN}`, categoryId: cat.id, brand: 'Live', fabric: 'Cotton', season: 'All', hsn: '6205', sizes: ['M', 'L'], colors: ['Teal'], cost: 400, mrp: 1299, price: 999 }, c))
    expect(made.variants).toHaveLength(2)
    const [vM, vL] = made.variants

    // buying
    const sup = perform((s, c) => saveSupplier(s, { name: `Live Mills ${RUN}`, phone: PHONE(), gstin: '', address: '', openingBalance: 0 }, undefined, c))
    const grn = perform((s, c) => receivePurchase(s, { supplierId: sup.supplier.id, date: c.now, invoiceRef: 'LV-1', items: [{ variantId: vM.id, qty: 10, cost: 410 }, { variantId: vL.id, qty: 5, cost: 420 }], total: 10 * 410 + 5 * 420, paid: 2000, notes: '' }, c))
    expect(grn.purchase.no).toMatch(/^GRN-/)

    // selling: a registered customer, loyalty earned, a second sale of an existing server item
    const live = () => data().variants[vM.id]
    const lines = [{ variantId: vM.id, productId: vM.productId, sku: vM.sku, barcode: vM.barcode, name: 'Live Test Shirt', size: 'M', color: 'Teal', hsn: '6205', mrp: 1299, price: 999, qty: 2, stock: live().stock, discountType: 'amt' as const, discountValue: 0, cost: live().avgCost ?? live().cost }]
    const store = data().store!
    const t = priceCart(lines, 'amt', 0, store.slabs, store.priceIncludesTax)
    const items: BillItem[] = t.items.map((i) => ({ ...i, soldBy: useApp.getState().session!.userId }))
    const sale = perform((s, c) => saveBill(s, {
      date: c.now, customerId: customer.id, items, grossMrp: t.grossMrp, itemDiscount: t.itemDiscount, billDiscountType: 'amt', billDiscountValue: 0, billDiscount: t.billDiscount, coupon: '',
      subtotal: t.subtotal, taxableTotal: t.taxableTotal, cgstTotal: t.cgstTotal, sgstTotal: t.sgstTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total,
      payments: [{ mode: 'cash', amount: t.total }], paid: t.total, changeDue: 0, loyaltyEarned: 20, loyaltyRedeemed: 0, creditUsed: 0, cashierId: useApp.getState().session!.userId,
      soldBy: useApp.getState().session!.userId, status: 'paid', notes: '',
    }, c))
    expect(sale.bill.no).toMatch(/^INV-.+-0001$/)

    // returning one of the two
    const ret = perform((s, c) => processReturn(s, sale.bill.id, [{ variantId: vM.id, qty: 1 }], 'cash', c, 'Live test'))
    expect(ret.creditNote.total).toBeLessThan(0)

    // stock, money, people, settings
    perform((s, c) => adjustStock(s, vL.id, -1, 'adjust', 'MANUAL', 'Damaged', c))
    perform((_s, c) => addExpense({ date: c.now, category: 'Transport', amount: 321, mode: 'cash', vendor: 'Live', note: 'live test', recurring: false }, c))
    const newCustomer = perform((s, c) => saveCustomer(s, { name: 'Live Customer', phone: PHONE(), email: '', dob: '', anniversary: '', address: '', gstin: '', notes: '' }, undefined, c))
    perform((s, c) => saveCustomer(s, { ...customer, notes: 'edited live' }, customer.id, c))
    perform((s, c) => saveCoupon(s, { code: `LIVE${RUN}`, type: 'pct', value: 10, minBill: 500, maxUses: 0, active: true }, undefined, c))
    perform((s, c) => saveCategory(s, { name: `Live Category ${RUN}`, group: 'Live' }, c))
    perform((_s, c) => updateSettings({ footerNote: 'live footer' }, c))
    const day = perform((s, c) => openDay(s, 1000, c))
    perform((s, c) => closeDay(s, day.session.id, 1500, c))
    // an edit to a variant the phone just created, and to one the server already had
    perform((s, c) => adjustStock(s, base.id, -1, 'adjust', 'MANUAL', 'Sample', c))

    const queued = useApp.getState().outbox.filter((o) => o.synced === 0)
    expect(queued.length).toBeGreaterThan(10)

    await eng.flush()

    const left = useApp.getState().outbox.filter((o) => o.synced !== 1).map((o) => `${o.entity}: ${o.lastError}`)
    expect(left).toEqual([])
    expect(state.rejected).toBe(0)

    // what the server now holds is what the phone predicted
    const snap = await server()
    const sv = new Map(snap.variants.map((v) => [v.id, v]))
    expect(sv.get(vM.id)!.stock).toBe(live().stock) // 10 received − 2 sold + 1 returned
    expect(sv.get(vM.id)!.stock).toBe(9)
    expect(sv.get(vL.id)!.stock).toBe(4) // 5 received − 1 damaged
    expect(sv.get(base.id)!.stock).toBe(base.stock - 1)
    expect(sv.get(vM.id)!.cost).toBe(410)

    const sb = snap.bills.find((b) => b.id === sale.bill.id)!
    expect(sb.total).toBe(sale.bill.total)
    expect(sb.status).toBe('partial-return')
    expect(snap.bills.find((b) => b.id === ret.creditNote.id)).toMatchObject({ refundOfBillId: sale.bill.id, status: 'returned' })

    const sc = snap.customers.find((c) => c.id === customer.id)!
    expect(sc.notes).toBe('edited live')
    expect(snap.customers.some((c) => c.id === newCustomer.customer.id)).toBe(true)

    const po = snap.purchases.find((p) => p.id === grn.purchase.id)!
    expect(po).toMatchObject({ total: grn.purchase.total, paid: 2000, supplierId: sup.supplier.id })
    expect(snap.suppliers.some((x) => x.id === sup.supplier.id)).toBe(true)
    expect(snap.expenses.some((e) => e.amount === 321 && e.category === 'Transport')).toBe(true)
    expect(snap.coupons?.some((c) => c.code === `LIVE${RUN}`)).toBe(true)
    expect(snap.categories.some((c) => c.name === `Live Category ${RUN}`)).toBe(true)
    expect(snap.store!.footerNote).toBe('live footer')
    const ss = snap.sessions.find((x) => x.id === day.session.id)!
    expect(ss).toMatchObject({ openingCash: 1000, countedCash: 1500 })
    expect(ss.closedAt).toBeTruthy()

    // the stock ledger on the server has a row for each movement we made
    const mv = snap.moves.filter((m) => m.variantId === vM.id).map((m) => `${m.type}:${m.qty}`).sort()
    expect(mv).toEqual(['purchase:10', 'return:1', 'sale:-2'])

    // a fresh download over the top of local data changes nothing that matters
    expect(await eng.pull()).toBe(true)
    expect(data().variants[vM.id].stock).toBe(9)
    expect(data().bills[sale.bill.id].status).toBe('partial-return')
  })

  test('retrying the same upload is harmless (409 means already there)', async () => {
    const eng = engine()
    const some = useApp.getState().outbox.filter((o) => o.synced === 1 && (o.entity === 'bill' || o.entity === 'customer'))
    expect(some.length).toBeGreaterThan(0)
    for (const o of some) await useApp.getState().updateOutbox(o.id, { synced: 0, attempts: 0 })
    await eng.flush()
    expect(useApp.getState().outbox.filter((o) => o.synced !== 1)).toEqual([])
  })

  test('a second phone numbers its invoices from its own series, so the two can never collide', async () => {
    const a = useApp.getState().workspace!.deviceTag
    const billNos = listOf(data().bills).map((b) => b.no)
    expect(a).toMatch(/^M/)
    expect(billNos.some((n) => n.includes(`-${a}-`))).toBe(true)
  })

  /** Runs a throwaway outbox through the real engine with a given sign-in, as another person's phone would. */
  async function runAs(token: string, entries: Array<Pick<OutboxEntry, 'entity' | 'payload'>>) {
    const rows: OutboxEntry[] = entries.map((e, i) => ({ id: i + 1, entity: e.entity, payload: e.payload, createdAt: 1, synced: 0, attempts: 0 }))
    let st = initialSyncState()
    const e = createSyncEngine({
      api: () => createApi(API!, () => token),
      token: () => token,
      setToken: () => {},
      outbox: () => rows,
      updateOutbox: async (id, patch) => { Object.assign(rows.find((r) => r.id === id)!, patch) },
      applySnapshot: async () => {},
      isOnline: () => true,
      getState: () => st,
      setState: (patch) => { st = { ...st, ...patch } },
    })
    for (let i = 0; i < 5; i++) await e.flush() // a refused row is retried a few times, then set aside
    return { rows, st }
  }

  test('staff: the owner adds a cashier, who signs in with a PIN and sees only what the role allows', async () => {
    const ws = useApp.getState().workspace!
    const hired = perform((s, c) => saveStaff(s, { name: 'Live Cashier', role: 'cashier', code: String(10 + Math.floor(Math.random() * 89)), active: true }, undefined, { plain: '4321' }, c))
    await engine().flush()
    expect(useApp.getState().outbox.filter((o) => o.synced !== 1)).toEqual([])

    const list = await createApi(API!).staff(ws.storeId!)
    expect(list.find((u) => u.id === hired.user.id)).toMatchObject({ name: 'Live Cashier', role: 'cashier', code: hired.user.code })
    expect(JSON.stringify(list)).not.toMatch(/pin|hash/i) // the public list never carries credentials

    await expect(createApi(API!).pinLogin(ws.storeId!, hired.user.id, '0000')).rejects.toMatchObject({ status: 401 })
    const login = await createApi(API!).pinLogin(ws.storeId!, hired.user.id, '4321')
    expect(login.user.role).toBe('cashier')

    // a cashier's snapshot leaves out suppliers, purchases, expenses and the stock ledger
    const snap = await createApi(API!, () => login.token).snapshot()
    expect(snap.suppliers).toEqual([])
    expect(snap.purchases).toEqual([])
    expect(snap.expenses).toEqual([])
    expect(snap.moves).toEqual([])
    expect(snap.products.length).toBeGreaterThan(0)

    // the server, not the app, enforces the role: a cashier's product write is refused and set aside, not retried forever
    const forbidden = await runAs(login.token, [{ entity: 'expense', payload: { id: 'exp_forbidden', date: Date.now(), category: 'Transport', amount: 1, mode: 'cash', vendor: '', note: '', recurring: false } }])
    expect(forbidden.rows[0].synced).toBe(2)
    expect(forbidden.rows[0].lastError).toMatch(/^403/)
    expect(forbidden.st.rejected).toBe(1)
  })

  test('two phones racing for one invoice number: the second sale is never silently dropped', async () => {
    const snap = await server()
    const taken = snap.bills.find((b) => !b.refundOfBillId && b.status === 'paid')!
    const imposter = { ...taken, id: `bill_imposter_${Date.now()}` } // same invoice number, different sale
    const token = getToken()!
    const r = await runAs(token, [{ entity: 'bill', payload: imposter }])
    expect(r.rows[0].synced).toBe(2)
    expect(r.rows[0].lastError).toMatch(/already used on another device/)
    expect(r.st.lastError).toMatch(/taken by another device/)
    expect((await server()).bills.some((b) => b.id === imposter.id)).toBe(false)
  })

  test('fractional quantities and services behave: fabric by the metre, a service that never touches stock', async () => {
    const cat = listOf(data().categories)[0]
    const fabric = perform((s, c) => createItem(s, { name: 'Live Fabric', styleCode: `LF-${RUN}`, categoryId: cat.id, brand: '', fabric: '', season: '', hsn: '5208', sizes: [''], colors: [''], cost: 80, mrp: 220, price: 180, unit: 'm', fractional: true, step: 0.25, openingStock: 20 }, c))
    const service = perform((s, c) => createItem(s, { name: 'Live Alteration', styleCode: `LS-${RUN}`, categoryId: cat.id, brand: '', fabric: '', season: '', hsn: '9988', sizes: [''], colors: [''], cost: 0, mrp: 150, price: 150, trackStock: false }, c))
    const [fv] = fabric.variants, [sv] = service.variants
    const store = data().store!
    const mk = (v: typeof fv, qty: number, name: string, unit?: string) => ({ variantId: v.id, productId: v.productId, sku: v.sku, barcode: v.barcode, name, size: '', color: '', hsn: '', mrp: v.mrp, price: v.price, qty, stock: 20, discountType: 'amt' as const, discountValue: 0, unit })
    const t = priceCart([mk(fv, 2.5, 'Live Fabric', 'm'), mk(sv, 1, 'Live Alteration')], 'amt', 0, store.slabs, store.priceIncludesTax)
    const uid = useApp.getState().session!.userId
    const bill = perform((s, c) => saveBill(s, {
      date: c.now, customerId: null, items: t.items.map((i) => ({ ...i, soldBy: uid })), grossMrp: t.grossMrp, itemDiscount: t.itemDiscount, billDiscountType: 'amt', billDiscountValue: 0, billDiscount: t.billDiscount, coupon: '',
      subtotal: t.subtotal, taxableTotal: t.taxableTotal, cgstTotal: t.cgstTotal, sgstTotal: t.sgstTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total,
      payments: [{ mode: 'upi', amount: t.total }], paid: t.total, changeDue: 0, loyaltyEarned: 0, loyaltyRedeemed: 0, creditUsed: 0, cashierId: uid, soldBy: uid, status: 'paid', notes: '',
    }, c))
    await engine().flush()
    expect(useApp.getState().outbox.filter((o) => o.synced !== 1)).toEqual([])
    const snap = await server()
    const sf = snap.variants.find((v) => v.id === fv.id)!
    const ss = snap.variants.find((v) => v.id === sv.id)!
    expect(sf.stock).toBe(17.5)
    expect(snap.products.find((p) => p.id === fabric.product.id)).toMatchObject({ unit: 'm', fractional: true, step: 0.25 })
    expect(snap.products.find((p) => p.id === service.product.id)!.trackStock).toBe(false)
    expect(snap.bills.find((b) => b.id === bill.bill.id)!.items.find((i) => i.variantId === fv.id)!.qty).toBe(2.5)
    // Whatever the server does with a service's stock number, the phone must never treat it as something to count.
    expect(data().variants[sv.id].stock).toBe(0)
    await engine().pull()
    const after = data().variants[sv.id]
    expect(data().products[after.productId].trackStock).toBe(false)
    console.log(`service stock on the server after one sale: ${ss.stock}`)
  })

  test('people can type the bare server address: the /api prefix is added for them', async () => {
    const bare = API!.replace(/\/api\/?$/, '')
    const api = createApi(bare)
    expect(api.base).toBe(`${bare}/api`)
    expect((await api.health()).ok).toBe(true)
    expect((await api.webLogin(EMAIL, PASSWORD)).store.id).toBe(useApp.getState().workspace!.storeId)
  })

  test('the token can be swapped for a fresh one', async () => {
    const r = await createApi(API!, getToken).refresh()
    expect(r.token.split('.')).toHaveLength(3)
  })

  test('a wrong password is a clear error, a missing server is a clear error', async () => {
    await expect(createApi(API!).webLogin(EMAIL, 'definitely-wrong')).rejects.toMatchObject({ status: 401 })
    await expect(createApi('http://127.0.0.1:9/api').health()).rejects.toThrow(/Cannot reach/)
  })
})

