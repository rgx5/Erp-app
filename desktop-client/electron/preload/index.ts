import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '../bridge-types'

const bridge: DesktopBridge = {
  desktop: true,
  info: () => ipcRenderer.invoke('app:info'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  document: { savePdf: (html, filename) => ipcRenderer.invoke('document:savePdf', html, filename) },
  printer: {
    list: () => ipcRenderer.invoke('printer:list'),
    printReceipt: (html, printerName) => ipcRenderer.invoke('printer:printReceipt', html, printerName),
  },
  secure: {
    get: (key) => ipcRenderer.invoke('secure:get', key),
    set: (key, value) => ipcRenderer.invoke('secure:set', key, value),
    delete: (key) => ipcRenderer.invoke('secure:delete', key),
  },
}

contextBridge.exposeInMainWorld('onesync', bridge)
