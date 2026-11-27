import type { Bill, Coupon, Customer, DaySession, Expense, Purchase, StockMove, Supplier } from '@/domain/types'
import { CloudError } from '../api'
import type { PlatformCtx } from './api'
import { billToSale, couponToPlatform, money, num, retotal, serverTotalFrom } from './mapping'

type Http = (method: string, path: string, body?: unknown, o?: { auth?: boolean; key?: string; headers?: Record<string, string> }) => Promise<Response>
export interface WriterDeps {
  http: Http
  json: <T>(method: string, path: string, body?: unknown, o?: { auth?: boolean; key?: string; headers?: Record<string, string> }) => Promise<T>
  all: <T>(path: string) => Promise<T[]>
  ctx: () => PlatformCtx | undefined
  setCtx: (c: PlatformCtx) => void
  ensureCtx: () => Promise<PlatformCtx>
  ensureShift: (c: PlatformCtx) => Promise<string>
}

const reply = (status: number, body: unknown = {}): Response => new Response(JSON.stringify(body), { status })
const today = (ms?: number): string => new Date(ms ?? Date.now()).toISOString().slice(0, 10)
const codeOf = (id: string, prefix: string): string => `${prefix}${id.replace(/[^A-Za-z0-9]/g, '').slice(-10).toUpperCase()}`
type Row = Record<string, unknown>

/**
 * The phone queues its writes in the older cloud client's vocabulary (a bill, a customer, a stock adjustment…). This turns each into the
 * platform's own calls and answers with a Response, so the sync engine reads the status as it always did. A record the platform names
 * with its own id is remembered (`ctx.ids`) so later records that point at it (a bill for a customer made on the phone) say the right id.
 */
