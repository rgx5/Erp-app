import { saveBill } from '@/data/ops'
import { listOf } from '@/data/state'
import { serviceBillInput } from '../logic/billing'
import { entryMinutes, invoiceLines, projectSummary, runningTimer, timesheet, unbilledEntries } from '../logic/projects'
import { deleteTask, deleteTime, editTime, invoiceFixedFee, invoiceTimesheet, logTime, saveProject, saveTask, setProjectStatus, setTaskStatus, startTimer, stopTimer } from '../ops'
import { cctx, ctx, DAY, NOW, run, shopState, TODAY } from './helpers'

const pdraft = (over = {}) => ({ name: 'Website', customerId: 'c1' as string | null, billing: 'hourly' as const, hourlyRate: 1000, fixedAmount: 0, budgetHours: 10, notes: '', ...over })

function project() {
  let s = shopState()
  const p = run(s, saveProject(s, pdraft(), undefined, ctx()))
  s = p.state
  const t = run(s, saveTask(s, p.result.project.id, { title: 'Design', estHours: 4, billable: true }, undefined, ctx()))
  return { s: t.state, pid: p.result.project.id, tid: t.result.task.id }
}

describe('projects and tasks', () => {
  test('a project is numbered and keeps its terms; tasks move along', () => {
    const { s, pid, tid } = project()
    expect(s.projects[pid]).toMatchObject({ no: 'PR-0001', status: 'active', billing: 'hourly', hourlyRate: 1000, fixedInvoiced: 0 })
    const d = run(s, setTaskStatus(s, tid, 'done', ctx()))
    expect(d.state.projectTasks[tid]).toMatchObject({ status: 'done', doneAt: NOW })
    expect(run(d.state, setTaskStatus(d.state, tid, 'todo', ctx())).state.projectTasks[tid].doneAt).toBeUndefined()
    expect(() => saveProject(s, pdraft({ name: ' ' }), undefined, ctx())).toThrow('name')
    expect(() => saveProject(s, pdraft({ billing: 'fixed', fixedAmount: 0 }), undefined, ctx())).toThrow('agreed fee')
    expect(() => saveTask(s, pid, { title: '', estHours: 1, billable: true }, undefined, ctx())).toThrow('title')
  })

  test('a task with time on it cannot be deleted', () => {
    const { s, pid, tid } = project()
    const l = run(s, logTime(s, { projectId: pid, taskId: tid, date: TODAY, minutes: 60, billable: true, note: '' }, ctx()))
    expect(() => deleteTask(l.state, tid, ctx())).toThrow('Time has been logged')
    expect(deleteTask(s, tid, ctx()).changes.del).toEqual({ projectTasks: [tid] })
  })
})

