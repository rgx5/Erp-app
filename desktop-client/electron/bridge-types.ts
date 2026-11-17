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