export function createWriter(d: WriterDeps) {
  const remember = (appId: string, platformId: string): void => { const c = d.ctx(); if (c) d.setCtx({ ...c, ids: { ...(c.ids ?? {}), [appId]: platformId } }) }
  const idOf = (appId: string | null | undefined): string | undefined => (appId ? d.ctx()?.ids?.[appId] ?? appId : undefined)
  const isId = (v: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

  /** Changes to an existing record carry the version read first (the platform's If-Match rule). */
  async function patch(path: string, body: Row): Promise<Response> {
    const cur = await d.json<{ version: number }>('GET', path)
    return d.http('PATCH', path, body, { headers: { 'If-Match': String(cur.version) } })
  }

  async function sale(bill: Bill): Promise<Response> {
    const ctx = await d.ensureCtx()
    const shiftId = await d.ensureShift(ctx)
    const body = billToSale(bill, { shiftId, walkInId: ctx.walkInCustomerId ?? null, priceIncludesTax: ctx.priceIncludesTax })
    const send = (b: typeof body) => d.http('POST', '/v1/pos/sales', { ...b, lines: b.lines.map((l) => ({ ...l, itemId: idOf(String(l['itemId'])) })), ...(b.customerId ? { customerId: idOf(b.customerId) } : {}) }, { key: bill.id })
    let res = await send(body)
    if (res.status === 422) {
      // the platform rounds and taxes on its own books: take its total for the bill and pay exactly that
      const total = serverTotalFrom(await res.clone().text())
      if (total !== null) res = await send({ ...body, payments: retotal(body.payments, total) })
    }
    if (res.ok) { try { const j = (await res.clone().json()) as { id?: string }; if (j.id) remember(bill.id, j.id) } catch { /* the id is only a convenience */ } }
    // a 409 here means the platform refused the sale (not enough stock); the older engine would read that as "already saved", so say it as a refusal
    if (res.status === 409) { const t = await res.clone().text(); let msg = 'The server refused this sale'; try { msg = String((JSON.parse(t) as { detail?: string }).detail ?? msg) } catch { /* plain */ } return reply(422, { error: msg }) }
    return res
  }

  async function saleReturn(credit: Bill): Promise<Response> {
    const ctx = await d.ensureCtx()
    const shiftId = await d.ensureShift(ctx)
    const originalSaleId = idOf(credit.refundOfBillId)
    if (!originalSaleId || !isId(originalSaleId)) return reply(404, { error: 'The original sale has not reached the server yet' })
    const orig = await d.json<{ lines?: Array<{ id: string; itemId: string; quantity: string }>; document?: { lines?: Array<{ id: string; itemId: string; quantity: string }> } }>('GET', `/v1/pos/sales/${originalSaleId}`)
    const lines = orig.lines ?? orig.document?.lines ?? []
    const used = new Map<string, number>()
    const out: Array<{ originalLineId: string; quantity: string }> = []
    for (const it of credit.items) {
      let left = Math.abs(it.qty)
      for (const l of lines.filter((x) => x.itemId === (idOf(it.variantId) ?? it.variantId))) {
        const take = Math.min(left, num(l.quantity) - (used.get(l.id) ?? 0)); if (take <= 0) continue
        out.push({ originalLineId: l.id, quantity: String(take) }); used.set(l.id, (used.get(l.id) ?? 0) + take); left -= take
        if (left <= 0) break
      }
    }
    if (!out.length) return reply(422, { error: 'None of the returned items are on the original sale' })
    const amount = Math.abs(credit.refundAmount ?? credit.total)
    const method = credit.payments[0]?.mode === 'cash' ? 'cash' : 'store_credit'
    const base = { shiftId, originalSaleId, reason: (credit.notes || 'Return').slice(0, 300), lines: out, refunds: [{ method, amount: money(amount) }] }
    let res = await d.http('POST', '/v1/pos/returns', base, { key: credit.id })
    if (res.status === 422) {
      const m = /credit note total \(([0-9.]+)\)/.exec(await res.clone().text())
      if (m) res = await d.http('POST', '/v1/pos/returns', { ...base, refunds: [{ method, amount: m[1] }] }, { key: credit.id })
    }
    return res
  }

  async function createCustomer(c: Customer): Promise<Response> {
    const res = await d.http('POST', '/v1/parties', { code: codeOf(c.id, 'C-'), legalName: c.name, isCustomer: true, gstTreatment: c.gstin ? 'registered_regular' : 'consumer', ...(c.gstin ? { gstin: c.gstin } : {}), ...(c.phone ? { phone: c.phone } : {}), ...(c.email ? { email: c.email } : {}) }, { key: c.id })
    if (res.ok) { try { remember(c.id, ((await res.clone().json()) as { id: string }).id) } catch { /* see sale() */ } }
    return res
  }
  async function createSupplier(s: Supplier): Promise<Response> {
    const res = await d.http('POST', '/v1/parties', { code: codeOf(s.id, 'S-'), legalName: s.name, isSupplier: true, gstTreatment: s.gstin ? 'registered_regular' : 'unregistered', ...(s.gstin ? { gstin: s.gstin } : {}), ...(s.phone ? { phone: s.phone } : {}) }, { key: s.id })
    if (res.ok) { try { remember(s.id, ((await res.clone().json()) as { id: string }).id) } catch { /* see sale() */ } }
    return res
  }

  /** The tax code whose rate is this percentage, and the unit "NOS", looked up once. */
  async function itemBasics(rate: number | undefined): Promise<{ taxCodeId?: string; baseUomId: string }> {
    const units = await d.all<{ id: string; code: string }>('/v1/units')
    const uom = units.find((u) => u.code === 'NOS') ?? units[0]
    if (!uom) throw new CloudError('This business has no units of measure yet.', 422)
    let taxCodeId: string | undefined
    if (rate !== undefined) {
      const ctx = await d.ensureCtx()
      const cat = await d.json<{ taxRates: Array<{ taxCodeId: string; igst: string }> }>('GET', `/v1/pos/sync/catalogue?deviceId=${ctx.deviceId}`)
      taxCodeId = cat.taxRates.find((t) => num(t.igst) === rate)?.taxCodeId
    }
    return { baseUomId: uom.id, ...(taxCodeId ? { taxCodeId } : {}) }
  }

  async function addExpense(e: Expense): Promise<Response> {
    const ctx = await d.ensureCtx()
    const cats = await d.json<{ items: Array<{ id: string; name: string }> }>('GET', `/v1/expenses/categories?companyId=${ctx.companyId}`)
    let cat = cats.items.find((c) => c.name.toLowerCase() === e.category.toLowerCase())
    if (!cat) {
      const accounts = (await d.all<{ id: string; code: string; name: string; type: string; isGroup: boolean; controlKind: string | null; status: string }>(`/v1/accounts?companyId=${ctx.companyId}`)).filter((a) => a.type === 'expense' && !a.isGroup && !a.controlKind && a.status === 'active')
      const exp = accounts.find((a) => /general|admin|misc|office|other/i.test(a.name) && !/cost of/i.test(a.name)) ?? accounts.find((a) => !/cost of/i.test(a.name)) ?? accounts[0]
      if (!exp) throw new CloudError('This business has no expense account to book the spending against.', 422)
      cat = await d.json<{ id: string; name: string }>('POST', '/v1/expenses/categories', { companyId: ctx.companyId, code: e.category.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 28) || 'GENERAL', name: e.category.slice(0, 100), expenseAccountId: exp.id }, { key: `expcat-${e.category}` })
    }
    const pay = await d.json<{ paymentAccounts: Array<{ method: string; accountId: string }> }>('GET', `/v1/pos/settings?companyId=${ctx.companyId}`)
    const method = e.mode === 'bank' ? 'bank_transfer' : e.mode
    const account = pay.paymentAccounts.find((p) => p.method === method) ?? pay.paymentAccounts.find((p) => p.method === 'cash')
    if (!account) return reply(422, { error: `Choose which account ${method} payments come from (Settings → payment accounts on the desktop app)` })
    return d.http('POST', '/v1/expenses/vouchers', { companyId: ctx.companyId, voucherDate: today(e.date), categoryId: cat.id, amount: money(e.amount), paidFromAccountId: account.accountId, ...(e.vendor ? { payee: e.vendor.slice(0, 150) } : {}), ...(e.note ? { note: e.note.slice(0, 300) } : {}) }, { key: e.id })
  }

  async function adjust(m: StockMove): Promise<Response> {
    // sales, returns and purchase receipts reach the platform on their own documents; a count correction and the first stock of a new item are adjustments
    if (m.type !== 'adjust' && m.type !== 'audit' && m.type !== 'opening') return reply(200)
    if (m.qty === 0) return reply(200)
    const ctx = await d.ensureCtx()
    if (!ctx.warehouseId) return reply(422, { error: 'This phone has no warehouse to adjust stock in' })
    const itemId = idOf(m.variantId)
    return d.http('POST', '/v1/stock/movements', { companyId: ctx.companyId, movementType: 'adjustment', postingDate: today(m.at), description: `${m.reason || 'Stock adjustment'} (${m.ref || 'phone'})`.slice(0, 500), lines: [{ warehouseId: ctx.warehouseId, itemId, quantity: String(Math.abs(m.qty)), direction: m.qty >= 0 ? 'in' : 'out', ...(m.qty >= 0 ? { unitCost: '0' } : {}) }] }, { key: `adj-${m.id}` })
  }

  /** A goods-received note becomes a goods receipt, the supplier's bill against it, and a payment for what was paid. */
  async function purchase(p: Purchase): Promise<Response> {
    const ctx = await d.ensureCtx()
    if (!ctx.warehouseId) return reply(422, { error: 'This phone has no warehouse to receive goods into' })
    const supplierId = idOf(p.supplierId)
    if (!supplierId || !isId(supplierId)) return reply(404, { error: 'That supplier has not reached the server yet' })
    const day = today(p.date)
    const grn = await d.http('POST', '/v1/purchasing/receipts', { companyId: ctx.companyId, supplierId, receiptDate: day, ...(p.invoiceRef ? { supplierDeliveryNote: p.invoiceRef.slice(0, 100) } : {}), lines: p.items.map((i) => ({ itemId: idOf(i.variantId), warehouseId: ctx.warehouseId, quantity: String(i.qty), unitPrice: money(i.cost) })) }, { key: `${p.id}-grn` })
    if (!grn.ok) return grn
    const receipt = (await grn.json()) as { lines?: Array<{ id: string; itemId: string }>; receipt?: { lines?: Array<{ id: string; itemId: string }> } }
    const rl = receipt.lines ?? receipt.receipt?.lines ?? []
    const taken = new Set<string>()
    const lines = p.items.map((i) => {
      const line = rl.find((x) => x.itemId === idOf(i.variantId) && !taken.has(x.id)); if (line) taken.add(line.id)
      return { itemId: idOf(i.variantId), quantity: String(i.qty), unitPrice: money(i.cost), ...(line ? { grnLineId: line.id } : {}) }
    })
    const regs = await d.all<{ id: string; gstin?: string }>(`/v1/companies/${ctx.companyId}/gst-registrations`)
    const state = /^[0-9]{2}/.exec(regs[0]?.gstin ?? '')?.[0] // a supplier the phone knows no address for is taken to be in the buyer's own state
    const bill = await d.http('POST', '/v1/purchasing/bills', { companyId: ctx.companyId, gstRegistrationId: regs[0]?.id, supplierId, ...(state ? { supplierStateCode: state } : {}), supplierInvoiceNo: (p.invoiceRef || p.no).slice(0, 60), supplierInvoiceDate: day, billDate: day, lines }, { key: `${p.id}-bill` })
    if (!bill.ok || !(p.paid > 0)) return bill
    const billId = ((await bill.clone().json()) as { id?: string; bill?: { id: string }; invoice?: { id: string } }); const id = billId.id ?? billId.bill?.id ?? billId.invoice?.id
    const settings = await d.json<{ paymentAccounts: Array<{ method: string; accountId: string }> }>('GET', `/v1/pos/settings?companyId=${ctx.companyId}`)
    const account = settings.paymentAccounts.find((a) => a.method === 'cash') ?? settings.paymentAccounts[0]
    if (!account || !id) return bill
    const pay = await d.http('POST', '/v1/payables/payments', { companyId: ctx.companyId, supplierId, paymentDate: day, amount: money(p.paid), method: account.method, paidFromAccountId: account.accountId, allocations: [{ billId: id, amount: money(p.paid) }] }, { key: `${p.id}-pay` })
    return pay.ok ? bill : pay
  }

  /** The phone's "open the day" is the till's shift; closing it counts the cash. A shift the sales have already opened is adopted, not opened twice. */
  async function openDay(sess: DaySession): Promise<Response> {
    const ctx = await d.ensureCtx()
    const open = await d.json<{ items: Array<{ id: string }> }>('GET', `/v1/pos/shifts?companyId=${ctx.companyId}&terminalId=${ctx.terminalId}&status=open&limit=1`)
    if (open.items[0]) { remember(sess.id, open.items[0].id); return reply(200) }
    const res = await d.http('POST', '/v1/pos/shifts', { terminalId: ctx.terminalId, openingCash: money(sess.openingCash) }, { key: sess.id })
    if (res.ok) { try { remember(sess.id, ((await res.clone().json()) as { id: string }).id) } catch { /* see sale() */ } }
    return res
  }
  async function closeDay(p: Row): Promise<Response> {
    const ctx = await d.ensureCtx()
    let id = idOf(String(p['id']))
    if (!id || !isId(id)) { const open = await d.json<{ items: Array<{ id: string }> }>('GET', `/v1/pos/shifts?companyId=${ctx.companyId}&terminalId=${ctx.terminalId}&status=open&limit=1`); id = open.items[0]?.id }
    if (!id) return reply(200) // nothing open on the platform: already closed
    return d.http('POST', `/v1/pos/shifts/${id}/close`, { countedCash: money(num(p['countedCash'])) }, { key: `close-${String(p['id'])}` })
  }
  async function createCoupon(c: Coupon): Promise<Response> {
    const ctx = await d.ensureCtx()
    const res = await d.http('POST', '/v1/retail/coupons', couponToPlatform(c, ctx.companyId), { key: c.id })
    if (res.ok) { try { remember(c.id, ((await res.clone().json()) as { id: string }).id) } catch { /* see sale() */ } }
    return res
  }
  async function updateCoupon(p: Row): Promise<Response> {
    const id = idOf(String(p['id'])); if (!id || !isId(id)) return reply(404, { error: 'That coupon has not reached the server yet' })
    const body: Row = { ...(p['active'] !== undefined ? { status: p['active'] ? 'active' : 'inactive' } : {}), ...(p['value'] !== undefined ? { value: money(num(p['value'])) } : {}), ...(p['minBill'] !== undefined ? { minBill: money(num(p['minBill'])) } : {}) }
    if (!Object.keys(body).length) return reply(200)
    // coupons have no single-record read: the version comes from the list
    const ctx = await d.ensureCtx()
    const list = await d.json<{ items: Array<{ id: string; version: number }> }>('GET', `/v1/retail/coupons?companyId=${ctx.companyId}`)
    const cur = list.items.find((x) => x.id === id); if (!cur) return reply(404, { error: 'That coupon is not on the server' })
    return d.http('PATCH', `/v1/retail/coupons/${id}`, body, { headers: { 'If-Match': String(cur.version) } })
  }

  async function holdProduct(p: Row): Promise<Response> {
    const c = d.ctx(); if (!c) return reply(401)
    d.setCtx({ ...c, pending: { ...(c.pending ?? {}), [String(p['id'])]: p } })
    return reply(200)
  }
  async function createVariant(v: Row): Promise<Response> {
    const ctx = await d.ensureCtx()
    const p = (ctx.pending?.[String(v['productId'])] ?? {}) as Row
    const basics = await itemBasics(p['gstRate'] === undefined ? undefined : num(p['gstRate']))
    const hsn = String(p['hsn'] ?? '').replace(/\D/g, '')
    const body: Row = {
      code: String(v['sku'] || codeOf(String(v['id']), 'I-')).toUpperCase().replace(/[^A-Z0-9._/-]/g, '-').slice(0, 40), name: String(p['name'] ?? v['sku']), itemType: 'finished_good', baseUomId: basics.baseUomId, ...(basics.taxCodeId ? { taxCodeId: basics.taxCodeId } : {}),
      ...(/^[0-9]{4,8}$/.test(hsn) ? { hsnSacCode: hsn } : {}), isStocked: p['trackStock'] !== false, isSellable: true, ...(p['brand'] ? { brand: String(p['brand']).slice(0, 100) } : {}), ...(p['styleCode'] ? { styleCode: String(p['styleCode']).slice(0, 40) } : {}),
      ...(v['size'] ? { size: String(v['size']).slice(0, 40) } : {}), ...(v['color'] ? { colour: String(v['color']).slice(0, 40) } : {}), ...(num(v['mrp']) || num(v['price']) ? { mrp: money(num(v['mrp']) || num(v['price'])) } : {}), ...(num(v['reorderLevel']) ? { reorderLevel: String(num(v['reorderLevel'])) } : {}),
    }
    const res = await d.http('POST', '/v1/items', body, { key: String(v['id']) })
    if (res.ok) { try { const id = ((await res.clone().json()) as { id: string }).id; remember(String(v['id']), id); remember(String(v['productId']), id) } catch { /* see sale() */ } }
    return res
  }
  async function updateVariant(v: Row): Promise<Response> {
    const id = idOf(String(v['id'])); if (!id || !isId(id)) return reply(404, { error: 'That item has not reached the server yet' })
    const body: Row = { ...(v['price'] !== undefined || v['mrp'] !== undefined ? { mrp: money(num(v['mrp']) || num(v['price'])) } : {}), ...(v['reorderLevel'] !== undefined ? { reorderLevel: String(num(v['reorderLevel'])) } : {}), ...(v['size'] !== undefined ? { size: String(v['size']) || null } : {}), ...(v['color'] !== undefined ? { colour: String(v['color']) || null } : {}) }
    return Object.keys(body).length ? patch(`/v1/items/${id}`, body) : reply(200)
  }
  async function updateProduct(p: Row): Promise<Response> {
    const id = idOf(String(p['id'])); if (!id || !isId(id)) return reply(404, { error: 'That item has not reached the server yet' })
    const body: Row = { ...(p['name'] !== undefined ? { name: String(p['name']).slice(0, 300) } : {}), ...(p['brand'] !== undefined ? { brand: String(p['brand']).slice(0, 100) || null } : {}), ...(p['active'] === false ? { isSellable: false } : p['active'] === true ? { isSellable: true } : {}) }
    return Object.keys(body).length ? patch(`/v1/items/${id}`, body) : reply(200)
  }

  return {
    idOf,
    async raw(method: string, path: string, bodyIn?: unknown): Promise<Response> {
      const body = bodyIn as Row
      try {
        if (method === 'POST' && path === '/bills') return await sale(bodyIn as Bill)
        if (method === 'POST' && /^\/bills\/[^/]+\/return$/.test(path)) return await saleReturn(bodyIn as Bill)
        if (method === 'POST' && path === '/customers') return await createCustomer(bodyIn as Customer)
        if (method === 'PUT' && path.startsWith('/customers/')) {
          const id = idOf(path.split('/')[2]); if (!id || !isId(id)) return reply(404, { error: 'That customer has not reached the server yet' })
          const out: Row = { ...(body['name'] !== undefined ? { legalName: body['name'] } : {}), ...(body['phone'] ? { phone: body['phone'] } : {}), ...(body['email'] ? { email: body['email'] } : {}) }
          return Object.keys(out).length ? await patch(`/v1/parties/${id}`, out) : reply(200)
        }
        if (method === 'POST' && path === '/suppliers') return await createSupplier(bodyIn as Supplier)
        if (method === 'POST' && path === '/purchases') return await purchase(bodyIn as Purchase)
        if (method === 'POST' && path === '/expenses') return await addExpense(bodyIn as Expense)
        if (method === 'POST' && path === '/stock/adjust') return await adjust(bodyIn as StockMove)
        if (method === 'POST' && path === '/products') return await holdProduct(body)
        if (method === 'POST' && path === '/variants') return await createVariant(body)
        if (method === 'PUT' && path.startsWith('/variants/')) return await updateVariant(body)
        if (method === 'PUT' && path.startsWith('/products/')) return await updateProduct(body)
        if (method === 'POST' && path === '/sessions') return await openDay(bodyIn as DaySession)
        if (method === 'PUT' && path.startsWith('/sessions/')) return await closeDay(body)
        if (method === 'POST' && path === '/coupons') return await createCoupon(bodyIn as Coupon)
        if (method === 'PUT' && path.startsWith('/coupons/')) return await updateCoupon(body)
        if (path === '/store' || path.startsWith('/categories') || path === '/users' || path.startsWith('/users/')) return reply(200) // settings that stay on the phone
        return reply(405, { error: `${method} ${path} is not synced to this server yet` })
      } catch (e) {
        // no connection: let the sync engine see it as one (it marks the phone offline and tries again later)
        if (e instanceof CloudError && e.status === 0) throw e
        if (e instanceof CloudError) return reply(e.status, { error: e.message })
        throw new CloudError('Cannot reach the server.')
      }
    },
  }
}