describe('time', () => {
  test('logged time keeps the rate of the day; a later rate change does not rewrite it', () => {
    let { s, pid } = project()
    s = run(s, logTime(s, { projectId: pid, date: TODAY, minutes: 90, billable: true, note: 'Wireframes' }, ctx())).state
    s = run(s, saveProject(s, pdraft({ hourlyRate: 1500 }), pid, ctx())).state
    s = run(s, logTime(s, { projectId: pid, date: TODAY, minutes: 60, billable: true, note: '' }, ctx())).state
    expect(listOf(s.timeEntries).map((e) => e.rate).sort()).toEqual([1000, 1500])
    const sum = projectSummary(s, s.projects[pid], NOW)
    expect(sum).toMatchObject({ hours: 2.5, unbilledHours: 2.5, unbilledAmount: 3000, budgetPct: 25 })
  })

  test('refusals: too little or too much time, a task of another project, a finished project', () => {
    const { s, pid } = project()
    expect(() => logTime(s, { projectId: pid, date: TODAY, minutes: 0, billable: true, note: '' }, ctx())).toThrow('1 minute and 24 hours')
    expect(() => logTime(s, { projectId: pid, date: TODAY, minutes: 1441, billable: true, note: '' }, ctx())).toThrow('24 hours')
    expect(() => logTime(s, { projectId: pid, taskId: 'zzz', date: TODAY, minutes: 10, billable: true, note: '' }, ctx())).toThrow('not on this project')
    const done = run(s, setProjectStatus(s, pid, 'completed', ctx())).state
    expect(() => logTime(done, { projectId: pid, date: TODAY, minutes: 10, billable: true, note: '' }, ctx())).toThrow('completed')
  })

  test('the timer adds the minutes run; one timer per person', () => {
    let { s, pid } = project()
    const t = run(s, startTimer(s, { projectId: pid, billable: true }, ctx({ now: NOW })))
    s = t.state
    expect(runningTimer(s, 'u_owner')?.id).toBe(t.result.entry.id)
    expect(() => startTimer(s, { projectId: pid, billable: true }, ctx())).toThrow('already running')
    expect(() => setProjectStatus(s, pid, 'completed', ctx())).toThrow('running timer')
    expect(entryMinutes(s.timeEntries[t.result.entry.id], NOW + 25 * 60_000)).toBe(25)
    expect(unbilledEntries(s, pid)).toHaveLength(0) // still running
    const stopped = run(s, stopTimer(s, t.result.entry.id, ctx({ now: NOW + 47 * 60_000 })))
    expect(stopped.result.entry).toMatchObject({ minutes: 47 })
    expect(stopped.result.entry.runningSince).toBeUndefined()
    expect(() => stopTimer(stopped.state, t.result.entry.id, ctx())).toThrow('not running')
    // a different person has their own
    expect(() => startTimer(s, { projectId: pid, billable: true }, cctx())).not.toThrow()
    // even an instant stop is a minute
    const quick = run(stopped.state, startTimer(stopped.state, { projectId: pid, billable: false }, ctx({ now: NOW + 3_600_000 })))
    expect(stopTimer(quick.state, quick.result.entry.id, ctx({ now: NOW + 3_600_000 + 5000 })).entry.minutes).toBe(1)
  })

  test('edit and delete work until the time is invoiced', () => {
    let { s, pid } = project()
    const l = run(s, logTime(s, { projectId: pid, date: TODAY, minutes: 60, billable: true, note: '' }, ctx()))
    s = l.state
    s = run(s, editTime(s, l.result.entry.id, { minutes: 120, note: 'Longer' }, ctx())).state
    expect(s.timeEntries[l.result.entry.id]).toMatchObject({ minutes: 120, note: 'Longer' })
    const inv = run(s, invoiceTimesheet(s, pid, [{ mode: 'cash', amount: 2360 }], ctx()))
    expect(() => editTime(inv.state, l.result.entry.id, { minutes: 5 }, ctx())).toThrow('on an invoice')
    expect(() => deleteTime(inv.state, l.result.entry.id, ctx())).toThrow('on an invoice')
    expect(deleteTime(s, l.result.entry.id, ctx()).changes.del).toEqual({ timeEntries: [l.result.entry.id] })
  })
})

