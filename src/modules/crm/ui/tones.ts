import type { Tone } from '@/ui/theme'
import type { LeadStage, TicketPriority, TicketStatus } from '../types'
import type { SlaState } from '../tickets'

export const STAGE_TONE: Record<LeadStage, Tone> = { new: 'primary', contacted: 'accent', qualified: 'warning', proposal: 'warning', won: 'success', lost: 'danger' }
export const STATUS_TONE: Record<TicketStatus, Tone> = { open: 'warning', 'in-progress': 'primary', waiting: 'accent', resolved: 'success', closed: 'default' }
export const PRIORITY_TONE: Record<TicketPriority, Tone> = { low: 'default', normal: 'primary', high: 'danger' }
export const SLA_TONE: Record<SlaState, Tone> = { ok: 'success', 'due-soon': 'warning', breached: 'danger', met: 'success', missed: 'danger' }
