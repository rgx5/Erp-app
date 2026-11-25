import type { Bill, Category, Coupon, Customer, Expense, Product, StoreSettings, Supplier, User, Variant } from '@/domain/types'
import { DEFAULT_SLABS } from '@/domain/tax'
import { CloudError, type FetchFn, type Snapshot } from '../api'
import { createWriter } from './writes'
import { categoryToCategory, itemToProduct, num, partyToCustomer, partyToSupplier, saleToBill, type PCategory, type PItem, type PParty, type PSaleDetail, type TaxRates } from './mapping'

/** What this phone has worked out about the business it is signed in to; kept with the workspace so it is asked for once. */
export interface PlatformCtx { tenant: string; companyId: string; companyName: string; terminalId?: string; deviceId?: string; warehouseId?: string; walkInCustomerId?: string | null; priceIncludesTax: boolean; invoicePrefix?: string
  /** App-made ids → the platform's ids, for records made on the phone that other records point at (a customer on a bill, an item on a return). */
  ids?: Record<string, string>
  /** Products waiting for their variant, since one platform item is both. */
  pending?: Record<string, unknown>
  /** The till's payment accounts and walk-in customer have been checked once. */
  prepared?: boolean }
export interface PlatformTokens { access: string; refresh: string }
export interface PlatformDeps {
  getToken: () => string | null
  getRefresh: () => string | null
  setTokens: (t: PlatformTokens) => void
  ctx: () => PlatformCtx | undefined
  setCtx: (c: PlatformCtx) => void
  /** What only lives on the phone and must survive a refresh: the shop's own settings and coupons. */
  local?: () => { store?: StoreSettings | null; coupons?: Coupon[] }
  /** A name that tells this phone's till apart from others. */
  deviceName: () => string
}

export interface PlatformSession { token: string; refreshToken: string; user: { id: string; name: string; role: 'owner' | 'manager' | 'cashier'; email: string; permissions: string[] }; tenant: string }

/** A server address as people type it: no path (the platform's API is at the root), https unless it is a machine on the local network. */
export function normalizePlatformUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '').replace(/\/api$/i, '')
  if (!u) return u
  if (!/^https?:\/\//i.test(u)) {
    const local = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^/:]+\.local)(:\d+)?(\/|$)/i.test(u)
    u = `${local ? 'http' : 'https'}://${u}`
  }
  return u
}

type Json = Record<string, unknown>
const roleOf = (perms: string[]): 'owner' | 'manager' | 'cashier' => (perms.includes('*') ? 'owner' : perms.includes('organization:write') || perms.includes('accounting:read') ? 'manager' : 'cashier')

/**
 * The phone's connection to the new platform. It has the same shape as the older cloud client (sign in, snapshot, one write per
 * record kind) so the sync engine and every screen stay as they are; underneath it speaks the platform's own API.
 */
