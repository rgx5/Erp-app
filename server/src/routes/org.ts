import type { FastifyInstance } from 'fastify'
import { authenticate, bodyOf, principalOf, requireOwner, type Ctx } from '../ctx'
import { one } from '../db'
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../errors'
import { newId } from '../ids'
import { bool, optStr, safeId, str } from '../validate'
import { branchesFor } from './shared'

interface OrgRow { id: string; name: string; industry: string; plan: string; profile: Record<string, unknown>; created_at: Date }
const orgOut = (o: OrgRow) => ({ id: o.id, name: o.name, industry: o.industry, plan: o.plan, profile: o.profile, createdAt: o.created_at.getTime() })

export function registerOrgRoutes(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx
  const auth = authenticate(ctx)

  // ── the business ──
  app.get('/org', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    return orgOut((await one<OrgRow>(pool, 'SELECT id, name, industry, plan, profile, created_at FROM orgs WHERE id = $1', [p.orgId]))!)
  })

  app.put('/org', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requireOwner(p)
    const b = bodyOf(req)
    const name = b.name === undefined ? null : str(b, 'name', { max: 120 })
    const industry = b.industry === undefined ? null : str(b, 'industry', { max: 40 })
    const plan = b.plan === undefined ? null : str(b, 'plan', { max: 32 })
    let profile: string | null = null
    if (b.profile !== undefined) {
      if (typeof b.profile !== 'object' || b.profile === null || Array.isArray(b.profile)) throw badRequest('profile must be an object')
      profile = JSON.stringify(b.profile)
      if (profile.length > 16_000) throw badRequest('profile is too large')
    }
    const r = await one<OrgRow>(pool,
      'UPDATE orgs SET name = COALESCE($2, name), industry = COALESCE($3, industry), plan = COALESCE($4, plan), profile = COALESCE($5::jsonb, profile) WHERE id = $1 RETURNING id, name, industry, plan, profile, created_at',
      [p.orgId, name, industry, plan, profile])
    return orgOut(r!)
  })

  // ── branches ──
  app.get('/branches', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    return branchesFor(pool, p.orgId, p.branches)
  })

  app.post('/branches', { preHandler: auth }, async (req, reply) => {
    const p = principalOf(req)
    requireOwner(p)
    const b = bodyOf(req)
    const id = newId('br')
    await pool.query('INSERT INTO branches (id, org_id, name, code, address, phone) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, p.orgId, str(b, 'name', { max: 120 }), optStr(b, 'code', { max: 20 }) || null, optStr(b, 'address', { max: 300 }) ?? '', optStr(b, 'phone', { max: 40 }) ?? ''])
    reply.code(201)
    return (await branchesFor(pool, p.orgId, 'all')).find((x) => x.id === id)
  })

  app.put('/branches/:id', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requireOwner(p)
    const { id } = req.params as { id: string }
    const b = bodyOf(req)
    const cur = await one<{ is_default: boolean }>(pool, 'SELECT is_default FROM branches WHERE id = $1 AND org_id = $2', [id, p.orgId])
    if (!cur) throw notFound('That branch does not exist')
    const active = bool(b, 'active')
    if (cur.is_default && active === false) throw unprocessable('The main branch cannot be switched off', 'default_branch')
    await pool.query(
      'UPDATE branches SET name = COALESCE($3, name), code = COALESCE($4, code), address = COALESCE($5, address), phone = COALESCE($6, phone), active = COALESCE($7, active) WHERE id = $1 AND org_id = $2',
      [id, p.orgId, b.name === undefined ? null : str(b, 'name', { max: 120 }), b.code === undefined ? null : str(b, 'code', { max: 20 }), b.address === undefined ? null : str(b, 'address', { max: 300, optional: true }),
        b.phone === undefined ? null : str(b, 'phone', { max: 40, optional: true }), active ?? null])
    return (await branchesFor(pool, p.orgId, 'all')).find((x) => x.id === id)
  })

  // ── devices ──
  app.get('/devices', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    const r = await pool.query<{ id: string; user_id: string | null; name: string; platform: string; revoked: boolean; last_seen: Date; created_at: Date }>(
      `SELECT id, user_id, name, platform, revoked, last_seen, created_at FROM devices WHERE org_id = $1 AND ($2::boolean OR user_id = $3) ORDER BY last_seen DESC`, [p.orgId, p.isOwner, p.userId])
    return r.rows.map((d) => ({ id: d.id, userId: d.user_id ?? undefined, name: d.name, platform: d.platform, revoked: d.revoked, lastSeen: d.last_seen.getTime(), createdAt: d.created_at.getTime(), current: d.id === p.deviceId }))
  })

  app.delete('/devices/:id', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    const { id } = req.params as { id: string }
    const d = await one<{ user_id: string | null }>(pool, 'SELECT user_id FROM devices WHERE org_id = $1 AND id = $2', [p.orgId, id])
    if (!d) throw notFound('That device does not exist')
    if (!p.isOwner && d.user_id !== p.userId) throw forbidden('Only the owner can remove another person’s device')
    await pool.query('UPDATE devices SET revoked = TRUE, push_token = NULL WHERE org_id = $1 AND id = $2', [p.orgId, id])
    ctx.principals.invalidate(p.orgId)
    return { ok: true }
  })

  app.post('/devices/push-token', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    if (p.kind !== 'user') throw forbidden('A push token belongs to a device')
    const b = bodyOf(req)
    const token = str(b, 'token', { max: 500 })
    const platform = optStr(b, 'platform', { max: 20 }) ?? ''
    await pool.query('UPDATE devices SET push_token = $3, platform = $4 WHERE org_id = $1 AND id = $2', [p.orgId, p.deviceId, token, platform])
    return { ok: true }
  })
}

void safeId
void conflict
