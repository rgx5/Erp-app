import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { withEffects } from '@/replication/local'
import { nextNo } from '../numbering'
import { covers, expiryOf, lapseFor, lapsed, packageStatus, releaseFor, sessionsLeft, splitPrice, usageProblem } from './logic/packages'
import { applyChanges, audit, branch, isManager, listOf, mergeChanges, need, OpError, type Changes, type DataState, type OpCtx } from './ops-shared'
import type { CustomerPackage, PackageMode, PackagePlan, PackageSale, PackageUse } from './types'
import './replication'

const MODES: PackageMode[] = ['cash', 'upi', 'card', 'bank']

// ───────────────────────────── plans ─────────────────────────────

export interface PlanDraft { name: string; price: number; sessions: number; validityDays: number; variantIds: string[]; gstRate: number; notes: string; active: boolean }

/** A package the shop sells: "5 hair spas for ₹4,000, valid 90 days". */
export function savePlan(state: DataState, d: PlanDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; plan: PackagePlan } {
  const name = d.name.trim()
  if (!name) throw new OpError('Give the package a name.')
  if (!(d.price > 0)) throw new OpError('Enter the price of the package.')
  if (!Number.isInteger(d.sessions) || d.sessions < 1 || d.sessions > 500) throw new OpError('Sessions must be a whole number from 1 to 500.')
  if (!Number.isInteger(d.validityDays) || d.validityDays < 0 || d.validityDays > 3650) throw new OpError('Validity is a number of days (0 = never expires).')
  if (![0, 5, 12, 18, 28].includes(d.gstRate) && !(d.gstRate >= 0 && d.gstRate <= 40)) throw new OpError('GST rate looks like 18.')
  for (const v of d.variantIds) if (!state.variants[v]) throw new OpError('One of the covered services no longer exists.')
  const cur = existingId ? need(state.packagePlans?.[existingId], 'package') : undefined
  const plan: PackagePlan = { id: existingId ?? id('pp', ctx.now), name, price: round2(d.price), sessions: d.sessions, validityDays: d.validityDays, variantIds: d.variantIds, gstRate: d.gstRate, active: d.active, notes: d.notes.trim(), createdAt: cur?.createdAt ?? ctx.now }
  return { plan, changes: { put: { packagePlans: [plan], audit: [audit(ctx, existingId ? 'PACKAGE_PLAN_EDIT' : 'PACKAGE_PLAN_ADD', `${name} — ₹${plan.price}`)] } } }
}

// ───────────────────────────── selling ─────────────────────────────

export interface SellDraft { customerId: string; planId: string; mode: PackageMode; ref?: string; /** A manager may sell below the list price. */ price?: number }

/** Sells a package: the money is received now and held for the customer (the books carry it as a liability until sessions are used). */
export function sellPackage(state: DataState, d: SellDraft, ctx: OpCtx): { changes: Changes; sale: PackageSale; package: CustomerPackage } {
  const customer = need(state.customers[d.customerId], 'customer')
  const plan = need(state.packagePlans?.[d.planId], 'package')
  if (!plan.active) throw new OpError(`${plan.name} is not on sale.`)
  if (!MODES.includes(d.mode)) throw new OpError('Choose how the money was received.')
  let price = plan.price
  if (d.price !== undefined && round2(d.price) !== plan.price) {
    if (!isManager(state, ctx)) throw new OpError('Only a manager can change the price of a package.')
    if (!(d.price > 0)) throw new OpError('Enter the price.')
    price = round2(d.price)
  }
  const { taxable } = splitPrice(price, plan.gstRate)
  const saleId = id('pk', ctx.now)
  const sale: PackageSale = {
    id: saleId, no: nextNo('PK-', listOf(state.packageSales ?? {}).map((x) => x.no), ctx), customerId: customer.id, planId: plan.id, name: plan.name, sessions: plan.sessions, price, gstRate: plan.gstRate,
    taxable, mode: d.mode, ref: (d.ref ?? '').trim(), date: ctx.now, variantIds: plan.variantIds, userId: ctx.userId, ...branch(ctx),
    ...(expiryOf(plan, ctx.now) !== undefined ? { expiresAt: expiryOf(plan, ctx.now) } : {}),
  }
  const pkg: CustomerPackage = {
    id: saleId, saleId, no: sale.no, customerId: customer.id, planId: plan.id, name: plan.name, sessions: plan.sessions, sessionsUsed: 0, price, taxable, recognised: 0, variantIds: plan.variantIds,
    soldAt: ctx.now, ...(sale.expiresAt !== undefined ? { expiresAt: sale.expiresAt } : {}), status: 'active', note: '', ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  } as CustomerPackage
  return { sale, package: pkg, changes: { put: { packageSales: [sale], customerPackages: [pkg], audit: [audit(ctx, 'PACKAGE_SOLD', `${sale.no} — ${customer.name}, ${plan.name}, ₹${price}`)] } } }
}

