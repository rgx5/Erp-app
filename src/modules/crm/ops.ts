import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import type { Customer } from '@/domain/types'
import { audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, mergeChanges, type Changes, type DataState } from '@/data/state'
import { withEffects } from '@/replication/local'
import { nextNo } from '../numbering'
import { buildAudience, campaignProgress, sendsOf, unknownFields } from './campaigns'
import { isLowScore } from './feedback'
import { customerWithPhone, isOpenLead, stagesFrom, STAGE_LABEL } from './leads'
import { customerByCode, makeReferralCode, normalizeCode, rewardIdFor } from './referrals'
import { resolveAudience, segmentProblem } from './segments'
import { DEFAULT_SETTINGS, settingsOf } from './settings'
import { statsByCustomer, statsOf } from './stats'
import { canMove, slaDueFor, STATUS_LABEL, warrantyCover } from './tickets'
import type {
  Campaign, CampaignSend, Channel, CrmNote, CrmSettings, CrmTask, CustomerSegment, Feedback, InvoiceLink, Lead, LeadStage, NoteKind, ReferralReward,
  SegmentRule, SendStatus, TaskKind, Ticket, TicketKind, TicketPriority, TicketStatus, WarrantyOutcome,
} from './types'
import './replication'

const EMAIL = /^\S+@\S+\.\S+$/
const PHONE = /^\d{10}$/
const clean = (s: string | undefined) => (s ?? '').trim()
const branch = (ctx: OpCtx) => (ctx.branchId ? { branchId: ctx.branchId } : {})
const needCustomer = (state: DataState, customerId: string): Customer => {
  const c = state.customers[customerId]
  if (!c) throw new OpError('That customer no longer exists.')
  return c
}
const checkPhone = (digits: string) => { if (digits && (digits.length < 10 || digits.length > 13)) throw new OpError('Enter a valid 10-digit mobile number.') }

// ───────────────────────────── segments and customer groups ─────────────────────────────

export interface SegmentDraft { name: string; match: 'all' | 'any'; rules: SegmentRule[]; note?: string }

export function saveSegment(state: DataState, d: SegmentDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; segment: CustomerSegment } {
  const problem = segmentProblem(d.name, d.rules)
  if (problem) throw new OpError(problem)
  const name = d.name.trim()
  if (listOf(state.crmSegments ?? {}).some((s) => s.id !== existingId && s.name.toLowerCase() === name.toLowerCase())) throw new OpError('You already have a segment with this name.')
  const cur = existingId ? state.crmSegments?.[existingId] : undefined
  if (existingId && !cur) throw new OpError('That segment no longer exists.')
  const segment: CustomerSegment = { id: cur?.id ?? id('seg', ctx.now), name, match: d.match, rules: d.rules, note: clean(d.note), createdAt: cur?.createdAt ?? ctx.now, updatedAt: ctx.now, userId: cur?.userId ?? ctx.userId }
  return { segment, changes: { put: { crmSegments: [segment], audit: [audit(ctx, 'SEGMENT_SAVE', `${name} — ${d.rules.length} rule${d.rules.length === 1 ? '' : 's'}`)] } } }
}

export function deleteSegment(state: DataState, segmentId: string, ctx: OpCtx): { changes: Changes } {
  const seg = state.crmSegments?.[segmentId]
  if (!seg) throw new OpError('That segment no longer exists.')
  return { changes: { del: { crmSegments: [segmentId] }, put: { audit: [audit(ctx, 'SEGMENT_DELETE', seg.name)] } } }
}

/** The groups a customer belongs to. Case does not matter, repeats are dropped. */
export function setCustomerTags(state: DataState, customerId: string, tags: string[], ctx: OpCtx): { changes: Changes; customer: Customer } {
  const c = needCustomer(state, customerId)
  const seen = new Set<string>()
  const next: string[] = []
  for (const raw of tags) {
    const t = raw.trim().replace(/\s+/g, ' ')
    if (!t || seen.has(t.toLowerCase())) continue
    if (t.length > 24) throw new OpError('A group name can be at most 24 letters.')
    seen.add(t.toLowerCase())
    next.push(t)
  }
  if (next.length > 12) throw new OpError('A customer can be in at most 12 groups.')
  const { tags: _old, ...rest } = c
  void _old
  const customer: Customer = next.length ? { ...rest, tags: next } : rest
  return { customer, changes: { put: { customers: [customer], audit: [audit(ctx, 'CUSTOMER_GROUPS', `${c.name}: ${next.join(', ') || 'none'}`)] } } }
}

