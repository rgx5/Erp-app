import type { FastifyInstance } from 'fastify'
import { authenticate, principalOf, type Ctx } from '../ctx'
import { one } from '../db'
import { badRequest, forbidden, notFound, tooLarge } from '../errors'
import { newId } from '../ids'

export const MAX_FILE_BYTES = 10 * 1024 * 1024

/** Shown in the browser only when it cannot run script; everything else downloads. */
const INLINE = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf)$/i

const cleanName = (raw: unknown) => {
  const s = typeof raw === 'string' ? decodeURIComponent(raw) : ''
  return s.replace(/[\\/\0\r\n"]/g, '_').slice(0, 200)
}

export function registerFileRoutes(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx
  const auth = authenticate(ctx)

  app.post('/files', { preHandler: auth, bodyLimit: MAX_FILE_BYTES }, async (req, reply) => {
    const p = principalOf(req)
    const body = req.body
    if (!Buffer.isBuffer(body)) throw badRequest('Send the file as raw bytes with its Content-Type')
    if (!body.length) throw badRequest('That file is empty')
    if (body.length > MAX_FILE_BYTES) throw tooLarge('Files can be at most 10 MB')
    const id = newId('file')
    const type = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim().slice(0, 100) || 'application/octet-stream'
    const name = cleanName(req.headers['x-filename'])
    await ctx.files.put(`${p.orgId}/${id}`, body)
    await pool.query('INSERT INTO files (id, org_id, name, content_type, size, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [id, p.orgId, name, type, body.length, p.userId])
    reply.code(201)
    return { id, url: `/files/${id}`, size: body.length, name, contentType: type }
  })

  app.get('/files/:id', { preHandler: auth }, async (req, reply) => {
    const p = principalOf(req)
    const { id } = req.params as { id: string }
    const f = await one<{ name: string; content_type: string }>(pool, 'SELECT name, content_type FROM files WHERE id = $1 AND org_id = $2', [id, p.orgId])
    const bytes = f ? await ctx.files.get(`${p.orgId}/${id}`) : null
    if (!f || !bytes) throw notFound('That file does not exist')
    const inline = INLINE.test(f.content_type)
    reply.header('Content-Type', inline ? f.content_type : 'application/octet-stream')
    reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${(f.name || id).replace(/[^\w.\- ]/g, '_')}"`)
    reply.header('Content-Security-Policy', "sandbox; default-src 'none'")
    reply.header('Cache-Control', 'private, max-age=86400')
    return reply.send(bytes)
  })

  app.delete('/files/:id', { preHandler: auth }, async (req) => {
    const p = principalOf(req)
    const { id } = req.params as { id: string }
    const f = await one<{ created_by: string }>(pool, 'SELECT created_by FROM files WHERE id = $1 AND org_id = $2', [id, p.orgId])
    if (!f) throw notFound('That file does not exist')
    if (!p.isOwner && f.created_by !== p.userId) throw forbidden('Only the owner or whoever uploaded it can delete a file')
    await pool.query('DELETE FROM files WHERE id = $1 AND org_id = $2', [id, p.orgId])
    await ctx.files.delete(`${p.orgId}/${id}`)
    return { ok: true }
  })
}
