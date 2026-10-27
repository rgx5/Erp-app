import { saveBill } from '@/data/ops'
import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import type { Bill, Payment, StockMove } from '@/domain/types'
import { withEffects } from '@/replication/local'
import { nextNo } from '../numbering'
import { serviceBillInput, type ServiceBillLine } from './logic/billing'
import { canEditLines, canIssueParts, JOB_FLOW, JOB_LABEL, jobTotals, linesProblem, toIssue } from './logic/jobs'
import { ensureSpecialItem } from './ops-setup'
import { applyChanges, audit, branch, checkPayments, listOf, mergeChanges, need, OpError, type Changes, type DataState, type OpCtx } from './ops-shared'
import type { JobCard, JobKind, JobLine, JobStatus } from './types'
import './replication'

export interface JobDraft {
  customerId: string | null
  partyName: string
  partyPhone: string
  kind: JobKind
  title: string
  identifier: string
  reading: string
  accessories: string
  condition: string
  problem: string
  photos: string[]
  assignedTo?: string
  promisedAt?: number
  notes: string
}

/** Takes an item in for repair: who it belongs to, what it is, what is wrong with it, and photos of how it arrived. */
export function saveJobCard(state: DataState, d: JobDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; job: JobCard } {
  const customer = d.customerId ? state.customers[d.customerId] : undefined
  if (d.customerId && !customer) throw new OpError('That customer no longer exists.')
  const partyName = (customer?.name ?? d.partyName).trim()
  const partyPhone = (customer?.phone ?? d.partyPhone).trim()
  if (!partyName) throw new OpError('Say whose item this is.')
  if (!d.title.trim()) throw new OpError('Say what the item is (make and model).')
  if (!d.problem.trim()) throw new OpError('Write down what is wrong with it.')
  if (d.assignedTo && !state.users[d.assignedTo]) throw new OpError('That person no longer exists.')
  if (d.photos.length > 12) throw new OpError('Keep it to 12 photos.')
  const base = {
    customerId: d.customerId, partyName, partyPhone, kind: d.kind, title: d.title.trim(), identifier: d.identifier.trim(), reading: d.reading.trim(), accessories: d.accessories.trim(),
    condition: d.condition.trim(), problem: d.problem.trim(), photos: d.photos, notes: d.notes.trim(),
  }
  if (existingId) {
    const cur = need(state.jobCards?.[existingId], 'job card')
    if (cur.status === 'delivered' || cur.status === 'cancelled') throw new OpError(`${cur.no} is closed.`)
    const j: JobCard = { ...cur, ...base }
    if (d.assignedTo) j.assignedTo = d.assignedTo; else delete j.assignedTo
    if (d.promisedAt) j.promisedAt = d.promisedAt; else delete j.promisedAt
    return { job: j, changes: { put: { jobCards: [j], audit: [audit(ctx, 'JOB_EDIT', cur.no)] } } }
  }
  const j: JobCard = {
    id: id('jc', ctx.now), no: nextNo('JC-', listOf(state.jobCards ?? {}).map((x) => x.no), ctx), ...base, status: 'received', lines: [], receivedAt: ctx.now, createdBy: ctx.userId, ...branch(ctx),
    ...(d.assignedTo ? { assignedTo: d.assignedTo } : {}), ...(d.promisedAt ? { promisedAt: d.promisedAt } : {}),
  }
  return { job: j, changes: { put: { jobCards: [j], audit: [audit(ctx, 'JOB_RECEIVED', `${j.no} — ${j.partyName}, ${j.title}`)] } } }
}

/** The labour and parts lines of the estimate. More work after the customer approved needs a new approval. */
export function setJobLines(state: DataState, jobId: string, lines: JobLine[], ctx: OpCtx): { changes: Changes; job: JobCard } {
  const cur = need(state.jobCards?.[jobId], 'job card')
  if (!canEditLines(cur)) throw new OpError(`The lines of ${cur.no} cannot be changed now.`)
  const why = linesProblem(lines)
  if (why) throw new OpError(why)
  for (const l of lines) if (l.kind === 'part' && !state.variants[l.variantId as string]) throw new OpError(`${l.name} is no longer in stock records.`)
  // a part that has been taken from stock cannot be dropped or cut below what was issued: give it back first
  for (const old of cur.lines) {
    const now = lines.find((l) => l.id === old.id)
    if ((old.issued ?? 0) > 0 && (!now || now.qty < (old.issued ?? 0) - 0.0005)) throw new OpError(`${old.name}: give the parts back to stock before removing or reducing them.`)
  }
  const kept = lines.map((l) => {
    const issued = cur.lines.find((o) => o.id === l.id)?.issued ?? 0
    const n: JobLine = { ...l, name: l.name.trim() }
    if (issued > 0) n.issued = issued; else delete n.issued
    return n
  })
  const total = jobTotals({ lines: kept }).total
  let status: JobStatus = cur.status
  if (cur.status === 'received' && kept.length) status = 'received'
  let note = ''
  if ((cur.status === 'approved' || cur.status === 'in_work') && total > (cur.approvedTotal ?? 0) + 0.5) { status = 'estimated'; note = ' — needs approval again' }
  const j: JobCard = { ...cur, lines: kept, status }
  if (status === 'estimated' && cur.status !== 'estimated') { j.estimatedAt = ctx.now; delete j.approvedAt; delete j.approvedBy; delete j.approvedTotal }
  return { job: j, changes: { put: { jobCards: [j], audit: [audit(ctx, 'JOB_LINES', `${cur.no}: ${kept.length} line${kept.length === 1 ? '' : 's'}, ₹${total}${note}`)] } } }
}

