/** What the desktop shell offers the app through `window.onesync`. Nothing else crosses the context-isolation boundary. */
export interface DesktopSettings {
  serverUrl?: string
  tenant?: string
  email?: string
  theme?: 'system' | 'light' | 'dark'
}

export interface DesktopBridge {
  /** True when the app runs inside the desktop shell (false in a plain browser). */
  readonly desktop: true
  info(): Promise<{ version: string; platform: string; secureStorage: boolean }>
  settings: {
    get(): Promise<DesktopSettings>
    /** A value of null removes that setting. */
    set(patch: { [K in keyof DesktopSettings]?: DesktopSettings[K] | null }): Promise<DesktopSettings>
  }
  /** Turns generated invoice HTML into a PDF and asks where to save it. Resolves to the saved path, or null when the person cancelled. */
  document: { savePdf(html: string, filename: string): Promise<string | null> }
  /** OS-keychain backed storage for the refresh token. `set` resolves false when the OS offers no secure storage. */
  secure: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<boolean>
    delete(key: string): Promise<void>
  }
}

declare global {
  interface Window {
    onesync?: DesktopBridge
  }
}
