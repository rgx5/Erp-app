// Load every module's collections, permissions and effects before anything can be asked of the registry.
import '@/modules/replication-all'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import type { Pool } from 'pg'
import type { Config } from './config'
import type { Ctx } from './ctx'
import { HttpError } from './errors'
import { DiskFileStore, type FileStore } from './fileStore'
import { Passwords } from './passwords'
import { PrincipalResolver } from './principal'
import { registerAuthRoutes } from './routes/auth'
import { registerBackupRoutes } from './routes/backup'
import { registerFileRoutes } from './routes/files'
import { registerOrgRoutes } from './routes/org'
import { registerShareRoutes } from './routes/share'
import { registerSyncRoutes } from './routes/sync'
import { registerUserRoutes } from './routes/users'

export const VERSION = '0.1.0'

export interface AppDeps {
  cfg: Config
  pool: Pool
  files?: FileStore
  logger?: FastifyServerOptions['logger']
}

/** The whole HTTP server, ready to `listen` or to be driven with `inject` in tests. */
export function buildApp(deps: AppDeps): FastifyInstance & { ctx: Ctx } {
  const { cfg, pool } = deps
  const app = Fastify({
    logger: deps.logger ?? (cfg.production ? { level: 'info', redact: ['req.headers.authorization'] } : false),
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: cfg.trustProxy,
    // Never leak internals: a stray exception becomes a generic 500 (the real error is logged).
  })

  const ctx: Ctx = { cfg, pool, principals: new PrincipalResolver(pool, cfg), passwords: new Passwords(cfg.bcryptCost), files: deps.files ?? new DiskFileStore(cfg.filesDir) }

  // Uploads arrive as raw bytes with any Content-Type (JSON keeps its own parser).
  app.removeContentTypeParser('text/plain') // Fastify would hand a text upload over as a string; every upload is bytes
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 128 * 1024 * 1024 }, (_req, body, done) => done(null, body))

  // ── CORS (explicit allow-list) and defensive headers ──
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (origin && cfg.corsOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Filename')
      reply.header('Access-Control-Max-Age', '86400')
    }
    if (req.method === 'OPTIONS') return reply.code(204).send()
    return undefined
  })
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Cross-Origin-Resource-Policy', 'same-site')
    if (cfg.production) reply.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store')
    return payload
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      if (err.status === 429 && typeof err.extra?.retryAfter === 'number') reply.header('Retry-After', String(err.extra.retryAfter))
      return reply.code(err.status).send({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.extra ?? {}) })
    }
    const e = err as { statusCode?: number; code?: string; message: string }
    if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || e.statusCode === 413) return reply.code(413).send({ error: 'That request is too large', code: 'too_large' })
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.statusCode === 415 ? 'Unsupported content type' : 'The request could not be read', code: 'bad_request' })
    req.log.error({ err }, 'unhandled error')
    return reply.code(500).send({ error: 'Something went wrong on the server', code: 'server_error' })
  })
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found', code: 'not_found' }))

  app.get('/health', async (_req, reply) => {
    try {
      await pool.query('SELECT 1')
    } catch {
      return reply.code(503).send({ app: 'kosh-server', version: VERSION, ok: false, time: Date.now() })
    }
    return { app: 'kosh-server', version: VERSION, ok: true, time: Date.now() }
  })

  registerAuthRoutes(app, ctx)
  registerUserRoutes(app, ctx)
  registerOrgRoutes(app, ctx)
  registerSyncRoutes(app, ctx)
  registerFileRoutes(app, ctx)
  registerShareRoutes(app, ctx)
  registerBackupRoutes(app, ctx)

  return Object.assign(app, { ctx })
}
