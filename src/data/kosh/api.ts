import type { Role } from '@/domain/types'
import type { Mutation, MutationResult, PullResult } from '@/replication/types'
import { CloudError, type FetchFn } from '../api'

/** A Kosh server's address as people type it: no path (the API is at the root), https unless it is a machine on the local network. */
export function normalizeKoshUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '')
  if (!u) return u
  if (!/^https?:\/\//i.test(u)) {
    const local = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^/:]+\.local)(:\d+)?(\/|$)/i.test(u)
    u = `${local ? 'http' : 'https'}://${u}`
  }
  return u
}

export interface KoshUser { id: string; name: string; role: Role | string; active?: boolean; code?: string; permissions?: string[] }
export interface KoshSession {
  token: string
  user: KoshUser
  org: { id: string; name: string; industry?: string }
  branch?: { id: string; name: string } | null
  branches?: Array<{ id: string; name: string }>
  device?: { id: string; name?: string }
}

/** The Kosh server's REST client. JSON in, `{ error }` out; every failure is a CloudError with the HTTP status (0 = unreachable). */
export function createKoshApi(baseUrl: string, getToken: () => string | null = () => null, fetchFn: FetchFn = (i, n) => fetch(i, n)) {
  const base = normalizeKoshUrl(baseUrl)

  async function call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = auth ? getToken() : null
    if (token) headers.Authorization = `Bearer ${token}`
    let res: Response
    try {
      res = await fetchFn(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    } catch {
      throw new CloudError('Cannot reach the server — check your internet connection and the server address.')
    }
    const text = await res.text()
    let data: unknown = null
    try { data = text ? JSON.parse(text) : null } catch { /* a non-JSON error page */ }
    if (!res.ok) throw new CloudError((data as { error?: string } | null)?.error ?? `Server error (${res.status})`, res.status)
    return data as T
  }

  return {
    base,
    health: () => call<{ app?: string; version?: string; time?: number }>('GET', '/health', undefined, false),
    signup: (b: { orgName: string; ownerName: string; email: string; password: string; pin?: string; industry?: string; ownerId?: string; deviceId: string; deviceName: string }) =>
      call<KoshSession>('POST', '/auth/signup', b, false),
    login: (email: string, password: string, deviceId: string, deviceName: string) => call<KoshSession>('POST', '/auth/login', { email, password, deviceId, deviceName }, false),
    pinLogin: (orgId: string, userId: string, pin: string, deviceId: string, deviceName: string) => call<KoshSession>('POST', '/auth/pin-login', { orgId, userId, pin, deviceId, deviceName }, false),
    staff: (orgId: string) => call<Array<{ id: string; name: string; role: Role | string; active: boolean; code?: string }>>('GET', `/auth/staff?orgId=${encodeURIComponent(orgId)}`, undefined, false),
    refresh: () => call<{ token: string }>('POST', '/auth/refresh'),
    me: () => call<{ user: KoshUser; permissions: string[] }>('GET', '/auth/me'),
    pull: (since: number, limit = 500) => call<PullResult>('GET', `/sync/pull?since=${since}&limit=${limit}`),
    push: (mutations: Mutation[]) => call<{ results: MutationResult[]; cursor?: number }>('POST', '/sync/push', { mutations }),
    /** A plain call for the entries that are not documents (staff accounts). Returns the Response so the caller can read the status. */
    raw: async (method: string, path: string, body?: unknown): Promise<Response> => {
      const token = getToken()
      try {
        return await fetchFn(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
      } catch { throw new CloudError('Cannot reach the server.') }
    },
  }
}
export type KoshApi = ReturnType<typeof createKoshApi>

/** Which kind of server an address is: a Kosh server answers /health with `app: 'kosh-server'`; a Krishna-compatible one at /api/health. */
export async function detectBackend(raw: string, fetchFn: FetchFn = (i, n) => fetch(i, n)): Promise<{ backend: 'kosh' | 'krishna'; url: string }> {
  const kosh = normalizeKoshUrl(raw)
  try {
    const h = await createKoshApi(kosh, () => null, fetchFn).health()
    if (h?.app === 'kosh-server') return { backend: 'kosh', url: kosh }
  } catch (e) { if (!(e instanceof CloudError) || e.status === 0) throw e }
  return { backend: 'krishna', url: raw }
}