export interface MoveJobOpts { approvedBy?: string; reason?: string; receivedBy?: string }

/** Moves a job along: estimate given → approved → in work → ready → delivered. */
export function setJobStatus(state: DataState, jobId: string, to: JobStatus, ctx: OpCtx, o: MoveJobOpts = {}): { changes: Changes; job: JobCard } {
  const cur = need(state.jobCards?.[jobId], 'job card')
  if (!JOB_FLOW[cur.status].includes(to)) throw new OpError(`A job that is “${JOB_LABEL[cur.status].toLowerCase()}” cannot become “${JOB_LABEL[to].toLowerCase()}”.`)
  const j: JobCard = { ...cur, status: to }
  const total = jobTotals(cur).total
  if (to === 'estimated') {
    if (!cur.lines.length) throw new OpError('Add the labour and parts first, then give the estimate.')
    j.estimatedAt = ctx.now
    delete j.rejectReason
  }
  if (to === 'approved') {
    if (!o.approvedBy?.trim()) throw new OpError('Say who approved the estimate and how (for example “Meera, by phone”).')
    j.approvedAt = ctx.now; j.approvedBy = o.approvedBy.trim(); j.approvedTotal = total
  }
  if (to === 'rejected') {
    if (!o.reason?.trim()) throw new OpError('Write down why the estimate was refused.')
    j.rejectReason = o.reason.trim()
  }
  if (to === 'in_work') j.startedAt = cur.startedAt ?? ctx.now
  if (to === 'ready') { j.readyAt = ctx.now; if (toIssue(cur).length) throw new OpError('Take the parts for this job from stock before it is marked ready.') }
  if (to === 'delivered') {
    if (cur.status === 'ready' && !cur.billId && total > 0) throw new OpError('Bill the job before handing it over.')
    j.deliveredAt = ctx.now
    if (o.receivedBy?.trim()) j.receivedBy = o.receivedBy.trim()
  }
  if (to === 'cancelled') {
    if (cur.lines.some((l) => (l.issued ?? 0) > 0)) throw new OpError('Give the parts back to stock before cancelling.')
  }
  if (to === 'estimated' || (to === 'in_work' && cur.status === 'ready')) { delete j.readyAt }
  if (to === 'estimated' && (cur.status === 'approved' || cur.status === 'in_work')) { delete j.approvedAt; delete j.approvedBy; delete j.approvedTotal }
  return { job: j, changes: { put: { jobCards: [j], audit: [audit(ctx, `JOB_${to.toUpperCase()}`, `${cur.no}${o.reason?.trim() ? ` — ${o.reason.trim()}` : ''}`)] } } }
}

const stockMove = (state: DataState, variantId: string, qty: number, job: JobCard, reason: string, ctx: OpCtx): StockMove => ({ id: id('mv', ctx.now), variantId, qty, type: 'adjust', ref: job.no, reason, at: ctx.now, userId: ctx.userId })

/** Takes a part for this job from stock (a stock movement on the ledger). */
export function issuePart(state: DataState, jobId: string, lineId: string, qty: number, ctx: OpCtx): { changes: Changes; job: JobCard } {
  const cur = need(state.jobCards?.[jobId], 'job card')
  if (!canIssueParts(cur)) throw new OpError('Parts can be taken once the customer has approved the estimate.')
  const line = need(cur.lines.find((l) => l.id === lineId && l.kind === 'part' && l.variantId), 'part')
  const q = round3(qty)
  if (!(q > 0)) throw new OpError('Enter how many.')
  if (q > round3(line.qty - (line.issued ?? 0)) + 0.0005) throw new OpError(`${line.name}: only ${round3(line.qty - (line.issued ?? 0))} more is needed for this job.`)
  const v = need(state.variants[line.variantId as string], 'item')
  if (round3(v.stock - q) < 0) throw new OpError(`Only ${v.stock} of ${line.name} in stock.`)
  const move = stockMove(state, v.id, -q, cur, `Used on ${cur.no}`, ctx)
  const j: JobCard = { ...cur, lines: cur.lines.map((l) => (l.id === lineId ? { ...l, issued: round3((l.issued ?? 0) + q) } : l)) }
  const base: Changes = { put: { moves: [move], jobCards: [j], audit: [audit(ctx, 'JOB_PART_ISSUED', `${cur.no}: ${q} × ${line.name}`)] } }
  return { job: j, changes: withEffects(state, base, ['moves'], ctx.now) }
}

