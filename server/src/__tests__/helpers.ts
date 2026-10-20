import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { Pool } from 'pg'
import { buildApp } from '../app'
import type { Config } from '../config'
import { MemoryFileStore } from '../fileStore'
import { migrate } from '../migrate'
import '../db' // installs the BIGINT / NUMERIC parsers

const ADMIN_URL = process.env.KOSH_TEST_PG_URL ?? 'postgresql://postgres@localhost:5433/postgres'

const SERVER_DIR = join(__dirname, '..', '..')

/** One synchronous reachability probe (a child process), so a test file can decide at load time whether to run or to skip. */
function ping(): boolean {
  try {
    execFileSync(process.execPath, ['-e', `const {Client}=require('pg');const c=new Client({connectionString:process.argv[1],connectionTimeoutMillis:1500});c.connect().then(()=>c.query('select 1')).then(()=>process.exit(0),()=>process.exit(1))`, ADMIN_URL], { cwd: SERVER_DIR, stdio: 'ignore', timeout: 10_000 })
    return true
  } catch { return false }
}

/** Whether a PostgreSQL is reachable; tries to start the throwaway one (scripts/pg.sh) once if it is not. */
export function pgAvailable(): boolean {
  if (ping()) return true
  if (process.env.KOSH_TEST_AUTOSTART_PG === '0') return false
  try { execFileSync(join(SERVER_DIR, 'scripts', 'pg.sh'), { stdio: 'ignore', timeout: 60_000 }) } catch { return false }
  return ping()
}

export const testConfig = (over: Partial<Config> = {}): Config => ({
  databaseUrl: '', jwtSecret: 'test-secret-test-secret-test-secret-123456', port: 0, host: '127.0.0.1', corsOrigins: ['http://app.test'], filesDir: '', production: false,
  bcryptCost: 4, tokenTtlSeconds: 3600, publicUrl: 'http://kosh.test', trustProxy: false, allowSignup: true, ...over,
})

export interface TestServer {
  app: ReturnType<typeof buildApp>
  pool: Pool
  files: MemoryFileStore
  close(): Promise<void>
  /** JSON request; returns status, parsed body and headers. */
  call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts?: { token?: string; body?: unknown; ip?: string; headers?: Record<string, string>; raw?: Buffer }): Promise<{ status: number; json: any; body: string; headers: Record<string, unknown>; raw: Buffer }>
}

let n = 0

/** A fresh database (migrated) and an app on top of it. Each test file gets its own, dropped at the end. */
export async function startServer(label: string, cfgOver: Partial<Config> = {}): Promise<TestServer> {
  const name = `kosh_t_${label}_${process.pid}_${++n}_${Date.now().toString(36)}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase()
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 })
  await admin.query(`CREATE DATABASE ${name}`)
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`)
  const pool = new Pool({ connectionString: url, max: 8 })
  pool.on('error', () => { /* connections closed by the DROP DATABASE at teardown */ })
  await migrate(pool)
  const files = new MemoryFileStore()
  const app = buildApp({ cfg: testConfig({ databaseUrl: url, ...cfgOver }), pool, files })
  await app.ready()
  return {
    app, pool, files,
    async close() {
      await app.close()
      await pool.end()
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await admin.end()
    },
    async call(method, url, o = {}) {
      const headers: Record<string, string> = { ...(o.headers ?? {}) }
      if (o.token) headers.authorization = `Bearer ${o.token}`
      let payload: string | Buffer | undefined
      if (o.raw) payload = o.raw
      else if (o.body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(o.body) }
      const r = await app.inject({ method, url, headers, payload, remoteAddress: o.ip ?? '10.0.0.1' })
      let json: unknown = null
      try { json = JSON.parse(r.body) } catch { /* not JSON */ }
      return { status: r.statusCode, json, body: r.body, headers: r.headers as Record<string, unknown>, raw: r.rawPayload }
    },
  }
}

