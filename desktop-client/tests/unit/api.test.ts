import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApi, normalizeServerUrl, type Tokens } from '@/api/client'
import { ApiError, NetworkError } from '@/api/errors'
import { can, canAny } from '@/auth/permissions'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const sessionBody = (n: number) => ({ accessToken: `acc${n}`, refreshToken: `ref${n}`, tokenType: 'Bearer', expiresIn: 900, user: { id: 'u', email: 'a@b.c', displayName: 'A', status: 'active', mfaEnabled: false, lastLoginAt: null } })

function setup(handler: (req: Request) => Response | Promise<Response>, tokens: Tokens | null = { accessToken: 'acc0', refreshToken: 'ref0' }) {
  let current = tokens
  const setTokens = vi.fn((t: Tokens | null) => { current = t })
  const seen: Request[] = []
  const api = createApi({ baseUrl: 'http://server.test', getTokens: () => current, setTokens, fetch: async (input) => { const r = input as Request; seen.push(r.clone()); return handler(r) }, newKey: (() => { let n = 0; return () => `key-${++n}` })() })
  return { api, setTokens, seen, tokens: () => current }
}

describe('server address', () => {
  it('adds a scheme: http for the local network, https otherwise', () => {
    expect(normalizeServerUrl('erp.example.com/')).toBe('https://erp.example.com')
    expect(normalizeServerUrl('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeServerUrl('192.168.1.20:3000')).toBe('http://192.168.1.20:3000')
    expect(normalizeServerUrl(' https://x.io// ')).toBe('https://x.io')
  })
})

describe('api client', () => {
  it('sends the bearer token and returns a checked body', async () => {
    const { api, seen } = setup(() => json(200, { items: [], nextCursor: null }))
    const out = await api.call(api.raw.GET('/v1/companies'), z.object({ items: z.array(z.unknown()), nextCursor: z.null() }))
    expect(out.items).toEqual([])
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer acc0')
  })

  it('waits and asks again when the server says too many requests, with the same idempotency key', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const { api, seen } = setup(() => (++calls < 3 ? json(429, { code: 'too_many_concurrent' }, { 'retry-after': '2' }) : json(200, { ok: true })))
      const pending = api.call(api.raw.POST('/v1/sales/invoices' as never, { body: {} } as never), z.object({ ok: z.boolean() }))
      await vi.advanceTimersByTimeAsync(5000)
      expect(await pending).toEqual({ ok: true })
      expect(calls).toBe(3)
      expect(new Set(seen.map((r) => r.headers.get('idempotency-key'))).size).toBe(1)
    } finally { vi.useRealTimers() }
  })

  it('does not send the token to public endpoints', async () => {
    const { api, seen } = setup(() => json(200, { app: 'onesync-erp' }))
    await api.raw.GET('/v1/meta')
    expect(seen[0]?.headers.get('authorization')).toBeNull()
  })

  it('turns problem+json into an ApiError with fields, code, request id and extras', async () => {
    const { api } = setup(() => json(422, { code: 'validation_failed', detail: 'The request is not valid', requestId: 'r-1', errors: [{ path: 'email', message: 'Required' }], amount: '5.0000' }))
    const err = await api.call(api.raw.POST('/v1/companies', { body: {} as never }), z.unknown()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 422, code: 'validation_failed', requestId: 'r-1', message: 'The request is not valid: Required', extra: { amount: '5.0000' } })
    expect((err as ApiError).fieldMap()).toEqual({ email: 'Required' })
  })

  it('answers a schema mismatch as a clear 502 instead of letting bad data reach a screen', async () => {
    const { api } = setup(() => json(200, { surprise: true }))
    const err = await api.call(api.raw.GET('/v1/companies'), z.object({ items: z.array(z.unknown()) })).catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 502, code: 'unexpected_response' })
  })

  it('reports an unreachable server as a NetworkError', async () => {
    const api = createApi({ baseUrl: 'http://x.test', getTokens: () => null, setTokens: () => undefined, fetch: async () => { throw new TypeError('fetch failed') } })
    await expect(api.raw.GET('/v1/meta')).rejects.toBeInstanceOf(NetworkError)
  })

  it('gives every write an idempotency key, and keeps a caller-supplied one', async () => {
    const { api, seen } = setup(() => json(200, {}))
    await api.raw.POST('/v1/companies', { body: {} as never })
    await api.raw.POST('/v1/companies', { body: {} as never, headers: { 'idempotency-key': 'mine' } })
    await api.raw.GET('/v1/companies')
    expect(seen.map((r) => r.headers.get('idempotency-key'))).toEqual(['key-1', 'mine', null])
  })

  it('renews an expired token once, shared by concurrent requests, and retries with the same idempotency key', async () => {
    let refreshes = 0
    const { api, seen, setTokens } = setup((req) => {
      const path = new URL(req.url).pathname
      if (path === '/v1/auth/refresh') { refreshes++; return json(200, sessionBody(1)) }
      return req.headers.get('authorization') === 'Bearer acc1' ? json(200, { ok: true }) : json(401, { code: 'unauthorized', detail: 'expired' })
    })
    const results = await Promise.all([api.raw.POST('/v1/companies', { body: {} as never }), api.raw.POST('/v1/parties', { body: {} as never }), api.raw.GET('/v1/companies')])
    expect(results.map((r) => r.response.status)).toEqual([200, 200, 200])
    expect(refreshes).toBe(1)
    expect(setTokens).toHaveBeenCalledWith({ accessToken: 'acc1', refreshToken: 'ref1' })
    const posts = seen.filter((r) => r.method === 'POST' && new URL(r.url).pathname === '/v1/companies')
    expect(posts).toHaveLength(2)
    expect(posts[0]?.headers.get('idempotency-key')).toBe(posts[1]?.headers.get('idempotency-key')) // the retry is the same logical request
  })

  it('drops the session when the refresh token is refused, and keeps it when the network is down', async () => {
    const refused = setup((req) => (new URL(req.url).pathname === '/v1/auth/refresh' ? json(401, { code: 'unauthorized' }) : json(401, { code: 'unauthorized' })))
    expect((await refused.api.raw.GET('/v1/companies')).response.status).toBe(401)
    expect(refused.setTokens).toHaveBeenCalledWith(null)

    let down = true
    const offline = setup((req) => {
      if (new URL(req.url).pathname === '/v1/auth/refresh') { if (down) throw new TypeError('offline'); return json(200, sessionBody(2)) }
      return json(401, {})
    })
    expect((await offline.api.raw.GET('/v1/companies')).response.status).toBe(401)
    expect(offline.setTokens).not.toHaveBeenCalled()
    expect(offline.tokens()).not.toBeNull()
    down = false
  })
})

describe('permissions', () => {
  it('lets the owner wildcard do anything and otherwise requires every permission', () => {
    expect(can(['*'], 'sales:post', 'x:y')).toBe(true)
    expect(can(['sales:read'], 'sales:read')).toBe(true)
    expect(can(['sales:read'], 'sales:read', 'sales:post')).toBe(false)
    expect(can([], )).toBe(true)
    expect(canAny(['a'], 'b', 'a')).toBe(true)
    expect(canAny(['a'], 'b')).toBe(false)
  })
})
