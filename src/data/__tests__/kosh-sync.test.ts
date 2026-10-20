import { applyMutations, pullChanges, MemoryDocStore, actorFor } from '@/replication/testserver'
import { listOf } from '../state'
import { MemoryStorage } from '../memory'
import { setStorage } from '../storage'
import { flushWrites, perform, useApp } from '../store'
import { createKoshApi } from '../kosh/api'
import { downloadAll, publishAll } from '../kosh/auth'
import { createKoshSync } from '../kosh/sync'
import { initialSyncState, type SyncState } from '../sync'
import { saveBill, saveCustomer, updateProduct, updateVariant } from '../ops'
import { baseState, billInput, line } from './helpers'
import type { Workspace } from '../store'

jest.mock('expo-crypto', () => ({}))
jest.mock('../secure', () => ({ secureGet: async () => null, secureSet: async () => undefined, secureDelete: async () => undefined }))

/** A Kosh server in memory: the real replication rules behind a fake `fetch`, so the whole client path runs without a network. */
function fakeServer() {
  const db = new MemoryDocStore()
  let down = false
  const calls: string[] = []
  const fetchFn = async (input: string, init?: RequestInit): Promise<Response> => {
    if (down) throw new TypeError('offline')
    const url = new URL(input)
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization?.replace('Bearer ', '') ?? ''
    const actor = actorFor(auth.replace('tok-', '') as 'owner' | 'cashier')
    calls.push(`${init?.method} ${url.pathname}`)
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
    if (url.pathname === '/sync/push') {
      const { mutations } = JSON.parse(String(init!.body))
      return json(200, { results: await applyMutations(db, mutations, actor) })
    }
    if (url.pathname === '/sync/pull') return json(200, await pullChanges(db, actor, Number(url.searchParams.get('since')), Number(url.searchParams.get('limit'))))
    return json(404, { error: 'not found' })
  }
  return { db, fetchFn, calls, setDown: (v: boolean) => { down = v } }
}

const WS = (deviceId: string): Workspace => ({ id: 'org1', name: 'Test', mode: 'remote', backend: 'kosh', industry: 'apparel', apiUrl: 'http://fake', storeId: 'org1', deviceId, deviceTag: 'M4X', barcodeBase: 300_000_000, createdAt: 1 })

async function phone(server: ReturnType<typeof fakeServer>, deviceId: string, role: 'owner' | 'cashier' = 'owner') {
  setStorage(new MemoryStorage())
  useApp.setState({ ready: false, workspace: null, outbox: [], session: null, cursor: 0 })
  await useApp.getState().boot()
  await useApp.getState().setWorkspace(WS(deviceId))
  await useApp.getState().setSession({ userId: 'u_owner' })
  let state: SyncState = initialSyncState()
  const api = () => createKoshApi('http://fake', () => `tok-${role}`, server.fetchFn)
  const eng = createKoshSync({
    api, token: () => `tok-${role}`, setToken: () => {},
    outbox: () => useApp.getState().outbox, updateOutbox: (id, p) => useApp.getState().updateOutbox(id, p),
    applyRemote: (pull, pending) => useApp.getState().applyRemote(pull, pending),
    getCursor: () => useApp.getState().cursor, setCursor: (n) => useApp.getState().setCursor(n),
    isOnline: () => true, getState: () => state, setState: (p) => { state = { ...state, ...p } },
  })
  return { eng, api, get sync() { return state } }
}