/** Marks a customer as not wanting promotional messages (or wanting them again). Campaigns leave them out. */
export function setMarketingOptOut(state: DataState, customerId: string, optOut: boolean, ctx: OpCtx): { changes: Changes; customer: Customer } {
  const c = needCustomer(state, customerId)
  const { optOutMarketing: _old, ...rest } = c
  void _old
  const customer: Customer = optOut ? { ...rest, optOutMarketing: true } : rest
  return { customer, changes: { put: { customers: [customer], audit: [audit(ctx, 'CUSTOMER_OPTOUT', `${c.name}: ${optOut ? 'no promotional messages' : 'messages allowed'}`)] } } }
}

// ───────────────────────────── notes and tasks ─────────────────────────────

export interface NoteDraft { kind?: NoteKind; text: string; customerId?: string; leadId?: string; ticketId?: string; at?: number }

function checkTarget(state: DataState, t: { customerId?: string; leadId?: string; ticketId?: string }) {
  if (t.customerId) needCustomer(state, t.customerId)
  if (t.leadId && !state.crmLeads?.[t.leadId]) throw new OpError('That lead no longer exists.')
  if (t.ticketId && !state.crmTickets?.[t.ticketId]) throw new OpError('That ticket no longer exists.')
}
const targetOf = (t: { customerId?: string; leadId?: string; ticketId?: string }) => ({
  ...(t.customerId ? { customerId: t.customerId } : {}), ...(t.leadId ? { leadId: t.leadId } : {}), ...(t.ticketId ? { ticketId: t.ticketId } : {}),
})

export function addNote(state: DataState, d: NoteDraft, ctx: OpCtx): { changes: Changes; note: CrmNote } {
  const text = clean(d.text)
  if (!text) throw new OpError('Write the note first.')
  if (!d.customerId && !d.leadId && !d.ticketId) throw new OpError('Say who the note is about.')
  checkTarget(state, d)
  const note: CrmNote = { id: id('nt', ctx.now), kind: d.kind ?? 'note', text, at: d.at ?? ctx.now, userId: ctx.userId, ...targetOf(d) }
  return { note, changes: { put: { crmNotes: [note] } } }
}

export function deleteNote(state: DataState, noteId: string): { changes: Changes } {
  if (!state.crmNotes?.[noteId]) throw new OpError('That note no longer exists.')
  return { changes: { del: { crmNotes: [noteId] } } }
}

export interface TaskDraft { title: string; kind?: TaskKind; due?: number; notes?: string; customerId?: string; leadId?: string; ticketId?: string; assignedTo?: string }

export function saveTask(state: DataState, d: TaskDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; task: CrmTask } {
  const title = clean(d.title)
  if (!title) throw new OpError('Say what needs to be done.')
  checkTarget(state, d)
  const cur = existingId ? state.crmTasks?.[existingId] : undefined
  if (existingId && !cur) throw new OpError('That task no longer exists.')
  const { doneAt: _d, ...base } = cur ?? ({} as Partial<CrmTask>)
  void _d
  const task: CrmTask = {
    ...base, id: cur?.id ?? id('tk', ctx.now), title, kind: d.kind ?? cur?.kind ?? 'task', done: cur?.done ?? false, notes: clean(d.notes), createdAt: cur?.createdAt ?? ctx.now, userId: cur?.userId ?? ctx.userId,
    ...(d.due !== undefined ? { due: d.due } : {}), ...(cur?.doneAt ? { doneAt: cur.doneAt } : {}), ...targetOf(d), ...(d.assignedTo ? { assignedTo: d.assignedTo } : {}),
  }
  return { task, changes: { put: { crmTasks: [task] } } }
}

export function completeTask(state: DataState, taskId: string, done: boolean, ctx: OpCtx): { changes: Changes; task: CrmTask } {
  const cur = state.crmTasks?.[taskId]
  if (!cur) throw new OpError('That task no longer exists.')
  const { doneAt: _d, ...rest } = cur
  void _d
  const task: CrmTask = done ? { ...rest, done: true, doneAt: ctx.now } : { ...rest, done: false }
  return { task, changes: { put: { crmTasks: [task] } } }
}

/** Pushes a task to another day. */
export function postponeTask(state: DataState, taskId: string, due: number): { changes: Changes; task: CrmTask } {
  const cur = state.crmTasks?.[taskId]
  if (!cur) throw new OpError('That task no longer exists.')
  const task: CrmTask = { ...cur, due }
  return { task, changes: { put: { crmTasks: [task] } } }
}

export function deleteTask(state: DataState, taskId: string): { changes: Changes } {
  if (!state.crmTasks?.[taskId]) throw new OpError('That task no longer exists.')
  return { changes: { del: { crmTasks: [taskId] } } }
}

