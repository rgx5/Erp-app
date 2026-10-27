import { saveBill } from '@/data/ops'
import { startOfDay } from '@/domain/dates'
import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import type { Bill, Payment } from '@/domain/types'
import { nextNo } from '../numbering'
import { serviceBillInput } from './logic/billing'
import { invoiceLines, runningTimer, taskProblem, unbilledEntries } from './logic/projects'
import { settingsOf } from './logic/settings'
import { ensureSpecialItem } from './ops-setup'
import { applyChanges, audit, branch, checkPayments, listOf, mergeChanges, need, OpError, type Changes, type DataState, type OpCtx } from './ops-shared'
import type { Project, ProjectBilling, ProjectStatus, ProjectTask, TaskStatus, TimeEntry } from './types'
import './replication'

// ───────────────────────────── projects ─────────────────────────────

export interface ProjectDraft {
  name: string; customerId: string | null; billing: ProjectBilling; hourlyRate: number; fixedAmount: number; budgetHours: number
  startDate?: number; dueDate?: number; notes: string; status?: ProjectStatus
}

export function saveProject(state: DataState, d: ProjectDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; project: Project } {
  const name = d.name.trim()
  if (!name) throw new OpError('Give the project a name.')
  if (d.customerId && !state.customers[d.customerId]) throw new OpError('That customer no longer exists.')
  if (!(d.hourlyRate >= 0)) throw new OpError('The hourly rate cannot be negative.')
  if (!(d.fixedAmount >= 0)) throw new OpError('The fixed fee cannot be negative.')
  if (d.billing === 'fixed' && !(d.fixedAmount > 0)) throw new OpError('Enter the agreed fee for a fixed-price project.')
  if (!(d.budgetHours >= 0)) throw new OpError('Budget hours cannot be negative.')
  if (d.startDate && d.dueDate && d.dueDate < d.startDate) throw new OpError('The due date is before the start date.')
  const cur = existingId ? need(state.projects?.[existingId], 'project') : undefined
  if (cur && d.billing !== cur.billing && Object.values(state.timeEntries ?? {}).some((e) => e.projectId === cur.id && e.billId)) throw new OpError('Time has been invoiced on this project, so how it is billed cannot change.')
  if (cur && d.billing === 'fixed' && d.fixedAmount < cur.fixedInvoiced) throw new OpError(`₹${cur.fixedInvoiced} has already been invoiced.`)
  const p: Project = {
    id: existingId ?? id('pr', ctx.now), no: cur?.no ?? nextNo('PR-', listOf(state.projects ?? {}).map((x) => x.no), ctx), name, customerId: d.customerId, status: d.status ?? cur?.status ?? 'active', billing: d.billing,
    hourlyRate: round2(d.hourlyRate || (d.billing === 'hourly' ? settingsOf(state).defaultHourlyRate : 0)), fixedAmount: d.billing === 'fixed' ? round2(d.fixedAmount) : 0,
    fixedInvoiced: cur?.fixedInvoiced ?? 0, budgetHours: d.budgetHours, notes: d.notes.trim(), createdAt: cur?.createdAt ?? ctx.now, ...(cur?.branchId ? { branchId: cur.branchId } : branch(ctx)),
    ...(d.startDate ? { startDate: d.startDate } : {}), ...(d.dueDate ? { dueDate: d.dueDate } : {}),
  }
  return { project: p, changes: { put: { projects: [p], audit: [audit(ctx, existingId ? 'PROJECT_EDIT' : 'PROJECT_ADD', `${p.no} ${name}`)] } } }
}

export function setProjectStatus(state: DataState, projectId: string, to: ProjectStatus, ctx: OpCtx): { changes: Changes; project: Project } {
  const cur = need(state.projects?.[projectId], 'project')
  if (to === 'completed' && Object.values(state.timeEntries ?? {}).some((e) => e.projectId === cur.id && e.runningSince)) throw new OpError('Stop the running timer first.')
  const p: Project = { ...cur, status: to }
  return { project: p, changes: { put: { projects: [p], audit: [audit(ctx, 'PROJECT_STATUS', `${cur.no} → ${to}`)] } } }
}

// ───────────────────────────── tasks ─────────────────────────────

export interface TaskDraft { title: string; assigneeId?: string; estHours: number; dueDate?: number; billable: boolean }

export function saveTask(state: DataState, projectId: string, d: TaskDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; task: ProjectTask } {
  need(state.projects?.[projectId], 'project')
  const why = taskProblem(d)
  if (why) throw new OpError(why)
  if (d.assigneeId && !state.users[d.assigneeId]) throw new OpError('That person no longer exists.')
  const cur = existingId ? need(state.projectTasks?.[existingId], 'task') : undefined
  const t: ProjectTask = {
    id: existingId ?? id('pt', ctx.now), projectId, title: d.title.trim(), status: cur?.status ?? 'todo', estHours: d.estHours, billable: d.billable, createdAt: cur?.createdAt ?? ctx.now,
    ...(d.assigneeId ? { assigneeId: d.assigneeId } : {}), ...(d.dueDate ? { dueDate: d.dueDate } : {}), ...(cur?.doneAt ? { doneAt: cur.doneAt } : {}),
  }
  return { task: t, changes: { put: { projectTasks: [t], audit: [audit(ctx, existingId ? 'TASK_EDIT' : 'TASK_ADD', `${state.projects[projectId].no}: ${t.title}`)] } } }
}

