import { listOf, type DataState } from '@/data/state'
import type { ClaimPayout, ExpenseClaim, HrDecision } from '../types'
import { decisionsByRef, deciding, statusOf } from './decisions'

const r2 = (n: number) => Math.round(n * 100) / 100

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'paid'

export interface ClaimRow {
  claim: ExpenseClaim
  status: ClaimStatus
  /** What the manager approved (0 until then). */
  approved: number
  decision?: HrDecision
  payout?: ClaimPayout
}

export const claimPayoutId = (claimId: string) => `cp_${claimId}`

/** Every claim with where it stands: waiting, approved (and for how much), rejected, or reimbursed. */
export function claimRows(state: Pick<DataState, 'expenseClaims' | 'hrDecisions' | 'claimPayouts'>): ClaimRow[] {
  const decisions = decisionsByRef(state)
  const payouts = new Map(listOf(state.claimPayouts ?? {}).map((p) => [p.claimId, p]))
  return listOf(state.expenseClaims ?? {}).map((claim) => {
    const list = decisions.get(claim.id)
    const st = statusOf(list)
    const decision = deciding(list)
    const payout = payouts.get(claim.id)
    const approved = st === 'approved' ? Math.min(claim.amount, decision?.amount ?? claim.amount) : 0
    const status: ClaimStatus = payout ? 'paid' : st
    return { claim, status, approved: r2(approved), decision, payout }
  }).sort((a, b) => b.claim.submittedAt - a.claim.submittedAt)
}

export const CLAIM_LABEL: Record<ClaimStatus, string> = { pending: 'Waiting for approval', approved: 'Approved, to be paid', rejected: 'Rejected', cancelled: 'Cancelled', paid: 'Reimbursed' }

/** Approved claims not yet reimbursed — what the business owes its staff. */
export const claimsToPay = (rows: ClaimRow[]) => r2(rows.filter((r) => r.status === 'approved').reduce((s, r) => s + r.approved, 0))
