/** What the desktop shell offers the app through `window.onesync`. Nothing else crosses the context-isolation boundary. */
export interface DesktopSettings {
  serverUrl?: string
  /** The address to use when the office address cannot be reached (through the remote-access gateway). */
  remoteUrl?: string
  tenant?: string
  email?: string
  theme?: 'system' | 'light' | 'dark'
  /** The receipt printer this computer prints to without a dialog, and whether a receipt prints by itself after each sale. */
  receiptPrinter?: string
  autoPrintReceipts?: boolean
  /** The scale this counter weighs on (its serial port's name), remembered once chosen. */
  scalePortName?: string
}

export interface DesktopBridge {
  /** True when the app runs inside the desktop shell (false in a plain browser). */
  readonly desktop: true
  /** 'win32', 'darwin' or 'linux': the screens use it to leave room for the window buttons. */
  readonly platform: string
  /** The shell's own commands, also in the native menu. */
  /** Second screen facing the customer (shows the bill as it is rung up) and the cash drawer wired to the receipt printer. */
  hardware: { openCustomerDisplay(): Promise<boolean>; closeCustomerDisplay(): Promise<void>; openCashDrawer(): Promise<void> }
  app: { about(): Promise<void>; openLogs(): Promise<void>; checkForUpdates(): Promise<void>; zoom(change: 'in' | 'out' | 'reset'): Promise<void> }
  info(): Promise<{ version: string; platform: string; secureStorage: boolean }>
  settings: {
    get(): Promise<DesktopSettings>
    /** A value of null removes that setting. */
    set(patch: { [K in keyof DesktopSettings]?: DesktopSettings[K] | null }): Promise<DesktopSettings>
  }
  /** Turns generated invoice HTML into a PDF and asks where to save it. Resolves to the saved path, or null when the person cancelled. */
  document: { savePdf(html: string, filename: string): Promise<string | null> }
  /** Printers known to this computer, and silent printing of a receipt (no dialog) to one of them. */
  printer: {
    list(): Promise<{ name: string; isDefault: boolean }[]>
    printReceipt(html: string, printerName: string): Promise<void>
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