export function setTaskStatus(state: DataState, taskId: string, to: TaskStatus, ctx: OpCtx): { changes: Changes; task: ProjectTask } {
  const cur = need(state.projectTasks?.[taskId], 'task')
  const t: ProjectTask = { ...cur, status: to }
  if (to === 'done') t.doneAt = ctx.now; else delete t.doneAt
  return { task: t, changes: { put: { projectTasks: [t] } } }
}

export function deleteTask(state: DataState, taskId: string, ctx: OpCtx): { changes: Changes } {
  const t = need(state.projectTasks?.[taskId], 'task')
  if (Object.values(state.timeEntries ?? {}).some((e) => e.taskId === taskId)) throw new OpError('Time has been logged on this task. Mark it done instead of deleting it.')
  return { changes: { del: { projectTasks: [taskId] }, put: { audit: [audit(ctx, 'TASK_DELETE', t.title)] } } }
}

// ───────────────────────────── time ─────────────────────────────

export interface TimeDraft { projectId: string; taskId?: string; userId?: string; date: number; minutes: number; billable: boolean; note: string }

function checkTime(state: DataState, d: Pick<TimeDraft, 'projectId' | 'taskId'>): Project {
  const p = need(state.projects?.[d.projectId], 'project')
  if (p.status === 'completed' || p.status === 'cancelled') throw new OpError(`${p.name} is ${p.status === 'completed' ? 'completed' : 'cancelled'}; time cannot be added.`)
  if (d.taskId && state.projectTasks?.[d.taskId]?.projectId !== d.projectId) throw new OpError('That task is not on this project.')
  return p
}

/** Records time worked (hours and minutes typed in). */
export function logTime(state: DataState, d: TimeDraft, ctx: OpCtx): { changes: Changes; entry: TimeEntry } {
  const p = checkTime(state, d)
  if (!Number.isInteger(d.minutes) || d.minutes < 1 || d.minutes > 1440) throw new OpError('Enter between 1 minute and 24 hours.')
  const userId = d.userId ?? ctx.userId
  if (!state.users[userId]) throw new OpError('That person no longer exists.')
  const e: TimeEntry = {
    id: id('te', ctx.now), projectId: p.id, userId, date: startOfDay(d.date), minutes: d.minutes, billable: d.billable && p.billing === 'hourly', rate: p.hourlyRate, note: d.note.trim(), createdAt: ctx.now, ...branch(ctx),
    ...(d.taskId ? { taskId: d.taskId } : {}),
  }
  return { entry: e, changes: { put: { timeEntries: [e], audit: [audit(ctx, 'TIME_LOGGED', `${p.no}: ${d.minutes} min`)] } } }
}

/** Starts the clock on a project. One timer per person. */
export function startTimer(state: DataState, d: { projectId: string; taskId?: string; billable: boolean; note?: string }, ctx: OpCtx): { changes: Changes; entry: TimeEntry } {
  const p = checkTime(state, d)
  const running = runningTimer(state, ctx.userId)
  if (running) throw new OpError(`A timer is already running on ${state.projects?.[running.projectId]?.name ?? 'another project'}. Stop it first.`)
  const e: TimeEntry = {
    id: id('te', ctx.now), projectId: p.id, userId: ctx.userId, date: startOfDay(ctx.now), minutes: 0, billable: d.billable && p.billing === 'hourly', rate: p.hourlyRate, note: (d.note ?? '').trim(),
    runningSince: ctx.now, createdAt: ctx.now, ...branch(ctx), ...(d.taskId ? { taskId: d.taskId } : {}),
  }
  return { entry: e, changes: { put: { timeEntries: [e] } } }
}

/** Stops the clock; the minutes run are added to the entry (at least one). */
export function stopTimer(state: DataState, entryId: string, ctx: OpCtx): { changes: Changes; entry: TimeEntry } {
  const cur = need(state.timeEntries?.[entryId], 'timer')
  if (!cur.runningSince) throw new OpError('That timer is not running.')
  const elapsed = Math.max(1, Math.round((ctx.now - cur.runningSince) / 60_000))
  const e: TimeEntry = { ...cur, minutes: Math.min(1440, cur.minutes + elapsed) }
  delete e.runningSince
  return { entry: e, changes: { put: { timeEntries: [e], audit: [audit(ctx, 'TIMER_STOPPED', `${state.projects?.[cur.projectId]?.no ?? ''}: ${elapsed} min`)] } } }
}

