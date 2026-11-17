import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { query } from '@/api/client'
import { ApiError } from '@/api/errors'
import { company, dashboard, me, meta, page } from '@/api/schemas'
import { createTenant, live, newClient, PASSWORD } from './helpers'

describe('the desktop client against the real backend', () => {
  it('recognises the server before anyone signs in', async () => {
    const { api } = newClient()
    const info = await api.call(api.raw.GET('/v1/meta'), meta)
    expect(info).toMatchObject({ app: 'onesync-erp', apiVersion: 'v1', auth: { passwordLogin: true, selfSignup: false } })
  })

  it('signs in, reads who it is, and gets its permissions', async () => {
    const t = await createTenant()
    const c = newClient()
    const session = await c.login(t.slug, t.email, t.password)
    expect(session.user.email).toBe(t.email)
    const who = await c.api.call(c.api.raw.GET('/v1/auth/me'), me)
    expect(who).toMatchObject({ kind: 'user', permissions: ['*'] })
  })

  it('maps a wrong password and an unknown business to the same clear 401', async () => {
    const t = await createTenant()
    const c = newClient()
    for (const attempt of [() => c.login(t.slug, t.email, 'wrong password entirely'), () => c.login('no-such-business', t.email, PASSWORD)]) {
      const err = await attempt().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ApiError)
      expect(err).toMatchObject({ status: 401, requestId: expect.any(String) })
    }
  })

  it('renews an expired access token by itself and carries on, rotating the refresh token', async () => {
    const t = await createTenant()
    const c = newClient()
    await c.login(t.slug, t.email, t.password)
    const firstRefresh = c.tokens()?.refreshToken
    c.expireAccessToken()
    const who = await c.api.call(c.api.raw.GET('/v1/auth/me'), me)
    expect(who.user?.email).toBe(t.email)
    expect(c.tokens()?.refreshToken).not.toBe(firstRefresh)
    expect(c.tokens()?.accessToken).not.toBe('expired.or.invalid')
  })

  it('creates a company, lists it, and shows a dashboard for it, with exact money', async () => {
    const t = await createTenant()
    const c = newClient()
    await c.login(t.slug, t.email, t.password)
    const created = await c.api.call(c.api.raw.POST('/v1/companies', { body: { legalName: 'Live Traders Pvt Ltd' } as never }), company)
    expect(created).toMatchObject({ legalName: 'Live Traders Pvt Ltd', status: 'active' })
    await c.api.call(c.api.raw.POST('/v1/fiscal-years', { body: { companyId: created.id, startDate: '2025-04-01' } as never }), z.unknown())
    const list = await c.api.call(c.api.raw.GET('/v1/companies', { params: { query: query({ limit: 50 }) } }), page(company))
    expect(list.items.map((x) => x.id)).toEqual([created.id])
    const d = await c.api.call(c.api.raw.GET('/v1/dashboard', { params: { query: query({ companyId: created.id, asOf: '2025-05-20' }) } }), dashboard)
    expect(d).toMatchObject({ asOf: '2025-05-20', fiscalYear: { startDate: '2025-04-01' }, cash: { total: '0.0000' }, receivables: { total: '0.0000' }, attention: { pendingApprovals: 0 } })
  })

  it('turns a server-side validation failure into field errors a form can show', async () => {
    const t = await createTenant()
    const c = newClient()
    await c.login(t.slug, t.email, t.password)
    const err = await c.api.call(c.api.raw.POST('/v1/companies', { body: { legalName: '' } as never }), company).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 422, code: 'validation_failed' })
    expect(Object.keys((err as ApiError).fieldMap()).length).toBeGreaterThan(0)
  })

  it('is allowed by CORS for the desktop origin and nobody else', async () => {
    const { baseUrl } = live()
    const ask = (origin: string) => fetch(`${baseUrl}/v1/auth/login`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,idempotency-key' } })
    expect((await ask('app://onesync')).headers.get('access-control-allow-origin')).toBe('app://onesync')
    expect((await ask('https://evil.example.com')).headers.get('access-control-allow-origin')).toBeNull()
  })

  it('replays a write with the same idempotency key without doing it twice', async () => {
    const t = await createTenant()
    const c = newClient()
    await c.login(t.slug, t.email, t.password)
    const headers = { 'idempotency-key': 'same-key-1' }
    const one = await c.api.call(c.api.raw.POST('/v1/companies', { body: { legalName: 'Once Ltd' } as never, headers }), company)
    const two = await c.api.call(c.api.raw.POST('/v1/companies', { body: { legalName: 'Once Ltd' } as never, headers }), company)
    expect(two.id).toBe(one.id)
    const all = await c.api.call(c.api.raw.GET('/v1/companies', { params: { query: query({ limit: 50 }) } }), page(company))
    expect(all.items).toHaveLength(1)
  })
})
