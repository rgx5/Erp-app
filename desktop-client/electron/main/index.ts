import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, safeStorage, screen, shell, type IpcMainInvokeEvent } from 'electron'
import type { DesktopSettings } from '../bridge-types'
import { JsonFile } from './store'
import { log } from './log'
import { buildMenu, checkForUpdates, iconPath, openLogs, showAbout } from './menu'
import { loadErrorHtml, splashHtml } from './splash'
import { fitState, type WindowState } from './windowState'
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
  ipcMain.handle('app:about', guard(() => showAbout(win)))
  ipcMain.handle('app:openLogs', guard(async () => { await openLogs() }))
  ipcMain.handle('app:checkForUpdates', guard(() => checkForUpdates()))
  ipcMain.handle('app:zoom', guard((change: 'in' | 'out' | 'reset') => { if (change === 'in' || change === 'out' || change === 'reset') zoomBy(change === 'in' ? 0.5 : change === 'out' ? -0.5 : 'reset') }))
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

const stateFile = () => new JsonFile<Partial<WindowState>>(join(app.getPath('userData'), 'window-state.json'), {})
let state: WindowState = fitState({}, [])

/** Zoom in steps of half a level, remembered with the window so a counter keeps its larger text after a restart. */
function zoomBy(delta: number | 'reset'): void {
  if (!win) return
  const next = delta === 'reset' ? 0 : Math.max(-3, Math.min(5, win.webContents.getZoomLevel() + delta))
  win.webContents.setZoomLevel(next); state.zoom = next; saveState()
}
function saveState(): void {
  if (!win || win.isDestroyed()) return
  const maximized = win.isMaximized() || win.isFullScreen()
  const b: Partial<WindowState> = maximized ? {} : win.getBounds() // when maximised, keep the earlier un-maximised size to come back to
  state = { ...state, ...b, maximized }
  try { stateFile().write(state) } catch (e) { log('warn', 'could not save window state', e) }
}

/** A small branded window shown the moment the app starts, so nobody stares at nothing while the real window loads. */
function showSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 480, height: 300, frame: false, resizable: false, movable: true, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    show: false, center: true, alwaysOnTop: true, backgroundColor: '#ffffff', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, devTools: false },
  })
  splash.webContents.on('will-navigate', (e) => e.preventDefault())
  splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  splash.once('ready-to-show', () => splash.show())
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(app.getVersion()))}`)
  return splash
}

function createWindow(splash?: BrowserWindow): void {
  nativeTheme.themeSource = 'light' // always light, whatever the operating system is set to
  const shownAt = Date.now()
  state = fitState(stateFile().read(), screen.getAllDisplays().map((d) => d.workArea))
  const icon = iconPath()
  // The window's own title bar is replaced by the app's top bar; the system's minimise, maximise and close buttons stay (Windows, Linux) or
  // sit at the left edge (macOS), so it still behaves like every other program on the computer.
  const frame: Partial<Electron.BrowserWindowConstructorOptions> = process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
    : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#ffffff', symbolColor: '#1d2433', height: 48 } }
  win = new BrowserWindow({
    width: state.width, height: state.height, ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}), minWidth: 1000, minHeight: 640,
    show: false, backgroundColor: '#f3f5f9', title: 'OneSyncERP', ...(icon ? { icon } : {}), ...frame,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: !app.isPackaged },
  })
  if (state.maximized) win.maximize()
  // The app asks for nothing from the browser (no camera, location, notifications, clipboard reads...): refuse every permission prompt, and never allow <webview>.
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  win.webContents.session.setPermissionCheckHandler(() => false)
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.on('did-finish-load', () => { if (state.zoom) win?.webContents.setZoomLevel(state.zoom) })
  win.once('ready-to-show', () => {
    // keep the splash up for at least a moment so it is seen rather than flashed
    setTimeout(() => { win?.show(); if (splash && !splash.isDestroyed()) splash.close() }, Math.max(0, 900 - (Date.now() - shownAt)))
  })
  win.on('resize', saveStateSoon); win.on('move', saveStateSoon); win.on('close', saveState)
  win.on('closed', () => { win = null })
  // Things going wrong are met with a plain choice, not a blank window: a crashed page offers to reload, a page that cannot load shows a retry screen.
  win.webContents.on('render-process-gone', (_e, details) => {
    log('error', 'renderer gone', details)
    if (details.reason === 'clean-exit') return
    void dialog.showMessageBox(win as BrowserWindow, { type: 'error', title: 'OneSyncERP', message: 'OneSyncERP stopped unexpectedly.', detail: 'Your work on the server is safe. Sales taken offline are kept on this computer and will upload after you reopen the app.', buttons: ['Reload', 'Close'], defaultId: 0, cancelId: 1 })
      .then((r) => { if (r.response === 0) win?.webContents.reload(); else win?.close() })
  })
  win.on('unresponsive', () => {
    log('warn', 'window unresponsive')
    void dialog.showMessageBox(win as BrowserWindow, { type: 'warning', title: 'OneSyncERP', message: 'OneSyncERP is not responding.', buttons: ['Wait', 'Reload'], defaultId: 0, cancelId: 0 }).then((r) => { if (r.response === 1) win?.webContents.reload() })
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted: a normal navigation change */ || url.startsWith('data:')) return
    log('error', 'page failed to load', `${code} ${desc} ${url}`)
    void win?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadErrorHtml(`${desc} (${code})`))}`)
  })
  // Links to the outside world open in the real browser; the app never navigates away from its own origin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url === 'app://retry') { event.preventDefault(); void win?.loadURL(DEV_URL ?? `${APP_ORIGIN}/`); return }
    if (!url.startsWith(`${APP_ORIGIN}/`) && !(DEV_URL && url.startsWith(DEV_URL)) && !url.startsWith('data:')) event.preventDefault()
  })
  void win.loadURL(DEV_URL ?? `${APP_ORIGIN}/`)
}
let saveTimer: ReturnType<typeof setTimeout> | undefined
function saveStateSoon(): void { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 400) }

process.on('uncaughtException', (e) => log('error', 'uncaught exception', e))
process.on('unhandledRejection', (e) => log('error', 'unhandled rejection', e instanceof Error ? e : String(e)))

app.whenReady().then(() => {
  protocol.handle(APP_SCHEME, async (request) => {
    if (new URL(request.url).host !== APP_HOST) return new Response('Not found', { status: 404 })
    const file = await resolveAppFile(RENDERER_DIR, request.url)
    return file ? readAppFile(file) : new Response('Forbidden', { status: 403 })
  })
  registerIpc()
  log('info', `start ${app.getVersion()} ${process.platform}`)
  const splash = showSplash()
  Menu.setApplicationMenu(buildMenu(() => win, zoomBy))
  createWindow(splash)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}).catch((e: unknown) => { console.error(e); app.quit() })

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
