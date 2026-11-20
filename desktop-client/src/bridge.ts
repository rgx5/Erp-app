import type { DesktopBridge, DesktopSettings } from '../electron/bridge-types'

/** In a plain browser (development, end-to-end tests) there is no shell: settings use localStorage and nothing is kept secretly. */
const web: Omit<DesktopBridge, 'desktop' | 'platform' | 'app'> = {
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
  document: {
    /** In a browser the document is printed through the print dialog (which can also save as PDF). */
    async savePdf(html) {
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden'
      frame.srcdoc = html
      document.body.appendChild(frame)
      await new Promise<void>((resolve) => { frame.onload = () => resolve() })
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      setTimeout(() => frame.remove(), 60_000)
      return null
    },
  },
  printer: {
    /** A browser cannot list printers or print without its dialog. */
    async list() { return [] },
    async printReceipt(html) { await web.document.savePdf(html, 'receipt') },
  },
  secure: {
    async get(key) { return sessionStorage.getItem(`onesync.secure.${key}`) },
    async set(key, value) { sessionStorage.setItem(`onesync.secure.${key}`, value); return false }, // false: not remembered after the window closes
    async delete(key) { sessionStorage.removeItem(`onesync.secure.${key}`) },
  },
}

export const bridge: Omit<DesktopBridge, 'desktop' | 'platform' | 'app'> = typeof window !== 'undefined' && window.onesync ? window.onesync : web
export const isDesktop = (): boolean => typeof window !== 'undefined' && window.onesync !== undefined
