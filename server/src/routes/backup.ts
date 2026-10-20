import type { FastifyInstance } from 'fastify'
import { collectionMeta } from '@/replication/registry'
import type { Doc } from '@/replication/types'
import { authenticate, bodyOf, principalOf, requireOwner, withOrg, type Ctx } from '../ctx'
import { one } from '../db'
import { badRequest, conflict, unprocessable } from '../errors'
import { newId } from '../ids'
import { knownPermissions } from '../permissions'
import { newApiKey, hashSecret } from '../tokens'
import { bool, optStr, str, strArray } from '../validate'
import { branchesFor } from './shared'

export const BACKUP_FORMAT = 'kosh-backup'
const MAX_RESTORE_BYTES = 128 * 1024 * 1024

interface BackupDoc { coll: string; id: string; branchId?: string | null; data: Doc }

export function registerBackupRoutes(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx
  const auth = authenticate(ctx)

  // ── the whole business as one JSON file (credentials are never included) ──
  app.get('/backup', { preHandler: auth }, async (req, reply) => {
    const p = principalOf(req)
    requireOwner(p)
    const org = await one<{ name: string; industry: string; plan: string; profile: Record<string, unknown> }>(pool, 'SELECT name, industry, plan, profile FROM orgs WHERE id = $1', [p.orgId])
    const docs = await pool.query<{ coll: string; id: string; branch_id: string | null; data: Doc }>(
      'SELECT coll, id, branch_id, data FROM docs WHERE org_id = $1 AND NOT deleted ORDER BY rev', [p.orgId])
    const roles = await pool.query<{ id: string; name: string; permissions: string[] }>('SELECT id, name, permissions FROM roles WHERE org_id = $1 ORDER BY name', [p.orgId])
    const out = {
      format: BACKUP_FORMAT, version: 1, createdAt: Date.now(), org,
      branches: await branchesFor(pool, p.orgId, 'all'),
      roles: roles.rows,
      docs: docs.rows.map((d): BackupDoc => ({ coll: d.coll, id: d.id, branchId: d.branch_id, data: d.data })),
    }
    reply.header('Content-Disposition', `attachment; filename="kosh-backup-${new Date().toISOString().slice(0, 10)}.json"`)
    return out
  })

  // ── put a backup back (only into a business that has no records yet) ──
  app.post('/restore', { preHandler: auth, bodyLimit: MAX_RESTORE_BYTES }, async (req) => {
    const p = principalOf(req)
    requireOwner(p)
    const b = bodyOf(req)
    if (b.format !== BACKUP_FORMAT || b.version !== 1 || !Array.isArray(b.docs)) throw badRequest('That does not look like a Kosh backup file')
    const docs = b.docs as BackupDoc[]
    const branches = Array.isArray(b.branches) ? (b.branches as Array<{ id: string; name: string; code?: string; address?: string; phone?: string; active?: boolean; isDefault?: boolean }>) : []
    const roles = Array.isArray(b.roles) ? (b.roles as Array<{ name: string; permissions: string[] }>) : []

    // Validate everything before writing anything.
    for (const d of docs) {
      const meta = d && typeof d.coll === 'string' ? collectionMeta(d.coll) : undefined
      if (!meta || meta.local) throw unprocessable(`The backup has records of an unknown kind (“${d?.coll}”)`, 'unknown_collection')
      if (!d.data || typeof d.data !== 'object' || d.data.id !== d.id) throw unprocessable('The backup has a damaged record', 'invalid')
    }

    return withOrg(ctx, p.orgId, async (store, c) => {
      const existing = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM docs WHERE org_id = $1 AND NOT deleted AND coll <> 'users'`, [p.orgId])
      if (existing.rows[0].n) throw conflict('This business already has records. Restore into a new, empty business.', 'not_empty')

      // Branches get new ids here (ids are global); documents are re-pointed.
      const branchMap = new Map<string, string>()
      const mine = (await c.query<{ id: string }>('SELECT id FROM branches WHERE org_id = $1 AND is_default', [p.orgId])).rows[0]?.id
      for (const br of branches) {
        if (!br || typeof br.id !== 'string' || typeof br.name !== 'string') continue
        if (br.isDefault && mine) { branchMap.set(br.id, mine); continue }
        const nid = newId('br')
        await c.query('INSERT INTO branches (id, org_id, name, code, address, phone, active) VALUES ($1, $2, $3, $4, $5, $6, $7)', [nid, p.orgId, br.name.slice(0, 120), br.code?.slice(0, 20) ?? null, (br.address ?? '').slice(0, 300), (br.phone ?? '').slice(0, 40), br.active !== false])
        branchMap.set(br.id, nid)
      }
      const known = new Set(knownPermissions())
      for (const r of roles) {
        if (!r || typeof r.name !== 'string') continue
        const perms = (Array.isArray(r.permissions) ? r.permissions : []).filter((x) => known.has(x))
        await c.query('INSERT INTO roles (id, org_id, name, permissions) VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, name) DO NOTHING', [newId('role'), p.orgId, r.name.slice(0, 60), perms])
      }

      let n = 0
      for (const d of docs) {
        if (d.coll === 'users') continue // people are added through the users API, with their own credentials
        const meta = collectionMeta(d.coll)!
        const data: Doc = { ...d.data }
        const branch = meta.branched && typeof data.branchId === 'string' ? branchMap.get(data.branchId) ?? null : null
        if (meta.branched && typeof data.branchId === 'string') { if (branch) data.branchId = branch; else delete data.branchId }
        await store.put(d.coll, d.id, data, { branchId: branch, by: p.userId })
        n++
      }
      return { ok: true, restored: n }
    })
  })

  // ── integration keys ──
  app.get('/api-keys', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requireOwner(p)
    const r = await pool.query<{ id: string; name: string; permissions: string[]; created_at: Date; last_used: Date | null; expires_at: Date | null; revoked: boolean }>(
      'SELECT id, name, permissions, created_at, last_used, expires_at, revoked FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC', [p.orgId])
    return r.rows.map((k) => ({ id: k.id, name: k.name, permissions: k.permissions, createdAt: k.created_at.getTime(), lastUsed: k.last_used?.getTime(), expiresAt: k.expires_at?.getTime(), revoked: k.revoked }))
  })

  app.post('/api-keys', { preHandler: auth }, async (req, reply) => {
    const p = principalOf(req)
    requireOwner(p)
    const b = bodyOf(req)
    const name = str(b, 'name', { max: 80 })
    const perms = strArray(b, 'permissions', { max: 200 }) ?? []
    const known = new Set(knownPermissions())
    const bad = perms.filter((x) => !known.has(x))
    if (bad.length) throw unprocessable(`Unknown permission: ${bad.join(', ')}`, 'unknown_permission')
    let expires: string | null = null
    if (b.expiresAt !== undefined && b.expiresAt !== null) {
      if (typeof b.expiresAt !== 'number' || b.expiresAt <= Date.now()) throw badRequest('expiresAt must be a time in the future (epoch milliseconds)')
      expires = new Date(b.expiresAt).toISOString()
    }
    const k = newApiKey()
    await pool.query('INSERT INTO api_keys (id, org_id, name, secret_hash, permissions, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [k.id, p.orgId, name, hashSecret(k.secret), perms, p.userId, expires])
    reply.code(201)
    return { id: k.id, name, permissions: perms, key: k.key } // the only time the key is shown
  })

  app.delete('/api-keys/:id', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    requireOwner(p)
    const { id } = req.params as { id: string }
    const r = await pool.query('UPDATE api_keys SET revoked = TRUE WHERE id = $1 AND org_id = $2', [id, p.orgId])
    if (!r.rowCount) throw badRequest('That key does not exist')
    ctx.principals.invalidate(p.orgId)
    return { ok: true }
  })
}

void bool
void optStr
