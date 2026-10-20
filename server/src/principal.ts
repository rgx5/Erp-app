import type { Pool } from 'pg'
import type { Actor } from '@/replication/types'
import type { Config } from './config'
import { permissionsOfRole } from './permissions'
import { hashSecret, parseApiKey, safeEqual, verifyToken } from './tokens'

/** Who is calling, resolved from the database on each request (cached briefly): never trusted from the token. */
export interface Principal extends Actor {
  orgId: string
  kind: 'user' | 'key'
  /** The built-in role name ('owner' | 'manager' | 'cashier'); '' for an API key. */
  role: string
  roleId: string | null
  isOwner: boolean
  permissions: string[]
  deviceId: string
  userName: string
  /** The key id, for an API key. */
  keyId?: string
  /** The token's versions (so "refresh" can issue an equivalent token). Users only. */
  tokenVer?: number
  sessionVer?: number
}

interface UserRow {
  id: string; name: string; role: 'owner' | 'manager' | 'cashier'; role_id: string | null; active: boolean; branches: string[] | null; token_ver: number
  revoked: boolean | null; session_ver: number | null; role_permissions: string[] | null
}

const TTL_MS = 5_000

/**
 * Turns a bearer token (a user's JWT or an API key) into a Principal. Results are cached for a few seconds and dropped the moment
 * something that changes them is written (`invalidate`), so a revoked device or a changed role takes effect on the next request.
 */
export class PrincipalResolver {
  private cache = new Map<string, { at: number; p: Principal | null }>()

  constructor(private readonly pool: Pool, private readonly cfg: Config) {}

  invalidate(orgId: string, userId?: string) {
    for (const k of [...this.cache.keys()]) {
      if (k.startsWith('*|')) this.cache.delete(k) // API-key entries: cheap to refill
      else if (k.startsWith(`${orgId}|`) && (!userId || k.startsWith(`${orgId}|${userId}|`))) this.cache.delete(k)
    }
  }

  async fromBearer(token: string): Promise<Principal | null> {
    const key = parseApiKey(token)
    if (key) return this.fromKey(key.id, key.secret)
    const claims = verifyToken(this.cfg, token)
    if (!claims) return null
    const ck = `${claims.org}|${claims.sub}|${claims.dev}|${claims.ver}|${claims.sv}`
    const hit = this.cache.get(ck)
    if (hit && Date.now() - hit.at < TTL_MS) return hit.p
    const p = await this.loadUser(claims.org, claims.sub, claims.dev, claims.ver, claims.sv)
    this.cache.set(ck, { at: Date.now(), p })
    if (this.cache.size > 5000) this.cache.clear()
    return p
  }

  private async loadUser(org: string, userId: string, dev: string, ver: number, sv: number): Promise<Principal | null> {
    const r = await this.pool.query<UserRow>(
      `SELECT u.id, u.name, u.role, u.role_id, u.active, u.branches, u.token_ver, d.revoked, d.session_ver, r.permissions AS role_permissions
         FROM users u
         LEFT JOIN devices d ON d.org_id = u.org_id AND d.id = $3
         LEFT JOIN roles r ON r.id = u.role_id AND r.org_id = u.org_id
        WHERE u.id = $1 AND u.org_id = $2`,
      [userId, org, dev],
    )
    const u = r.rows[0]
    if (!u || !u.active || u.token_ver !== ver) return null
    if (u.revoked === null || u.revoked || u.session_ver !== sv) return null // unknown, removed, or signed-out device
    const isOwner = u.role === 'owner'
    const permissions = u.role_id && u.role_permissions ? u.role_permissions : permissionsOfRole(u.role)
    const set = new Set(permissions)
    return {
      orgId: org, userId: u.id, kind: 'user', role: u.role, roleId: u.role_id, isOwner, permissions, deviceId: dev, userName: u.name,
      can: (p) => isOwner || set.has(p), branches: u.branches ?? 'all', tokenVer: u.token_ver, sessionVer: u.session_ver ?? 0,
    }
  }

  private async fromKey(id: string, secret: string): Promise<Principal | null> {
    const ck = `key:${id}`
    // The cache key holds the hash of the whole secret, so a request that only knows a prefix of it cannot ride on a cached success.
    const cacheKey = `*|${ck}|${hashSecret(secret)}`
    const hit = this.cache.get(cacheKey)
    if (hit && Date.now() - hit.at < TTL_MS) return hit.p
    const r = await this.pool.query<{ org_id: string; name: string; secret_hash: string; permissions: string[]; revoked: boolean; expires_at: Date | null }>(
      'SELECT org_id, name, secret_hash, permissions, revoked, expires_at FROM api_keys WHERE id = $1', [id])
    const k = r.rows[0]
    let p: Principal | null = null
    if (k && !k.revoked && (!k.expires_at || k.expires_at.getTime() > Date.now()) && safeEqual(k.secret_hash, hashSecret(secret))) {
      const set = new Set(k.permissions)
      p = { orgId: k.org_id, userId: `key:${id}`, kind: 'key', role: '', roleId: null, isOwner: false, permissions: k.permissions, deviceId: '', userName: k.name, keyId: id, can: (x) => set.has(x), branches: 'all' }
      void this.pool.query('UPDATE api_keys SET last_used = now() WHERE id = $1', [id]).catch(() => {})
    }
    this.cache.set(cacheKey, { at: Date.now(), p })
    if (this.cache.size > 5000) this.cache.clear()
    return p
  }
}
