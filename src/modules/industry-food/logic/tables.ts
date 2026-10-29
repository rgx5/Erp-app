import { listOf, type DataState } from '@/data/state'
import { openOrderForTable } from './orders'

/** A table's status is never stored: it is always worked out from the order that currently touches it, so two phones can
 *  never disagree about whether a table is free. */
export type TableStatus = 'free' | 'seated' | 'billing'

export function tableStatus(state: DataState, tableId: string): TableStatus {
  const o = openOrderForTable(state, tableId)
  if (!o) return 'free'
  return o.requestedBill ? 'billing' : 'seated'
}

export const activeTables = (state: DataState) => listOf(state.foodTables).filter((t) => t.active).sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true }))

export interface FloorBoard { total: number; free: number; seated: number; billing: number }

export function floorBoard(state: DataState): FloorBoard {
  const tables = activeTables(state)
  const out: FloorBoard = { total: tables.length, free: 0, seated: 0, billing: 0 }
  for (const t of tables) out[tableStatus(state, t.id)]++
  return out
}

/** A table already seated by an order other than the one being merged/opened cannot be picked again. */
export const isBusy = (state: DataState, tableId: string, exceptOrderId?: string) => {
  const o = openOrderForTable(state, tableId)
  return !!o && o.id !== exceptOrderId
}