/** Puts a part back on the shelf (not used after all). */
export function returnPart(state: DataState, jobId: string, lineId: string, qty: number, ctx: OpCtx): { changes: Changes; job: JobCard } {
  const cur = need(state.jobCards?.[jobId], 'job card')
  if (cur.status === 'delivered' || cur.status === 'cancelled' || cur.billId) throw new OpError(`${cur.no} is closed.`)
  const line = need(cur.lines.find((l) => l.id === lineId && l.kind === 'part' && l.variantId), 'part')
  const q = round3(qty)
  if (!(q > 0)) throw new OpError('Enter how many.')
  if (q > (line.issued ?? 0) + 0.0005) throw new OpError(`${line.name}: only ${line.issued ?? 0} was taken for this job.`)
  const move = stockMove(state, line.variantId as string, q, cur, `Returned from ${cur.no}`, ctx)
  const issued = round3((line.issued ?? 0) - q)
  const j: JobCard = { ...cur, lines: cur.lines.map((l) => { if (l.id !== lineId) return l; const n: JobLine = { ...l, issued }; if (!issued) delete n.issued; return n }) }
  const base: Changes = { put: { moves: [move], jobCards: [j], audit: [audit(ctx, 'JOB_PART_RETURNED', `${cur.no}: ${q} × ${line.name}`)] } }
  return { job: j, changes: withEffects(state, base, ['moves'], ctx.now) }
}

/**
 * Bills a finished job (through the ordinary bill path: GST, numbering, loyalty) and hands it over. Parts already taken from stock for
 * the job are put back on the shelf in the same step and the bill takes them out again, so each leaves stock exactly once.
 */
export function billJobCard(state: DataState, jobId: string, payments: Payment[], ctx: OpCtx, o: { receivedBy?: string } = {}): { changes: Changes; job: JobCard; bill: Bill } {
  const cur = need(state.jobCards?.[jobId], 'job card')
  if (cur.billId) throw new OpError(`${cur.no} has already been billed.`)
  if (cur.status !== 'ready') throw new OpError('Bill a job when it is ready.')
  if (!cur.lines.length) throw new OpError('There is nothing to bill on this job.')
  const labourItem = cur.lines.some((l) => l.kind === 'labour') ? ensureSpecialItem(state, 'labour', ctx) : null
  let s = state
  let acc: Changes = {}
  const add = (c: Changes) => { acc = mergeChanges(acc, c); s = applyChanges(s, c) }
  if (labourItem) add(labourItem.changes)
  // Put back what the job took; the bill takes the whole quantity itself.
  for (const l of cur.lines) {
    if (l.kind !== 'part' || !(l.issued ?? 0)) continue
    const back = stockMove(s, l.variantId as string, l.issued as number, cur, `Billed on invoice (${cur.no})`, ctx)
    add(withEffects(s, { put: { moves: [back] } }, ['moves'], ctx.now))
  }
  for (const l of cur.lines) {
    if (l.kind !== 'part') continue
    const v = s.variants[l.variantId as string]
    if (!v) throw new OpError(`${l.name} is no longer in stock records.`)
    if (s.products[v.productId]?.trackStock !== false && round3(v.stock - l.qty) < 0) throw new OpError(`Only ${v.stock} of ${l.name} in stock — it is needed for the bill.`)
  }
  const lines: ServiceBillLine[] = cur.lines.map((l) => ({ variantId: l.kind === 'labour' ? (labourItem as { variantId: string }).variantId : (l.variantId as string), name: l.name, qty: l.qty, price: l.price }))
  const input = serviceBillInput(s, { lines, customerId: cur.customerId, payments, userId: ctx.userId, now: ctx.now, notes: `Job card ${cur.no} — ${cur.title}`, ext: { services: { jobCardId: cur.id } } })
  checkPayments(payments, input.total)
  const r = saveBill(s, input, ctx)
  const j: JobCard = { ...cur, billId: r.bill.id, status: 'delivered', deliveredAt: ctx.now, ...(o.receivedBy?.trim() ? { receivedBy: o.receivedBy.trim() } : {}) }
  add(r.changes)
  add({ put: { jobCards: [j], audit: [audit(ctx, 'JOB_BILLED', `${cur.no} → ${r.bill.no}`)] } })
  return { job: j, bill: r.bill, changes: acc }
}