export function createPlatformApi(baseUrl: string, d: PlatformDeps, fetchFn: FetchFn = (i, n) => fetch(i, n)) {
  const base = normalizePlatformUrl(baseUrl)
  // a sale never changes once made, so its detail is fetched once for as long as the app is open
  const billCache = new Map<string, Bill>()

  async function http(method: string, path: string, body?: unknown, o: { auth?: boolean; key?: string; headers?: Record<string, string> } = {}): Promise<Response> {
    const go = async (): Promise<Response> => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(o.headers ?? {}), ...(o.key ? { 'Idempotency-Key': o.key.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 200) } : {}) }
      const t = o.auth === false ? null : d.getToken()
      if (t) headers['Authorization'] = `Bearer ${t}`
      try { return await fetchFn(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }) } catch { throw new CloudError('Cannot reach the server — check your internet connection and the server address.') }
    }
    let res = await go()
    // access tokens last minutes: on a refusal, renew once with the refresh token and try again
    if (res.status === 401 && o.auth !== false && d.getRefresh()) { if (await renew()) res = await go() }
    return res
  }
  const problem = async (res: Response): Promise<CloudError> => {
    const t = await res.text(); let j: Json | null = null
    try { j = t ? (JSON.parse(t) as Json) : null } catch { /* not JSON */ }
    const errors = Array.isArray(j?.['errors']) ? (j?.['errors'] as Array<{ path?: string; message?: string }>) : []
    return new CloudError(errors[0]?.message ?? String(j?.['detail'] ?? j?.['title'] ?? `Server error (${res.status})`), res.status)
  }
  async function json<T>(method: string, path: string, body?: unknown, o: { auth?: boolean; key?: string; headers?: Record<string, string> } = {}): Promise<T> {
    const res = await http(method, path, body, o)
    if (!res.ok) throw await problem(res)
    const t = await res.text()
    return (t ? JSON.parse(t) : null) as T
  }
  // refresh tokens are single-use: when several requests find the token expired at once, only one renews and the rest wait for it
  let renewing: Promise<boolean> | null = null
  function renew(): Promise<boolean> {
    renewing ??= renewOnce().finally(() => { renewing = null })
    return renewing
  }
  async function renewOnce(): Promise<boolean> {
    const rt = d.getRefresh(); if (!rt) return false
    try {
      const r = await fetchFn(`${base}/v1/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
      if (!r.ok) return false
      const j = (await r.json()) as { accessToken: string; refreshToken: string }
      d.setTokens({ access: j.accessToken, refresh: j.refreshToken })
      return true
    } catch { return false }
  }
  /** Every page of a list, following the server's cursor. */
  async function all<T>(path: string, cap = 5000): Promise<T[]> {
    const out: T[] = []; let cursor: string | null = null
    do {
      const sep = path.includes('?') ? '&' : '?'
      const page: { items: T[]; nextCursor?: string | null } = await json('GET', `${path}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      out.push(...page.items); cursor = page.nextCursor ?? null
    } while (cursor && out.length < cap)
    return out
  }

  // ───────────── the business: company, till, device, shift ─────────────
  async function ensureCtx(): Promise<PlatformCtx> {
    const have = d.ctx(); if (!have) throw new CloudError('Sign in again to connect this phone.', 401)
    if (have.terminalId && have.deviceId && have.prepared) return have
    const companyId = have.companyId
    let terminalId = have.terminalId; let warehouseId = have.warehouseId
    if (!terminalId) {
      const terminals = await all<{ id: string; warehouseId: string; status?: string }>(`/v1/pos/terminals?companyId=${companyId}`)
      const t = terminals.find((x) => (x.status ?? 'active') === 'active')
      if (t) { terminalId = t.id; warehouseId = t.warehouseId } else {
        const [locs, whs, regs] = await Promise.all([all<{ id: string; gstRegistrationId?: string }>(`/v1/business-locations?companyId=${companyId}`), all<{ id: string; businessLocationId: string }>('/v1/warehouses'), all<{ id: string }>(`/v1/companies/${companyId}/gst-registrations`)])
        const loc = locs[0]; const wh = whs.find((w) => w.businessLocationId === loc?.id) ?? whs[0]; const reg = regs[0]
        if (!loc || !wh || !reg) throw new CloudError('This business has no shop location, warehouse or GST registration yet. Finish the setup on the desktop app first.', 422)
        const made = await json<{ id: string; warehouseId: string }>('POST', '/v1/pos/terminals', { companyId, code: `PH${Math.floor(Math.random() * 900 + 100)}`, name: 'Phone counter', gstRegistrationId: reg.id, businessLocationId: loc.id, warehouseId: wh.id }, { key: `terminal-${companyId}-${d.deviceName()}` })
        terminalId = made.id; warehouseId = made.warehouseId
      }
    }
    const devices = await all<{ id: string; terminalId: string; name: string; status: string }>(`/v1/pos/devices?companyId=${companyId}`)
    let dev = devices.find((x) => x.terminalId === terminalId && x.name === d.deviceName() && x.status === 'active')
    if (!dev) dev = await json<{ id: string; terminalId: string; name: string; status: string }>('POST', '/v1/pos/devices', { terminalId, name: d.deviceName() }, { key: `device-${terminalId}-${d.deviceName()}` })
    const next: PlatformCtx = { ...have, terminalId: terminalId as string, deviceId: dev.id, ...(warehouseId ? { warehouseId } : {}) }
    d.setCtx(next)
    const walkIn = await prepare(next)
    const done: PlatformCtx = { ...next, prepared: true, walkInCustomerId: walkIn ?? next.walkInCustomerId ?? null }
    d.setCtx(done)
    return done
  }

  /**
   * What a till needs before its first sale: a payment account for each way of paying, and a walk-in customer. A business set up on the
   * desktop app may have neither, so the phone sets up the obvious ones (cash and bank accounts by name) rather than refusing sales.
   * Whatever the business has already chosen is left alone.
   */
  async function prepare(c: PlatformCtx): Promise<string | null> {
    const cur = await json<{ settings: { walkInCustomerId: string | null } | null; paymentAccounts: Array<{ method: string; accountId: string }> }>('GET', `/v1/pos/settings?companyId=${c.companyId}`)
    const mapped = new Set(cur.paymentAccounts.map((p) => p.method))
    if (['cash', 'upi', 'card', 'bank_transfer', 'cheque'].some((m) => !mapped.has(m))) {
      try {
        const accounts = (await all<{ id: string; code: string; name: string; type: string; isGroup: boolean; controlKind: string | null; status: string }>(`/v1/accounts?companyId=${c.companyId}`)).filter((a) => a.type === 'asset' && !a.isGroup && !a.controlKind && a.status === 'active')
        const cash = accounts.find((a) => /cash/i.test(a.name)); const bank = accounts.find((a) => /bank/i.test(a.name))
        const want: Array<[string, string | undefined]> = [['cash', cash?.id], ['upi', bank?.id ?? cash?.id], ['card', bank?.id ?? cash?.id], ['bank_transfer', bank?.id ?? cash?.id], ['cheque', bank?.id ?? cash?.id]]
        for (const [method, accountId] of want) if (accountId && !mapped.has(method)) await json('PUT', `/v1/pos/payment-accounts?companyId=${c.companyId}`, { method, accountId })
      } catch { /* a person without the right to set this up gets the platform's own refusal on the first sale */ }
    }
    let walkIn = cur.settings?.walkInCustomerId ?? null
    if (!walkIn) {
      try {
        const parties = await all<{ id: string; code: string }>('/v1/parties')
        walkIn = parties.find((p) => p.code === 'WALKIN')?.id ?? (await json<{ id: string }>('POST', '/v1/parties', { code: 'WALKIN', legalName: 'Walk-in customer', gstTreatment: 'consumer', isCustomer: true }, { key: `walkin-${c.companyId}` })).id
        await json('PUT', `/v1/pos/settings?companyId=${c.companyId}`, { walkInCustomerId: walkIn })
      } catch { walkIn = null }
    }
    return walkIn
  }

  async function ensureShift(ctx: PlatformCtx): Promise<string> {
    const open = await json<{ items: Array<{ id: string }> }>('GET', `/v1/pos/shifts?companyId=${ctx.companyId}&terminalId=${ctx.terminalId}&status=open&limit=1`)
    if (open.items[0]) return open.items[0].id
    return (await json<{ id: string }>('POST', '/v1/pos/shifts', { terminalId: ctx.terminalId, openingCash: '0' }, { key: `shift-${ctx.terminalId}-${new Date().toISOString().slice(0, 13)}` })).id
  }

  const writer = createWriter({ http, json, all, ctx: () => d.ctx(), setCtx: d.setCtx, ensureCtx, ensureShift })
  return {
    base,
    health: () => json<{ status?: string }>('GET', '/health/live', undefined, { auth: false }).then(() => ({ ok: true })),

    /** Business code + email + password, as the platform asks. */
    async login(tenant: string, email: string, password: string): Promise<PlatformSession> {
      const r = await json<{ accessToken: string; refreshToken: string }>('POST', '/v1/auth/login', { tenant: tenant.trim().toLowerCase(), email: email.trim(), password }, { auth: false })
      d.setTokens({ access: r.accessToken, refresh: r.refreshToken })
      const me = await json<{ user: { id: string; displayName: string; email: string }; permissions: string[] }>('GET', '/v1/auth/me')
      return { token: r.accessToken, refreshToken: r.refreshToken, tenant: tenant.trim().toLowerCase(), user: { id: me.user.id, name: me.user.displayName, role: roleOf(me.permissions), email: me.user.email, permissions: me.permissions } }
    },
    companies: () => all<{ id: string; legalName: string; tradeName: string | null; status: string }>('/v1/companies').then((l) => l.filter((c) => c.status === 'active')),

    /** The access token is renewed with the refresh token; the engine calls this when a token is near its end. */
    async refresh(): Promise<{ token: string }> {
      if (!(await renew())) throw new CloudError('Your session expired — sign in again', 401)
      return { token: d.getToken() as string }
    },
    // the platform has no counter-staff PIN sign-in; the phone signs in as a person with an email and password
    pinLogin: async (): Promise<never> => { throw new CloudError('Staff PIN sign-in is not available on this server. Sign in with your email and password.', 400) },
    staff: async (): Promise<[]> => [],

    async snapshot(): Promise<Snapshot> {
      let ctx = await ensureCtx()
      const [company, items, parties, balances, categories, settings, cat, sales, vouchers, expCats] = await Promise.all([
        json<Json>('GET', `/v1/companies/${ctx.companyId}`).catch(() => ({} as Json)),
        all<PItem>('/v1/items?isSellable=true'),
        all<PParty>('/v1/parties'),
        json<{ items: Array<{ itemId: string; quantity: string }> }>('GET', `/v1/stock/balances?companyId=${ctx.companyId}${ctx.warehouseId ? `&warehouseId=${ctx.warehouseId}` : ''}&limit=500`).catch(() => ({ items: [] })),
        all<PCategory>('/v1/item-categories').catch(() => [] as PCategory[]),
        json<{ settings: { walkInCustomerId: string | null } | null }>('GET', `/v1/pos/settings?companyId=${ctx.companyId}`).catch(() => ({ settings: null })),
        json<{ taxRates: Array<{ taxCodeId: string; igst: string }>; barcodes: Array<{ itemId: string; barcode: string }> }>('GET', `/v1/pos/sync/catalogue?deviceId=${ctx.deviceId}`),
        json<{ items: Array<{ id: string }> }>('GET', `/v1/pos/sales?companyId=${ctx.companyId}&limit=200`).catch(() => ({ items: [] })),
        json<{ items: Array<{ id: string; voucherDate: string; categoryId: string; amount: string; payee: string | null; note: string | null; status: string; createdAt: string }> }>('GET', `/v1/expenses/vouchers?companyId=${ctx.companyId}&limit=200`).catch(() => ({ items: [] })),
        json<{ items: Array<{ id: string; name: string }> }>('GET', `/v1/expenses/categories?companyId=${ctx.companyId}`).catch(() => ({ items: [] })),
      ])
      const walkIn = settings.settings?.walkInCustomerId ?? null
      if (walkIn !== (ctx.walkInCustomerId ?? null)) { ctx = { ...ctx, walkInCustomerId: walkIn }; d.setCtx(ctx) }
      const rates: TaxRates = Object.fromEntries(cat.taxRates.map((r) => [r.taxCodeId, num(r.igst)]))
      const byCat = new Map(categories.map((c) => [c.id, c]))
      const stock = new Map<string, number>()
      for (const b of balances.items) stock.set(b.itemId, (stock.get(b.itemId) ?? 0) + num(b.quantity))
      const codes = new Map<string, string>()
      for (const b of cat.barcodes) if (!codes.has(b.itemId)) codes.set(b.itemId, b.barcode)

      const products: Product[] = []; const variants: Variant[] = []
      for (const i of items) {
        const { product, variant } = itemToProduct(i, rates, () => '')
        products.push(product); variants.push({ ...variant, barcode: codes.get(i.id) ?? '', stock: stock.get(i.id) ?? 0 })
      }
      const vById = new Map(variants.map((v) => [v.id, v])); const pById = new Map(products.map((p) => [p.id, p]))
      const bills: Bill[] = []
      const todo = sales.items.filter((x) => !billCache.has(x.id))
      for (let i = 0; i < todo.length; i += 10) {
        const got = await Promise.all(todo.slice(i, i + 10).map((x) => json<PSaleDetail>('GET', `/v1/pos/sales/${x.id}`).catch(() => null)))
        for (const x of got) if (x) billCache.set(x.id, saleToBill(x, (id) => { const v = vById.get(id); return { name: pById.get(id)?.name ?? '', sku: v?.sku ?? '', barcode: v?.barcode ?? '', size: v?.size ?? '', color: v?.color ?? '', mrp: v?.mrp ?? 0 } }, walkIn))
      }
      for (const x of sales.items) { const b = billCache.get(x.id); if (b) bills.push(b) }
      const catName = new Map(expCats.items.map((c) => [c.id, c.name]))
      const expenses: Expense[] = vouchers.items.filter((v) => v.status === 'posted').map((v) => ({ id: v.id, date: Date.parse(v.voucherDate) || Date.parse(v.createdAt) || Date.now(), category: catName.get(v.categoryId) ?? 'General', amount: num(v.amount), mode: 'cash', vendor: v.payee ?? '', note: v.note ?? '', recurring: false, userId: '' }))
      const me = await json<{ user: { id: string; displayName: string }; permissions: string[] }>('GET', '/v1/auth/me')
      const name = String((company['tradeName'] as string | null) ?? company['legalName'] ?? ctx.companyName)
      const mine = d.local?.() ?? {}
      const store: StoreSettings & { plan?: string } = {
        tagline: '', address: '', city: '', phone: '', email: '', gstin: '', invoicePrefix: 'INV-', nextInvoiceNo: 1, slabs: DEFAULT_SLABS, priceIncludesTax: true, receiptWidth: '58mm', printFormat: 'thermal',
        autoPrintOnSale: false, returnPolicy: '', footerNote: '', loyaltyEarnPct: 0, loyaltyRedeemValue: 0, maxCashierDiscountPct: 100, lowStockDefault: 5,
        ...(mine.store ?? {}), id: ctx.companyId, name,
      }
      const users: User[] = [{ id: me.user.id, name: me.user.displayName, role: roleOf(me.permissions), active: true }]
      const customers: Customer[] = parties.filter((p) => p.isCustomer && p.id !== walkIn && (p.status ?? 'active') === 'active').map(partyToCustomer)
      const suppliers: Supplier[] = parties.filter((p) => p.isSupplier && (p.status ?? 'active') === 'active').map(partyToSupplier)
      const cats: Category[] = categories.map((c) => categoryToCategory(c, byCat))
      return { serverTime: Date.now(), store, users, categories: cats, products, variants, customers, bills, suppliers, ...(mine.coupons?.length ? { coupons: mine.coupons } : {}), purchases: [], moves: [], expenses, sessions: [] }
    },

    bill: async (id: string): Promise<Bill> => { throw new CloudError(`Sale ${id} is not on this server`, 404) },

    /** The outbox's writes, translated into the platform's calls (see writes.ts). */
    raw: (method: string, path: string, body?: unknown): Promise<Response> => writer.raw(method, path, body),
  }
}
export type PlatformApi = ReturnType<typeof createPlatformApi>
