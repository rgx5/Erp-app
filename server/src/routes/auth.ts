import type { FastifyInstance } from 'fastify'
import type { PoolClient } from 'pg'
import { allCollectionMetas } from '@/replication/registry'
import { authenticate, bodyOf, principalOf, type Ctx } from '../ctx'
import { one, withTx } from '../db'
import { badRequest, conflict, forbidden, tooMany, unauthorized } from '../errors'
import { newId } from '../ids'
import { knownPermissions } from '../permissions'
import { lockoutSeconds } from '../passwords'
import { PgDocStore } from '../pgDocStore'
import { clearThrottle, lockedFor, recordFailure } from '../throttle'
import { signToken } from '../tokens'
import { email, optStr, password, pin, safeId, str } from '../validate'
import { branchesFor, isUniqueViolation, userDoc, type UserRow } from './shared'

const orgView = (o: { id: string; name: string; industry: string; plan: string }) => ({ id: o.id, name: o.name, industry: o.industry, plan: o.plan })

/** Registers (or re-registers) the calling device; a removed device stays removed. */
async function touchDevice(c: Pick<PoolClient, 'query'>, orgId: string, id: string, name: string, userId: string) {
  const r = await c.query<{ revoked: boolean; session_ver: number }>(
    `INSERT INTO devices (org_id, id, user_id, name, last_seen) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (org_id, id) DO UPDATE SET user_id = EXCLUDED.user_id, name = CASE WHEN EXCLUDED.name = '' THEN devices.name ELSE EXCLUDED.name END, last_seen = now()
     RETURNING revoked, session_ver`, [orgId, id, userId, name])
  const d = r.rows[0]
  if (d.revoked) throw forbidden('This device has been removed from the business', 'device_revoked')
  return d.session_ver
}

