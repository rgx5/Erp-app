import { emptyPersisted, type PersistedState, type Storage, type WriteBatch } from './storage.types'
import { MemoryStorage } from './memory'

const KEY = 'kosh.web.v1'

/**
 * Browser build (used for previews and design review — the shipping targets are Android and iOS). The whole state is a
 * single localStorage blob, kept in memory and flushed after each write.
 */
class WebStorage extends MemoryStorage {
  private loaded = false

  private read(): PersistedState {
    try {
      const raw = globalThis.localStorage?.getItem(KEY)
      if (raw) return JSON.parse(raw) as PersistedState
    } catch { /* private mode or corrupt — start fresh */ }
    return emptyPersisted()
  }

  private async hydrate() {
    if (this.loaded) return
    this.loaded = true
    const saved = this.read()
    // Seed the in-memory base class with what was saved.
    const batch: WriteBatch = { put: [], outboxPut: saved.outbox, kv: saved.kv }
    if (saved.store) batch.put!.push({ coll: 'store', id: 'store', json: JSON.stringify(saved.store) })
    for (const [coll, list] of Object.entries(saved.docs)) {
      for (const d of (list ?? []) as Array<{ id: string }>) batch.put!.push({ coll: coll as never, id: d.id, json: JSON.stringify(d) })
    }
    await super.write(batch)
  }

  private flush(state: PersistedState) {
    try { globalThis.localStorage?.setItem(KEY, JSON.stringify(state)) } catch { /* storage full — the in-memory copy still works this session */ }
  }

  override async load(): Promise<PersistedState> {
    await this.hydrate()
    return super.load()
  }

  override async write(b: WriteBatch): Promise<void> {
    await this.hydrate()
    await super.write(b)
    this.flush(await super.load())
  }

  override async wipe(): Promise<void> {
    await super.wipe()
    try { globalThis.localStorage?.removeItem(KEY) } catch { /* ignore */ }
  }
}

export const createStorage = (): Storage => new WebStorage()
