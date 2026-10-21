import { listOf, type DataState } from '@/data/state'
import type { Candidate, CandidateStage } from '../types'

export const STAGES: Array<{ value: CandidateStage; label: string }> = [
  { value: 'applied', label: 'Applied' },
  { value: 'screening', label: 'Screening' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'hired', label: 'Hired' },
  { value: 'rejected', label: 'Rejected' },
]
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.value, s.label])) as Record<CandidateStage, string>

/** A hired candidate is final (they are an employee now); anyone else can move to any stage, including back. */
export const canMoveTo = (from: CandidateStage, to: CandidateStage) => from !== 'hired' && from !== to

export const ONBOARDING_STEPS = [
  'Offer letter signed', 'ID and address proof collected', 'Bank details collected', 'PF / ESI details taken', 'Shift and weekly off decided',
  'Added to the sign-in staff list', 'Uniform / tools handed over', 'First-week training done',
]

export interface Funnel { stage: CandidateStage; label: string; count: number }

/** How many candidates are at each stage, for one opening or all. */
export function funnel(candidates: Candidate[], openingId?: string): Funnel[] {
  const list = openingId ? candidates.filter((c) => c.openingId === openingId) : candidates
  return STAGES.map((s) => ({ stage: s.value, label: s.label, count: list.filter((c) => c.stage === s.value).length }))
}

export const openingStats = (state: Pick<DataState, 'hrOpenings' | 'hrCandidates'>, openingId: string) => {
  const cands = listOf(state.hrCandidates ?? {}).filter((c) => c.openingId === openingId)
  const hired = cands.filter((c) => c.stage === 'hired').length
  return { candidates: cands.length, hired, active: cands.filter((c) => c.stage !== 'hired' && c.stage !== 'rejected').length, positions: state.hrOpenings?.[openingId]?.positions ?? 0 }
}
