/**
 * The replication protocol shared by the app and the OneSync server.
 *
 * Every business record is a JSON document in a named collection. Devices write by sending *mutations*; they read by
 * pulling everything that changed since a cursor. The rules for what a mutation may do live in one place
 * (`apply.ts`) and are run by the server against PostgreSQL and by the tests against memory — so there is a single
 * definition of what the server does with a write.
 */

/** A record: always has a string id; everything else is the module's business. */
export type Doc = { id: string } & Record<string, unknown>

export type MutationOp = 'create' | 'patch' | 'delete'

export interface Mutation {
  /** Idempotency key: `${deviceId}:${n}`. Sending the same mutation twice does nothing the second time. */
  mid: string
  coll: string
  id: string
  op: MutationOp
  /** create: the whole document. patch: only the fields that changed (`null` removes a field). */
  data?: Record<string, unknown>
  /** When it happened on the device (informational; the server orders by arrival). */
  at: number
}

export type MutationStatus = 'ok' | 'duplicate' | 'rejected'
export type RejectCode =
  | 'unknown_collection' | 'forbidden' | 'managed' | 'immutable' | 'not_found' | 'invalid' | 'too_large' | 'branch_forbidden'

export interface MutationResult {
  mid: string
  status: MutationStatus
  code?: RejectCode
  message?: string
  rev?: number
}

/** A document as the server keeps it. `data` is null for a deleted record (a tombstone, so devices learn of the delete). */
export interface StoredDoc {
  coll: string
  id: string
  data: Doc | null
  rev: number
  branchId?: string | null
}

export interface PullResult {
  /** Send this back as `since` next time. */
  cursor: number
  hasMore: boolean
  upserts: Array<{ coll: string; id: string; data: Doc; rev: number }>
  deletes: Array<{ coll: string; id: string; rev: number }>
}

/** Who is writing: resolved by the server from the signed-in token and the role's permissions. */
export interface Actor {
  userId: string
  /** Whether the person's role grants a permission. The owner is granted everything. */
  can(perm: string): boolean
  /** Branches this person may touch; 'all' for the owner and org-wide roles. */
  branches: string[] | 'all'
}

/** What the store hands back for a pull: only collections / branches the person may see. */
export interface ReadFilter {
  colls: string[]
  branches: string[] | 'all'
}

/** The storage the replication rules run against. PostgreSQL on the server, a Map in tests. */
export interface DocStore {
  get(coll: string, id: string): Promise<StoredDoc | undefined>
  /** Writes (or tombstones, with `data: null`) a document and returns its new revision. Revisions only ever increase. */
  put(coll: string, id: string, data: Doc | null, opts: { branchId?: string | null; by: string }): Promise<number>
  hasMutation(mid: string): Promise<boolean>
  rememberMutation(mid: string, rev: number): Promise<void>
  /** All-or-nothing: if `fn` throws, nothing it wrote is kept. */
  atomic<T>(fn: () => Promise<T>): Promise<T>
  changesSince(since: number, limit: number, filter: ReadFilter): Promise<{ docs: StoredDoc[]; cursor: number; hasMore: boolean }>
}
