import { id } from '@/domain/ids'
import { audit, OpError, type OpCtx } from '@/data/ops'
import type { Changes, DataState } from '@/data/state'
import { withEffects } from '@/replication/local'
import { approvalRefusal, settingsOf } from './approvals'
import type { PoApproval } from './types'
import './replication'

/** Approves or turns down a draft purchase order, within the person's limit. The order is updated by the approval's effect. */
export function decidePurchaseOrder(state: DataState, orderId: string, decision: PoApproval['decision'], note: string, ctx: OpCtx): { changes: Changes; approval: PoApproval } {
  const po = state.purchaseOrders[orderId]
  if (!po) throw new OpError('That purchase order no longer exists.')
  const user = state.users[ctx.userId]
  if (!user) throw new OpError('Sign in to approve orders.')
  const settings = settingsOf(state)
  const refusal = approvalRefusal(settings, po, user.role)
  if (refusal) throw new OpError(refusal)
  if (decision === 'rejected' && !note.trim()) throw new OpError('Say why the order is turned down, so whoever made it knows what to change.')
  const approval: PoApproval = {
    id: id('pa_', ctx.now), orderId, orderNo: po.no, decision, amount: po.total, role: user.role, userId: ctx.userId, note: note.trim(), date: ctx.now,
    ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  const word = decision === 'approved' ? 'approved' : 'turned down'
  const base: Changes = { put: { poApprovals: [approval], audit: [audit(ctx, 'PO_APPROVAL', `${po.no} ${word} — ₹${po.total}${note.trim() ? ` (${note.trim()})` : ''}`)] } }
  return { approval, changes: withEffects(state, base, ['poApprovals'], ctx.now) }
}
