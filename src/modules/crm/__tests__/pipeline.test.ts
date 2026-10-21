import { OpError } from '@/data/ops'
import { endOfDay, startOfDay } from '@/domain/dates'
import { customerWithPhone, followUpState, leadsToFollowUp, pipelineSummary, stagesFrom } from '../leads'
import { addNote, completeTask, convertLead, deleteLead, deleteNote, deleteTask, moveLead, postponeTask, saveLead, saveTask, setFollowUp } from '../ops'
import { notesFor, openTasks, taskCounts, taskState, tasksFor } from '../tasks'
import { commit, ctx, DAY, NOW, shop } from './helpers'

const draft = (over: Record<string, unknown> = {}) => ({ name: 'Kavita', phone: '9000000001', source: 'Instagram', value: 20_000, ...over })

describe('leads', () => {
  test('a new lead is numbered per phone series and starts as new', () => {
    const s = shop()
    const a = saveLead(s, draft(), undefined, ctx())
    expect(a.lead).toMatchObject({ no: 'LD-0001', stage: 'new', value: 20_000, source: 'Instagram' })
    const s2 = commit(s, a)
    expect(saveLead(s2, draft({ name: 'B' }), undefined, ctx()).lead.no).toBe('LD-0002')
    expect(saveLead(s2, draft(), undefined, ctx({ series: 'M4X' })).lead.no).toBe('LD-M4X-0001')
  })

  test('refusals: no name, no way to reach them, bad phone or email, negative value', () => {
    const s = shop()
    expect(() => saveLead(s, draft({ name: ' ' }), undefined, ctx())).toThrow('name')
    expect(() => saveLead(s, draft({ phone: '', email: '' }), undefined, ctx())).toThrow('reach')
    expect(() => saveLead(s, draft({ phone: '123' }), undefined, ctx())).toThrow('10-digit')
    expect(() => saveLead(s, draft({ email: 'nope' }), undefined, ctx())).toThrow('email')
    expect(() => saveLead(s, draft({ value: -5 }), undefined, ctx())).toThrow('negative')
    expect(saveLead(s, draft({ phone: '', email: 'k@x.in' }), undefined, ctx()).lead.email).toBe('k@x.in')
  })

  test('moving through stages leaves a log; losing needs a reason; won is only by converting', () => {
    let s = commit(shop(), saveLead(shop(), draft(), undefined, ctx()))
    const id = Object.keys(s.crmLeads)[0]
    s = commit(s, moveLead(s, id, 'contacted', ctx({ now: NOW + 1 })))
    s = commit(s, moveLead(s, id, 'qualified', ctx({ now: NOW + 2 })))
    expect(s.crmLeads[id].stage).toBe('qualified')
    expect(notesFor(s, { leadId: id }).map((n) => n.text)).toEqual(['Moved to Qualified', 'Moved to Contacted'])
    expect(() => moveLead(s, id, 'won', ctx())).toThrow('Convert')
    expect(() => moveLead(s, id, 'lost', ctx())).toThrow('why')
    expect(() => moveLead(s, id, 'qualified', ctx())).toThrow(OpError)
    s = commit(s, moveLead(s, id, 'lost', ctx({ now: NOW + 3 }), 'Too expensive'))
    expect(s.crmLeads[id]).toMatchObject({ stage: 'lost', lostReason: 'Too expensive', closedAt: NOW + 3 })
    expect(stagesFrom(s.crmLeads[id])).toEqual(['new'])
    s = commit(s, moveLead(s, id, 'new', ctx({ now: NOW + 4 })))
    expect(s.crmLeads[id].lostReason).toBeUndefined()
    expect(s.crmLeads[id].closedAt).toBeUndefined()
  })

  test('converting makes a customer, carries the lead, and cannot be done twice', () => {
    let s = commit(shop(), saveLead(shop(), draft({ notes: 'wants sarees' }), undefined, ctx()))
    const id = Object.keys(s.crmLeads)[0]
    const r = convertLead(s, id, ctx({ now: NOW + 1 }))
    expect(r.existed).toBe(false)
    expect(r.customer).toMatchObject({ name: 'Kavita', phone: '9000000001', notes: 'wants sarees', loyaltyPoints: 0, storeCredit: 0 })
    s = commit(s, r)
    expect(s.customers[r.customer.id]).toBeDefined()
    expect(s.crmLeads[id]).toMatchObject({ stage: 'won', customerId: r.customer.id })
    expect(notesFor(s, { customerId: r.customer.id })[0].text).toMatch('Became a customer')
    expect(() => convertLead(s, id, ctx())).toThrow('already')
    expect(() => saveLead(s, draft(), id, ctx())).toThrow('closed')
  })

  test('a lead whose number is already a customer is linked, not duplicated', () => {
    let s = commit(shop(), saveLead(shop(), draft({ name: 'Meera again', phone: '98765 43210' }), undefined, ctx()))
    const id = Object.keys(s.crmLeads)[0]
    expect(customerWithPhone(s, '+91 98765 43210')).toBe('c1')
    const r = convertLead(s, id, ctx())
    expect(r.existed).toBe(true)
    expect(r.customer.id).toBe('c1')
    s = commit(s, r)
    expect(Object.keys(s.customers)).toHaveLength(4)
    expect(s.crmLeads[id].customerId).toBe('c1')
  })

  test('a lead with only an email cannot become a customer until it has a number', () => {
    const s = commit(shop(), saveLead(shop(), draft({ phone: '', email: 'a@b.in' }), undefined, ctx()))
    expect(() => convertLead(s, Object.keys(s.crmLeads)[0], ctx())).toThrow('10-digit')
  })

  test('follow-ups: overdue, today and later; closed leads have none', () => {
    let s = shop()
    const mk = (name: string, days: number) => {
      const r = saveLead(s, draft({ name, phone: '', email: `${name}@x.in`, nextFollowUp: NOW + days * DAY }), undefined, ctx({ now: NOW + Object.keys(s.crmLeads).length }))
      s = commit(s, r)
      return r.lead
    }
    const late = mk('late', -2)
    const today = mk('today', 0)
    const later = mk('later', 3)
    expect(followUpState(late, NOW)).toBe('overdue')
    expect(followUpState(today, NOW)).toBe('today')
    expect(followUpState(later, NOW)).toBe('later')
    expect(leadsToFollowUp(s, NOW).map((l) => l.name)).toEqual(['late', 'today'])
    s = commit(s, setFollowUp(s, later.id, NOW - 3 * DAY, ctx()))
    expect(leadsToFollowUp(s, NOW).map((l) => l.name)).toEqual(['later', 'late', 'today'])
    s = commit(s, setFollowUp(s, later.id, null, ctx()))
    expect(s.crmLeads[later.id].nextFollowUp).toBeUndefined()
    s = commit(s, moveLead(s, late.id, 'lost', ctx(), 'gone'))
    expect(followUpState(s.crmLeads[late.id], NOW)).toBe('none')
    expect(() => setFollowUp(s, late.id, NOW, ctx())).toThrow('closed')
  })

  test('the pipeline adds up by stage, weighs open value, and gives a win rate', () => {
    let s = shop()
    const add = (name: string, value: number, stage?: 'contacted' | 'proposal' | 'lost') => {
      const r = saveLead(s, draft({ name, value }), undefined, ctx({ now: NOW + Object.keys(s.crmLeads).length }))
      s = commit(s, r)
      if (stage) s = commit(s, moveLead(s, r.lead.id, stage, ctx(), 'no budget'))
      return r.lead
    }
    add('a', 1000)
    add('b', 2000, 'contacted')
    add('c', 4000, 'proposal')
    add('d', 500, 'lost')
    const won = add('e', 3000)
    s = commit(s, convertLead(s, won.id, ctx()))
    const p = pipelineSummary(s, NOW)
    expect(p.byStage.new).toEqual({ count: 1, value: 1000 })
    expect(p.open).toEqual({ count: 3, value: 7000 })
    expect(p.weighted).toBe(1000 * 0.1 + 2000 * 0.25 + 4000 * 0.75)
    expect(p.won).toEqual({ count: 1, value: 3000 })
    expect(p.lost).toBe(1)
    expect(p.winRatePct).toBe(50)
    expect(pipelineSummary({ crmLeads: {} }, NOW).winRatePct).toBeNull()
  })

  test('deleting a lead', () => {
    let s = commit(shop(), saveLead(shop(), draft(), undefined, ctx()))
    const id = Object.keys(s.crmLeads)[0]
    s = commit(s, deleteLead(s, id, ctx()))
    expect(s.crmLeads[id]).toBeUndefined()
    expect(() => deleteLead(s, id, ctx())).toThrow('no longer')
  })
})

