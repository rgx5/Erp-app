import { endOfDay, startOfDay } from '@/domain/dates'
import { listOf, type DataState } from '@/data/state'
import type { CrmNote, CrmTask } from './types'

export type TaskState = 'done' | 'overdue' | 'today' | 'upcoming' | 'someday'

export function taskState(t: Pick<CrmTask, 'done' | 'due'>, now: number): TaskState {
  if (t.done) return 'done'
  if (t.due === undefined) return 'someday'
  if (t.due < startOfDay(now)) return 'overdue'
  return t.due <= endOfDay(now) ? 'today' : 'upcoming'
}

const byDue = (a: CrmTask, b: CrmTask) => (a.due ?? Infinity) - (b.due ?? Infinity) || a.createdAt - b.createdAt

/** Open tasks in the order to do them: late first, then today, then later, then those with no date. */
export const openTasks = (state: Pick<DataState, 'crmTasks'>): CrmTask[] => listOf(state.crmTasks ?? {}).filter((t) => !t.done).sort(byDue)

export interface TaskTarget { customerId?: string; leadId?: string; ticketId?: string }

export function tasksFor(state: Pick<DataState, 'crmTasks'>, target: TaskTarget): CrmTask[] {
  return listOf(state.crmTasks ?? {})
    .filter((t) => (target.customerId ? t.customerId === target.customerId : true) && (target.leadId ? t.leadId === target.leadId : true) && (target.ticketId ? t.ticketId === target.ticketId : true))
    .sort((a, b) => Number(a.done) - Number(b.done) || byDue(a, b))
}

export function taskCounts(state: Pick<DataState, 'crmTasks'>, now: number): { overdue: number; today: number; upcoming: number; someday: number; done: number } {
  const out = { overdue: 0, today: 0, upcoming: 0, someday: 0, done: 0 }
  for (const t of listOf(state.crmTasks ?? {})) out[taskState(t, now)] += 1
  return out
}

/** Notes and log entries about a customer, a lead or a ticket, newest first. */
export function notesFor(state: Pick<DataState, 'crmNotes'>, target: TaskTarget): CrmNote[] {
  return listOf(state.crmNotes ?? {})
    .filter((n) => (target.customerId ? n.customerId === target.customerId : true) && (target.leadId ? n.leadId === target.leadId : true) && (target.ticketId ? n.ticketId === target.ticketId : true))
    .sort((a, b) => b.at - a.at)
}

export const NOTE_LABEL: Record<CrmNote['kind'], string> = { note: 'Note', call: 'Call', whatsapp: 'WhatsApp', sms: 'SMS', visit: 'Visit', email: 'Email', status: 'Update' }
export const TASK_LABEL: Record<CrmTask['kind'], string> = { task: 'To-do', call: 'Call', visit: 'Visit', reminder: 'Reminder' }
