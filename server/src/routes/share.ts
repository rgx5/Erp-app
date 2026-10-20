import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Bill, Customer, StoreSettings, User } from '@/domain/types'
import { invoiceHtml } from '@/domain/receipt'
import { docToSettings } from '@/replication/client'
import { authenticate, bodyOf, principalOf, requirePerm, type Ctx } from '../ctx'
import { one } from '../db'
import { badRequest, notFound, unprocessable } from '../errors'
import { str } from '../validate'

/** Collections that have a printable form. */
const SHAREABLE = ['bills']

const fallbackStore = (orgId: string, name: string): StoreSettings => ({
  id: orgId, name, tagline: '', address: '', city: '', phone: '', email: '', gstin: '', invoicePrefix: 'INV-', nextInvoiceNo: 1, slabs: [], priceIncludesTax: true,
  receiptWidth: '80mm', returnPolicy: '', footerNote: '', loyaltyEarnPct: 0, loyaltyRedeemValue: 0, maxCashierDiscountPct: 0, lowStockDefault: 0,
})

export function registerShareRoutes(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx
  const auth = authenticate(ctx)

  // ── make a public link to one document ──
  app.post('/share', { preHandler: auth }, async (req, reply) => {
    const p = principalOf(req)
    requirePerm(p, 'pos', 'customers')
    const b = bodyOf(req)
    const coll = str(b, 'coll', { max: 40 })
    const id = str(b, 'id', { max: 100 })
    if (!SHAREABLE.includes(coll)) throw unprocessable(`Only ${SHAREABLE.join(', ')} can be shared`, 'not_shareable')
    const doc = await one<{ deleted: boolean }>(pool, 'SELECT deleted FROM docs WHERE org_id = $1 AND coll = $2 AND id = $3', [p.orgId, coll, id])
    if (!doc || doc.deleted) throw notFound('That document does not exist')
    let days: number | null = null
    if (b.expiresInDays !== undefined && b.expiresInDays !== null) {
      if (typeof b.expiresInDays !== 'number' || !(b.expiresInDays > 0) || b.expiresInDays > 3650) throw badRequest('expiresInDays must be between 1 and 3650')
      days = b.expiresInDays
    }
    const token = randomBytes(24).toString('base64url')
    await pool.query(`INSERT INTO share_tokens (token, org_id, coll, doc_id, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::float8 IS NULL THEN NULL ELSE now() + ($6::float8 * interval '1 day') END)`,
      [token, p.orgId, coll, id, p.userId, days])
    reply.code(201)
    return { token, url: `${ctx.cfg.publicUrl}/p/${token}` }
  })

  app.delete('/share/:token', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requirePerm(p, 'pos', 'customers')
    const { token } = req.params as { token: string }
    const r = await pool.query('DELETE FROM share_tokens WHERE token = $1 AND org_id = $2', [token, p.orgId])
    if (!r.rowCount) throw notFound('That link does not exist')
    return { ok: true }
  })

  // ── the public page ──
  app.get('/p/:token', async (req, reply) => {
    const { token } = req.params as { token: string }
    const t = typeof token === 'string' && token.length <= 64
      ? await one<{ org_id: string; coll: string; doc_id: string }>(pool, 'SELECT org_id, coll, doc_id FROM share_tokens WHERE token = $1 AND (expires_at IS NULL OR expires_at > now())', [token])
      : undefined
    if (!t) throw notFound('This link is not valid any more')
    const doc = async <T>(coll: string, id: string) => (await one<{ data: T | null }>(pool, 'SELECT data FROM docs WHERE org_id = $1 AND coll = $2 AND id = $3 AND NOT deleted', [t.org_id, coll, id]))?.data ?? null
    const bill = await doc<Bill>(t.coll, t.doc_id)
    if (!bill) throw notFound('This link is not valid any more')
    const org = await one<{ name: string }>(pool, 'SELECT name FROM orgs WHERE id = $1', [t.org_id])
    const settings = await doc<Record<string, unknown> & { id: string }>('settings', 'store')
    const store = settings ? docToSettings(settings, t.org_id) : fallbackStore(t.org_id, org?.name ?? '')
    const customer = bill.customerId ? await doc<Customer>('customers', bill.customerId) : null
    const sellerId = bill.soldBy ?? bill.cashierId
    const seller = sellerId ? await doc<User>('users', sellerId) : null
    reply.header('Content-Type', 'text/html; charset=utf-8')
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'")
    reply.header('Cache-Control', 'private, no-store')
    reply.header('Referrer-Policy', 'no-referrer')
    return invoiceHtml({ bill, store, customer, seller })
  })
}
