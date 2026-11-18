import { expect, it } from 'vitest'
import * as S from '@/api/schemas'
import { createTenant, newClient } from './helpers'

it('administration answers match what the client expects', async () => {
  const t = await createTenant()
  const c = newClient(); await c.login(t.slug, t.email, t.password)
  const get = async (path: string): Promise<unknown> => { const r = await fetch(`${(await import('./helpers')).live().baseUrl}${path}`, { headers: { authorization: `Bearer ${c.tokens()?.accessToken}` } }); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json() }
  const post = async (path: string, body: unknown): Promise<unknown> => { const r = await fetch(`${(await import('./helpers')).live().baseUrl}${path}`, { method: 'POST', headers: { authorization: `Bearer ${c.tokens()?.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`); return r.json() }
  const perms = (await get('/v1/roles/permissions')) as { items: string[] }
  expect(perms.items).toContain('pos:sell')
  expect(S.page(S.adminUser).parse(await get('/v1/users')).items.length).toBeGreaterThan(0)
  expect(S.page(S.role).parse(await get('/v1/roles')).items.some((r) => r.isSystem)).toBe(true)
  const key = S.apiKey.extend({ key: S.apiKey.shape.name }).parse(await post('/v1/api-keys', { name: 'k', permissions: ['accounting:read'] }))
  expect(key.keyPrefix.length).toBeGreaterThan(3)
  expect(S.page(S.apiKey).parse(await get('/v1/api-keys')).items).toHaveLength(1)
  expect(S.page(S.auditEvent).parse(await get('/v1/audit-events')).items.length).toBeGreaterThan(0)
})
