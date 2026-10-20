import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import type { Config } from './config'
import { withTx } from './db'
import type { FileStore } from './fileStore'
import { forbidden, unauthorized } from './errors'
import { Passwords } from './passwords'
import { PgDocStore } from './pgDocStore'
import { PrincipalResolver, type Principal } from './principal'

/** What every route needs. */
export interface Ctx {
  cfg: Config
  pool: Pool
  principals: PrincipalResolver
  passwords: Passwords
  files: FileStore
}

declare module 'fastify' {
  interface FastifyRequest { principal?: Principal }
}

/** `preHandler` that requires a signed-in caller (a user's token or an API key) and puts the Principal on the request. */
export const authenticate = (ctx: Ctx) => async (req: FastifyRequest, _reply: FastifyReply) => {
  const h = req.headers.authorization
  const m = h ? /^Bearer\s+(\S+)$/i.exec(h) : null
  if (!m) throw unauthorized()
  const p = await ctx.principals.fromBearer(m[1])
  if (!p) throw unauthorized('Your session has ended — sign in again', 'session_ended')
  req.principal = p
}

export const principalOf = (req: FastifyRequest): Principal => {
  if (!req.principal) throw unauthorized()
  return req.principal
}

export function requirePerm(p: Principal, ...perms: string[]) {
  if (!perms.some((x) => x === 'any' || p.can(x))) throw forbidden()
}
export function requireOwner(p: Principal) {
  if (!p.isOwner) throw forbidden('Only the owner can do that')
}

/** A write transaction on one organisation: its write lock is taken first, so concurrent writers queue instead of interleaving. */
export async function withOrg<T>(ctx: Ctx, orgId: string, fn: (store: PgDocStore, c: PoolClient) => Promise<T>): Promise<T> {
  return withTx(ctx.pool, async (c) => {
    const store = new PgDocStore(c, orgId)
    await store.lockOrg()
    return fn(store, c)
  })
}

/** Reads only the object body of a JSON request (a raw upload on a JSON route is a mistake, not an object). */
export function bodyOf(req: FastifyRequest): Record<string, unknown> {
  const b = req.body
  if (b === undefined || b === null) return {}
  if (typeof b !== 'object' || Array.isArray(b) || Buffer.isBuffer(b)) throw Object.assign(new Error('Send a JSON object'), { statusCode: 400 })
  return b as Record<string, unknown>
}
