import type { StoreSettings } from '@/domain/types'
import { COLLECTIONS, emptyData, type Coll, type CollMap, type DataState } from './state'

/**
 * A whole business as one JSON file. Written for people to keep somewhere safe (and for an offline workspace to restore
 * from); the shape is the app's own collections, so it never needs translating.
 */
export const BACKUP_FORMAT = 'kosh-erp-backup'
export const BACKUP_VERSION = 1

export type BackupData = { [K in Coll]: CollMap[K][] }

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: number
  workspace: { name: string; industry: string; mode: 'local' | 'remote' }
  store: StoreSettings
  data: BackupData
}

export function buildBackup(data: DataState, workspace: Backup['workspace'], now = Date.now()): Backup {
  if (!data.store) throw new Error('There is no business to back up yet.')
  const out = {} as BackupData
  for (const coll of COLLECTIONS) (out as Record<string, unknown[]>)[coll] = Object.values(data[coll])
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, workspace, store: data.store, data: out }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Reads a backup file, refusing anything that is not one — a restore replaces everything, so it has to be sure. */
export function parseBackup(text: string): Backup {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('That file is not a Kosh backup (it is not valid JSON).') }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new Error('That file is not a Kosh backup.')
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app. Update the app and try again.')
  const store = raw.store
  if (!isObj(store) || typeof store.name !== 'string' || !store.name) throw new Error('The backup has no business details.')
  const data = raw.data
  if (!isObj(data)) throw new Error('The backup has no records.')
  for (const coll of COLLECTIONS) {
    const rows = data[coll]
    if (rows === undefined) continue
    if (!Array.isArray(rows) || rows.some((r) => !isObj(r) || typeof r.id !== 'string')) throw new Error(`The backup is damaged (${coll}).`)
  }
  const users = (data.users ?? []) as Array<{ role?: string; active?: boolean }>
  if (!users.some((u) => u.role === 'owner' && u.active)) throw new Error('The backup has no active owner, so nobody could sign in after restoring it.')
  const ws = isObj(raw.workspace) ? raw.workspace : {}
  return {
    format: BACKUP_FORMAT, version: raw.version, exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
    workspace: { name: typeof ws.name === 'string' ? ws.name : String(store.name), industry: typeof ws.industry === 'string' ? ws.industry : 'general', mode: ws.mode === 'remote' ? 'remote' : 'local' },
    store: store as unknown as StoreSettings,
    data: Object.fromEntries(COLLECTIONS.map((c) => [c, (data[c] ?? []) as unknown[]])) as unknown as BackupData,
  }
}

export function backupToData(b: Backup): DataState {
  const d = emptyData()
  d.store = b.store
  for (const coll of COLLECTIONS) {
    const rec: Record<string, unknown> = {}
    for (const r of b.data[coll] as Array<{ id: string }>) rec[r.id] = r
    ;(d as unknown as Record<string, unknown>)[coll] = rec
  }
  return d
}

export const backupCounts = (b: Backup) => ({ bills: b.data.bills.length, items: b.data.products.length, customers: b.data.customers.length })