// ───────────────────────────── leads ─────────────────────────────

export interface LeadDraft { name: string; phone: string; email?: string; source?: string; value?: number; nextFollowUp?: number; notes?: string; assignedTo?: string }

export function saveLead(state: DataState, d: LeadDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; lead: Lead } {
  const name = clean(d.name)
  if (!name) throw new OpError("Enter the lead's name.")
  const phone = clean(d.phone).replace(/\D/g, '')
  checkPhone(phone)
  if (!phone && !clean(d.email)) throw new OpError('Add a mobile number or an email so you can reach them.')
  if (clean(d.email) && !EMAIL.test(clean(d.email))) throw new OpError("That email address doesn't look right.")
  const value = round2(d.value ?? 0)
  if (!(value >= 0)) throw new OpError('The value cannot be negative.')
  const cur = existingId ? state.crmLeads?.[existingId] : undefined
  if (existingId && !cur) throw new OpError('That lead no longer exists.')
  if (cur && !isOpenLead(cur)) throw new OpError('A closed lead cannot be edited. Reopen it first.')
  const { nextFollowUp: _f, assignedTo: _a, ...base } = cur ?? ({} as Partial<Lead>)
  void _f; void _a
  const lead: Lead = {
    ...base, id: cur?.id ?? id('ld', ctx.now), no: cur?.no ?? nextNo('LD-', listOf(state.crmLeads ?? {}).map((l) => l.no), ctx), name, phone, email: clean(d.email), source: clean(d.source),
    stage: cur?.stage ?? 'new', value, notes: clean(d.notes), createdAt: cur?.createdAt ?? ctx.now, updatedAt: ctx.now, userId: cur?.userId ?? ctx.userId,
    ...(d.nextFollowUp !== undefined ? { nextFollowUp: d.nextFollowUp } : {}), ...(d.assignedTo ? { assignedTo: d.assignedTo } : {}), ...(cur ? {} : branch(ctx)),
  }
  return { lead, changes: { put: { crmLeads: [lead], ...(cur ? {} : { audit: [audit(ctx, 'LEAD_NEW', `${lead.no} ${name}`)] }) } } }
}

/** Moves a lead along the pipeline. Losing one needs a reason; winning is done by converting it to a customer. */
export function moveLead(state: DataState, leadId: string, stage: LeadStage, ctx: OpCtx, lostReason = ''): { changes: Changes; lead: Lead } {
  const cur = state.crmLeads?.[leadId]
  if (!cur) throw new OpError('That lead no longer exists.')
  if (stage === 'won') throw new OpError('Convert the lead to a customer to mark it won.')
  if (!stagesFrom(cur).includes(stage)) throw new OpError(`A lead that is ${STAGE_LABEL[cur.stage].toLowerCase()} cannot move to ${STAGE_LABEL[stage].toLowerCase()}.`)
  const { lostReason: _r, closedAt: _c, ...rest } = cur
  void _r; void _c
  if (stage === 'lost' && !clean(lostReason)) throw new OpError('Say why the lead was lost.')
  const lead: Lead = stage === 'lost'
    ? { ...rest, stage, updatedAt: ctx.now, closedAt: ctx.now, lostReason: clean(lostReason) }
    : { ...rest, stage, updatedAt: ctx.now }
  const note: CrmNote = { id: id('nt', ctx.now), kind: 'status', text: stage === 'lost' ? `Marked lost: ${clean(lostReason)}` : `Moved to ${STAGE_LABEL[stage]}`, at: ctx.now, userId: ctx.userId, leadId }
  return { lead, changes: { put: { crmLeads: [lead], crmNotes: [note] } } }
}

/** Sets or clears the date to follow up. */
export function setFollowUp(state: DataState, leadId: string, date: number | null, ctx: OpCtx): { changes: Changes; lead: Lead } {
  const cur = state.crmLeads?.[leadId]
  if (!cur) throw new OpError('That lead no longer exists.')
  if (!isOpenLead(cur)) throw new OpError('This lead is closed.')
  const { nextFollowUp: _f, ...rest } = cur
  void _f
  const lead: Lead = date === null ? { ...rest, updatedAt: ctx.now } : { ...rest, nextFollowUp: date, updatedAt: ctx.now }
  return { lead, changes: { put: { crmLeads: [lead] } } }
}

/**
 * Turns a lead into a customer and marks it won. A lead whose number is already a customer is linked to that customer instead of
 * making a second one. The lead's notes follow to the customer's record.
 */