let counter = 0
export interface Biz { token: string; orgId: string; userId: string; deviceId: string; email: string; branchId: string }

/** Signs a new business up; returns what the tests need. */
export async function signup(s: TestServer, name = 'Shop', extra: Record<string, unknown> = {}): Promise<Biz> {
  const email = `owner${++counter}_${Date.now().toString(36)}@example.test`
  const deviceId = `dev_${counter}_${name}`.replace(/[^A-Za-z0-9_.:-]/g, "_")
  const r = await s.call('POST', '/auth/signup', { body: { orgName: name, ownerName: `${name} Owner`, email, password: 'correct horse battery', pin: '1234', deviceId, deviceName: 'Test phone', ...extra } })
  if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${r.body}`)
  return { token: r.json.token, orgId: r.json.org.id, userId: r.json.user.id, deviceId, email, branchId: r.json.branch.id }
}

/** Adds a staff member and signs them in with their PIN on their own device. */
export async function addStaff(s: TestServer, owner: Biz, role: 'manager' | 'cashier', name: string = role, extra: Record<string, unknown> = {}) {
  const c = await s.call('POST', '/users', { token: owner.token, body: { name, role, pin: '4321', ...extra } })
  if (c.status !== 201) throw new Error(`add staff failed: ${c.status} ${c.body}`)
  const deviceId = `dev_${role}_${++counter}`
  const l = await s.call('POST', '/auth/pin-login', { body: { orgId: owner.orgId, userId: c.json.id, pin: '4321', deviceId, deviceName: 'Counter' } })
  if (l.status !== 200) throw new Error(`pin login failed: ${l.status} ${l.body}`)
  return { id: c.json.id as string, token: l.json.token as string, deviceId }
}

let mid = 0
export const mut = (coll: string, id: string, op: 'create' | 'patch' | 'delete', data?: Record<string, unknown>, m = `t:${++mid}`) => ({ mid: m, coll, id, op, ...(data ? { data } : {}), at: Date.now() })

export async function push(s: TestServer, token: string, mutations: unknown[]) {
  const r = await s.call('POST', '/sync/push', { token, body: { mutations } })
  return r
}
export async function pull(s: TestServer, token: string, since = 0, limit = 500) {
  return s.call('GET', `/sync/pull?since=${since}&limit=${limit}`, { token })
}

export function maybe(name: string, ok: boolean, fn: () => void) {
  if (ok) describe(name, fn)
  else describe.skip(`${name} (PostgreSQL is not reachable — start it with server/scripts/pg.sh)`, fn)
}

// ── document fixtures (shaped like the app's own) ──
export const variantDoc = (id: string, over: Record<string, unknown> = {}) => ({ id, productId: 'p1', sku: `SKU-${id}`, barcode: '', size: 'M', color: 'Navy', cost: 400, mrp: 1299, price: 999, stock: 0, reorderLevel: 2, ...over })
export const customerDoc = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Customer ${id}`, phone: '9876543210', email: '', loyaltyPoints: 0, storeCredit: 0, createdAt: 1, ...over })
export const moveDoc = (id: string, variantId: string, qty: number, over: Record<string, unknown> = {}) => ({ id, variantId, qty, type: qty > 0 ? 'purchase' : 'sale', date: Date.now(), ref: '', ...over })
export const billDoc = (id: string, over: Record<string, unknown> = {}) => ({
  id, no: `INV-${id}`, date: Date.now(), customerId: null, items: [{ variantId: 'v1', productId: 'p1', name: 'Oxford Shirt', qty: 1, returnedQty: 0, price: 999, discountAmount: 0, lineTotal: 999 }],
  subtotal: 999, taxTotal: 0, roundOff: 0, total: 999, payments: [{ mode: 'cash', amount: 999 }], paid: 999, changeDue: 0, loyaltyEarned: 0, loyaltyRedeemed: 0, creditUsed: 0,
  cashierId: 'u', status: 'paid', notes: '', ...over,
})
