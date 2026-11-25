import { ApiError } from '@/api/errors'
import { currentApi } from '@/auth/session'
import type { Server } from './engine'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>

async function run(method: 'GET' | 'POST', path: string, o: unknown): Promise<unknown> {
  const raw = currentApi().raw as unknown as Raw
  const r = await raw[method]!(path, o)
  if (!r.response.ok) {
    const e = (r.error ?? {}) as Record<string, unknown>
    const fields = Array.isArray(e['errors']) ? (e['errors'] as { path?: string; message?: string }[]) : []
    const first = fields[0]
    throw new ApiError(r.response.status, String(e['code'] ?? 'request_failed'), first ? `${first.path ? `${first.path}: ` : ''}${first.message ?? ''}` : String(e['detail'] ?? e['title'] ?? 'The request failed'), undefined, fields.map((f) => ({ path: f.path ?? '', message: f.message ?? '' })))
  }
  return r.data
}

/** The signed-in business's server, as the migration engine sees it. */
export const apiServer = (): Server => ({
  get: (path, query) => run('GET', path, { params: { query: query ?? {} } }),
  post: (path, body, key) => run('POST', path, { body, headers: { 'idempotency-key': key } }),
})
