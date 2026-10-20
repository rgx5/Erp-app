import type { FastifyInstance } from 'fastify'
import { authenticate, bodyOf, principalOf, requireOwner, requirePerm, withOrg, type Ctx } from '../ctx'
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../errors'
import { newId } from '../ids'
import { knownPermissions } from '../permissions'
import { bool, email, optStr, password, pin, safeId, str, strArray } from '../validate'
import { isUniqueViolation, USER_COLS, userView, writeUserDoc, type UserRow } from './shared'

const ROLES = ['owner', 'manager', 'cashier'] as const
type RoleName = (typeof ROLES)[number]

export function registerUserRoutes(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx
  const auth = authenticate(ctx)

  const roleName = (v: unknown): RoleName => {
    if (typeof v !== 'string' || !(ROLES as readonly string[]).includes(v)) throw badRequest('role must be owner, manager or cashier')
    return v as RoleName
  }

  // ── staff ──
  app.get('/users', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requirePerm(p, 'settings')
    const r = await pool.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE org_id = $1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, name`, [p.orgId])
    return r.rows.map(userView)
  })

  app.post('/users', { preHandler: auth }, async (req, reply) => {
    const p = principalOf(req)
    requirePerm(p, 'settings')
    const b = bodyOf(req)
    const id = b.id === undefined || b.id === null ? newId('usr') : safeId(b.id, 'id')
    const name = str(b, 'name', { max: 120 })
    const role = b.role === undefined ? 'cashier' : roleName(b.role)
    if (role === 'owner' && !p.isOwner) throw forbidden('Only the owner can add another owner')
    const roleId = optStr(b, 'roleId', { max: 100 })
    const code = optStr(b, 'code', { max: 20 })
    const branches = strArray(b, 'branches', { max: 200 })
    const mail = b.email === undefined || b.email === null || b.email === '' ? null : email(b)
    const pw = b.password === undefined || b.password === null || b.password === '' ? null : password(b)
    const pn = pin(b) // a PIN is required: it is how staff sign in at the counter
    const pinHash = await ctx.passwords.hash(pn)
    const pwHash = pw ? await ctx.passwords.hash(pw) : null
    const active = bool(b, 'active') ?? true

    try {
      const row = await withOrg(ctx, p.orgId, async (store, c) => {
        if (roleId) {
          const r = await c.query('SELECT 1 FROM roles WHERE id = $1 AND org_id = $2', [roleId, p.orgId])
          if (!r.rowCount) throw unprocessable('That role does not exist')
        }
        if (branches?.length) {
          const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM branches WHERE org_id = $1 AND id = ANY($2::text[])', [p.orgId, branches])
          if (r.rows[0].n !== branches.length) throw unprocessable('One of those branches does not exist')
        }
        const ins = await c.query<UserRow>(
          `INSERT INTO users (id, org_id, name, email, password_hash, pin_hash, role, role_id, active, code, branches)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${USER_COLS}`,
          [id, p.orgId, name, mail, pwHash, pinHash, role, roleId ?? null, active, code || null, branches ?? null])
        await writeUserDoc(store, ins.rows[0], p.userId)
        return ins.rows[0]
      })
      ctx.principals.invalidate(p.orgId)
      reply.code(201)
      return userView(row)
    } catch (e) {
      if (isUniqueViolation(e, 'users_pkey')) throw conflict('A user with that id already exists', 'id_taken')
      if (isUniqueViolation(e, 'users_email')) throw conflict('That email is already used by another account', 'email_taken')
      if (isUniqueViolation(e, 'users_code')) throw conflict('That staff number is already used', 'code_taken')
      throw e
    }
  })

  async function update(orgId: string, actorId: string, actorIsOwner: boolean, id: string, b: Record<string, unknown>, opts: { deactivate?: boolean } = {}) {
    const patch: Record<string, unknown> = {}
    if (b.name !== undefined) patch.name = str(b, 'name', { max: 120 })
    if (b.role !== undefined) patch.role = roleName(b.role)
    if (b.roleId !== undefined) patch.role_id = b.roleId === null || b.roleId === '' ? null : safeId(b.roleId, 'roleId')
    if (b.active !== undefined || opts.deactivate) patch.active = opts.deactivate ? false : bool(b, 'active')
    if (b.code !== undefined) patch.code = b.code === null || b.code === '' ? null : str(b, 'code', { max: 20 })
    if (b.branches !== undefined) patch.branches = b.branches === null ? null : strArray(b, 'branches', { max: 200 })
    if (b.email !== undefined) patch.email = b.email === null || b.email === '' ? null : email(b)
    const newPin = b.pin !== undefined ? pin(b) : undefined
    const newPassword = b.password !== undefined ? password(b) : undefined
    if (newPin !== undefined) { patch.pin_hash = await ctx.passwords.hash(newPin); patch.pin_fail = 0; patch.pin_locked_until = 0 }
    if (newPassword !== undefined) { patch.password_hash = await ctx.passwords.hash(newPassword) }

    try {
      return await withOrg(ctx, orgId, async (store, c) => {
        const cur = (await c.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE org_id = $1 AND id = $2 FOR UPDATE`, [orgId, id])).rows[0]
        if (!cur) throw notFound('That person does not exist')
        if ((cur.role === 'owner' || patch.role === 'owner') && !actorIsOwner) throw forbidden('Only the owner can change an owner')
        const losesOwner = cur.role === 'owner' && cur.active && ((patch.role !== undefined && patch.role !== 'owner') || patch.active === false)
        if (losesOwner) {
          const others = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'owner' AND active AND id <> $2`, [orgId, id])
          if (others.rows[0].n === 0) throw unprocessable('The business needs at least one active owner', 'last_owner')
        }
        if (patch.role_id) {
          const r = await c.query('SELECT 1 FROM roles WHERE id = $1 AND org_id = $2', [patch.role_id, orgId])
          if (!r.rowCount) throw unprocessable('That role does not exist')
        }
        if (Array.isArray(patch.branches) && patch.branches.length) {
          const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM branches WHERE org_id = $1 AND id = ANY($2::text[])', [orgId, patch.branches])
          if (r.rows[0].n !== patch.branches.length) throw unprocessable('One of those branches does not exist')
        }
        const keys = Object.keys(patch)
        if (keys.length) {
          const sets = keys.map((k, i) => `${k} = $${i + 3}`)
          if (newPassword !== undefined || patch.active === false) sets.push('token_ver = token_ver + 1') // old tokens stop working
          await c.query(`UPDATE users SET ${sets.join(', ')} WHERE org_id = $1 AND id = $2`, [orgId, id, ...keys.map((k) => patch[k])])
        }
        const row = (await c.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE org_id = $1 AND id = $2`, [orgId, id])).rows[0]
        await writeUserDoc(store, row, actorId)
        return row
      })
    } catch (e) {
      if (isUniqueViolation(e, 'users_email')) throw conflict('That email is already used by another account', 'email_taken')
      if (isUniqueViolation(e, 'users_code')) throw conflict('That staff number is already used', 'code_taken')
      throw e
    } finally {
      ctx.principals.invalidate(orgId)
    }
  }

  app.put('/users/:id', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requirePerm(p, 'settings')
    const { id } = req.params as { id: string }
    return userView(await update(p.orgId, p.userId, p.isOwner, id, bodyOf(req)))
  })

  app.post('/users/:id/pin', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requirePerm(p, 'settings')
    const { id } = req.params as { id: string }
    const b = bodyOf(req)
    return userView(await update(p.orgId, p.userId, p.isOwner, id, { pin: b.pin }))
  })

  /** "Remove" a person: they can no longer sign in, but everything they did keeps its author. */
  app.delete('/users/:id', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requirePerm(p, 'settings')
    const { id } = req.params as { id: string }
    if (id === p.userId) throw unprocessable('You cannot remove yourself', 'self')
    return userView(await update(p.orgId, p.userId, p.isOwner, id, {}, { deactivate: true }))
  })

  // ── custom roles (owner) ──
  const knownSet = () => new Set(knownPermissions())
  const rolePerms = (b: Record<string, unknown>): string[] => {
    const perms = strArray(b, 'permissions', { max: 200 }) ?? []
    const known = knownSet()
    const bad = perms.filter((x) => !known.has(x))
    if (bad.length) throw unprocessable(`Unknown permission: ${bad.join(', ')}`, 'unknown_permission')
    return perms
  }
  const roleRow = (r: { id: string; name: string; permissions: string[] }) => ({ id: r.id, name: r.name, permissions: r.permissions })

  app.get('/roles', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requireOwner(p)
    const r = await pool.query<{ id: string; name: string; permissions: string[] }>('SELECT id, name, permissions FROM roles WHERE org_id = $1 ORDER BY name', [p.orgId])
    return r.rows.map(roleRow)
  })

  app.post('/roles', { preHandler: auth }, async (req, reply) => {
    const p = principalOf(req)
    requireOwner(p)
    const b = bodyOf(req)
    const name = str(b, 'name', { max: 60 })
    const perms = rolePerms(b)
    try {
      const r = await pool.query<{ id: string; name: string; permissions: string[] }>('INSERT INTO roles (id, org_id, name, permissions) VALUES ($1, $2, $3, $4) RETURNING id, name, permissions', [newId('role'), p.orgId, name, perms])
      reply.code(201)
      return roleRow(r.rows[0])
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('A role with that name already exists')
      throw e
    }
  })

  app.put('/roles/:id', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requireOwner(p)
    const { id } = req.params as { id: string }
    const b = bodyOf(req)
    const name = b.name === undefined ? undefined : str(b, 'name', { max: 60 })
    const perms = b.permissions === undefined ? undefined : rolePerms(b)
    try {
      const r = await pool.query<{ id: string; name: string; permissions: string[] }>(
        'UPDATE roles SET name = COALESCE($3, name), permissions = COALESCE($4, permissions) WHERE id = $1 AND org_id = $2 RETURNING id, name, permissions', [id, p.orgId, name ?? null, perms ?? null])
      if (!r.rows[0]) throw notFound('That role does not exist')
      ctx.principals.invalidate(p.orgId)
      return roleRow(r.rows[0])
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('A role with that name already exists')
      throw e
    }
  })

  app.delete('/roles/:id', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requireOwner(p)
    const { id } = req.params as { id: string }
    const used = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role_id = $2', [p.orgId, id])
    if (used.rows[0].n) throw conflict(`${used.rows[0].n} ${used.rows[0].n === 1 ? 'person has' : 'people have'} this role — give them another first`, 'role_in_use')
    const r = await pool.query('DELETE FROM roles WHERE id = $1 AND org_id = $2', [id, p.orgId])
    if (!r.rowCount) throw notFound('That role does not exist')
    ctx.principals.invalidate(p.orgId)
    return { ok: true }
  })
}
