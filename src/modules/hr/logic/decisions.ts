import { listOf, type DataState } from '@/data/state'
import type { HrDecision } from '../types'

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

/** The id of the answer to a request, and of its cancellation. Fixed ids make a double tap (or two managers) harmless: the second is ignored. */
export const decisionId = (refId: string) => `dec_${refId}`
export const cancelId = (refId: string) => `can_${refId}`

/** What a request has become: a cancellation beats everything, otherwise the earliest answer stands. */
export function statusOf(list: HrDecision[] | undefined): RequestStatus {
  if (!list?.length) return 'pending'
  if (list.some((d) => d.decision === 'cancelled')) return 'cancelled'
  const first = [...list].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))[0]
  return first.decision === 'approved' ? 'approved' : 'rejected'
}

/** The answer that decided it (for the note and the amount). */
export function deciding(list: HrDecision[] | undefined): HrDecision | undefined {
  if (!list?.length) return undefined
  const cancel = list.find((d) => d.decision === 'cancelled')
  if (cancel) return cancel
  return [...list].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))[0]
}

/** Every answer, grouped by the request it answers. */
export function decisionsByRef(state: Pick<DataState, 'hrDecisions'>): Map<string, HrDecision[]> {
  const out = new Map<string, HrDecision[]>()
  for (const d of listOf(state.hrDecisions ?? {})) { const l = out.get(d.refId) ?? []; l.push(d); out.set(d.refId, l) }
  return out
}
