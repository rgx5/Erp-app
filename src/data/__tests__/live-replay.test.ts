/**
 * Live replay: a whole generated business (45 days of trading in one of the eight industries) is uploaded to a real
 * Krishna server through the app's own sync engine, then the server's books are compared with the phone's.
 *
 * It exists to find disagreements between what the app creates and what the server accepts or does — the kind a
 * hand-written test never thinks of (a single item with no size, a fractional quantity, a service with no stock,
 * a coupon, a return paid back as store credit, a cash-drawer day…).
 *
 * Skipped unless KOSH_LIVE_API and KOSH_LIVE_PACK are set. Needs an *empty* store provisioned for it:
 *   KOSH_LIVE_API=http://localhost:8081/api KOSH_LIVE_PACK=grocery KOSH_LIVE_EMAIL=… KOSH_LIVE_PASSWORD=… npx jest live-replay
 */
import { createApi, type Snapshot } from '../api'
import { connectWithPassword, getApi, getToken, setToken } from '../auth'
import { buildDemo } from '../demo'
import { MemoryStorage } from '../memory'
import { listOf, type OutboxDraft } from '../state'
import { setStorage } from '../storage'
import { flushWrites, useApp } from '../store'
import { createSyncEngine, initialSyncState, type SyncState } from '../sync'
import { snapshotToData } from '../snapshot'
import type { Bill, Variant } from '@/domain/types'
import { round2 } from '@/domain/money'

jest.mock('expo-crypto', () => ({}))
jest.mock('../secure', () => {
  const mem = new Map<string, string>()
  return { secureGet: async (k: string) => mem.get(k) ?? null, secureSet: async (k: string, v: string) => { mem.set(k, v) }, secureDelete: async (k: string) => { mem.delete(k) } }
})

const API = process.env.KOSH_LIVE_API
const PACK = process.env.KOSH_LIVE_PACK
const EMAIL = process.env.KOSH_LIVE_EMAIL ?? ''
const PASSWORD = process.env.KOSH_LIVE_PASSWORD ?? ''
const suite = API && PACK ? describe : describe.skip