export function convertLead(state: DataState, leadId: string, ctx: OpCtx): { changes: Changes; lead: Lead; customer: Customer; existed: boolean } {
  const cur = state.crmLeads?.[leadId]
  if (!cur) throw new OpError('That lead no longer exists.')
  if (cur.stage === 'won') throw new OpError('This lead is already a customer.')
  const phone = cur.phone.replace(/\D/g, '').slice(-10)
  const existingId = customerWithPhone(state, phone)
  if (!existingId && !PHONE.test(phone)) throw new OpError('Add a 10-digit mobile number to the lead before making it a customer.')
  const existed = !!existingId
  const customer: Customer = existingId
    ? state.customers[existingId]
    : { id: id('cus', ctx.now), name: cur.name, phone, email: cur.email, dob: '', anniversary: '', address: '', gstin: '', loyaltyPoints: 0, storeCredit: 0, createdAt: ctx.now, notes: cur.notes }
  const { nextFollowUp: _f, ...rest } = cur
  void _f
  const lead: Lead = { ...rest, stage: 'won', customerId: customer.id, updatedAt: ctx.now, closedAt: ctx.now }
  const note: CrmNote = { id: id('nt', ctx.now), kind: 'status', text: `Became a customer (${lead.no})`, at: ctx.now, userId: ctx.userId, customerId: customer.id }
  const base: Changes = { put: { crmLeads: [lead], crmNotes: [note], audit: [audit(ctx, 'LEAD_WON', `${lead.no} ${lead.name}${existed ? ' (already a customer)' : ' → new customer'}`)], ...(existed ? {} : { customers: [customer] }) } }
  return { lead, customer, existed, changes: base }
}

export function deleteLead(state: DataState, leadId: string, ctx: OpCtx): { changes: Changes } {
  const cur = state.crmLeads?.[leadId]
  if (!cur) throw new OpError('That lead no longer exists.')
  return { changes: { del: { crmLeads: [leadId] }, put: { audit: [audit(ctx, 'LEAD_DELETE', `${cur.no} ${cur.name}`)] } } }
}

// ───────────────────────────── campaigns ─────────────────────────────

export interface CampaignDraft { name: string; channel: Channel; template: string; audience: string }

/** Builds a campaign: one finished message per customer with a number who has not opted out. Nothing is sent. */
export function createCampaign(state: DataState, d: CampaignDraft, ctx: OpCtx): { changes: Changes; campaign: Campaign; sends: CampaignSend[]; skipped: { noPhone: number; optedOut: number } } {
  const name = clean(d.name)
  if (!name) throw new OpError('Give the campaign a name.')
  const template = d.template.trim()
  if (!template) throw new OpError('Write the message first.')
  const bad = unknownFields(template)
  if (bad.length) throw new OpError(`The message uses {{${bad[0]}}}, which is not a field the app knows.`)
  if (d.channel !== 'whatsapp' && d.channel !== 'sms') throw new OpError('Choose WhatsApp or SMS.')
  const aud = resolveAudience(state, d.audience)
  if (!aud) throw new OpError('That segment no longer exists.')
  const built = buildAudience(state, d.audience, template, d.channel, ctx.now)
  if (!built || !built.recipients.length) throw new OpError('No one in this segment can be messaged: they have no valid mobile number, or have opted out.')
  const campaign: Campaign = {
    id: id('cp', ctx.now), no: nextNo('CP-', listOf(state.crmCampaigns ?? {}).map((c) => c.no), ctx), name, channel: d.channel, template, audience: d.audience, audienceName: aud.name,
    count: built.recipients.length, createdAt: ctx.now, userId: ctx.userId,
  }
  const sends: CampaignSend[] = built.recipients.map((r, i) => ({
    id: `snd_${campaign.id}_${r.customer.id}`, campaignId: campaign.id, customerId: r.customer.id, name: r.customer.name, phone: r.customer.phone, text: r.text, order: i, status: 'pending', createdAt: ctx.now,
  }))
  return {
    campaign, sends, skipped: { noPhone: built.noPhone.length, optedOut: built.optedOut.length },
    changes: { put: { crmCampaigns: [campaign], crmSends: sends, audit: [audit(ctx, 'CAMPAIGN_NEW', `${campaign.no} ${name} — ${sends.length} messages (${d.channel})`)] } },
  }
}