describe('a phone and a Kosh server', () => {
  test('a business is published, trading syncs, and the server\'s numbers come back', async () => {
    const server = fakeServer()
    const a = await phone(server, 'devA')
    await useApp.getState().replaceData(baseState())
    useApp.getState().enqueue(publishAll(baseState(), 'devA'))
    await a.eng.syncNow()
    expect(useApp.getState().outbox.every((o) => o.synced === 1)).toBe(true)
    expect(a.sync.pending).toBe(0)

    const sale = perform((s, ctx) => saveBill(s, billInput(s, [line(s.variants.v1, 3)], { customerId: 'c1', loyaltyEarned: 12 }), ctx))
    expect(useApp.getState().outbox.filter((o) => o.synced === 0).map((o) => (o.payload as { coll: string }).coll).sort()).toEqual(['audit', 'bills', 'moves'])
    await a.eng.syncNow()
    expect(useApp.getState().outbox.every((o) => o.synced === 1)).toBe(true)
    // stock was decreased locally, and the server agrees after the round trip
    expect(useApp.getState().data.variants.v1.stock).toBe(7)
    expect(server.db.list('variants').find((v) => v.id === 'v1')!.stock).toBe(7)
    expect(server.db.list('customers').find((c) => c.id === 'c1')!.loyaltyPoints).toBe(62)
    expect(useApp.getState().data.customers.c1.loyaltyPoints).toBe(62)
    expect(server.db.list('bills').map((b) => b.id)).toContain(sale.bill.id)
  })

  test('a second phone downloads the whole business and then only what changes', async () => {
    const server = fakeServer()
    const a = await phone(server, 'devA')
    await useApp.getState().replaceData(baseState())
    useApp.getState().enqueue(publishAll(baseState(), 'devA'))
    await a.eng.syncNow()
    perform((s, ctx) => saveBill(s, billInput(s, [line(s.variants.v2, 1)]), ctx))
    await a.eng.syncNow()
    const phoneA = useApp.getState().data

    const b = await phone(server, 'devB')
    const down = await downloadAll(b.api(), 'org1')
    await useApp.getState().replaceData(down.data)
    await useApp.getState().setCursor(down.cursor)
    const phoneB = useApp.getState().data
    expect(phoneB.variants).toEqual(phoneA.variants)
    expect(phoneB.bills).toEqual(phoneA.bills)
    expect(phoneB.store?.name).toBe(phoneA.store?.name)

    // nothing new: a pull is empty; then A sells and B receives just that
    const before = server.calls.length
    await b.eng.pull()
    expect(server.calls.slice(before)).toEqual(['GET /sync/pull'])
    perform((s, ctx) => saveBill(s, billInput(s, [line(s.variants.v1, 2)]), ctx)) // (still phone B's store: it is the current one)
    await b.eng.syncNow()
    expect(server.db.list('variants').find((v) => v.id === 'v1')!.stock).toBe(8)
  })

  test('edits on two phones to different fields of one record both survive', async () => {
    const server = fakeServer()
    const a = await phone(server, 'devA')
    await useApp.getState().replaceData(baseState())
    useApp.getState().enqueue(publishAll(baseState(), 'devA'))
    await a.eng.syncNow()

    // phone B edits the brand while offline from A's point of view
    const b = await phone(server, 'devB')
    const down = await downloadAll(b.api(), 'org1')
    await useApp.getState().replaceData(down.data)
    await useApp.getState().setCursor(down.cursor)
    perform((s, ctx) => updateProduct(s, 'p1', { brand: 'Acme Co' }, ctx))
    await b.eng.syncNow()

    // phone A (now the current store again) edits the price of a variant and the name of the product in the same minute
    await phone(server, 'devA')
    const down2 = await downloadAll(a.api(), 'org1')
    await useApp.getState().replaceData(down2.data)
    await useApp.getState().setCursor(down2.cursor)
    perform((s, ctx) => updateVariant(s, 'v1', { price: 1099 }, ctx))
    perform((s, ctx) => updateProduct(s, 'p1', { name: 'Oxford Shirt Pro' }, ctx))
    await a.eng.syncNow()

    const p = server.db.list('products').find((x) => x.id === 'p1')!
    expect(p).toMatchObject({ brand: 'Acme Co', name: 'Oxford Shirt Pro' })
    expect(useApp.getState().data.products.p1).toMatchObject({ brand: 'Acme Co', name: 'Oxford Shirt Pro' })
  })

  test('offline work waits in the outbox and goes up when the server is back, once', async () => {
    const server = fakeServer()
    const a = await phone(server, 'devA')
    await useApp.getState().replaceData(baseState())
    useApp.getState().enqueue(publishAll(baseState(), 'devA'))
    await a.eng.syncNow()

    server.setDown(true)
    perform((s, ctx) => saveBill(s, billInput(s, [line(s.variants.v1, 1)]), ctx))
    perform((s, ctx) => saveCustomer(s, { name: 'Nina', phone: '9000000077', email: '', dob: '', anniversary: '', address: '', gstin: '', notes: '' }, undefined, ctx))
    await a.eng.flush()
    expect(a.sync.online).toBe(false)
    const waiting = useApp.getState().outbox.filter((o) => o.synced === 0).length
    expect(waiting).toBeGreaterThan(3)

    server.setDown(false)
    await a.eng.syncNow()
    expect(useApp.getState().outbox.every((o) => o.synced === 1)).toBe(true)
    expect(server.db.list('bills')).toHaveLength(1)
    expect(server.db.list('variants').find((v) => v.id === 'v1')!.stock).toBe(9)
    // the same writes sent again (a lost reply) change nothing
    for (const o of useApp.getState().outbox) await useApp.getState().updateOutbox(o.id, { synced: 0 })
    await a.eng.flush()
    expect(server.db.list('variants').find((v) => v.id === 'v1')!.stock).toBe(9)
    expect(listOf(useApp.getState().data.moves)).toHaveLength(1)
  })

  test('a write the server refuses is set aside with its reason and does not block the rest', async () => {
    const server = fakeServer()
    const owner = await phone(server, 'devA')
    await useApp.getState().replaceData(baseState())
    useApp.getState().enqueue(publishAll(baseState(), 'devA'))
    await owner.eng.syncNow()

    const cashier = await phone(server, 'devC', 'cashier')
    const down = await downloadAll(cashier.api(), 'org1')
    await useApp.getState().replaceData(down.data)
    await useApp.getState().setCursor(down.cursor)
    expect(Object.keys(useApp.getState().data.suppliers)).toHaveLength(0) // a cashier is never sent suppliers
    perform((s, ctx) => updateProduct(s, 'p1', { brand: 'Hacked' }, ctx)) // needs 'inventory'
    perform((s, ctx) => saveBill(s, billInput(s, [line(s.variants.v1, 1)]), ctx))
    await cashier.eng.flush()
    const rows = useApp.getState().outbox
    expect(rows.filter((o) => o.synced === 2).map((o) => o.lastError)).toEqual([expect.stringMatching(/^forbidden/)])
    expect(rows.filter((o) => o.synced === 1).length).toBeGreaterThan(0) // the sale went through
    expect(cashier.sync.rejected).toBe(1)
    expect(server.db.list('products').find((x) => x.id === 'p1')!.brand).not.toBe('Hacked')
  })
})