suite(`live replay: ${PACK}`, () => {
  jest.setTimeout(600_000)
  let state: SyncState = initialSyncState()
  const server = (): Promise<Snapshot> => createApi(API!, getToken).snapshot()

  test('a whole business uploads without a single refusal and the server ends up with the same books', async () => {
    setStorage(new MemoryStorage())
    await useApp.getState().boot()
    await connectWithPassword(API!, EMAIL, PASSWORD)
    await flushWrites()
    const before = await server()
    expect(before.products).toHaveLength(0)
    const serverOwner = before.users.find((u) => u.role === 'owner')!.id

    const demo = buildDemo(PACK!, { pinHash: 'x', days: 30 })
    // The same business before any trading: what each customer started with (the generator is deterministic up to there).
    const day0 = buildDemo(PACK!, { pinHash: 'x', days: 0 })
    const startedWith = new Map(listOf(day0.customers).map((c) => [c.phone, c]))
    const demoOwner = listOf(demo.users).find((u) => u.role === 'owner')!.id
    const uid = (id: string | undefined) => (id === demoOwner ? serverOwner : id)

    // ── turn the finished business back into the ordered list of writes a phone would have queued ──
    const q: Array<OutboxDraft & { at: number; rank: number }> = []
    const put = (entity: OutboxDraft['entity'], payload: unknown, at = 0, rank = 0) => q.push({ entity, payload, at, rank })

    const haveCats = new Set(before.categories.map((c) => c.id))
    for (const c of listOf(demo.categories)) if (!haveCats.has(c.id)) put('category', c)
    for (const u of listOf(demo.users)) if (u.id !== demoOwner) put('user', { id: u.id, name: u.name, role: u.role, active: u.active, code: u.code ?? null, pin: '1234' })
    for (const s of listOf(demo.suppliers)) put('supplier', s)
    for (const c of listOf(demo.customers)) put('customer', { ...c, loyaltyPoints: startedWith.get(c.phone)?.loyaltyPoints ?? 0, storeCredit: startedWith.get(c.phone)?.storeCredit ?? 0 })
    for (const c of listOf(demo.coupons)) put('coupon', c)
    for (const p of listOf(demo.products)) put('product', { ...p, variants: [] })
    const fresh = (v: Variant): Variant => ({ ...v, stock: 0 })
    for (const v of listOf(demo.variants)) put('variant', fresh(v))

    // Stock movements the bills / receipts do not make themselves: opening stock, corrections, counts.
    for (const m of listOf(demo.moves)) if (m.type === 'opening' || m.type === 'adjust' || m.type === 'audit' || m.type === 'transfer') put('stockAdjust', m, m.at, 1)
    for (const p of listOf(demo.purchases)) put('purchase', p, p.date, 2)
    const bills = listOf(demo.bills).filter((b) => b.status !== 'held')
    const asSale = (b: Bill): Bill => ({
      ...b, status: 'paid', cashierId: uid(b.cashierId)!, soldBy: uid(b.soldBy), items: b.items.map((i) => ({ ...i, returnedQty: 0, soldBy: uid(i.soldBy) })),
    })
    for (const b of bills) {
      if (b.refundOfBillId) put('billReturn', { ...b, cashierId: uid(b.cashierId)!, items: b.items.map((i) => ({ ...i, soldBy: uid(i.soldBy) })) }, b.date, 3)
      else put('bill', asSale(b), b.date, 3)
    }
    for (const e of listOf(demo.expenses)) put('expense', e, e.date, 4)
    for (const s of listOf(demo.sessions)) {
      put('session', { id: s.id, openedAt: s.openedAt, openedBy: uid(s.openedBy), openingCash: s.openingCash }, s.openedAt, 5)
      if (s.closedAt) put('sessionUpdate', { id: s.id, closedAt: s.closedAt, closedBy: uid(s.closedBy), countedCash: s.countedCash, expectedCash: s.expectedCash, variance: s.variance }, s.closedAt, 6)
    }
    // The final cost / price / MRP of every variant (receipts update cost; "price later" updates price).
    for (const v of listOf(demo.variants)) {
      put('variantUpdate', { id: v.id, cost: v.cost, avgCost: v.avgCost, price: v.price, mrp: v.mrp, reorderLevel: v.reorderLevel, unpricedSince: v.unpricedSince ?? null }, Number.MAX_SAFE_INTEGER, 9)
    }
    // Catalogue first (rank 0 / at 0 keeps insertion order), then history in the order it happened.
    const sorted = [...q.filter((x) => x.at === 0), ...q.filter((x) => x.at > 0).sort((a, b) => a.at - b.at || a.rank - b.rank)]

    useApp.getState().commit({ outbox: sorted.map(({ entity, payload }) => ({ entity, payload })) })
    expect(useApp.getState().outbox.length).toBe(sorted.length)

    // ── upload ──
    const eng = createSyncEngine({
      api: () => getApi(), token: () => getToken(), setToken: (t) => { void setToken(t) },
      outbox: () => useApp.getState().outbox, updateOutbox: (id, patch) => useApp.getState().updateOutbox(id, patch),
      applySnapshot: async (snap) => { const s = useApp.getState(); await s.replaceData(snapshotToData(snap, s.data), { keepOutbox: true }) },
      isOnline: () => true, getState: () => state, setState: (p) => { state = { ...state, ...p } },
    })
    await eng.flush()
    const notDone = useApp.getState().outbox.filter((o) => o.synced !== 1)
    const sample = notDone.slice(0, 6).map((o) => `${o.entity} → ${o.lastError}`)
    expect({ left: notDone.length, sample }).toEqual({ left: 0, sample: [] })

    // ── compare ──
    const snap = await server()
    const sv = new Map(snap.variants.map((v) => [v.id, v]))
    const stockDiffs: string[] = []
    for (const v of listOf(demo.variants)) {
      const theirs = sv.get(v.id)
      if (!theirs) { stockDiffs.push(`${v.sku}: missing on server`); continue }
      const p = demo.products[v.productId]
      if (p.trackStock === false) continue // the server counts services down too; the phone ignores it
      if (round2(theirs.stock) !== round2(v.stock)) stockDiffs.push(`${v.sku}: server ${theirs.stock} vs phone ${v.stock}`)
    }
    expect(stockDiffs.slice(0, 10)).toEqual([])

    const priceDiffs = listOf(demo.variants).filter((v) => { const t = sv.get(v.id)!; return t.price !== v.price || t.mrp !== v.mrp || round2(t.cost) !== round2(v.cost) || (t.avgCost !== undefined && round2(t.avgCost) !== round2(v.avgCost ?? v.cost)) }).map((v) => v.sku)
    expect(priceDiffs.slice(0, 10)).toEqual([])

    const sb = new Map(snap.bills.map((b) => [b.id, b]))
    const billDiffs: string[] = []
    for (const b of bills) {
      const t = sb.get(b.id)
      if (!t) { billDiffs.push(`${b.no}: missing`); continue }
      if (t.total !== b.total) billDiffs.push(`${b.no}: total ${t.total} vs ${b.total}`)
      if (t.status !== b.status) billDiffs.push(`${b.no}: status ${t.status} vs ${b.status}`)
      if (t.items.length !== b.items.length) billDiffs.push(`${b.no}: ${t.items.length} lines vs ${b.items.length}`)
      if (!b.refundOfBillId && t.items.some((i, k) => i.returnedQty !== b.items[k].returnedQty)) billDiffs.push(`${b.no}: returned qty differs`)
    }
    expect(billDiffs.slice(0, 10)).toEqual([])
    expect(snap.bills.length).toBe(bills.length)

    expect(snap.purchases.map((p) => `${p.no}:${p.total}:${p.paid}`).sort()).toEqual(listOf(demo.purchases).map((p) => `${p.no}:${p.total}:${p.paid}`).sort())
    expect(round2(snap.expenses.reduce((s, e) => s + e.amount, 0))).toBe(round2(listOf(demo.expenses).reduce((s, e) => s + e.amount, 0)))
    expect(snap.sessions.filter((s) => s.closedAt).map((s) => `${s.countedCash}:${s.expectedCash}:${s.variance}`).sort())
      .toEqual(listOf(demo.sessions).filter((s) => s.closedAt).map((s) => `${s.countedCash}:${s.expectedCash}:${s.variance}`).sort())

    // Customers: the server applies each sale's points and credit, and a credit refund's credit. (It does not take points back
    // on a return — the phone does, locally — so for people who returned something the two legitimately differ; see
    // docs/API-CONTRACT.md "Known gaps in the server".)
    const sc = new Map(snap.customers.map((c) => [c.id, c]))
    const returnedBy = new Set(bills.filter((b) => b.refundOfBillId && b.customerId).map((b) => b.customerId))
    const custDiffs: string[] = []
    for (const c of listOf(demo.customers)) {
      const t = sc.get(c.id)!
      const start = startedWith.get(c.phone)
      const mine = bills.filter((b) => b.customerId === c.id)
      const points = round2((start?.loyaltyPoints ?? 0) + mine.filter((b) => !b.refundOfBillId).reduce((n, b) => n + b.loyaltyEarned - b.loyaltyRedeemed, 0))
      const credit = round2((start?.storeCredit ?? 0) - mine.filter((b) => !b.refundOfBillId).reduce((n, b) => n + b.creditUsed, 0)
        + mine.filter((b) => b.refundOfBillId && b.payments[0]?.mode === 'credit').reduce((n, b) => n - b.total, 0))
      if (round2(t.loyaltyPoints) !== points) custDiffs.push(`${c.name}: server points ${t.loyaltyPoints}, bills say ${points}`)
      if (round2(t.storeCredit) !== credit) custDiffs.push(`${c.name}: server credit ${t.storeCredit}, bills say ${credit}`)
      if (!returnedBy.has(c.id) && (c.loyaltyPoints !== t.loyaltyPoints || round2(c.storeCredit) !== round2(t.storeCredit))) custDiffs.push(`${c.name}: phone ${c.loyaltyPoints}/${c.storeCredit} vs server ${t.loyaltyPoints}/${t.storeCredit}`)
    }
    expect(custDiffs.slice(0, 10)).toEqual([])

    // and a fresh download reproduces the phone's own numbers for the dashboard
    const down = snapshotToData(snap)
    expect(listOf(down.bills).length).toBe(bills.length)
    expect(listOf(down.variants).filter((v) => down.products[v.productId]?.trackStock !== false).reduce((s, v) => s + Math.max(0, v.stock), 0))
      .toBeCloseTo(listOf(demo.variants).filter((v) => demo.products[v.productId]?.trackStock !== false).reduce((s, v) => s + Math.max(0, v.stock), 0), 2)
    console.log(`${PACK}: ${sorted.length} writes, ${bills.length} bills, ${listOf(demo.variants).length} variants — all accepted, books agree`)
  })
})