/** Records that a message was sent (or skipped), writes it to the customer's communication log, and closes the campaign with the last one. */
export function markSend(state: DataState, sendId: string, status: SendStatus, ctx: OpCtx): { changes: Changes; send: CampaignSend } {
  const cur = state.crmSends?.[sendId]
  if (!cur) throw new OpError('That message is no longer in the campaign.')
  const campaign = state.crmCampaigns?.[cur.campaignId]
  if (!campaign) throw new OpError('That campaign no longer exists.')
  const { at: _a, userId: _u, ...rest } = cur
  void _a; void _u
  const send: CampaignSend = status === 'pending' ? { ...rest, status } : { ...rest, status, at: ctx.now, userId: ctx.userId }
  const put: NonNullable<Changes['put']> = { crmSends: [send] }
  const logId = `nt_${sendId}`
  if (status === 'sent' && state.customers[cur.customerId]) {
    put.crmNotes = [{ id: logId, kind: campaign.channel, text: `Campaign “${campaign.name}”: ${cur.text}`, at: ctx.now, userId: ctx.userId, customerId: cur.customerId }]
  }
  const changes: Changes = { put }
  if (status !== 'sent' && state.crmNotes?.[logId]) changes.del = { crmNotes: [logId] }
  const all = sendsOf(state, campaign.id).map((s) => (s.id === sendId ? send : s))
  const progress = campaignProgress(all)
  const { closedAt: _c, ...campRest } = campaign
  void _c
  if (progress.done && !campaign.closedAt) put.crmCampaigns = [{ ...campaign, closedAt: ctx.now }]
  else if (!progress.done && campaign.closedAt) put.crmCampaigns = [campRest as Campaign]
  return { send, changes }
}

export function deleteCampaign(state: DataState, campaignId: string, ctx: OpCtx): { changes: Changes } {
  const c = state.crmCampaigns?.[campaignId]
  if (!c) throw new OpError('That campaign no longer exists.')
  return { changes: { del: { crmCampaigns: [campaignId], crmSends: sendsOf(state, campaignId).map((s) => s.id) }, put: { audit: [audit(ctx, 'CAMPAIGN_DELETE', `${c.no} ${c.name}`)] } } }
}

// ───────────────────────────── tickets ─────────────────────────────

export interface TicketDraft {
  kind: TicketKind
  subject: string
  description?: string
  priority?: TicketPriority
  customerId?: string
  partyName?: string
  partyPhone?: string
  billId?: string
  itemName?: string
  serial?: string
  assignedTo?: string
}

/** Opens a complaint, an after-sales request or a warranty claim and works out when it is due. */
export function saveTicket(state: DataState, d: TicketDraft, ctx: OpCtx): { changes: Changes; ticket: Ticket } {
  const subject = clean(d.subject)
  if (!subject) throw new OpError('Say what the problem is.')
  const customer = d.customerId ? needCustomer(state, d.customerId) : undefined
  const bill = d.billId ? state.bills[d.billId] : undefined
  if (d.billId && !bill) throw new OpError('That bill no longer exists.')
  if (bill && customer && bill.customerId && bill.customerId !== customer.id) throw new OpError('That bill belongs to another customer.')
  if (d.kind === 'warranty' && !bill && !clean(d.itemName)) throw new OpError('Pick the bill or type the product the warranty claim is for.')
  const partyName = clean(d.partyName) || customer?.name || ''
  if (!partyName) throw new OpError('Choose the customer, or type their name.')
  const cfg = settingsOf(state)
  const priority = d.priority ?? 'normal'
  const ticket: Ticket = {
    id: id('tkt', ctx.now), no: nextNo('TK-', listOf(state.crmTickets ?? {}).map((t) => t.no), ctx), kind: d.kind, status: 'open', priority, partyName, partyPhone: clean(d.partyPhone) || customer?.phone || '',
    subject, description: clean(d.description), resolution: '', openedAt: ctx.now, slaDue: slaDueFor(priority, ctx.now, cfg), updatedAt: ctx.now, userId: ctx.userId,
    ...(customer ? { customerId: customer.id } : {}), ...(bill ? { billId: bill.id } : {}), ...(clean(d.itemName) ? { itemName: clean(d.itemName) } : {}), ...(clean(d.serial) ? { serial: clean(d.serial) } : {}),
    ...(d.assignedTo ? { assignedTo: d.assignedTo } : {}), ...branch(ctx),
  }
  const notes: CrmNote[] = []
  if (d.kind === 'warranty' && bill) {
    const cover = warrantyCover(bill.date, cfg.warrantyMonths, ctx.now)
    if (!cover.covered) notes.push({ id: id('nt', ctx.now), kind: 'status', text: `The bill ${bill.no} is outside the ${cfg.warrantyMonths}-month warranty`, at: ctx.now, userId: ctx.userId, ticketId: ticket.id })
  }
  return { ticket, changes: { put: { crmTickets: [ticket], ...(notes.length ? { crmNotes: notes } : {}), audit: [audit(ctx, 'TICKET_NEW', `${ticket.no} ${ticket.kind}: ${subject}`)] } } }
}

export interface TicketMove { note?: string; resolution?: string; outcome?: WarrantyOutcome }

