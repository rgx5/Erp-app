import type { StoreSettings } from '@/domain/types'
import type { Snapshot } from './api'
import { COLLECTIONS, emptyData, listOf, type DataState } from './state'

const byId = <T extends { id: string }>(rows: T[] | undefined): Record<string, T> => {
  const out: Record<string, T> = {}
  for (const r of rows ?? []) out[r.id] = r
  return out
}

/**
 * Turns a server snapshot into the app's local state. What only exists on this phone survives a refresh: parked
 * ('held') bills are never sent to the server, and the audit log is local.
 */
export function snapshotToData(snap: Snapshot, local: DataState = emptyData()): DataState {
  if (!snap.store) throw new Error('This account has no business set up.')
  const { plan, ...store } = snap.store
  const held = listOf(local.bills).filter((b) => b.status === 'held')
  const data = emptyData()
  data.store = { ...(store as StoreSettings), ...(plan ? { plan } : {}) }
  data.users = byId(snap.users.map((u) => ({ ...u, pin: local.users[u.id]?.pin })))
  data.categories = byId(snap.categories)
  // The server allows an item with no category; the app treats that as "uncategorised".
  data.products = byId(snap.products.map((p) => ({ ...p, categoryId: p.categoryId ?? '' })))
  data.variants = byId(snap.variants)
  data.customers = byId(snap.customers)
  data.coupons = byId(snap.coupons)
  data.bills = { ...byId(snap.bills), ...byId(held) }
  data.suppliers = byId(snap.suppliers)
  data.purchases = byId(snap.purchases)
  data.moves = byId(snap.moves)
  data.expenses = byId(snap.expenses)
  data.sessions = byId(snap.sessions)
  data.audit = { ...local.audit }
  return data
}

/** Row counts per collection — shown on the Data & sync screen. */
export function countsOf(data: DataState): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of COLLECTIONS) out[c] = Object.keys(data[c]).length
  return out
}
