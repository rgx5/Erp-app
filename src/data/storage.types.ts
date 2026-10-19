import type { OutboxEntry, StoreSettings } from '@/domain/types'
import type { Coll } from './state'

/**
 * Everything the app persists on the phone. Records are stored as JSON documents (one row per record) so the schema
 * never has to change when a field is added — the same record shapes the cloud API uses.
 */
export interface PersistedState {
  store: StoreSettings | null
  docs: { [K in Coll]?: unknown[] }
  outbox: OutboxEntry[]
  kv: Record<string, string>
}

export interface WriteBatch {
  /** `store` is the single settings row. */
  put?: Array<{ coll: Coll | 'store'; id: string; json: string }>
  del?: Array<{ coll: Coll; id: string }>
  outboxPut?: OutboxEntry[]
  outboxDel?: number[]
  kv?: Record<string, string | null>
}

export interface Storage {
  load(): Promise<PersistedState>
  /** Applies a batch atomically: either every row lands or none does. */
  write(batch: WriteBatch): Promise<void>
  /** Forgets everything (sign out / reset). */
  wipe(): Promise<void>
}

export const emptyPersisted = (): PersistedState => ({ store: null, docs: {}, outbox: [], kv: {} })