/** Moves a ticket along its flow. Resolving needs a resolution (and an outcome for a warranty claim); reopening restarts the clock. */
export function moveTicket(state: DataState, ticketId: string, to: TicketStatus, m: TicketMove, ctx: OpCtx): { changes: Changes; ticket: Ticket } {
  const cur = state.crmTickets?.[ticketId]
  if (!cur) throw new OpError('That ticket no longer exists.')
  if (!canMove(cur.status, to)) throw new OpError(`A ticket that is ${STATUS_LABEL[cur.status].toLowerCase()} cannot go to ${STATUS_LABEL[to].toLowerCase()}.`)
  const { resolvedAt: _r, closedAt: _c, outcome: _o, ...rest } = cur
  void _r; void _c; void _o
  let ticket: Ticket
  if (to === 'resolved') {
    const resolution = clean(m.resolution) || cur.resolution
    if (!resolution) throw new OpError('Write how it was resolved.')
    const outcome = m.outcome ?? cur.outcome
    if (cur.kind === 'warranty' && !outcome) throw new OpError('Choose the outcome of the claim: repair, replace, refund or rejected.')
    ticket = { ...rest, status: to, resolution, resolvedAt: ctx.now, updatedAt: ctx.now, ...(outcome ? { outcome } : {}) }
  } else if (to === 'closed') {
    ticket = { ...rest, status: to, resolvedAt: cur.resolvedAt ?? ctx.now, closedAt: ctx.now, updatedAt: ctx.now, ...(cur.outcome ? { outcome: cur.outcome } : {}) }
  } else if (to === 'open') {
    ticket = { ...rest, status: to, slaDue: cur.status === 'resolved' || cur.status === 'closed' ? slaDueFor(cur.priority, ctx.now, settingsOf(state)) : cur.slaDue, updatedAt: ctx.now }
  } else {
    ticket = { ...rest, status: to, updatedAt: ctx.now, ...(cur.outcome ? { outcome: cur.outcome } : {}) }
  }
  const text = `${STATUS_LABEL[to]}${clean(m.note) ? `: ${clean(m.note)}` : to === 'resolved' ? `: ${ticket.resolution}` : ''}`
  const note: CrmNote = { id: id('nt', ctx.now), kind: 'status', text, at: ctx.now, userId: ctx.userId, ticketId, ...(cur.customerId ? { customerId: cur.customerId } : {}) }
  return { ticket, changes: { put: { crmTickets: [ticket], crmNotes: [note], audit: [audit(ctx, 'TICKET_MOVE', `${cur.no} → ${STATUS_LABEL[to]}`)] } } }
}

/** Changes the priority; an open ticket's due time is worked out again from when it was opened. */
export function setTicketPriority(state: DataState, ticketId: string, priority: TicketPriority, ctx: OpCtx): { changes: Changes; ticket: Ticket } {
  const cur = state.crmTickets?.[ticketId]
  if (!cur) throw new OpError('That ticket no longer exists.')
  if (cur.status === 'resolved' || cur.status === 'closed') throw new OpError('This ticket is already settled.')
  const ticket: Ticket = { ...cur, priority, slaDue: slaDueFor(priority, cur.openedAt, settingsOf(state)), updatedAt: ctx.now }
  return { ticket, changes: { put: { crmTickets: [ticket], audit: [audit(ctx, 'TICKET_PRIORITY', `${cur.no} → ${priority}`)] } } }
}

export function assignTicket(state: DataState, ticketId: string, userId: string | null, ctx: OpCtx): { changes: Changes; ticket: Ticket } {
  const cur = state.crmTickets?.[ticketId]
  if (!cur) throw new OpError('That ticket no longer exists.')
  if (userId && !state.users[userId]) throw new OpError('That person is not on the team.')
  const { assignedTo: _a, ...rest } = cur
  void _a
  const ticket: Ticket = userId ? { ...rest, assignedTo: userId, updatedAt: ctx.now } : { ...rest, updatedAt: ctx.now }
  return { ticket, changes: { put: { crmTickets: [ticket] } } }
}

// ───────────────────────────── feedback ─────────────────────────────

export interface FeedbackDraft {
  customerId?: string
  billId?: string
  rating?: number
  nps?: number
  comment?: string
  source?: Feedback['source']
  /** Open a complaint when the score is low. */
  openTicket?: boolean
}