// ───────────────────────────── using ─────────────────────────────

export interface UseInput {
  customerId?: string
  /** The services the session pays for: the package must cover all of them. */
  variantIds?: string[]
  serviceName?: string
  appointmentId?: string
  billId?: string
  visitId?: string
  jobCardId?: string
  note?: string
}

/** Takes one session from the package and earns its share of the revenue. */
export function usePackageSession(state: DataState, packageId: string, o: UseInput, ctx: OpCtx): { changes: Changes; use: PackageUse; package: CustomerPackage } {
  const cp = need(state.customerPackages?.[packageId], 'package')
  if (o.customerId && o.customerId !== cp.customerId) throw new OpError('That package belongs to another customer.')
  const why = usageProblem(cp, ctx.now, o.variantIds ?? [])
  if (why) throw new OpError(why)
  const rel = releaseFor(cp, 1)
  const use: PackageUse = {
    id: id('pu', ctx.now), customerPackageId: cp.id, customerId: cp.customerId, kind: 'use', sessions: 1, value: rel.value, tax: rel.tax, date: ctx.now,
    ...(o.variantIds?.[0] ? { variantId: o.variantIds[0] } : {}), serviceName: o.serviceName?.trim() || cp.name,
    ...(o.appointmentId ? { appointmentId: o.appointmentId } : {}), ...(o.billId ? { billId: o.billId } : {}), ...(o.visitId ? { visitId: o.visitId } : {}), ...(o.jobCardId ? { jobCardId: o.jobCardId } : {}),
    note: (o.note ?? '').trim(), userId: ctx.userId, ...branch(ctx),
  }
  const changes = withEffects(state, { put: { packageUses: [use], audit: [audit(ctx, 'PACKAGE_USED', `${cp.no} — ${use.serviceName} (${sessionsLeft(cp) - 1} left)`)] } }, ['packageUses'], ctx.now)
  return { use, changes, package: applyChanges(state, changes).customerPackages[cp.id] }
}

/** Gives a session back (a booking cancelled after it was used up, a mistake). The use stays on record; a new entry reverses it. */
export function reverseUse(state: DataState, useId: string, reason: string, ctx: OpCtx): { changes: Changes; use: PackageUse } {
  const orig = need(state.packageUses?.[useId], 'session')
  if (orig.kind !== 'use') throw new OpError('Only a used session can be given back.')
  if (state.packageUses?.[`rev_${orig.id}`]) throw new OpError('That session has already been given back.')
  if (!isManager(state, ctx)) throw new OpError('Only a manager can give a session back.')
  if (!reason.trim()) throw new OpError('Say why the session is given back.')
  const rev: PackageUse = {
    id: `rev_${orig.id}`, customerPackageId: orig.customerPackageId, customerId: orig.customerId, kind: 'reversal', sessions: -orig.sessions, value: -orig.value, tax: -orig.tax, date: ctx.now,
    ...(orig.variantId ? { variantId: orig.variantId } : {}), ...(orig.serviceName ? { serviceName: orig.serviceName } : {}), ...(orig.billId ? { billId: orig.billId } : {}),
    reverses: orig.id, note: reason.trim(), userId: ctx.userId, ...branch(ctx),
  }
  const changes = withEffects(state, { put: { packageUses: [rev], audit: [audit(ctx, 'PACKAGE_USE_REVERSED', `${state.customerPackages?.[orig.customerPackageId]?.no ?? ''} — ${reason.trim()}`)] } }, ['packageUses'], ctx.now)
  return { use: rev, changes }
}

