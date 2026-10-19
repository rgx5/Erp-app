import { emptyPersisted, type PersistedState, type Storage, type WriteBatch } from './storage.types'
import type { Coll } from './state'
import type { OutboxEntry, StoreSettings } from '@/domain/types'

/**
 * In-memory storage: used by the unit tests, and as the base behaviour the platform drivers
 * (`driver.native.ts` → SQLite, `driver.web.ts` → localStorage) build on.
 */
export class MemoryStorage implements Storage {
  private s: PersistedState = emptyPersisted()

  async load(): Promise<PersistedState> {
    return JSON.parse(JSON.stringify(this.s)) as PersistedState
  }

  async write(b: WriteBatch): Promise<void> {
    for (const r of b.put ?? []) {
      if (r.coll === 'store') { this.s.store = JSON.parse(r.json) as StoreSettings; continue }
      const list = (this.s.docs[r.coll as Coll] ??= []) as Array<{ id: string }>
      const i = list.findIndex((x) => x.id === r.id)
      const doc = JSON.parse(r.json) as { id: string }
      if (i >= 0) list[i] = doc; else list.push(doc)
    }
    for (const r of b.del ?? []) {
      const list = this.s.docs[r.coll] as Array<{ id: string }> | undefined
      if (list) this.s.docs[r.coll] = list.filter((x) => x.id !== r.id)
    }
    for (const o of b.outboxPut ?? []) {
      const i = this.s.outbox.findIndex((x) => x.id === o.id)
      const copy = JSON.parse(JSON.stringify(o)) as OutboxEntry
      if (i >= 0) this.s.outbox[i] = copy; else this.s.outbox.push(copy)
    }
    if (b.outboxDel?.length) this.s.outbox = this.s.outbox.filter((o) => !b.outboxDel!.includes(o.id))
    for (const [k, v] of Object.entries(b.kv ?? {})) { if (v === null) delete this.s.kv[k]; else this.s.kv[k] = v }
  }

  async wipe(): Promise<void> {
    this.s = emptyPersisted()
  }
}

