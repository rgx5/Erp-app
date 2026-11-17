import type { DesktopBridge, DesktopSettings } from '../electron/bridge-types'

/** In a plain browser (development, end-to-end tests) there is no shell: settings use localStorage and nothing is kept secretly. */
const web: Omit<DesktopBridge, 'desktop'> = {
  async info() { return { version: 'web', platform: 'web', secureStorage: false } },
  settings: {
    async get() { try { return JSON.parse(localStorage.getItem('onesync.settings') ?? '{}') as DesktopSettings } catch { return {} } },
    async set(patch) {
      const next: Record<string, unknown> = { ...(await web.settings.get()), ...patch }
      for (const [k, v] of Object.entries(next)) if (v === null || v === undefined) delete next[k]
      localStorage.setItem('onesync.settings', JSON.stringify(next))
      return next as DesktopSettings
    },
  },
  secure: {
    async get(key) { return sessionStorage.getItem(`onesync.secure.${key}`) },
    async set(key, value) { sessionStorage.setItem(`onesync.secure.${key}`, value); return false }, // false: not remembered after the window closes
    async delete(key) { sessionStorage.removeItem(`onesync.secure.${key}`) },
  },
}

export const bridge: Omit<DesktopBridge, 'desktop'> = typeof window !== 'undefined' && window.onesync ? window.onesync : web
export const isDesktop = (): boolean => typeof window !== 'undefined' && window.onesync !== undefined
