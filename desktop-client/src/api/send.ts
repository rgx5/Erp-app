import { ApiError } from './errors'
import { currentApi } from '@/auth/session'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
export type Query = Record<string, string | number | boolean | undefined>

/** A plain call to any endpoint (for the newer screens that do not have generated helpers yet): returns the answer, or throws an ApiError carrying the server's own words. */
export async function send<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, o: { path?: Record<string, string>; query?: Query; body?: unknown } = {}): Promise<T> {
  const raw = currentApi().raw as unknown as Raw
  const query = o.query ? Object.fromEntries(Object.entries(o.query).filter(([, v]) => v !== undefined && v !== '')) : undefined
  const r = await raw[method]!(path, { params: { ...(o.path ? { path: o.path } : {}), ...(query ? { query } : {}) }, ...(o.body !== undefined ? { body: o.body } : {}) })
  if (!r.response.ok) {
    const e = (r.error ?? {}) as Record<string, unknown>
    const fields = Array.isArray(e['errors']) ? (e['errors'] as { path?: string; message?: string }[]) : []
    throw new ApiError(r.response.status, String(e['code'] ?? 'request_failed'), fields[0]?.message ?? String(e['detail'] ?? e['title'] ?? 'The request failed'), undefined, fields.map((f) => ({ path: f.path ?? '', message: f.message ?? '' })), e)
  }
  return r.data as T
}
