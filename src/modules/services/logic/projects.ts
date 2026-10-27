import { listOf, type DataState } from '@/data/state'
import { round2 } from '@/domain/money'
import type { Project, ProjectTask, TimeEntry } from '../types'

export const PROJECT_LABEL = { active: 'Active', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled' } as const
export const TASK_LABEL = { todo: 'To do', doing: 'Doing', done: 'Done' } as const

/** Minutes on an entry, counting a running timer up to `now`. */
export const entryMinutes = (e: TimeEntry, now: number): number => e.minutes + (e.runningSince ? Math.max(0, Math.round((now - e.runningSince) / 60_000)) : 0)
export const hoursOf = (minutes: number) => round2(minutes / 60)
export const entryAmount = (e: TimeEntry, now = 0) => round2((entryMinutes(e, now) / 60) * e.rate)

export const entriesOf = (state: DataState, projectId: string): TimeEntry[] =>
  listOf(state.timeEntries ?? {}).filter((e) => e.projectId === projectId).sort((a, b) => b.date - a.date || b.createdAt - a.createdAt)
export const tasksOf = (state: DataState, projectId: string): ProjectTask[] =>
  listOf(state.projectTasks ?? {}).filter((t) => t.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt)

/** Billable time not yet invoiced and not still running. */
export const unbilledEntries = (state: DataState, projectId: string): TimeEntry[] =>
  entriesOf(state, projectId).filter((e) => e.billable && !e.billId && !e.runningSince && e.minutes > 0)

export const runningTimer = (state: DataState, userId: string): TimeEntry | undefined =>
  listOf(state.timeEntries ?? {}).find((e) => e.userId === userId && !!e.runningSince)

export interface ProjectSummary {
  minutes: number; billableMinutes: number; billedMinutes: number; unbilledMinutes: number
  hours: number; unbilledHours: number; unbilledAmount: number; billedAmount: number
  budgetPct: number | null; tasksDone: number; tasks: number; fixedLeft: number
}
export function projectSummary(state: DataState, p: Project, now: number): ProjectSummary {
  const es = entriesOf(state, p.id)
  let minutes = 0, billable = 0, billed = 0, unbilledAmt = 0, billedAmt = 0
  for (const e of es) {
    const m = entryMinutes(e, now)
    minutes += m
    if (e.billable) {
      billable += m
      if (e.billId) { billed += m; billedAmt += (m / 60) * e.rate } else if (!e.runningSince) unbilledAmt += (m / 60) * e.rate
    }
  }
  const tasks = tasksOf(state, p.id)
  return {
    minutes, billableMinutes: billable, billedMinutes: billed, unbilledMinutes: billable - billed, hours: hoursOf(minutes), unbilledHours: hoursOf(billable - billed),
    unbilledAmount: round2(unbilledAmt), billedAmount: round2(billedAmt), budgetPct: p.budgetHours > 0 ? Math.round((minutes / 60 / p.budgetHours) * 100) : null,
    tasksDone: tasks.filter((t) => t.status === 'done').length, tasks: tasks.length, fixedLeft: round2(Math.max(0, p.fixedAmount - p.fixedInvoiced)),
  }
}

export interface InvoiceLine { name: string; hours: number; rate: number; amount: number; entryIds: string[] }
/** Lines for an invoice made from entries: one per task and rate, hours rounded to two places. */
export function invoiceLines(state: DataState, project: Project, entries: TimeEntry[]): InvoiceLine[] {
  const groups = new Map<string, InvoiceLine & { minutes: number }>()
  for (const e of entries) {
    const task = e.taskId ? state.projectTasks?.[e.taskId]?.title : ''
    const key = `${task}|${e.rate}`
    const g = groups.get(key) ?? { name: task ? `${project.name} — ${task}` : project.name, hours: 0, rate: e.rate, amount: 0, entryIds: [], minutes: 0 }
    g.minutes += e.minutes; g.entryIds.push(e.id)
    groups.set(key, g)
  }
  return [...groups.values()].map((g) => { const hours = round2(g.minutes / 60); return { name: g.name, hours, rate: g.rate, amount: round2(hours * g.rate), entryIds: g.entryIds } })
}

export interface TimesheetDay { day: number; entries: TimeEntry[]; minutes: number }
/** One person's time between two days, by day. */
export function timesheet(state: DataState, userId: string | null, from: number, to: number, now: number): { days: TimesheetDay[]; minutes: number; billableMinutes: number; amount: number } {
  const es = listOf(state.timeEntries ?? {}).filter((e) => e.date >= from && e.date <= to && (!userId || e.userId === userId))
  const byDay = new Map<number, TimeEntry[]>()
  for (const e of es) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e])
  const days = [...byDay.entries()].sort((a, b) => b[0] - a[0]).map(([day, entries]) => ({ day, entries, minutes: entries.reduce((s, e) => s + entryMinutes(e, now), 0) }))
  return {
    days, minutes: es.reduce((s, e) => s + entryMinutes(e, now), 0), billableMinutes: es.filter((e) => e.billable).reduce((s, e) => s + entryMinutes(e, now), 0),
    amount: round2(es.filter((e) => e.billable).reduce((s, e) => s + entryAmount(e, now), 0)),
  }
}

export interface ProjectRow { project: Project; summary: ProjectSummary }
export function projectBoard(state: DataState, now: number): ProjectRow[] {
  return listOf(state.projects ?? {}).map((project) => ({ project, summary: projectSummary(state, project, now) }))
    .sort((a, b) => (a.project.status === 'active' ? 0 : 1) - (b.project.status === 'active' ? 0 : 1) || b.project.createdAt - a.project.createdAt)
}

export function taskProblem(t: { title: string; estHours: number }): string | null {
  if (!t.title.trim()) return 'Give the task a title.'
  if (!(t.estHours >= 0)) return 'Estimated hours cannot be negative.'
  return null
}
