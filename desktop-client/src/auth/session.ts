import { create } from 'zustand'
import { createApi, normalizeServerUrl, type Api, type Tokens } from '@/api/client'
import { ApiError, NetworkError } from '@/api/errors'
import { compareVersions } from '@/domain/version'
import { answers, chooseServer } from './serverChoice'
import { me as meSchema, meta as metaSchema, session as sessionSchema, type Me } from '@/api/schemas'
import { bridge } from '@/bridge'

const REFRESH_KEY = 'refreshToken'
/** Who the person was at their last successful sign-in (name, permissions, plan), kept in the secure store so a till can open with no connection. */
const IDENTITY_KEY = 'lastIdentity'
/** An offline start is allowed only for this long after the last time the server confirmed who the person is. */
const OFFLINE_START_DAYS = 14

export interface ServerInfo { url: string; selfSignup: boolean }

interface SessionState {
  status: 'booting' | 'anonymous' | 'authenticated'
  server: ServerInfo | null
  tenant: string
  email: string
  me: Me | null
  /** True when the refresh token was stored securely and the next launch will not ask for a password. */
  remembered: boolean
  /** True when the app opened with no connection, using the details from the last sign-in. They are checked with the server as soon as it can be reached. */
  offlineStart: boolean
  api: Api | null
  restore(): Promise<void>
  connect(url: string, remote?: string): Promise<ServerInfo>
  login(input: { tenant: string; email: string; password: string; mfaCode?: string; remember: boolean }): Promise<void>
  logout(): Promise<void>
  forgetServer(): Promise<void>
  /** Reads who I am again (after changing something about my own account). */
  refreshMe(): Promise<void>
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
    set({ status: 'authenticated', me, api, server, offlineStart: false })
    void bridge.secure.set(IDENTITY_KEY, JSON.stringify({ me, at: Date.now(), server: server.url }))
  }
  const lastIdentity = async (serverUrl: string): Promise<Me | null> => {
    try {
      const raw = await bridge.secure.get(IDENTITY_KEY); if (!raw) return null
      const v = JSON.parse(raw) as { me: unknown; at: number; server: string }
      if (v.server !== serverUrl || Date.now() - v.at > OFFLINE_START_DAYS * 86_400_000) return null
      const parsed = meSchema.safeParse(v.me); return parsed.success ? parsed.data : null
    } catch { return null }
  }
  return {
    status: 'booting', server: null, tenant: '', email: '', me: null, remembered: false, offlineStart: false, api: null,

    async restore() {
      const saved = await bridge.settings.get()
      set({ tenant: saved.tenant ?? '', email: saved.email ?? '' })
      if (!saved.serverUrl) { set({ status: 'anonymous' }); return }
      const server: ServerInfo = { url: await chooseServer(saved.serverUrl, saved.remoteUrl, answers), selfSignup: false }
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
      } catch (e) {
        // No connection at start-up (a power cut, the Wi-Fi down): a counter must still open. Use who the server last confirmed, keep the
        // saved sign-in for when the connection returns, and check again then. Anything else (a refused sign-in) goes to the sign-in screen.
        if (e instanceof NetworkError) {
          const me = await lastIdentity(server.url)
          if (me) { set({ status: 'authenticated', me, api, server, remembered: true, offlineStart: true }); return }
        }
        tokens = null
        set({ status: 'anonymous' })
      }
    },

    async connect(rawUrl, rawRemote) {
      const officeUrl = normalizeServerUrl(rawUrl)
      const remoteUrl = rawRemote?.trim() ? normalizeServerUrl(rawRemote) : undefined
      const url = await chooseServer(officeUrl, remoteUrl, answers)
      const probe = createApi({ baseUrl: url, getTokens: () => null, setTokens: () => undefined })
      const info = await probe.call(probe.raw.GET('/v1/meta'), metaSchema)
      if (info.minClientVersion) {
        const mine = (await bridge.info()).version
        if (/^\d+\.\d+\.\d+/.test(mine) && compareVersions(mine, info.minClientVersion) < 0) throw new Error(`This server needs OneSyncERP ${info.minClientVersion} or newer, and this app is ${mine}. Please update the app, then connect again.`)
      }
      const server: ServerInfo = { url, selfSignup: info.auth.selfSignup }
      await bridge.settings.set({ serverUrl: officeUrl, remoteUrl: remoteUrl ?? null })
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
      await bridge.secure.delete(REFRESH_KEY); await bridge.secure.delete(IDENTITY_KEY)
      set({ status: 'anonymous', me: null, remembered: false, offlineStart: false })
    },

    async refreshMe() {
      const { api } = get()
      if (api) { const me = await api.call(api.raw.GET('/v1/auth/me'), meSchema); set({ me, offlineStart: false }); void bridge.secure.set(IDENTITY_KEY, JSON.stringify({ me, at: Date.now(), server: get().server?.url })) }
    },

    async forgetServer() {
      tokens = null
      await bridge.secure.delete(REFRESH_KEY); await bridge.secure.delete(IDENTITY_KEY)
      await bridge.settings.set({ serverUrl: null })
      set({ status: 'anonymous', server: null, api: null, me: null, offlineStart: false })
    },
  }
})

export const currentApi = (): Api => {
  const api = useSession.getState().api
  if (!api) throw new Error('Not connected to a server')
  return api
}

if (typeof window !== 'undefined') {
  const confirm = (): void => {
    const st = useSession.getState()
    if (st.status === 'authenticated' && st.offlineStart) {
      st.refreshMe().catch((e: unknown) => {
        // the saved sign-in no longer works (the person was removed, the password changed): back to the sign-in screen
        if (e instanceof ApiError && (e.isUnauthorized || e.isForbidden)) void st.logout()
      })
    }
  }
  window.addEventListener('online', confirm)
  // a refused connection does not fire 'online' (the computer thinks it is connected), so also look again every half minute while working offline
  setInterval(confirm, 30_000)
}
