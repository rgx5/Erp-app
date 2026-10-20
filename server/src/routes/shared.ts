import type { Queryable } from '../db'
import type { PgDocStore } from '../pgDocStore'
import type { Doc } from '@/replication/types'

export interface UserRow {
  id: string; org_id: string; name: string; email: string | null; role: 'owner' | 'manager' | 'cashier'; role_id: string | null; active: boolean
  code: string | null; branches: string[] | null; pin_hash: string | null; password_hash: string | null
}

/** The `users` collection document: what every device may see about a person. Never a credential. */
export const userDoc = (u: Pick<UserRow, 'id' | 'name' | 'role' | 'active' | 'code'>): Doc => ({
  id: u.id, name: u.name, role: u.role, active: u.active, ...(u.code ? { code: u.code } : {}),
})

/** A user as the management API shows them (still never a hash). */
export const userView = (u: UserRow) => ({
  id: u.id, name: u.name, email: u.email ?? undefined, role: u.role, roleId: u.role_id ?? undefined, active: u.active, code: u.code ?? undefined,
  branches: u.branches ?? undefined, hasPin: !!u.pin_hash, hasPassword: !!u.password_hash,
})

export async function writeUserDoc(store: PgDocStore, u: UserRow, by: string) {
  await store.put('users', u.id, userDoc(u), { by })
}

export const USER_COLS = 'id, org_id, name, email, role, role_id, active, code, branches, pin_hash, password_hash'

export async function branchesFor(q: Queryable, orgId: string, only: string[] | 'all') {
  const r = await q.query<{ id: string; name: string; code: string | null; address: string; phone: string; active: boolean; is_default: boolean }>(
    'SELECT id, name, code, address, phone, active, is_default FROM branches WHERE org_id = $1 ORDER BY is_default DESC, name', [orgId])
  return r.rows
    .filter((b) => only === 'all' || only.includes(b.id))
    .map((b) => ({ id: b.id, name: b.name, code: b.code ?? undefined, address: b.address, phone: b.phone, active: b.active, isDefault: b.is_default }))
}

export const isUniqueViolation = (e: unknown, constraintHint?: string) =>
  !!e && typeof e === 'object' && (e as { code?: string }).code === '23505' && (!constraintHint || String((e as { constraint?: string }).constraint ?? '').includes(constraintHint))
