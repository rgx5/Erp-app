import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import type { DesktopSettings } from '../bridge-types'
import { JsonFile } from './store'
import { APP_HOST, APP_ORIGIN, APP_SCHEME, readAppFile, resolveAppFile } from './serve'

// The app is served from its own fixed origin, so what it stores (and what a server's CORS list names) is the same on every launch.
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

const RENDERER_DIR = join(__dirname, '../renderer')
const DEV_URL = process.env['ELECTRON_RENDERER_URL']

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
const settings = () => new JsonFile<DesktopSettings>(join(app.getPath('userData'), 'settings.json'), {})
// Secrets are encrypted with the OS keychain (DPAPI, Keychain, libsecret) before they touch the disk.
const secrets = () => new JsonFile<Record<string, string>>(join(app.getPath('userData'), 'secure.json'), {})

/** Only the app's own pages may use the bridge. */
const trusted = (e: IpcMainInvokeEvent): boolean => {
  const url = e.senderFrame?.url ?? ''
  return url.startsWith(`${APP_ORIGIN}/`) || (DEV_URL !== undefined && url.startsWith(DEV_URL))
}
const guard = <A extends unknown[], R>(fn: (...a: A) => R) => (e: IpcMainInvokeEvent, ...a: A): R => {
  if (!trusted(e)) throw new Error('Untrusted sender')
  return fn(...a)
}

/** Prints generated HTML (our own template, scripts off) to an A4 PDF in a window nobody sees. */
async function renderPdf(html: string): Promise<Buffer> {
  const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
  try {
    printer.webContents.on('will-navigate', (e) => e.preventDefault())
    printer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await printer.webContents.printToPDF({ pageSize: 'A4', printBackground: true })
  } finally {
    printer.destroy()
  }
}

/** Prints an 80 mm receipt (our own template, scripts off) straight to a named printer, with no dialog. */
async function printSilently(html: string, deviceName: string): Promise<void> {
  const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
  try {
    printer.webContents.on('will-navigate', (e) => e.preventDefault())
    printer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise<void>((resolve, reject) => {
      printer.webContents.print({ silent: true, deviceName, printBackground: true, margins: { marginType: 'none' }, pageSize: { width: 80_000, height: 297_000 } }, (ok, why) => (ok ? resolve() : reject(new Error(why || 'The printer did not accept the receipt'))))
    })
  } finally {
    printer.destroy()
  }
}

function registerIpc(): void {
  ipcMain.handle('printer:list', guard(async () => (await (win ?? BrowserWindow.getAllWindows()[0] as BrowserWindow).webContents.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: (p as { isDefault?: boolean }).isDefault === true }))))
  ipcMain.handle('printer:printReceipt', guard(async (html: string, printerName: string) => {
    if (typeof html !== 'string' || html.length > 1_000_000 || typeof printerName !== 'string' || !printerName) throw new Error('Nothing to print')
    const known = await (win ?? BrowserWindow.getAllWindows()[0] as BrowserWindow).webContents.getPrintersAsync()
    if (!known.some((p) => p.name === printerName)) throw new Error('That printer is not available on this computer')
    await printSilently(html, printerName)
  }))
  ipcMain.handle('app:info', guard(() => ({ version: app.getVersion(), platform: process.platform, secureStorage: safeStorage.isEncryptionAvailable() })))
  ipcMain.handle('settings:get', guard(() => settings().read()))
  ipcMain.handle('settings:set', guard((patch: Record<string, unknown>) => {
    const file = settings()
    const next: Record<string, unknown> = { ...file.read(), ...patch }
    for (const [k, v] of Object.entries(next)) if (v === null || v === undefined) delete next[k]
    file.write(next as DesktopSettings)
    return next as DesktopSettings
  }))
  ipcMain.handle('document:savePdf', guard(async (html: string, filename: string) => {
    if (typeof html !== 'string' || html.length > 5_000_000) throw new Error('Document too large')
    const pdf = await renderPdf(html)
    const name = `${String(filename).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'document'}.pdf`
    const choice = await dialog.showSaveDialog(win ?? BrowserWindow.getAllWindows()[0] as BrowserWindow, { defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (choice.canceled || !choice.filePath) return null
    await writeFile(choice.filePath, pdf)
    return choice.filePath
  }))
  ipcMain.handle('secure:get', guard((key: string) => {
    const stored = secrets().read()[key]
    if (!stored || !safeStorage.isEncryptionAvailable()) return null
    try { return safeStorage.decryptString(Buffer.from(stored, 'base64')) } catch { return null }
  }))
  ipcMain.handle('secure:set', guard((key: string, value: string) => {
    if (!safeStorage.isEncryptionAvailable()) return false
    const file = secrets()
    file.write({ ...file.read(), [key]: safeStorage.encryptString(value).toString('base64') })
    return true
  }))
  ipcMain.handle('secure:delete', guard((key: string) => {
    const file = secrets()
    const { [key]: _gone, ...rest } = file.read()
    file.write(rest)
  }))
}

function createWindow(): void {
  nativeTheme.themeSource = 'light' // always light, whatever the operating system is set to
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1000, minHeight: 640, show: false, backgroundColor: '#f3f5f9', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => { win = null })
  // Links to the outside world open in the real browser; the app never navigates away from its own origin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`) && !(DEV_URL && url.startsWith(DEV_URL))) event.preventDefault()
  })
  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/`)
}

app.whenReady().then(() => {
  protocol.handle(APP_SCHEME, async (request) => {
    if (new URL(request.url).host !== APP_HOST) return new Response('Not found', { status: 404 })
    const file = await resolveAppFile(RENDERER_DIR, request.url)
    return file ? readAppFile(file) : new Response('Forbidden', { status: 403 })
  })
  registerIpc()
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}).catch((e: unknown) => { console.error(e); app.quit() })

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
