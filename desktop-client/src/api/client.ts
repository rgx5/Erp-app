import createClient from 'openapi-fetch'
import type { z } from 'zod'
import { ApiError, NetworkError, problemToError } from './errors'
import { isGatewayDown, markReachable, markUnreachable } from './reachability'
import type { paths } from './schema'
import { session as sessionSchema } from './schemas'

export interface Tokens { accessToken: string; refreshToken: string }

export interface ApiOptions {
  baseUrl: string
  getTokens: () => Tokens | null
  /** Called with fresh tokens after a silent refresh, or null when the session can no longer be renewed. */
  setTokens: (tokens: Tokens | null) => void
  fetch?: typeof fetch
  newKey?: () => string
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const PUBLIC_PREFIXES = ['/v1/auth/login', '/v1/auth/refresh', '/v1/auth/signup', '/v1/meta']

export const normalizeServerUrl = (raw: string): string => {
  let url = raw.trim().replace(/\/+$/, '')
  if (!url) return url
  if (!/^https?:\/\//i.test(url)) url = `${/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url) ? 'http' : 'https'}://${url}`
  return url
}

/**
 * The typed REST client. Requests and paths come from the generated OpenAPI types; responses are checked against the zod schemas the
 * caller passes. It attaches the bearer token, renews it once (shared by all concurrent requests) when the server says 401, gives
 * every write an `Idempotency-Key` that stays the same across that retry, and turns problem+json into `ApiError`.
 */
export function createApi(options: ApiOptions) {
  const baseUrl = normalizeServerUrl(options.baseUrl)
  const doFetch = options.fetch ?? ((r: Request) => fetch(r))
  const newKey = options.newKey ?? (() => crypto.randomUUID())
  let refreshing: Promise<boolean> | null = null

  const send = async (request: Request): Promise<Response> => {
    try { const res = await doFetch(request); if (isGatewayDown(res.status)) markUnreachable(); else markReachable(); return res } catch { markUnreachable(); throw new NetworkError() }
  }

  const refresh = (): Promise<boolean> => {
    refreshing ??= (async () => {
      const tokens = options.getTokens()
      if (!tokens) return false
      try {
        const res = await send(new Request(`${baseUrl}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: tokens.refreshToken }) }))
        if (!res.ok) { options.setTokens(null); return false }
        const next = sessionSchema.parse(await res.json())
        options.setTokens({ accessToken: next.accessToken, refreshToken: next.refreshToken })
        return true
      } catch (e) {
        if (e instanceof NetworkError) return false // keep the session; the network may come back
        options.setTokens(null)
        return false
      } finally {
        queueMicrotask(() => { refreshing = null })
      }
    })()
    return refreshing
  }

  const authedFetch = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname
    const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p))
    if (MUTATING.has(request.method) && !request.headers.has('idempotency-key')) request.headers.set('idempotency-key', newKey())
    const retry = request.clone()
    const withAuth = (r: Request): Request => {
      const t = options.getTokens()
      if (t && !isPublic) r.headers.set('authorization', `Bearer ${t.accessToken}`)
      return r
    }
    const again = (): Request => withAuth(retry.clone())
    let res = await send(withAuth(request))
    if (res.status === 401 && !isPublic && options.getTokens() && (await refresh())) res = await send(again())
    // The server limits how many heavy requests one business may run at once and says how long to wait: wait, then ask again (the same idempotency key, so nothing is done twice).
    for (let i = 0; res.status === 429 && i < 5; i++) {
      const wait = Math.min(5, Math.max(1, Number(res.headers.get('retry-after')) || 2))
      await new Promise((done) => setTimeout(done, wait * 1000))
      res = await send(again())
    }
    return res
  }

  const raw = createClient<paths>({ baseUrl, fetch: authedFetch })

  /** Awaits an openapi-fetch call, throws `ApiError` for a failed answer, and returns the checked body. */
  async function call<T>(promise: Promise<{ data?: unknown; error?: unknown; response: Response }>, schema: z.ZodType<T>): Promise<T> {
    const { data, error, response } = await promise
    if (!response.ok) throw problemToError(response.status, error, response.headers.get('x-request-id'))
    const parsed = schema.safeParse(data)
    if (!parsed.success) throw new ApiError(502, 'unexpected_response', 'The server answered in a form this version of the app does not understand.', response.headers.get('x-request-id') ?? undefined)
    return parsed.data
  }

  /** For answers with no body (204). */
  async function done(promise: Promise<{ error?: unknown; response: Response }>): Promise<void> {
    const { error, response } = await promise
    if (!response.ok) throw problemToError(response.status, error, response.headers.get('x-request-id'))
  }

  /** A long-lived read (the server's change notes): the same sign-in and renewal as any call. */
  const stream = (path: string, signal: AbortSignal): Promise<Response> => authedFetch(new Request(baseUrl + path, { headers: { accept: 'text/event-stream' }, signal }))
  return { baseUrl, raw, call, done, stream }
}

export type Api = ReturnType<typeof createApi>

/**
 * The server's OpenAPI document does not describe query parameters yet (only request bodies), so the generated types forbid them.
 * Until it does (backend gap G8) this helper passes them through; the paths themselves are still checked.
 */
export const query = (params: Record<string, string | number | boolean | undefined>): never => params as never
