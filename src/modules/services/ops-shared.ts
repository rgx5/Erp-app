import { audit, OpError, type OpCtx } from '@/data/ops'
import { applyChanges, listOf, mergeChanges, type Changes, type DataState } from '@/data/state'
import { can } from '@/domain/permissions'
import type { Payment } from '@/domain/types'
import { paymentMethodList } from '@/modules/registry'
import './replication'

export const branch = (ctx: OpCtx) => (ctx.branchId ? { branchId: ctx.branchId } : {})
export const need = <T>(v: T | undefined | null, what: string): T => { if (!v) throw new OpError(`That ${what} no longer exists.`); return v }
export const isManager = (state: DataState, ctx: OpCtx) => can(state.users[ctx.userId]?.role, 'servicesManage')
export { applyChanges, audit, listOf, mergeChanges, OpError }
export type { Changes, DataState, OpCtx }

const PAY = ['cash', 'upi', 'card', 'bank', 'package']
/** How a bill made here may be paid. "On account" only exists when the credit app is there. */
export const hasOnAccount = () => paymentMethodList().some((m) => m.id === 'due')
export function checkPayments(payments: Payment[], total: number): void {
  if (!payments.length) throw new OpError('Choose how the customer pays.')
  for (const p of payments) {
    if (!(p.amount > 0)) throw new OpError('Every payment needs an amount.')
    if (p.mode === 'due' && !hasOnAccount()) throw new OpError('Billing on account needs the Credit app. Choose cash, UPI or card.')
    if (!PAY.includes(p.mode) && !paymentMethodList().some((m) => m.id === p.mode)) throw new OpError('Choose how the customer pays.')
  }
  const paid = payments.reduce((s, p) => s + p.amount, 0)
  if (paid + 0.01 < total) throw new OpError('The payments add up to less than the bill.')
}