export function editTime(state: DataState, entryId: string, d: Partial<Pick<TimeDraft, 'minutes' | 'billable' | 'note' | 'date' | 'taskId'>>, ctx: OpCtx): { changes: Changes; entry: TimeEntry } {
  const cur = need(state.timeEntries?.[entryId], 'time entry')
  if (cur.billId) throw new OpError('This time is on an invoice and cannot be changed.')
  if (cur.runningSince) throw new OpError('Stop the timer first.')
  const p = need(state.projects?.[cur.projectId], 'project')
  const minutes = d.minutes ?? cur.minutes
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new OpError('Enter between 1 minute and 24 hours.')
  const e: TimeEntry = { ...cur, minutes, billable: (d.billable ?? cur.billable) && p.billing === 'hourly', note: d.note !== undefined ? d.note.trim() : cur.note, date: d.date !== undefined ? startOfDay(d.date) : cur.date }
  if (d.taskId !== undefined) { if (d.taskId) e.taskId = d.taskId; else delete e.taskId }
  return { entry: e, changes: { put: { timeEntries: [e], audit: [audit(ctx, 'TIME_EDIT', `${p.no}: ${minutes} min`)] } } }
}

export function deleteTime(state: DataState, entryId: string, ctx: OpCtx): { changes: Changes } {
  const cur = need(state.timeEntries?.[entryId], 'time entry')
  if (cur.billId) throw new OpError('This time is on an invoice and cannot be deleted.')
  return { changes: { del: { timeEntries: [entryId] }, put: { audit: [audit(ctx, 'TIME_DELETE', `${cur.minutes} min`)] } } }
}

// ───────────────────────────── invoicing ─────────────────────────────

/** Invoices billable, unbilled hours on an hourly project (all of them, or the entries chosen) through the ordinary bill path. */
export function invoiceTimesheet(state: DataState, projectId: string, payments: Payment[], ctx: OpCtx, o: { entryIds?: string[] } = {}): { changes: Changes; bill: Bill; entries: TimeEntry[] } {
  const p = need(state.projects?.[projectId], 'project')
  if (p.billing !== 'hourly') throw new OpError('This is a fixed-price project. Invoice its fee instead of its hours.')
  if (!p.customerId) throw new OpError('Choose the customer on the project before invoicing it.')
  const pool = unbilledEntries(state, projectId)
  const entries = o.entryIds ? pool.filter((e) => o.entryIds!.includes(e.id)) : pool
  if (!entries.length) throw new OpError('There is no billable, unbilled time on this project.')
  const lines = invoiceLines(state, p, entries)
  if (lines.some((l) => !(l.rate > 0))) throw new OpError('Set an hourly rate on the project before invoicing it.')
  const item = ensureSpecialItem(state, 'hours', ctx)
  const s0 = applyChanges(state, item.changes)
  const input = serviceBillInput(s0, {
    lines: lines.map((l) => ({ variantId: item.variantId, name: `${l.name} (${l.hours} h)`, qty: l.hours, price: l.rate })), customerId: p.customerId, payments, userId: ctx.userId, now: ctx.now,
    notes: `Project ${p.no} — ${p.name}`, ext: { services: { projectId: p.id, timeEntryIds: entries.map((e) => e.id) } },
  })
  checkPayments(payments, input.total)
  const r = saveBill(s0, input, ctx)
  const marked = entries.map((e) => ({ ...e, billId: r.bill.id }))
  return { bill: r.bill, entries: marked, changes: mergeChanges(item.changes, r.changes, { put: { timeEntries: marked, audit: [audit(ctx, 'PROJECT_INVOICED', `${p.no} → ${r.bill.no} (${lines.reduce((s, l) => s + l.hours, 0)} h)`)] } }) }
}

/** Invoices part of the agreed fee of a fixed-price project (a milestone, an advance). */
export function invoiceFixedFee(state: DataState, projectId: string, amount: number, label: string, payments: Payment[], ctx: OpCtx): { changes: Changes; bill: Bill; project: Project } {
  const p = need(state.projects?.[projectId], 'project')
  if (p.billing !== 'fixed') throw new OpError('This project is billed by the hour.')
  if (!p.customerId) throw new OpError('Choose the customer on the project before invoicing it.')
  const amt = round2(amount)
  if (!(amt > 0)) throw new OpError('Enter the amount to invoice.')
  if (amt > round2(p.fixedAmount - p.fixedInvoiced) + 0.001) throw new OpError(`Only ₹${round2(p.fixedAmount - p.fixedInvoiced)} of the fee is left to invoice.`)
  const item = ensureSpecialItem(state, 'hours', ctx)
  const s0 = applyChanges(state, item.changes)
  const input = serviceBillInput(s0, {
    lines: [{ variantId: item.variantId, name: `${p.name}${label.trim() ? ` — ${label.trim()}` : ''}`, qty: 1, price: amt }], customerId: p.customerId, payments, userId: ctx.userId, now: ctx.now,
    notes: `Project ${p.no} — ${p.name}`, ext: { services: { projectId: p.id, fixedAmount: amt } },
  })
  checkPayments(payments, input.total)
  const r = saveBill(s0, input, ctx)
  const next: Project = { ...p, fixedInvoiced: round2(p.fixedInvoiced + amt) }
  return { bill: r.bill, project: next, changes: mergeChanges(item.changes, r.changes, { put: { projects: [next], audit: [audit(ctx, 'PROJECT_FEE_INVOICED', `${p.no} → ${r.bill.no} ₹${amt}`)] } }) }
}
