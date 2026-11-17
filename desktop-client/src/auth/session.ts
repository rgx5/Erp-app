import { create } from 'zustand'
import { createApi, normalizeServerUrl, type Api, type Tokens } from '@/api/client'
import { ApiError } from '@/api/errors'
import { me as meSchema, meta as metaSchema, session as sessionSchema, type Me } from '@/api/schemas'
import { bridge } from '@/bridge'

const REFRESH_KEY = 'refreshToken'

export interface ServerInfo { url: string; selfSignup: boolean }

interface SessionState {
  status: 'booting' | 'anonymous' | 'authenticated'
  server: ServerInfo | null
  tenant: string
  email: string
  me: Me | null
  /** True when the refresh token was stored securely and the next launch will not ask for a password. */
  remembered: boolean
  api: Api | null
  restore(): Promise<void>
  connect(url: string): Promise<ServerInfo>
  login(input: { tenant: string; email: string; password: string; mfaCode?: string; remember: boolean }): Promise<void>
  logout(): Promise<void>
  forgetServer(): Promise<void>
}

let tokens: Tokens | null = null
const buildApi = (url: string, onLost: () => void): Api =>
  createApi({
    baseUrl: url,
    getTokens: () => tokens,
    setTokens: (next) => {
      tokens = next
      if (next) void bridge.secure.set(REFRESH_KEY, next.refreshToken)
      else { void bridge.secure.delete(REFRESH_KEY); onLost() }
    },
  })

export const useSession = create<SessionState>()((set, get) => {
  const lost = (): void => set({ status: 'anonymous', me: null })
  const open = async (api: Api, server: ServerInfo): Promise<void> => {
    const me = await api.call(api.raw.GET('/v1/auth/me'), meSchema)
    set({ status: 'authenticated', me, api, server })
  }
  return {
    status: 'booting', server: null, tenant: '', email: '', me: null, remembered: false, api: null,

    async restore() {
      const saved = await bridge.settings.get()
      set({ tenant: saved.tenant ?? '', email: saved.email ?? '' })
      if (!saved.serverUrl) { set({ status: 'anonymous' }); return }
      const server: ServerInfo = { url: saved.serverUrl, selfSignup: false }
      const api = buildApi(server.url, lost)
      set({ server, api })
      const refreshToken = await bridge.secure.get(REFRESH_KEY)
      if (!refreshToken) { set({ status: 'anonymous' }); return }
      tokens = { accessToken: '', refreshToken }
      try {
        const res = await api.raw.POST('/v1/auth/refresh', { body: { refreshToken } })
        if (!res.response.ok) throw new Error('refresh refused')
        const next = sessionSchema.parse(res.data)
        tokens = { accessToken: next.accessToken, refreshToken: next.refreshToken }
        void bridge.secure.set(REFRESH_KEY, next.refreshToken)
        await open(api, server)
        set({ remembered: true })
      } catch {
        tokens = null
        set({ status: 'anonymous' })
      }
    },

    async connect(rawUrl) {
      const url = normalizeServerUrl(rawUrl)
      const probe = createApi({ baseUrl: url, getTokens: () => null, setTokens: () => undefined })
      const info = await probe.call(probe.raw.GET('/v1/meta'), metaSchema)
      const server: ServerInfo = { url, selfSignup: info.auth.selfSignup }
      await bridge.settings.set({ serverUrl: url })
      set({ server, api: buildApi(url, lost) })
      return server
    },

    async login({ tenant, email, password, mfaCode, remember }) {
      const { api, server } = get()
      if (!api || !server) throw new Error('Connect to a server first')
      const res = await api.call(api.raw.POST('/v1/auth/login', { body: { tenant: tenant.trim().toLowerCase(), email: email.trim(), password, ...(mfaCode ? { mfaCode } : {}) } }), sessionSchema)
      tokens = { accessToken: res.accessToken, refreshToken: res.refreshToken }
      const stored = remember ? await bridge.secure.set(REFRESH_KEY, res.refreshToken) : (await bridge.secure.delete(REFRESH_KEY), false)
      await bridge.settings.set({ tenant: tenant.trim().toLowerCase(), email: email.trim() })
      try { await open(api, server) } catch (e) { tokens = null; throw e }
      set({ tenant: tenant.trim().toLowerCase(), email: email.trim(), remembered: stored })
    },

    async logout() {
      const { api } = get()
      try { if (api && tokens) await api.done(api.raw.POST('/v1/auth/logout')) } catch (e) { if (!(e instanceof ApiError)) { /* offline: the token simply expires */ } }
      tokens = null
      await bridge.secure.delete(REFRESH_KEY)
      set({ status: 'anonymous', me: null, remembered: false })
    },

    async forgetServer() {
      tokens = null
      await bridge.secure.delete(REFRESH_KEY)
      await bridge.settings.set({ serverUrl: null })
      set({ status: 'anonymous', server: null, api: null, me: null })
    },
  }
})

export const currentApi = (): Api => {
  const api = useSession.getState().api
  if (!api) throw new Error('Not connected to a server')
  return api
}
