import { OpError } from '@/data/ops'
import { applyChanges, mergeChanges, type Changes, type DataState } from '@/data/state'
import { round2 } from '@/domain/money'
import type { Bill } from '@/domain/types'
import type { BillHook, BillHookCtx } from '@/modules/registry'
import { bestPackage, customerBalance } from './logic/packages'
import { usePackageSession } from './ops-packages'
import type { Appointment, JobCard, Project, TimeEntry } from './types'
import './replication'

/** The key this module's data lives under in `bill.ext`. */
export const EXT = 'services'

/** What a bill made by this module says about where it came from. */
export interface ServicesLink {
  appointmentId?: string
  jobCardId?: string
  projectId?: string
  timeEntryIds?: string[]
  fixedAmount?: number
}
export const linkOf = (b: Pick<Bill, 'ext'>): ServicesLink => ((b.ext?.[EXT] as ServicesLink | undefined) ?? {})
export const packagePayments = (b: Pick<Bill, 'payments'>) => b.payments.filter((p) => p.mode === 'package').length

/** Variants a bill's lines are for, to find a package that covers them. */
const variantsOf = (b: Pick<Bill, 'items'>) => [...new Set(b.items.map((i) => i.variantId))]

/** Refuses a bill that cannot honour what it says: a booking or repair already billed, hours already invoiced, a package with nothing left. */
export function beforeSave({ state, ctx, bill }: BillHookCtx): void {
  const link = linkOf(bill)
  if (link.appointmentId) {
    const a = state.appointments?.[link.appointmentId]
    if (!a) throw new OpError('The appointment for this bill no longer exists.')
    if (a.billId || a.packageUseId) throw new OpError(`${a.no} has already been paid for.`)
    if (a.status === 'cancelled' || a.status === 'no_show') throw new OpError(`${a.no} was ${a.status === 'cancelled' ? 'cancelled' : 'missed'}.`)
  }
  if (link.jobCardId) {
    const j = state.jobCards?.[link.jobCardId]
    if (!j) throw new OpError('The job card for this bill no longer exists.')
    if (j.billId) throw new OpError(`${j.no} has already been billed.`)
    if (j.status !== 'ready') throw new OpError(`${j.no} is not ready to be billed.`)
  }
  for (const id of link.timeEntryIds ?? []) {
    const e = state.timeEntries?.[id]
    if (!e) throw new OpError('Some of the time on this invoice no longer exists.')
    if (e.billId) throw new OpError('Some of this time has already been invoiced.')
  }
  if (link.projectId && link.fixedAmount) {
    const p = state.projects?.[link.projectId]
    if (!p) throw new OpError('The project for this bill no longer exists.')
    if (round2(p.fixedInvoiced + link.fixedAmount) > p.fixedAmount + 0.001) throw new OpError(`That is more than is left of ${p.name}'s fee.`)
  }
  const n = packagePayments(bill)
  if (n > 0) {
    if (!bill.customerId) throw new OpError('Choose a customer to pay with a package.')
    const vids = variantsOf(bill)
    // every package payment takes one session; they may come from different packages, soonest to lapse first
    let s = state
    for (let i = 0; i < n; i++) {
      const p = bestPackage(s, bill.customerId, ctx.now, vids)
      if (!p) throw new OpError(i === 0 ? 'This customer has no package session that covers these items.' : `This customer has only ${i} package session${i === 1 ? '' : 's'} for these items.`)
      s = applyChanges(s, { put: { customerPackages: [{ ...p, sessionsUsed: p.sessionsUsed + 1 }] } })
    }
  }
}

/** Writes what the bill means to the booking, the repair, the hours and the package, in the same transaction as the bill. */
export function onSave({ state, ctx, bill }: BillHookCtx): Changes | null {
  const link = linkOf(bill)
  const parts: Changes[] = []
  const put: { appointments?: Appointment[]; jobCards?: JobCard[]; timeEntries?: TimeEntry[]; projects?: Project[] } = {}
  if (link.appointmentId && state.appointments?.[link.appointmentId]) {
    const a = state.appointments[link.appointmentId]
    put.appointments = [{ ...a, status: 'completed', billId: bill.id, completedAt: a.completedAt ?? ctx.now, arrivedAt: a.arrivedAt ?? ctx.now }]
  }
  if (link.jobCardId && state.jobCards?.[link.jobCardId]) {
    const j = state.jobCards[link.jobCardId]
    put.jobCards = [{ ...j, status: 'delivered', billId: bill.id, deliveredAt: ctx.now }]
  }
  const entries = (link.timeEntryIds ?? []).map((id) => state.timeEntries?.[id]).filter(Boolean) as TimeEntry[]
  if (entries.length) put.timeEntries = entries.map((e) => ({ ...e, billId: bill.id }))
  if (link.projectId && link.fixedAmount && state.projects?.[link.projectId]) {
    const p = state.projects[link.projectId]
    put.projects = [{ ...p, fixedInvoiced: round2(p.fixedInvoiced + link.fixedAmount) }]
  }
  if (Object.keys(put).length) parts.push({ put: put as Changes['put'] })

  const n = packagePayments(bill)
  if (n > 0 && bill.customerId) {
    let s: DataState = applyChanges(state, parts.length ? mergeChanges(...parts) : {})
    const vids = variantsOf(bill)
    const names = bill.items.map((i) => i.name).join(', ')
    for (let i = 0; i < n; i++) {
      const p = bestPackage(s, bill.customerId, ctx.now, vids)
      if (!p) break
      const u = usePackageSession(s, p.id, { customerId: bill.customerId, variantIds: vids, serviceName: names, billId: bill.id, note: bill.no }, ctx)
      parts.push(u.changes); s = applyChanges(s, u.changes)
    }
  }
  return parts.length ? mergeChanges(...parts) : null
}

export const servicesBillHook: BillHook = { id: EXT, beforeSave, onSave }

/** Lines at the top of a printed bill: the booking or repair it settles. */
export function receiptHeader(bill: Bill, state: DataState): string[] {
  const link = linkOf(bill)
  const out: string[] = []
  const a = link.appointmentId ? state.appointments?.[link.appointmentId] : undefined
  const j = link.jobCardId ? state.jobCards?.[link.jobCardId] : undefined
  const p = link.projectId ? state.projects?.[link.projectId] : undefined
  if (a) out.push(`Appointment ${a.no}`)
  if (j) out.push(`Job card ${j.no}${j.identifier ? ` · ${j.identifier}` : ''}`)
  if (p) out.push(`Project ${p.no} · ${p.name}`)
  return out
}

/** Footer: sessions left on the customer's packages after paying with one. */
export function receiptFooter(bill: Bill, state: DataState): string[] {
  if (!packagePayments(bill) || !bill.customerId) return []
  const b = customerBalance(state, bill.customerId, bill.date)
  return [`Package session used${packagePayments(bill) > 1 ? 's' : ''}: ${packagePayments(bill)} · ${b.sessions} left`]
}