/** Lets a package that ran out of time with sessions left lapse: what is left becomes income, once. */
export function expirePackage(state: DataState, packageId: string, ctx: OpCtx): { changes: Changes; use: PackageUse } {
  const cp = need(state.customerPackages?.[packageId], 'package')
  if (cp.status === 'expired') throw new OpError(`${cp.name} has already lapsed.`)
  if (packageStatus(cp, ctx.now) !== 'expired') throw new OpError(`${cp.name} is still valid.`)
  const left = sessionsLeft(cp)
  if (left <= 0) throw new OpError(`${cp.name} has nothing left to lapse.`)
  const rel = lapseFor(cp)
  const use: PackageUse = {
    id: `exp_${cp.id}`, customerPackageId: cp.id, customerId: cp.customerId, kind: 'expiry', sessions: left, value: rel.value, tax: rel.tax, date: ctx.now, serviceName: cp.name,
    note: `${left} unused session${left === 1 ? '' : 's'} lapsed`, userId: ctx.userId, ...branch(ctx),
  }
  const eff = withEffects(state, { put: { packageUses: [use], audit: [audit(ctx, 'PACKAGE_EXPIRED', `${cp.no} — ${left} session${left === 1 ? '' : 's'}`)] } }, ['packageUses'], ctx.now)
  const done = applyChanges(state, eff).customerPackages[cp.id]
  return { use, changes: mergeChanges(eff, { put: { customerPackages: [{ ...done, status: 'expired' }] } }) }
}

/** Lapses every package that is past its date. */
export function expireDue(state: DataState, ctx: OpCtx): { changes: Changes; count: number } {
  let s = state
  let acc: Changes = {}
  let count = 0
  for (const p of lapsed(state, ctx.now)) {
    const r = expirePackage(s, p.id, ctx)
    acc = mergeChanges(acc, r.changes); s = applyChanges(s, r.changes); count++
  }
  return { changes: acc, count }
}

export type PackageStatusChange = 'frozen' | 'active'
/** Freezes a package (a customer away, a dispute) or lifts the freeze. A frozen package cannot be used; its date does not move. */
export function setPackageFrozen(state: DataState, packageId: string, frozen: boolean, note: string, ctx: OpCtx): { changes: Changes; package: CustomerPackage } {
  const cp = need(state.customerPackages?.[packageId], 'package')
  if (!isManager(state, ctx)) throw new OpError('Only a manager can freeze a package.')
  if (cp.status === 'expired') throw new OpError('An expired package cannot be changed.')
  const next: CustomerPackage = { ...cp, status: frozen ? 'frozen' : 'active', note: note.trim() || cp.note }
  return { package: next, changes: { put: { customerPackages: [next], audit: [audit(ctx, frozen ? 'PACKAGE_FROZEN' : 'PACKAGE_UNFROZEN', cp.no)] } } }
}

/** Packages usable for these services, expiring first. */
export const usablePackages = (state: DataState, customerId: string, now: number, variantIds: string[] = []) =>
  listOf(state.customerPackages ?? {}).filter((p) => p.customerId === customerId && !usageProblem(p, now, variantIds) && covers(p, variantIds[0]))
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity))
