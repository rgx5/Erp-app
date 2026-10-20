import type { FastifyInstance } from 'fastify'
import type { PoolClient } from 'pg'
import { applyMutations, pullChanges } from '@/replication/apply'
import type { Mutation } from '@/replication/types'
import { authenticate, bodyOf, principalOf, withOrg, type Ctx } from '../ctx'
import { badRequest, tooLarge } from '../errors'
import { PgDocStore } from '../pgDocStore'

/** Most writes accepted in one request. */
export const MAX_BATCH = 200

export function registerSyncRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = authenticate(ctx)

  app.post('/sync/push', { preHandler: auth, bodyLimit: 16 * 1024 * 1024 }, async (req) => {
    const p = principalOf(req)
    const b = bodyOf(req)
    if (!Array.isArray(b.mutations)) throw badRequest('Send { mutations: [...] }')
    if (b.mutations.length > MAX_BATCH) throw tooLarge(`Send at most ${MAX_BATCH} writes at a time`)
    // One transaction, with the organisation's write lock taken first. The shared rules judge each write on its own (a savepoint
    // per mutation), so a refusal undoes only itself.
    return withOrg(ctx, p.orgId, async (store, c) => {
      const results = await applyMutations(store, b.mutations as Mutation[], p)
      const rev = (await c.query<{ rev: number }>('SELECT rev FROM orgs WHERE id = $1', [p.orgId])).rows[0].rev
      return { results, cursor: rev }
    })
  })

  app.get('/sync/pull', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    const q = req.query as { since?: string; limit?: string }
    const since = q.since === undefined ? 0 : Number(q.since)
    const limit = q.limit === undefined ? 500 : Number(q.limit)
    if (!Number.isInteger(since) || since < 0) throw badRequest('since must be a whole number, 0 or more')
    if (!Number.isInteger(limit) || limit < 1) throw badRequest('limit must be a whole number, 1 or more')
    // One snapshot for the page and the cursor, so the cursor can never skip a document that commits a moment later.
    const c: PoolClient = await ctx.pool.connect()
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const out = await pullChanges(new PgDocStore(c, p.orgId), p, since, limit)
      await c.query('COMMIT')
      return out
    } catch (e) {
      try { await c.query('ROLLBACK') } catch { /* gone */ }
      throw e
    } finally {
      c.release()
    }
  })
}
