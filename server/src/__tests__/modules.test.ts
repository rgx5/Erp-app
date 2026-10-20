import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { allCollectionMetas } from '@/replication/registry'
import '../app' // loads replication-all, exactly as the server does
import { migrate } from '../migrate'
import { addStaff, billDoc, customerDoc, maybe, moveDoc, mut, pgAvailable, pull, push, signup, startServer, variantDoc, type TestServer } from './helpers'

jest.setTimeout(60_000)

const MODULES = join(__dirname, '..', '..', '..', 'src', 'modules')

describe('every module’s replication rules load on the server', () => {
  test('replication-all imports every src/modules/*/replication.ts', () => {
    const all = readFileSync(join(MODULES, 'replication-all.ts'), 'utf8')
    const missing = readdirSync(MODULES, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(MODULES, d.name, 'replication.ts')))
      .map((d) => d.name)
      .filter((n) => !all.includes(`'./${n}/replication'`))
    expect(missing).toEqual([])
  })

  test('the server registry holds the core and the module collections', async () => {
    const names = allCollectionMetas().map((m) => m.name)
    expect(names).toEqual(expect.arrayContaining(['bills', 'moves', 'variants', 'customers', 'collections', 'giftCards', 'batches', 'stockLevels', 'purchaseOrders', 'quotations', 'vouchers']))
    expect(new Set(names).size).toBe(names.length)
  })
})

maybe('migrations', pgAvailable(), () => {
  test('are applied once, recorded, and safe to run again — also concurrently', async () => {
    const admin = new Pool({ connectionString: process.env.KOSH_TEST_PG_URL ?? 'postgresql://postgres@localhost:5433/postgres', max: 1 })
    const name = `kosh_t_mig_${process.pid}_${Date.now().toString(36)}`
    await admin.query(`CREATE DATABASE ${name}`)
    const pool = new Pool({ connectionString: (process.env.KOSH_TEST_PG_URL ?? 'postgresql://postgres@localhost:5433/postgres').replace(/\/[^/]*$/, `/${name}`), max: 6 })
    pool.on('error', () => undefined)
    try {
      const files = readdirSync(join(__dirname, '..', '..', 'migrations')).filter((f) => f.endsWith('.sql')).sort()
      const [first, ...others] = await Promise.all([migrate(pool), migrate(pool), migrate(pool)])
      const total = [first, ...others].flat()
      expect(total.sort()).toEqual(files) // each file applied by exactly one of the three
      expect(await migrate(pool)).toEqual([])
      const t = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)
      expect(t.rows.map((r) => r.table_name)).toEqual(expect.arrayContaining(['orgs', 'users', 'docs', 'mutations', 'devices', 'files', 'share_tokens', 'api_keys', 'login_throttle', 'schema_migrations']))
    } finally {
      await pool.end()
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await admin.end()
    }
  })
})