describe('tasks and notes', () => {
  test('a task can be about a customer; the target must exist', () => {
    let s = shop()
    const t = saveTask(s, { title: ' Call about the saree ', kind: 'call', due: NOW + DAY, customerId: 'c1' }, undefined, ctx())
    s = commit(s, t)
    expect(t.task).toMatchObject({ title: 'Call about the saree', kind: 'call', done: false, customerId: 'c1' })
    expect(tasksFor(s, { customerId: 'c1' })).toHaveLength(1)
    expect(tasksFor(s, { customerId: 'c2' })).toHaveLength(0)
    expect(() => saveTask(s, { title: 'x', customerId: 'zz' }, undefined, ctx())).toThrow('customer')
    expect(() => saveTask(s, { title: 'x', leadId: 'zz' }, undefined, ctx())).toThrow('lead')
    expect(() => saveTask(s, { title: ' ' }, undefined, ctx())).toThrow('what needs')
  })

  test('states: overdue, today, upcoming, someday, done — and the order to do them in', () => {
    let s = shop()
    const mk = (title: string, due?: number) => { const r = saveTask(s, { title, ...(due !== undefined ? { due } : {}) }, undefined, ctx({ now: NOW + Object.keys(s.crmTasks).length })); s = commit(s, r); return r.task }
    const none = mk('none')
    const up = mk('up', NOW + 3 * DAY)
    const old = mk('old', startOfDay(NOW) - 1)
    const now = mk('now', endOfDay(NOW))
    expect(taskState(old, NOW)).toBe('overdue')
    expect(taskState(now, NOW)).toBe('today')
    expect(taskState(up, NOW)).toBe('upcoming')
    expect(taskState(none, NOW)).toBe('someday')
    expect(openTasks(s).map((t) => t.title)).toEqual(['old', 'now', 'up', 'none'])
    s = commit(s, completeTask(s, old.id, true, ctx({ now: NOW + 9 })))
    expect(s.crmTasks[old.id]).toMatchObject({ done: true, doneAt: NOW + 9 })
    expect(taskState(s.crmTasks[old.id], NOW)).toBe('done')
    expect(taskCounts(s, NOW)).toEqual({ overdue: 0, today: 1, upcoming: 1, someday: 1, done: 1 })
    s = commit(s, completeTask(s, old.id, false, ctx()))
    expect(s.crmTasks[old.id].doneAt).toBeUndefined()
    s = commit(s, postponeTask(s, old.id, NOW + 5 * DAY))
    expect(taskState(s.crmTasks[old.id], NOW)).toBe('upcoming')
    s = commit(s, deleteTask(s, old.id))
    expect(s.crmTasks[old.id]).toBeUndefined()
  })

  test('editing keeps who made it and whether it is done', () => {
    let s = shop()
    const a = saveTask(s, { title: 'a' }, undefined, ctx({ userId: 'u_cash' }))
    s = commit(s, a)
    s = commit(s, completeTask(s, a.task.id, true, ctx({ now: NOW + 1 })))
    const e = saveTask(s, { title: 'b', due: NOW }, a.task.id, ctx({ userId: 'u_owner', now: NOW + 2 }))
    expect(e.task).toMatchObject({ title: 'b', userId: 'u_cash', done: true, doneAt: NOW + 1, createdAt: NOW })
  })

  test('notes go to the log of a customer, newest first', () => {
    let s = shop()
    s = commit(s, addNote(s, { text: 'Prefers silk', customerId: 'c1' }, ctx({ now: NOW + 1 })))
    s = commit(s, addNote(s, { text: 'Called, no answer', kind: 'call', customerId: 'c1' }, ctx({ now: NOW + 2 })))
    expect(notesFor(s, { customerId: 'c1' }).map((n) => `${n.kind}:${n.text}`)).toEqual(['call:Called, no answer', 'note:Prefers silk'])
    expect(() => addNote(s, { text: ' ', customerId: 'c1' }, ctx())).toThrow('Write')
    expect(() => addNote(s, { text: 'x' }, ctx())).toThrow('who')
    const id = notesFor(s, { customerId: 'c1' })[0].id
    s = commit(s, deleteNote(s, id))
    expect(notesFor(s, { customerId: 'c1' })).toHaveLength(1)
    expect(() => deleteNote(s, id)).toThrow('no longer')
  })
})
