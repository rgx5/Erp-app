/**
 * Live end-to-end test: the app's real Kosh client (src/data/kosh) against a real OneSync Server and PostgreSQL.
 *
 * Skipped unless KOSH_LIVE_SERVER is set, so `npm test` stays hermetic (see docs/LIVE-TESTING.md):
 *
 *   KOSH_LIVE_SERVER=spawn npx jest kosh-live
 *       starts the throwaway PostgreSQL (server/scripts/pg.sh), creates a database, builds and boots server/dist/main.js on a
 *       free port, runs the test, then stops the server and drops the database.
 *
 *   KOSH_LIVE_SERVER=http://localhost:8090 npx jest kosh-live
 *       uses a server you already started (server/scripts/dev.sh). Every business it creates is new, so it can be re-run.
 *
 * It drives the same code the phone runs: sign-up (organisation, owner, catalogue upload), a sale rung up while the server is
 * unreachable and synced afterwards, and further devices that sign in and download the business.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { priceCart } from '@/domain/cart'
import type { BillItem } from '@/domain/types'
import { listOf } from '../state'
import { MemoryStorage } from '../memory'
import { setStorage } from '../storage'
import { getToken, setToken } from '../auth'
import { flushWrites, perform, useApp } from '../store'
import { createKoshApi } from '../kosh/api'
import { getKoshApi, koshCreateBusiness, koshLogin, koshPinLogin, koshStaff } from '../kosh/auth'
import { createKoshSync } from '../kosh/sync'
import { initialSyncState, type SyncState } from '../sync'
import { adjustStock, createItem, saveBill, saveCustomer } from '../ops'

jest.mock('expo-crypto', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('node:crypto') as typeof import('node:crypto')
  return {
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    digestStringAsync: async (_alg: string, s: string) => nodeCrypto.createHash('sha256').update(s).digest('hex'),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  }
})
jest.mock('../secure', () => {
  const mem = new Map<string, string>()
  return {
    secureGet: async (k: string) => mem.get(k) ?? null,
    secureSet: async (k: string, v: string) => { mem.set(k, v) },
    secureDelete: async (k: string) => { mem.delete(k) },
  }
})

const SERVER = process.env.KOSH_LIVE_SERVER
const suite = SERVER ? describe : describe.skip
jest.setTimeout(240_000)

const ROOT = join(__dirname, '..', '..', '..')
const RUN = Date.now().toString(36)
const PG_PORT = process.env.PGPORT ?? '5433'

const freePort = () => new Promise<number>((resolve, reject) => {
  const srv = createServer()
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address() as { port: number }; srv.close(() => resolve(port)) })
})

suite('live: the app’s Kosh client against a real OneSync Server', () => {
  let url = ''
  let child: ChildProcess | null = null
  let dbName = ''
  let state: SyncState = initialSyncState()
  let offline = false

  /** The sync engine, wired like src/data/runtime.ts, except that "offline" makes every request fail as a dead network would. */
  const engine = () => createKoshSync({
    api: () => {
      const real = getKoshApi(getToken)
      if (!real) return null
      return createKoshApi(url, getToken, (i, n) => (offline ? Promise.reject(new TypeError('network down')) : fetch(i, n)))
    },
    token: () => getToken(),
    setToken: (t) => { void setToken(t) },
    outbox: () => useApp.getState().outbox,
    updateOutbox: (id, patch) => useApp.getState().updateOutbox(id, patch),
    applyRemote: (pull, pending) => useApp.getState().applyRemote(pull, pending),
    getCursor: () => useApp.getState().cursor,
    setCursor: (n) => useApp.getState().setCursor(n),
    isOnline: () => true,
    getState: () => state,
    setState: (p) => { state = { ...state, ...p } },
  })

  /** A different phone: nothing of the previous one is left. */
  const freshPhone = async () => {
    setStorage(new MemoryStorage())
    useApp.setState({ ready: false, workspace: null, outbox: [], session: null, cursor: 0 })
    await useApp.getState().boot()
    await setToken(null)
    state = initialSyncState()
    offline = false
  }
  const data = () => useApp.getState().data
  const token = () => getToken()!
  const serverPull = async () => {
    const api = createKoshApi(url, token)
    const docs = new Map<string, Record<string, any>>()
    let cursor = 0
    for (;;) {
      const page = await api.pull(cursor, 500)
      for (const u of page.upserts) docs.set(`${u.coll}/${u.id}`, u.data)
      cursor = page.cursor
      if (!page.hasMore) break
    }
    return docs
  }

  beforeAll(async () => {
    if (/^https?:\/\//.test(SERVER!)) { url = SERVER!.replace(/\/+$/, ''); return }
    execFileSync(join(ROOT, 'server', 'scripts', 'pg.sh'), { stdio: 'ignore', timeout: 90_000 })
    dbName = `kosh_live_${process.pid}_${RUN}`.replace(/[^a-z0-9_]/g, '_')
    const psql = (db: string, sql: string) => execFileSync('psql', ['-h', 'localhost', '-p', PG_PORT, '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-d', db, '-c', sql], { stdio: 'ignore' })
    psql('postgres', `CREATE DATABASE ${dbName}`)
    execFileSync(process.execPath, [join(ROOT, 'server', 'scripts', 'build.mjs')], { cwd: join(ROOT, 'server'), stdio: 'ignore', timeout: 90_000 })
    const port = await freePort()
    child = spawn(process.execPath, [join(ROOT, 'server', 'dist', 'main.js')], {
      cwd: join(ROOT, 'server'),
      env: { ...process.env, DATABASE_URL: `postgresql://postgres@localhost:${PG_PORT}/${dbName}`, JWT_SECRET: 'live-test-secret-live-test-secret-live-test', PORT: String(port), HOST: '127.0.0.1', BCRYPT_COST: '4', FILES_DIR: join(ROOT, 'server', 'data', `live-${RUN}`), NODE_ENV: 'development' },
      stdio: 'ignore',
    })
    url = `http://127.0.0.1:${port}`
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${url}/health`)).ok) return } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error('the OneSync server did not start')
  })

  afterAll(async () => {
    if (child) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)) }
    if (dbName) {
      try { execFileSync('psql', ['-h', 'localhost', '-p', PG_PORT, '-U', 'postgres', '-q', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`], { stdio: 'ignore' }) } catch { /* best effort */ }
    }
  })

  const OWNER_EMAIL = `owner.${RUN}@live.test`
  const PASSWORD = 'live-password-123'
  let orgId = ''
  let ownerId = ''
  let variantId = ''
  let customerId = ''
  let billId = ''
  let billNo = ''

  test('the server identifies itself as a OneSync server', async () => {
    const h = await createKoshApi(url).health()
    expect(h).toMatchObject({ app: 'kosh-server' })
  })

  test('phone A signs up a new business; the catalogue and owner reach the server', async () => {
    await freshPhone()
    await koshCreateBusiness(url, { name: `Live Apparel ${RUN}`, ownerName: 'Asha', packId: 'apparel', pin: '1111', email: OWNER_EMAIL, password: PASSWORD, city: 'Pune' })
    const ws = useApp.getState().workspace!
    expect(ws).toMatchObject({ mode: 'remote', backend: 'kosh', apiUrl: url })
    orgId = ws.storeId!
    ownerId = useApp.getState().session!.userId
    expect(useApp.getState().outbox.filter((o) => o.synced === 0).length).toBeGreaterThan(0)

    const a = engine()
    await a.syncNow()
    expect(state.authenticated).not.toBe(false)
    expect(useApp.getState().outbox.filter((o) => o.synced !== 1).map((o) => o.lastError)).toEqual([])

    const server = await serverPull()
    expect(server.get('settings/store')).toMatchObject({ name: `Live Apparel ${RUN}` })
    expect(server.get(`users/${ownerId}`)).toMatchObject({ name: 'Asha', role: 'owner' })
    expect([...server.keys()].filter((k) => k.startsWith('categories/')).length).toBe(listOf(data().categories).length)
    // who am I, as the server sees it
    const me = await createKoshApi(url, token).me()
    expect(me.user.id).toBe(ownerId)
    expect(me.permissions).toEqual(expect.arrayContaining(['pos', 'settings']))
  })

  test('a sale rung up while the server is unreachable waits, then syncs once, and the server’s numbers come back', async () => {
    const a = engine()
    // Stock the shelf and register a customer (online), then lose the network.
    const cat = listOf(data().categories)[0]
    const made = perform((s, c) => createItem(s, { name: 'Live Oxford Shirt', styleCode: `LO-${RUN}`.toUpperCase(), categoryId: cat.id, brand: 'Live', fabric: 'Cotton', season: 'All', hsn: '6205', sizes: ['M'], colors: ['Navy'], cost: 400, mrp: 1299, price: 999 }, c))
    variantId = made.variants[0].id
    perform((s, c) => adjustStock(s, variantId, 10, 'adjust', 'OPENING', 'Opening stock', c))
    const cust = perform((s, c) => saveCustomer(s, { name: 'Meera Live', phone: '9876500001', email: '', dob: '', anniversary: '', address: '', gstin: '', notes: '' }, undefined, c))
    customerId = cust.customer.id
    await a.syncNow()
    expect((await serverPull()).get(`variants/${variantId}`)!.stock).toBe(10)

    offline = true
    const v = data().variants[variantId]
    const store = data().store!
    const lines = [{ variantId, productId: v.productId, sku: v.sku, barcode: v.barcode, name: 'Live Oxford Shirt', size: 'M', color: 'Navy', hsn: '6205', mrp: 1299, price: 999, qty: 3, stock: v.stock, discountType: 'amt' as const, discountValue: 0, cost: v.avgCost ?? v.cost }]
    const t = priceCart(lines, 'amt', 0, store.slabs, store.priceIncludesTax)
    const items: BillItem[] = t.items.map((i) => ({ ...i, soldBy: ownerId }))
    const sale = perform((s, c) => saveBill(s, {
      date: c.now, customerId, items, grossMrp: t.grossMrp, itemDiscount: t.itemDiscount, billDiscountType: 'amt', billDiscountValue: 0, billDiscount: t.billDiscount, coupon: '',
      subtotal: t.subtotal, taxableTotal: t.taxableTotal, cgstTotal: t.cgstTotal, sgstTotal: t.sgstTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total,
      payments: [{ mode: 'cash', amount: t.total }], paid: t.total, changeDue: 0, loyaltyEarned: 30, loyaltyRedeemed: 0, creditUsed: 0, cashierId: ownerId, soldBy: ownerId, status: 'paid', notes: '',
    }, c))
    billId = sale.bill.id
    billNo = sale.bill.no

    await a.flush()
    expect(state.online).toBe(false)
    const waiting = useApp.getState().outbox.filter((o) => o.synced === 0)
    expect(waiting.length).toBeGreaterThanOrEqual(2) // the bill and its stock movement (and the audit entry)
    expect((await serverPull()).has(`bills/${billId}`)).toBe(false)
    expect(data().variants[variantId].stock).toBe(7) // the phone already knows

    offline = false
    await a.syncNow()
    expect(useApp.getState().outbox.filter((o) => o.synced !== 1)).toEqual([])
    expect(state.pending).toBe(0)
    expect(state.rejected).toBe(0)

    const server = await serverPull()
    expect(server.get(`bills/${billId}`)).toMatchObject({ no: billNo, total: t.total, customerId })
    expect(server.get(`variants/${variantId}`)!.stock).toBe(7)
    expect(server.get(`customers/${customerId}`)!.loyaltyPoints).toBe(30)
    // the server's own figures came back to the phone
    expect(data().variants[variantId].stock).toBe(7)
    expect(data().customers[customerId].loyaltyPoints).toBe(30)

    // syncing again sends nothing twice
    const before = (await serverPull()).get(`variants/${variantId}`)!.stock
    await a.syncNow()
    expect((await serverPull()).get(`variants/${variantId}`)!.stock).toBe(before)
  })

  test('phone B signs in with the password and downloads the business, sale included', async () => {
    const aBills = listOf(data().bills).map((b) => b.id).sort()
    await freshPhone()
    await expect(koshLogin(url, OWNER_EMAIL, 'wrong-password-123')).rejects.toThrow(/invalid/i)
    await koshLogin(url, OWNER_EMAIL, PASSWORD)
    expect(useApp.getState().workspace).toMatchObject({ mode: 'remote', backend: 'kosh', storeId: orgId })
    expect(useApp.getState().session!.userId).toBe(ownerId)

    const d = data()
    expect(d.store!.name).toBe(`Live Apparel ${RUN}`)
    expect(listOf(d.bills).map((b) => b.id).sort()).toEqual(aBills)
    expect(d.bills[billId]).toMatchObject({ no: billNo, customerId })
    expect(d.variants[variantId].stock).toBe(7)
    expect(d.customers[customerId]).toMatchObject({ name: 'Meera Live', loyaltyPoints: 30 })
    expect(listOf(d.products).some((p) => p.name === 'Live Oxford Shirt')).toBe(true)

    // B is a second device of the same business
    const devices = await createKoshApi(url, token).raw('GET', '/devices')
    const list = (await devices.json()) as Array<{ id: string }>
    expect(list.length).toBe(2)

    // B sells one more (online) and the stock the server keeps goes to 6
    const eng = engine()
    const v = data().variants[variantId]
    const store = data().store!
    const lines = [{ variantId, productId: v.productId, sku: v.sku, barcode: v.barcode, name: 'Live Oxford Shirt', size: 'M', color: 'Navy', hsn: '6205', mrp: 1299, price: 999, qty: 1, stock: v.stock, discountType: 'amt' as const, discountValue: 0, cost: v.avgCost ?? v.cost }]
    const t = priceCart(lines, 'amt', 0, store.slabs, store.priceIncludesTax)
    const sale = perform((s, c) => saveBill(s, {
      date: c.now, customerId: null, items: t.items.map((i) => ({ ...i, soldBy: ownerId })), grossMrp: t.grossMrp, itemDiscount: t.itemDiscount, billDiscountType: 'amt', billDiscountValue: 0, billDiscount: t.billDiscount, coupon: '',
      subtotal: t.subtotal, taxableTotal: t.taxableTotal, cgstTotal: t.cgstTotal, sgstTotal: t.sgstTotal, taxTotal: t.taxTotal, roundOff: t.roundOff, total: t.total,
      payments: [{ mode: 'upi', amount: t.total }], paid: t.total, changeDue: 0, loyaltyEarned: 0, loyaltyRedeemed: 0, creditUsed: 0, cashierId: ownerId, soldBy: ownerId, status: 'paid', notes: '',
    }, c))
    await eng.syncNow()
    expect(state.rejected).toBe(0)
    expect((await serverPull()).get(`variants/${variantId}`)!.stock).toBe(6)
    expect((await serverPull()).has(`bills/${sale.bill.id}`)).toBe(true)
    await flushWrites()
  })

  test('phone C signs in at the counter with the owner’s PIN and sees both sales and the server’s stock', async () => {
    await freshPhone()
    const staff = await koshStaff(url, orgId)
    const asha = staff.find((u) => u.id === ownerId)!
    expect(asha).toMatchObject({ name: 'Asha', role: 'owner' })
    await expect(koshPinLogin(url, orgId, ownerId, '9999')).rejects.toThrow(/wrong pin/i)
    await koshPinLogin(url, orgId, ownerId, '1111')
    const d = data()
    expect(listOf(d.bills).filter((b) => b.status !== 'held')).toHaveLength(2)
    expect(d.variants[variantId].stock).toBe(6)
    expect(d.customers[customerId].loyaltyPoints).toBe(30)

    // a share link for the first sale opens as an invoice, without signing in
    const share = await createKoshApi(url, token).raw('POST', '/share', { coll: 'bills', id: billId })
    expect(share.status).toBe(201)
    const link = ((await share.json()) as { url: string; token: string })
    const page = await fetch(`${url}/p/${link.token}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(billNo)
  })
})