maybe('module effects run on the server', pgAvailable(), () => {
  let s: TestServer
  beforeAll(async () => { s = await startServer('modules') })
  afterAll(async () => { await s.close() })

  const world = async (token: string) => {
    const r = await pull(s, token, 0, 2000)
    return new Map<string, any>(r.json.upserts.map((u: { coll: string; id: string; data: any }) => [`${u.coll}/${u.id}`, u.data]))
  }

  test('credit: sales on account raise the customer’s balance, collections lower it, and the client cannot set it', async () => {
    const biz = await signup(s, 'Credit Shop 2')
    const t = biz.token
    await push(s, t, [mut('customers', 'c1', 'create', customerDoc('c1'))])
    const sale = billDoc('b1', { customerId: 'c1', total: 1000, payments: [{ mode: 'cash', amount: 400 }, { mode: 'due', amount: 600 }] })
    expect(((await push(s, t, [mut('bills', 'b1', 'create', sale)])).json.results[0].status)).toBe('ok')
    expect((await world(t)).get('customers/c1').dueBalance).toBe(600)
    const pay = await push(s, t, [mut('collections', 'col1', 'create', { id: 'col1', customerId: 'c1', amount: 250, allocations: [{ billId: 'b1', amount: 250 }], date: 1, mode: 'cash' })])
    expect(pay.json.results[0].status).toBe('ok')
    expect((await world(t)).get('customers/c1').dueBalance).toBe(350)
    await push(s, t, [mut('customers', 'c1', 'patch', { dueBalance: 0, name: 'Renamed' })])
    const c = (await world(t)).get('customers/c1')
    expect(c).toMatchObject({ dueBalance: 350, name: 'Renamed' })
    // the same collection sent again does not take the money off twice
    await push(s, t, [mut('collections', 'col1', 'create', { id: 'col1', customerId: 'c1', amount: 250, allocations: [], date: 1 }, 'again:1')])
    expect((await world(t)).get('customers/c1').dueBalance).toBe(350)
  })

  test('warehouse: a movement at a location keeps that location’s level; batch movements build the batch', async () => {
    const biz = await signup(s, 'Warehouse Shop')
    const t = biz.token
    await push(s, t, [mut('variants', 'v1', 'create', variantDoc('v1'))])
    const r = await push(s, t, [
      mut('moves', 'mv1', 'create', moveDoc('mv1', 'v1', 10, { locationId: 'loc_shop' })),
      mut('moves', 'mv2', 'create', moveDoc('mv2', 'v1', -4, { locationId: 'loc_shop' })),
      mut('batchMoves', 'bm1', 'create', { id: 'bm1', batchId: 'bt1', variantId: 'v1', qty: 12, date: 1, batch: { variantId: 'v1', code: 'LOT-1', expiry: 0 } }),
      mut('batchMoves', 'bm2', 'create', { id: 'bm2', batchId: 'bt1', variantId: 'v1', qty: -5, date: 2 }),
    ])
    expect(r.json.results.map((x: { status: string }) => x.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    const w = await world(t)
    expect(w.get('variants/v1').stock).toBe(6)
    const level = [...w.entries()].find(([k]) => k.startsWith('stockLevels/'))
    expect(level![1]).toMatchObject({ variantId: 'v1', qty: 6 })
    expect(w.get('batches/bt1')).toMatchObject({ qty: 7, code: 'LOT-1' })
    // a client's own number for a batch does not stick
    await push(s, t, [mut('batches', 'bt1', 'patch', { qty: 999, code: 'LOT-1B' })])
    expect((await world(t)).get('batches/bt1')).toMatchObject({ qty: 7, code: 'LOT-1B' })
  })

  test('purchasing: a goods receipt that names an order updates the order', async () => {
    const biz = await signup(s, 'Buying Shop')
    const t = biz.token
    await push(s, t, [mut('variants', 'v1', 'create', variantDoc('v1')), mut('suppliers', 's1', 'create', { id: 's1', name: 'Mills' }),
      mut('purchaseOrders', 'po1', 'create', { id: 'po1', no: 'PO-1', supplierId: 's1', status: 'sent', items: [{ variantId: 'v1', qty: 10, receivedQty: 0, cost: 400 }], date: 1 })])
    const rec = await push(s, t, [mut('purchases', 'pu1', 'create', { id: 'pu1', no: 'GRN-1', supplierId: 's1', date: 2, invoiceRef: '', items: [{ variantId: 'v1', qty: 4, cost: 400 }], total: 1600, paid: 0, notes: '', userId: biz.userId, poId: 'po1' })])
    expect(rec.json.results[0].status).toBe('ok')
    const po = (await world(t)).get('purchaseOrders/po1')
    expect(po.items[0].receivedQty).toBe(4)
    expect(po.status).toBe('partial')
  })

  test('accounting: balanced vouchers are an immutable ledger; a locked period (read from the server’s own documents) refuses postings', async () => {
    const biz = await signup(s, 'Books Shop')
    const t = biz.token
    const voucher = (id: string, date: number, over: Record<string, unknown> = {}) => ({ id, no: id.toUpperCase(), date, kind: 'journal', lines: [{ account: 'cash', debit: 10 }, { account: 'sales', credit: 10 }], ...over })
    const ok = await push(s, t, [mut('vouchers', 'vo1', 'create', voucher('vo1', 1000))])
    expect(ok.json.results[0].status).toBe('ok')
    expect((await push(s, t, [mut('vouchers', 'vo1', 'patch', { no: 'JV-2' })])).json.results[0].code).toBe('immutable')
    const unbalanced = await push(s, t, [mut('vouchers', 'vo2', 'create', voucher('vo2', 1000, { lines: [{ account: 'cash', debit: 10 }, { account: 'sales', credit: 9 }] }))])
    expect(unbalanced.json.results[0]).toMatchObject({ status: 'rejected', code: 'invalid' })
    // a manager keeps the books but cannot lock a period; the owner can
    const manager = await addStaff(s, biz, 'manager', 'Accountant')
    const lock = { id: 'lock1', throughDate: 5000 }
    expect((await push(s, manager.token, [mut('periodLocks', 'lock1', 'create', lock)])).json.results[0].code).toBe('forbidden')
    expect((await push(s, t, [mut('periodLocks', 'lock1', 'create', lock)])).json.results[0].status).toBe('ok')
    const late = await push(s, manager.token, [mut('vouchers', 'vo3', 'create', voucher('vo3', 4000)), mut('vouchers', 'vo4', 'create', voucher('vo4', 6000))])
    expect(late.json.results.map((x: { status: string; code?: string }) => x.code ?? x.status)).toEqual(['invalid', 'ok'])
  })
})