/** Records a rating (1–5) and/or a recommend score (0–10). A low score can open a complaint in the same step. */
export function captureFeedback(state: DataState, d: FeedbackDraft, ctx: OpCtx): { changes: Changes; feedback: Feedback; ticket?: Ticket } {
  const hasRating = d.rating !== undefined
  const hasNps = d.nps !== undefined
  if (!hasRating && !hasNps) throw new OpError('Pick a rating first.')
  if (hasRating && !(Number.isInteger(d.rating) && (d.rating as number) >= 1 && (d.rating as number) <= 5)) throw new OpError('A rating is from 1 to 5 stars.')
  if (hasNps && !(Number.isInteger(d.nps) && (d.nps as number) >= 0 && (d.nps as number) <= 10)) throw new OpError('The score is from 0 to 10.')
  const bill = d.billId ? state.bills[d.billId] : undefined
  if (d.billId && !bill) throw new OpError('That bill no longer exists.')
  if (d.billId && listOf(state.crmFeedback ?? {}).some((f) => f.billId === d.billId)) throw new OpError('Feedback for this bill is already recorded.')
  const customerId = d.customerId ?? bill?.customerId ?? undefined
  if (customerId) needCustomer(state, customerId)
  const feedback: Feedback = {
    id: id('fb', ctx.now), comment: clean(d.comment), at: ctx.now, source: d.source ?? 'counter', userId: ctx.userId,
    ...(customerId ? { customerId } : {}), ...(d.billId ? { billId: d.billId } : {}), ...(hasRating ? { rating: d.rating } : {}), ...(hasNps ? { nps: d.nps } : {}), ...branch(ctx),
  }
  let ticket: Ticket | undefined
  let opened: Changes = {}
  if (d.openTicket && isLowScore(feedback)) {
    const subject = `Unhappy after purchase${bill ? ` (${bill.no})` : ''}`
    const t = saveTicket(state, { kind: 'complaint', subject, description: feedback.comment || `Rated ${feedback.rating ?? feedback.nps}`, priority: 'high', ...(customerId ? { customerId } : { partyName: 'Customer' }), ...(d.billId ? { billId: d.billId } : {}) }, ctx)
    ticket = t.ticket
    feedback.ticketId = ticket.id
    opened = t.changes
  }
  return { feedback, ...(ticket ? { ticket } : {}), changes: mergeChanges({ put: { crmFeedback: [feedback] } }, opened) }
}

// ───────────────────────────── referrals ─────────────────────────────

/** Gives a customer a referral code to hand to friends (keeps the one they have). */
export function ensureReferralCode(state: DataState, customerId: string, ctx: OpCtx, rnd?: () => number): { changes: Changes; customer: Customer; code: string } {
  const c = needCustomer(state, customerId)
  if (c.referralCode) return { customer: c, code: c.referralCode, changes: {} }
  const taken = new Set(listOf(state.customers).map((x) => normalizeCode(x.referralCode ?? '')).filter(Boolean))
  const code = makeReferralCode(c.name, taken, rnd)
  const customer: Customer = { ...c, referralCode: code }
  return { customer, code, changes: { put: { customers: [customer], audit: [audit(ctx, 'REFERRAL_CODE', `${c.name}: ${code}`)] } } }
}

/** A new customer quotes a friend's code. Only a customer who has not bought yet can be referred, and not by themselves. */
export function applyReferral(state: DataState, customerId: string, code: string, ctx: OpCtx): { changes: Changes; customer: Customer; referrer: Customer } {
  const c = needCustomer(state, customerId)
  if (c.referredBy) throw new OpError(`${c.name} has already been referred by someone.`)
  const referrer = customerByCode(state, code)
  if (!referrer) throw new OpError('That referral code does not match any customer.')
  if (referrer.id === c.id) throw new OpError('A customer cannot refer themselves.')
  if (statsOf(statsByCustomer(state), c.id).orders > 0) throw new OpError('A referral code can only be used by someone who has not bought yet.')
  const customer: Customer = { ...c, referredBy: referrer.id }
  return { customer, referrer, changes: { put: { customers: [customer], audit: [audit(ctx, 'REFERRAL_APPLY', `${c.name} referred by ${referrer.name}`)] } } }
}

/**
 * Gives the referral reward: store credit and points to the referrer and credit to the new customer, once. The reward's number is
 * built from the referred customer's, so two phones rewarding the same referral at the same time cannot pay it twice.
 */
