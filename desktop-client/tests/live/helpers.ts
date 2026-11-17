import { inject } from 'vitest'
import { createApi, type Tokens } from '@/api/client'
import { session as sessionSchema } from '@/api/schemas'

export const live = () => inject('live')
let n = 0
export const uniqueSlug = (): string => `live-${Date.now().toString(36)}-${++n}`
export const PASSWORD = 'a long passphrase for tests 42'

/** Creates a tenant with an owner through the operator endpoint (what a platform administrator does). */
export async function createTenant(name = 'Live Co') {
  const { baseUrl, platformToken } = live()
  const slug = uniqueSlug()
  const email = `owner@${slug}.example.com`
  const res = await fetch(`${baseUrl}/v1/platform/tenants`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${platformToken}` }, body: JSON.stringify({ name, slug, owner: { email, displayName: 'Owner', password: PASSWORD } }) })
  if (res.status !== 201) throw new Error(`tenant not created: ${res.status} ${await res.text()}`)
  return { slug, email, password: PASSWORD }
}

/** An api client that holds its own tokens, like the app does. */
export function newClient() {
  let tokens: Tokens | null = null
  const api = createApi({ baseUrl: live().baseUrl, getTokens: () => tokens, setTokens: (t) => { tokens = t } })
  return {
    api, tokens: () => tokens,
    async login(tenant: string, email: string, password: string, mfaCode?: string) {
      const res = await api.call(api.raw.POST('/v1/auth/login', { body: { tenant, email, password, ...(mfaCode ? { mfaCode } : {}) } }), sessionSchema)
      tokens = { accessToken: res.accessToken, refreshToken: res.refreshToken }
      return res
    },
    expireAccessToken() { if (tokens) tokens = { ...tokens, accessToken: 'expired.or.invalid' } },
  }
}
