import { round2 } from '@/domain/money'
import { listOf, type DataState } from '@/data/state'
import type { CashMove, Shift } from '../types'

export interface ShiftFigures {
  from: number
  to: number
  opening: number
  /** Cash taken from customers in the window, after change given back and cash refunds. */
  cashSales: number
  /** Cash received for orders (advances and instalments), net of cash given back, and cash collected against dues. */
  cashOther: number
  /** Everything sold in the window by how it was paid (cash, upi, card, due…), net of returns. */
  byMode: Array<{ mode: string; amount: number }>
  payIns: number
  payOuts: number
  cashExpenses: number
  expected: number
  bills: number
  moves: CashMove[]
}

export const openShiftFor = (state: DataState, userId: string): Shift | undefined =>
  listOf(state.shifts).find((s) => s.status === 'open' && s.userId === userId)

/**
 * What should be in a till at this moment (or when it closed): the float it opened with, plus cash sales, plus cash received on
 * orders and dues, plus cash put in, minus cash taken out and cash expenses — for this person's documents within the shift.
 * Complements the day close; it does not replace it (the day close counts the whole shop's drawer).
 */
export function shiftFigures(state: DataState, shiftId: string, now: number): ShiftFigures | null {
  const shift = state.shifts[shiftId]
  if (!shift) return null
  const from = shift.openedAt
  const to = shift.closedAt ?? now
  const mine = listOf(state.bills).filter((b) => b.status !== 'held' && b.cashierId === shift.userId && b.date >= from && b.date <= to)
  // Cash payments are already net of change; a cash refund on a return is a negative cash payment.
  const cashSales = round2(mine.reduce((s, b) => s + b.payments.filter((p) => p.mode === 'cash').reduce((t, p) => t + p.amount, 0), 0))
  // Cash for orders is ours; cash collected against dues belongs to the credit module, whose collections are read by shape (no import).
  const orderCash = listOf(state.orderPayments).filter((p) => p.mode === 'cash' && p.userId === shift.userId && p.date >= from && p.date <= to)
    .reduce((s, p) => s + (p.kind === 'advance' ? p.amount : p.kind === 'refund' ? -p.amount : 0), 0)
  const collected = Object.values((state as unknown as { collections?: Record<string, { mode?: string; amount?: number; userId?: string; date?: number }> }).collections ?? {})
    .filter((c) => c.mode === 'cash' && c.userId === shift.userId && (c.date ?? 0) >= from && (c.date ?? 0) <= to).reduce((s, c) => s + (c.amount ?? 0), 0)
  const cashOther = round2(orderCash + collected)
  const modes = new Map<string, number>()
  for (const b of mine) for (const p of b.payments) modes.set(p.mode, round2((modes.get(p.mode) ?? 0) + p.amount))
  const moves = listOf(state.cashMoves).filter((m) => m.shiftId === shift.id).sort((a, b) => a.date - b.date)
  const payIns = round2(moves.filter((m) => m.kind === 'in').reduce((s, m) => s + m.amount, 0))
  const payOuts = round2(moves.filter((m) => m.kind === 'out').reduce((s, m) => s + m.amount, 0))
  const cashExpenses = round2(listOf(state.expenses).filter((e) => e.mode === 'cash' && e.userId === shift.userId && e.date >= from && e.date <= to).reduce((s, e) => s + e.amount, 0))
  return {
    from, to, opening: shift.openingCash, cashSales, cashOther, byMode: [...modes].map(([mode, amount]) => ({ mode, amount })).sort((a, b) => b.amount - a.amount), payIns, payOuts, cashExpenses, bills: mine.filter((b) => b.total >= 0).length, moves,
    expected: round2(shift.openingCash + cashSales + cashOther + payIns - payOuts - cashExpenses),
  }
}

export const varianceLabel = (v: number) => (v === 0 ? 'Exact' : v > 0 ? `Over by ₹${v}` : `Short by ₹${Math.abs(v)}`)

export const PAY_IN_REASONS = ['Float top-up', 'Change from bank', 'Owner put in', 'Other']
export const PAY_OUT_REASONS = ['Bank deposit', 'Petty cash', 'Supplier payment', 'Staff advance', 'Tea & snacks', 'Other']
