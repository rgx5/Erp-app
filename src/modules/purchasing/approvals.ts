import type { Role } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import type { PoApproval, PurchaseOrder, PurchaseSettings } from './types'

/**
 * Who may approve what. The shop sets a threshold ("orders above ₹10,000 need approval") and the most each role may approve
 * ("managers up to ₹50,000"). The owner has no limit. A person whose own limit covers an order may send it without asking
 * anyone; above their limit the order waits for someone whose limit does. A decision holds for the amount it was made at —
 * editing the order afterwards asks again.
 */

export const DEFAULT_SETTINGS: PurchaseSettings = { id: 'purchasing', approvalsOn: false, approvalAbove: 10_000, limits: { manager: 50_000 }, defaultDays: 30, remindDays: 7 }

export const settingsOf = (state: Pick<DataState, 'purchaseSettings'>): PurchaseSettings => ({ ...DEFAULT_SETTINGS, ...(state.purchaseSettings?.purchasing ?? {}) })

/** The most a role may approve; the owner is unlimited, a role that is not listed can approve nothing. */
export function limitFor(settings: PurchaseSettings, role: Role | string | undefined): number {
  if (role === 'owner') return Infinity
  const n = role ? settings.limits[role] : 0
  return typeof n === 'number' && n > 0 ? n : 0
}

/** Does an order of this size need someone's approval at all? */
export const needsApproval = (settings: PurchaseSettings, total: number) => settings.approvalsOn && total > Math.max(0, settings.approvalAbove)

export type ApprovalState = 'not-needed' | 'pending' | 'approved' | 'rejected'

/** Where an order stands. A decision made for a different amount than the order's current total no longer counts. */
export function approvalState(settings: PurchaseSettings, po: Pick<PurchaseOrder, 'total' | 'approvalStatus' | 'approvedAmount'>): ApprovalState {
  if (!needsApproval(settings, po.total)) return 'not-needed'
  if (po.approvalStatus && po.approvedAmount === po.total) return po.approvalStatus
  return 'pending'
}

export interface SendCheck { ok: boolean; reason: string }

/** May this person send the order to the supplier now? */
export function canSend(settings: PurchaseSettings, po: PurchaseOrder, role: Role | string | undefined): SendCheck {
  const st = approvalState(settings, po)
  if (st === 'not-needed' || st === 'approved') return { ok: true, reason: '' }
  if (st === 'rejected') return { ok: false, reason: 'This order was turned down. Change it (the amount or the items) and ask again.' }
  if (limitFor(settings, role) >= po.total) return { ok: true, reason: '' }
  return { ok: false, reason: `An order of ₹${po.total} needs approval first${approverHint(settings, po.total)}.` }
}

/** "from the owner" / "from a manager or the owner" — who could say yes. */
export function approverHint(settings: PurchaseSettings, total: number): string {
  const roles = Object.keys(settings.limits).filter((r) => r !== 'owner' && limitFor(settings, r) >= total)
  return roles.length ? ` from ${roles.map((r) => `a ${r}`).join(' or ')} or the owner` : ' from the owner'
}

/** Why this person may not decide on the order, or null when they may. */
export function approvalRefusal(settings: PurchaseSettings, po: PurchaseOrder, role: Role | string | undefined): string | null {
  if (!settings.approvalsOn) return 'Approvals are switched off in the purchasing settings.'
  if (po.status !== 'draft') return 'Only a draft order can be approved — it is already on its way.'
  if (!needsApproval(settings, po.total)) return 'This order is under the approval threshold; it can be sent as it is.'
  const limit = limitFor(settings, role)
  if (limit <= 0) return 'Your role cannot approve purchase orders.'
  if (limit < po.total) return `Your limit is ₹${limit}; this order is ₹${po.total}${approverHint(settings, po.total)}.`
  return null
}

/** Drafts waiting for a decision, oldest first. */
export function awaitingApproval(state: DataState): PurchaseOrder[] {
  const s = settingsOf(state)
  if (!s.approvalsOn) return []
  return listOf(state.purchaseOrders).filter((o) => o.status === 'draft' && approvalState(s, o) === 'pending').sort((a, b) => a.date - b.date)
}

/** Drafts this role could approve right now (a manager is not asked about an order above their limit). */
export const approvableBy = (state: DataState, role: Role | string | undefined): PurchaseOrder[] =>
  awaitingApproval(state).filter((o) => approvalRefusal(settingsOf(state), o, role) === null)

/** The decisions made on one order, newest first. */
export const approvalsFor = (state: DataState, orderId: string): PoApproval[] =>
  listOf(state.poApprovals).filter((a) => a.orderId === orderId).sort((a, b) => b.date - a.date)

/** What a decision does to its order (run by the phone and the server alike). */
export const orderAfterApproval = (a: PoApproval): Partial<PurchaseOrder> => ({ approvalStatus: a.decision, approvedAmount: a.amount, approvedBy: a.userId, approvedAt: a.date })