export function rewardReferral(state: DataState, referredId: string, ctx: OpCtx): { changes: Changes; reward: ReferralReward } {
  const referred = needCustomer(state, referredId)
  const referrer = referred.referredBy ? state.customers[referred.referredBy] : undefined
  if (!referrer) throw new OpError(`${referred.name} was not referred by a customer.`)
  if (state.referralRewards?.[rewardIdFor(referredId)]) throw new OpError('This referral has already been rewarded.')
  const cfg = settingsOf(state)
  const spend = round2(statsOf(statsByCustomer(state), referredId).spend)
  if (!(spend > 0) || spend < cfg.referralMinBill) throw new OpError(`${referred.name} must buy for at least ₹${cfg.referralMinBill} first (so far ₹${spend}).`)
  if (!(cfg.referrerCredit > 0 || cfg.referrerPoints > 0 || cfg.refereeCredit > 0)) throw new OpError('No reward is set. Set the amounts in the CRM settings.')
  const reward: ReferralReward = {
    id: rewardIdFor(referredId), referrerId: referrer.id, referredId, referrerCredit: cfg.referrerCredit, referrerPoints: cfg.referrerPoints, refereeCredit: cfg.refereeCredit,
    date: ctx.now, note: `${referred.name} referred by ${referrer.name}`, userId: ctx.userId, ...branch(ctx),
  }
  const base: Changes = { put: { referralRewards: [reward], audit: [audit(ctx, 'REFERRAL_REWARD', `${referrer.name} +₹${reward.referrerCredit}/${reward.referrerPoints} pts, ${referred.name} +₹${reward.refereeCredit}`)] } }
  return { reward, changes: withEffects(state, base, ['referralRewards'], ctx.now) }
}

// ───────────────────────────── invoice links ─────────────────────────────

/** Remembers the link the server made for a bill, so it is made once and the same link is sent every time. */
export function saveInvoiceLink(state: DataState, billId: string, link: { token: string; url: string }, ctx: OpCtx): { changes: Changes; link: InvoiceLink } {
  if (!state.bills[billId]) throw new OpError('That bill no longer exists.')
  if (!link.token || !link.url) throw new OpError('The link is incomplete.')
  const cur = state.invoiceLinks?.[billId]
  const out: InvoiceLink = { id: billId, billId, token: link.token, url: link.url, createdAt: cur?.createdAt ?? ctx.now, userId: cur?.userId ?? ctx.userId, ...(cur?.sentAt ? { sentAt: cur.sentAt } : {}) }
  return { link: out, changes: { put: { invoiceLinks: [out], audit: [audit(ctx, 'INVOICE_LINK', `${state.bills[billId].no}`)] } } }
}

export function markLinkSent(state: DataState, billId: string, ctx: OpCtx): { changes: Changes; link: InvoiceLink } {
  const cur = state.invoiceLinks?.[billId]
  if (!cur) throw new OpError('There is no link for this bill yet.')
  const link: InvoiceLink = { ...cur, sentAt: ctx.now }
  return { link, changes: { put: { invoiceLinks: [link] } } }
}

// ───────────────────────────── settings ─────────────────────────────

export function saveCrmSettings(state: DataState, patch: Partial<Omit<CrmSettings, 'id'>>, ctx: OpCtx): { changes: Changes; settings: CrmSettings } {
  const next: CrmSettings = { ...settingsOf(state), ...patch, id: 'crm' }
  for (const k of ['high', 'normal', 'low'] as const) {
    if (!(next.slaHours[k] > 0) || next.slaHours[k] > 24 * 90) throw new OpError('Hours to settle a ticket must be between 1 and 2160.')
  }
  if (!Number.isInteger(next.warrantyMonths) || next.warrantyMonths < 0 || next.warrantyMonths > 120) throw new OpError('Warranty months must be a whole number from 0 to 120.')
  if (!Number.isInteger(next.tierWindowDays) || next.tierWindowDays < 30 || next.tierWindowDays > 1825) throw new OpError('Tier spend window must be between 30 and 1825 days.')
  for (const k of ['referrerCredit', 'referrerPoints', 'refereeCredit', 'referralMinBill'] as const) if (!(next[k] >= 0)) throw new OpError('Reward amounts cannot be negative.')
  const names = new Set<string>()
  for (const t of next.tiers) {
    if (!t.name.trim()) throw new OpError('Every tier needs a name.')
    if (names.has(t.name.trim().toLowerCase())) throw new OpError(`Two tiers are called ${t.name.trim()}.`)
    if (!(t.minSpend >= 0)) throw new OpError('Tier spend cannot be negative.')
    names.add(t.name.trim().toLowerCase())
  }
  if (!next.tiers.length) next.tiers = DEFAULT_SETTINGS.tiers
  next.tiers = next.tiers.map((t) => ({ name: t.name.trim(), minSpend: round2(t.minSpend), perk: clean(t.perk) })).sort((a, b) => a.minSpend - b.minSpend)
  return { settings: next, changes: { put: { crmSettings: [next], audit: [audit(ctx, 'CRM_SETTINGS', Object.keys(patch).join(', '))] } } }
}
