import { app, dialog, Menu, nativeImage, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logDir } from './log'

/** Where releases are published. Can be pointed elsewhere with ONESYNC_RELEASES_URL. */
export const RELEASES_URL = process.env['ONESYNC_RELEASES_URL'] ?? 'https://github.com/rgx5/Erp-app/releases'

export const iconPath = (): string | undefined => {
  const packed = join(process.resourcesPath ?? '', 'icon.png')
  if (existsSync(packed)) return packed
  const dev = join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(dev) ? dev : undefined
}

export async function showAbout(parent: BrowserWindow | null): Promise<void> {
  const icon = iconPath()
  const options = {
    type: 'info' as const, title: 'About OneSyncERP', message: 'OneSyncERP', buttons: ['OK'],
    detail: `Version ${app.getVersion()}\n\nOne system for selling, buying, stock, accounts, GST, payroll and production.\n\nRuns on Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
    ...(icon ? { icon: nativeImage.createFromPath(icon) } : {}),
  }
  if (parent) await dialog.showMessageBox(parent, options); else await dialog.showMessageBox(options)
}

export const openLogs = (): Promise<string> => shell.openPath(logDir())
export const checkForUpdates = (): Promise<void> => shell.openExternal(`${RELEASES_URL}/latest`)

/** The native menu: standard editing and view commands, zoom, and Help (what's new, updates, logs, About). */
export function buildMenu(getWin: () => BrowserWindow | null, zoom: (delta: number | 'reset') => void): Menu {
  const mac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ label: app.name, submenu: [{ label: 'About OneSyncERP', click: () => void showAbout(getWin()) }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } as MenuItemConstructorOptions] : []),
    { label: 'File', submenu: [mac ? { role: 'close' } : { role: 'quit', label: 'Exit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { label: 'Zoom in', accelerator: 'CommandOrControl+Plus', click: () => zoom(0.5) },
      { label: 'Zoom out', accelerator: 'CommandOrControl+-', click: () => zoom(-0.5) },
      { label: 'Actual size', accelerator: 'CommandOrControl+0', click: () => zoom('reset') },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [
      { label: 'What’s new', click: () => void shell.openExternal(RELEASES_URL) },
      { label: 'Check for updates…', click: () => void checkForUpdates() },
      { label: 'Open log folder', click: () => void openLogs() },
      ...(mac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { label: 'About OneSyncERP', click: () => void showAbout(getWin()) } as MenuItemConstructorOptions]),
    ] },
  ]
  return Menu.buildFromTemplate(template)
}
