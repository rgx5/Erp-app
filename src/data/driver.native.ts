import * as SQLite from 'expo-sqlite'
import { emptyPersisted, type PersistedState, type Storage, type WriteBatch } from './storage.types'
import type { Coll } from './state'
import type { OutboxEntry, StoreSettings } from '@/domain/types'

const pad = (n: number) => String(n).padStart(10, '0')

/**
 * SQLite on the phone. One generic `docs` table keyed by (collection, id) holds every record as JSON, so adding a field
 * never needs a migration; the pending server writes live in the same table under the `outbox` collection.
 * WAL mode makes a write survive the app being killed mid-sale.
 */
class SqliteStorage implements Storage {
  private db: SQLite.SQLiteDatabase | null = null

  private async open(): Promise<SQLite.SQLiteDatabase> {
    if (this.db) return this.db
    const db = await SQLite.openDatabaseAsync('kosh.db')
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (coll, id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);
    `)
    this.db = db
    return db
  }

  async load(): Promise<PersistedState> {
    const db = await this.open()
    const out = emptyPersisted()
    const rows = await db.getAllAsync<{ coll: string; json: string }>('SELECT coll, json FROM docs ORDER BY coll, id')
    for (const r of rows) {
      const doc = JSON.parse(r.json) as unknown
      if (r.coll === 'store') out.store = doc as StoreSettings
      else if (r.coll === 'outbox') out.outbox.push(doc as OutboxEntry)
      else (out.docs[r.coll as Coll] ??= []).push(doc)
    }
    for (const r of await db.getAllAsync<{ k: string; v: string }>('SELECT k, v FROM kv')) out.kv[r.k] = r.v
    return out
  }

  async write(b: WriteBatch): Promise<void> {
    const db = await this.open()
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const r of b.put ?? []) await tx.runAsync('INSERT OR REPLACE INTO docs (coll, id, json) VALUES (?, ?, ?)', [r.coll, r.id, r.json])
      for (const r of b.del ?? []) await tx.runAsync('DELETE FROM docs WHERE coll = ? AND id = ?', [r.coll, r.id])
      for (const o of b.outboxPut ?? []) await tx.runAsync('INSERT OR REPLACE INTO docs (coll, id, json) VALUES (?, ?, ?)', ['outbox', pad(o.id), JSON.stringify(o)])
      for (const n of b.outboxDel ?? []) await tx.runAsync('DELETE FROM docs WHERE coll = ? AND id = ?', ['outbox', pad(n)])
      for (const [k, v] of Object.entries(b.kv ?? {})) {
        if (v === null) await tx.runAsync('DELETE FROM kv WHERE k = ?', [k])
        else await tx.runAsync('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', [k, v])
      }
    })
  }

  async wipe(): Promise<void> {
    const db = await this.open()
    await db.execAsync('DELETE FROM docs; DELETE FROM kv;')
  }
}

export const createStorage = (): Storage => new SqliteStorage()