export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx) {
  const { cfg, pool } = ctx
  const auth = authenticate(ctx)

  // ── sign-up: a new business ──
  app.post('/auth/signup', async (req, reply) => {
    if (!cfg.allowSignup) throw forbidden('This server does not accept new businesses', 'signup_closed')
    const b = bodyOf(req)
    const orgName = str(b, 'orgName', { max: 120, label: 'Business name' })
    const ownerName = str(b, 'ownerName', { max: 120, label: 'Your name' })
    const mail = email(b)
    const pw = password(b)
    const pn = b.pin === undefined || b.pin === null || b.pin === '' ? undefined : pin(b)
    const deviceId = safeId(b.deviceId, 'deviceId')
    const deviceName = optStr(b, 'deviceName', { max: 100 }) ?? ''
    const industry = optStr(b, 'industry', { max: 40 }) ?? 'general'
    const ownerId = b.ownerId === undefined || b.ownerId === null ? newId('usr') : safeId(b.ownerId, 'ownerId')
    const passwordHash = await ctx.passwords.hash(pw)
    const pinHash = pn ? await ctx.passwords.hash(pn) : null

    const orgId = newId('org')
    const branchId = newId('br')
    try {
      const out = await withTx(pool, async (c) => {
        await c.query('INSERT INTO orgs (id, name, industry) VALUES ($1, $2, $3)', [orgId, orgName, industry])
        await c.query('INSERT INTO branches (id, org_id, name, is_default) VALUES ($1, $2, $3, TRUE)', [branchId, orgId, 'Main'])
        await c.query(`INSERT INTO users (id, org_id, name, email, password_hash, pin_hash, role) VALUES ($1, $2, $3, $4, $5, $6, 'owner')`,
          [ownerId, orgId, ownerName, mail, passwordHash, pinHash])
        const sv = await touchDevice(c, orgId, deviceId, deviceName, ownerId)
        // The owner is also a document, so every device can show who made a sale.
        const store = new PgDocStore(c, orgId)
        await store.lockOrg()
        await store.put('users', ownerId, userDoc({ id: ownerId, name: ownerName, role: 'owner', active: true, code: null }), { by: ownerId })
        return sv
      })
      const token = signToken(cfg, { sub: ownerId, org: orgId, dev: deviceId, ver: 0, sv: out })
      reply.code(201)
      return {
        token, user: { id: ownerId, name: ownerName, role: 'owner', email: mail }, org: orgView({ id: orgId, name: orgName, industry, plan: 'free' }),
        branch: { id: branchId, name: 'Main' }, device: { id: deviceId, name: deviceName },
      }
    } catch (e) {
      if (isUniqueViolation(e, 'users_email')) throw conflict('An account with that email already exists', 'email_taken')
      throw e
    }
  })

  // ── password sign-in (owner / manager) ──
  app.post('/auth/login', async (req) => {
    const b = bodyOf(req)
    const mail = email(b)
    const pw = typeof b.password === 'string' ? b.password : ''
    const deviceId = safeId(b.deviceId, 'deviceId')
    const deviceName = optStr(b, 'deviceName', { max: 100 }) ?? ''
    const key = `pw:${mail}:${req.ip}`
    const wait = await lockedFor(pool, key)
    if (wait) throw tooMany(`Too many tries. Wait ${wait} seconds and try again.`, wait)

    const u = await one<UserRow & { token_ver: number }>(pool, `SELECT id, org_id, name, email, role, role_id, active, code, branches, pin_hash, password_hash, token_ver FROM users WHERE lower(email) = $1`, [mail])
    const ok = await ctx.passwords.verify(pw, u?.password_hash)
    if (!u || !ok || !u.active) {
      const w = await recordFailure(pool, key)
      void w
      throw unauthorized('Invalid email or password', 'bad_credentials')
    }
    await clearThrottle(pool, key)
    const sv = await withTx(pool, (c) => touchDevice(c, u.org_id, deviceId, deviceName, u.id))
    const org = await one<{ id: string; name: string; industry: string; plan: string }>(pool, 'SELECT id, name, industry, plan FROM orgs WHERE id = $1', [u.org_id])
    const token = signToken(cfg, { sub: u.id, org: u.org_id, dev: deviceId, ver: u.token_ver, sv })
    return {
      token, user: { id: u.id, name: u.name, role: u.role, email: u.email ?? undefined, code: u.code ?? undefined }, org: orgView(org!),
      branches: await branchesFor(pool, u.org_id, u.branches ?? 'all'), device: { id: deviceId, name: deviceName },
    }
  })

  // ── PIN sign-in at the counter ──
  app.post('/auth/pin-login', async (req) => {
    const b = bodyOf(req)
    const orgId = safeId(b.orgId, 'orgId')
    const userId = safeId(b.userId, 'userId')
    const pn = typeof b.pin === 'string' ? b.pin : ''
    const deviceId = safeId(b.deviceId, 'deviceId')
    const deviceName = optStr(b, 'deviceName', { max: 100 }) ?? ''
    const u = await one<UserRow & { token_ver: number; pin_fail: number; pin_locked_until: number }>(pool,
      `SELECT id, org_id, name, email, role, role_id, active, code, branches, pin_hash, password_hash, token_ver, pin_fail, pin_locked_until FROM users WHERE org_id = $1 AND id = $2`, [orgId, userId])
    const wait = u ? Math.max(0, Math.ceil((u.pin_locked_until - Date.now()) / 1000)) : 0
    if (wait) throw tooMany(`Too many wrong PINs. Wait ${wait} seconds and try again.`, wait)
    const ok = await ctx.passwords.verify(pn, u?.pin_hash)
    if (!u || !ok || !u.active) {
      if (u) {
        const fails = u.pin_fail + 1
        const w = lockoutSeconds(fails)
        await pool.query('UPDATE users SET pin_fail = $3, pin_locked_until = $4 WHERE org_id = $1 AND id = $2', [orgId, userId, fails, w ? Date.now() + w * 1000 : 0])
      }
      throw unauthorized('Wrong PIN', 'bad_credentials')
    }
    if (u.pin_fail) await pool.query('UPDATE users SET pin_fail = 0, pin_locked_until = 0 WHERE org_id = $1 AND id = $2', [orgId, userId])
    const sv = await withTx(pool, (c) => touchDevice(c, orgId, deviceId, deviceName, u.id))
    const org = await one<{ id: string; name: string; industry: string; plan: string }>(pool, 'SELECT id, name, industry, plan FROM orgs WHERE id = $1', [orgId])
    const token = signToken(cfg, { sub: u.id, org: orgId, dev: deviceId, ver: u.token_ver, sv })
    return {
      token, user: { id: u.id, name: u.name, role: u.role, code: u.code ?? undefined }, org: orgView(org!),
      branches: await branchesFor(pool, orgId, u.branches ?? 'all'), device: { id: deviceId, name: deviceName },
    }
  })

  // ── who is at the counter (public: names only) ──
  app.get('/auth/staff', async (req) => {
    const orgId = (req.query as { orgId?: string }).orgId
    if (!orgId || typeof orgId !== 'string') throw badRequest('orgId is required')
    const r = await pool.query<{ id: string; name: string; role: string; active: boolean; code: string | null }>(
      `SELECT id, name, role, active, code FROM users WHERE org_id = $1 AND active AND pin_hash IS NOT NULL
        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, name`, [orgId])
    return r.rows.map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active, code: u.code ?? undefined }))
  })

  app.post('/auth/refresh', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    if (p.kind !== 'user') throw forbidden('API keys do not need refreshing')
    return { token: signToken(cfg, { sub: p.userId, org: p.orgId, dev: p.deviceId, ver: p.tokenVer ?? 0, sv: p.sessionVer ?? 0 }) }
  })

  app.get('/auth/me', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    const org = await one<{ id: string; name: string; industry: string; plan: string }>(pool, 'SELECT id, name, industry, plan FROM orgs WHERE id = $1', [p.orgId])
    const branches = await branchesFor(pool, p.orgId, p.branches)
    const permissions = p.isOwner ? knownPermissions() : [...p.permissions].sort()
    if (p.kind === 'key') return { user: null, key: { id: p.keyId, name: p.userName }, org: orgView(org!), role: '', permissions, branches }
    const u = await one<UserRow>(pool, `SELECT id, org_id, name, email, role, role_id, active, code, branches, pin_hash, password_hash FROM users WHERE org_id = $1 AND id = $2`, [p.orgId, p.userId])
    return {
      user: { id: u!.id, name: u!.name, role: u!.role, roleId: u!.role_id ?? undefined, email: u!.email ?? undefined, code: u!.code ?? undefined },
      org: orgView(org!), role: p.role, permissions, branches,
    }
  })

  app.post('/auth/logout', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    if (p.kind === 'user') {
      await pool.query('UPDATE devices SET session_ver = session_ver + 1 WHERE org_id = $1 AND id = $2', [p.orgId, p.deviceId])
      ctx.principals.invalidate(p.orgId, p.userId)
    }
    return { ok: true }
  })

  // ── the registry as this server knows it (diagnostics) ──
  app.get('/sync/info', { preHandler: auth }, async () => ({
    collections: allCollectionMetas().map((m) => ({
      name: m.name, kind: m.kind, perm: m.perm, readPerm: m.readPerm ?? m.perm, owned: m.owned ?? [], patchable: m.patchable ?? [], local: !!m.local, branched: !!m.branched,
    })),
  }))
}