describe('timesheet invoice', () => {
  test('billable unbilled hours become an invoice by task and rate; non-billable stays out', () => {
    let { s, pid, tid } = project()
    s = run(s, logTime(s, { projectId: pid, taskId: tid, date: TODAY, minutes: 90, billable: true, note: '' }, ctx())).state
    s = run(s, logTime(s, { projectId: pid, taskId: tid, date: TODAY - DAY, minutes: 30, billable: true, note: '' }, ctx())).state
    s = run(s, logTime(s, { projectId: pid, date: TODAY, minutes: 60, billable: true, note: '' }, ctx())).state
    s = run(s, logTime(s, { projectId: pid, date: TODAY, minutes: 45, billable: false, note: 'Internal' }, ctx())).state
    const lines = invoiceLines(s, s.projects[pid], unbilledEntries(s, pid))
    expect(lines.map((l) => [l.name, l.hours, l.amount])).toEqual([['Website — Design', 2, 2000], ['Website', 1, 1000]])
    const r = run(s, invoiceTimesheet(s, pid, [{ mode: 'upi', amount: 3000 }], ctx()))
    const bill = r.result.bill
    expect(bill.customerId).toBe('c1')
    expect(bill.total).toBe(3000) // rates are GST-inclusive, like every price in the shop
    expect(bill.taxableTotal).toBeCloseTo(3000 / 1.18, 1)
    expect(bill.items.map((i) => i.qty)).toEqual([2, 1])
    expect(r.result.entries).toHaveLength(3)
    expect(listOf(r.state.timeEntries).filter((e) => e.billId === bill.id)).toHaveLength(3)
    expect(listOf(r.state.timeEntries).filter((e) => !e.billId)).toHaveLength(1)
    expect(r.state.variants['var_svc_hours']).toBeTruthy()
    expect(() => invoiceTimesheet(r.state, pid, [{ mode: 'cash', amount: 10 }], ctx())).toThrow('no billable')
  })

  test('it needs a customer, hourly billing and a rate', () => {
    let { s, pid } = project()
    s = run(s, logTime(s, { projectId: pid, date: TODAY, minutes: 60, billable: true, note: '' }, ctx())).state
    const noCust = run(s, saveProject(s, pdraft({ customerId: null }), pid, ctx())).state
    expect(() => invoiceTimesheet(noCust, pid, [{ mode: 'cash', amount: 1000 }], ctx())).toThrow('customer')
    expect(() => invoiceTimesheet(s, pid, [{ mode: 'cash', amount: 100 }], ctx())).toThrow('less than the bill')
  })

  test('the same hours cannot be invoiced twice, even by a bill that names them', () => {
    let { s, pid } = project()
    const l = run(s, logTime(s, { projectId: pid, date: TODAY, minutes: 60, billable: true, note: '' }, ctx()))
    s = l.state
    const r = run(s, invoiceTimesheet(s, pid, [{ mode: 'cash', amount: 1000 }], ctx()))
    const again = serviceBillInput(r.state, { lines: [{ variantId: 'var_svc_hours', name: 'Hours', qty: 1, price: 1000 }], customerId: 'c1', payments: [{ mode: 'cash', amount: 1000 }], userId: 'u_owner', now: NOW, ext: { services: { projectId: pid, timeEntryIds: [l.result.entry.id] } } })
    expect(() => saveBill(r.state, again, ctx())).toThrow('already been invoiced')
  })
})

describe('fixed-price projects', () => {
  test('milestones are invoiced up to the agreed fee', () => {
    let s = shopState()
    const p = run(s, saveProject(s, pdraft({ billing: 'fixed', fixedAmount: 10000, hourlyRate: 0 }), undefined, ctx()))
    s = p.state
    const pid = p.result.project.id
    expect(() => invoiceTimesheet(s, pid, [{ mode: 'cash', amount: 1 }], ctx())).toThrow('fixed-price')
    const a = run(s, invoiceFixedFee(s, pid, 4000, 'Advance', [{ mode: 'cash', amount: 4000 }], ctx()))
    expect(a.result.bill.total).toBe(4000)
    expect(a.result.bill.items[0].name).toBe('Website — Advance')
    expect(a.state.projects[pid].fixedInvoiced).toBe(4000)
    expect(projectSummary(a.state, a.state.projects[pid], NOW).fixedLeft).toBe(6000)
    expect(() => invoiceFixedFee(a.state, pid, 6001, '', [{ mode: 'cash', amount: 6001 }], ctx())).toThrow('Only ₹6000')
    const b = run(a.state, invoiceFixedFee(a.state, pid, 6000, 'Final', [{ mode: 'cash', amount: 6000 }], ctx()))
    expect(b.state.projects[pid].fixedInvoiced).toBe(10000)
    expect(() => saveProject(b.state, pdraft({ billing: 'fixed', fixedAmount: 5000 }), pid, ctx())).toThrow('already been invoiced')
  })

  test('hours on a fixed project are tracked but never billable', () => {
    let s = shopState()
    const p = run(s, saveProject(s, pdraft({ billing: 'fixed', fixedAmount: 10000 }), undefined, ctx()))
    const l = run(p.state, logTime(p.state, { projectId: p.result.project.id, date: TODAY, minutes: 60, billable: true, note: '' }, ctx()))
    expect(l.result.entry.billable).toBe(false)
    expect(timesheet(l.state, 'u_owner', TODAY, TODAY, NOW)).toMatchObject({ minutes: 60, billableMinutes: 0 })
  })
})
