import { endOfDay, startOfDay } from '@/domain/dates'
import { round2 } from '@/domain/money'
import { listOf, type DataState } from '@/data/state'
import type { Lead, LeadStage } from './types'

export interface StageDef { id: LeadStage; label: string; /** Chance a lead at this stage is won, for the weighted forecast. */ chance: number }

export const STAGES: StageDef[] = [
  { id: 'new', label: 'New', chance: 0.1 },
  { id: 'contacted', label: 'Contacted', chance: 0.25 },
  { id: 'qualified', label: 'Qualified', chance: 0.5 },
  { id: 'proposal', label: 'Proposal', chance: 0.75 },
  { id: 'won', label: 'Won', chance: 1 },
  { id: 'lost', label: 'Lost', chance: 0 },
]
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<LeadStage, string>
export const OPEN_STAGES: LeadStage[] = ['new', 'contacted', 'qualified', 'proposal']
export const isOpenLead = (l: Pick<Lead, 'stage'>) => OPEN_STAGES.includes(l.stage)

export type FollowUp = 'none' | 'overdue' | 'today' | 'later'

/** Whether a lead's follow-up date is past, today or still to come. A closed lead has none to do. */
export function followUpState(l: Pick<Lead, 'stage' | 'nextFollowUp'>, now: number): FollowUp {
  if (!isOpenLead(l) || l.nextFollowUp === undefined) return 'none'
  if (l.nextFollowUp < startOfDay(now)) return 'overdue'
  return l.nextFollowUp <= endOfDay(now) ? 'today' : 'later'
}

/** Open leads whose follow-up is today or late, most overdue first. */
export function leadsToFollowUp(state: Pick<DataState, 'crmLeads'>, now: number): Lead[] {
  return listOf(state.crmLeads ?? {})
    .filter((l) => ['overdue', 'today'].includes(followUpState(l, now)))
    .sort((a, b) => (a.nextFollowUp ?? 0) - (b.nextFollowUp ?? 0))
}

export interface PipelineSummary {
  byStage: Record<LeadStage, { count: number; value: number }>
  open: { count: number; value: number }
  /** Value of open leads, each counted at its stage's chance of being won. */
  weighted: number
  won: { count: number; value: number }
  lost: number
  /** Won as a share of the leads that are decided. Null when none are. */
  winRatePct: number | null
  overdue: number
  dueToday: number
}

export function pipelineSummary(state: Pick<DataState, 'crmLeads'>, now: number): PipelineSummary {
  const byStage = Object.fromEntries(STAGES.map((s) => [s.id, { count: 0, value: 0 }])) as PipelineSummary['byStage']
  let weighted = 0
  let overdue = 0
  let dueToday = 0
  for (const l of listOf(state.crmLeads ?? {})) {
    const b = byStage[l.stage]
    b.count += 1
    b.value = round2(b.value + l.value)
    weighted += l.value * (STAGES.find((s) => s.id === l.stage)?.chance ?? 0) * (isOpenLead(l) ? 1 : 0)
    const f = followUpState(l, now)
    if (f === 'overdue') overdue += 1
    else if (f === 'today') dueToday += 1
  }
  const open = OPEN_STAGES.reduce((t, s) => ({ count: t.count + byStage[s].count, value: round2(t.value + byStage[s].value) }), { count: 0, value: 0 })
  const decided = byStage.won.count + byStage.lost.count
  return { byStage, open, weighted: round2(weighted), won: byStage.won, lost: byStage.lost.count, winRatePct: decided ? Math.round((byStage.won.count / decided) * 100) : null, overdue, dueToday }
}

/** The stages a lead may be moved to from where it is. A won lead is final (it is a customer now); a lost one can be reopened. */
export function stagesFrom(l: Pick<Lead, 'stage'>): LeadStage[] {
  if (l.stage === 'won') return []
  if (l.stage === 'lost') return ['new']
  return STAGES.map((s) => s.id).filter((s) => s !== l.stage && s !== 'won')
}

/** An existing customer with the same mobile number as a lead, if any (a lead who is already a customer). */
export function customerWithPhone(state: Pick<DataState, 'customers'>, phone: string): string | null {
  const d = phone.replace(/\D/g, '').slice(-10)
  if (d.length < 10) return null
  return listOf(state.customers).find((c) => c.phone.replace(/\D/g, '').slice(-10) === d)?.id ?? null
}
