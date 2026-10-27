import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { registerCollectionMeta, type Effect } from '@/replication/registry'
import type { Doc, DocStore } from '@/replication/types'
import { isHhmm } from './logic/time'
import type { CustomerPackage, PackageSale, PackageUse } from './types'
import './types'
import './postings'

/**
 * Who may do what.
 *   services        the counter side: book appointments, take in job cards, log time, make visits, sell packages and use their sessions
 *   servicesManage  the set-up and the money rules: hours, staff & resources, package plans, projects, freezing a package
 */
registerPermission('services', ['manager', 'cashier'])
registerPermission('servicesManage', ['manager'])

registerCollections([
  'serviceSettings', 'serviceItems', 'serviceResources', 'appointments', 'packagePlans', 'packageSales', 'customerPackages', 'packageUses',
  'jobCards', 'projects', 'projectTasks', 'timeEntries', 'fieldVisits',
])

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0
const oneOf = (v: unknown, list: string[]) => typeof v === 'string' && list.includes(v)
const COUNTER = ['services', 'servicesManage', 'reports']
const MANAGE = 'servicesManage'

/** A session used (or lapsed) adds to what the package has consumed; a reversal takes it back. The same function runs on the phone. */
export function useEffects(u: PackageUse): Effect[] {
  return [
    { kind: 'inc', coll: 'customerPackages', id: u.customerPackageId, field: 'sessionsUsed', by: u.sessions },
    { kind: 'inc', coll: 'customerPackages', id: u.customerPackageId, field: 'recognised', by: u.value },
  ]
}

/**
 * Inside the server's transaction: a session can only be taken from a package that exists, belongs to that customer, is not frozen
 * and has one left — so two phones using the last session at once cannot both succeed (the second is refused).
 */
export async function useGuard(doc: Doc, db: DocStore): Promise<string | null> {
  const u = doc as unknown as PackageUse
  const cp = (await db.get('customerPackages', u.customerPackageId))?.data as unknown as CustomerPackage | null | undefined
  if (!cp) return 'That package does not exist.'
  if (cp.customerId !== u.customerId) return 'That package belongs to another customer.'
  if (u.kind === 'reversal') {
    const orig = (await db.get('packageUses', u.reverses ?? ''))?.data as unknown as PackageUse | null | undefined
    if (!orig || orig.kind !== 'use' || orig.customerPackageId !== u.customerPackageId) return 'There is no session to give back.'
    if (u.sessions !== -orig.sessions || u.value !== -orig.value || u.tax !== -orig.tax) return 'A reversal must repeat the session it gives back.'
    if (u.id !== `rev_${orig.id}`) return 'A reversal is filed under the session it gives back.'
    return cp.sessionsUsed + u.sessions < 0 ? 'More sessions would be given back than were used.' : null
  }
  if (u.sessions <= 0) return 'A session use needs at least one session.'
  if (cp.sessionsUsed + u.sessions > cp.sessions) return `${cp.name} has only ${Math.max(0, cp.sessions - cp.sessionsUsed)} session${cp.sessions - cp.sessionsUsed === 1 ? '' : 's'} left.`
  if (u.kind === 'use' && cp.status === 'frozen') return `${cp.name} is frozen.`
  if (u.kind === 'use' && cp.expiresAt !== undefined && u.date > cp.expiresAt + 86_400_000) return `${cp.name} has expired.`
  if (u.kind === 'expiry' && (u.id !== `exp_${cp.id}` || cp.sessionsUsed + u.sessions !== cp.sessions)) return 'A package lapses once, with every session it has left.'
  return null
}

/** A package a phone creates must match a sale that has been posted, with nothing used yet. */
export async function packageGuard(doc: Doc, db: DocStore): Promise<string | null> {
  const p = doc as unknown as CustomerPackage
  const sale = (await db.get('packageSales', p.saleId))?.data as unknown as PackageSale | null | undefined
  if (!sale) return 'Sell the package first.'
  if (p.id !== sale.id || p.customerId !== sale.customerId || p.sessions !== sale.sessions || p.price !== sale.price || p.taxable !== sale.taxable) return 'The package does not match its sale.'
  if (p.sessionsUsed !== 0 || p.recognised !== 0) return 'A new package starts with nothing used.'
  return null
}

registerCollectionMeta(
  { name: 'serviceSettings', kind: 'master', perm: MANAGE, readPerm: COUNTER, validate: (d) => (d.id === 'services' && isHhmm(d.openTime) && isHhmm(d.closeTime) && Array.isArray(d.workDays) ? null : 'Settings need opening hours and working days') },
  { name: 'serviceItems', kind: 'master', perm: MANAGE, readPerm: COUNTER, validate: (d) => (str(d.variantId) && finite(d.durationMin) && d.durationMin > 0 && finite(d.bufferMin) && d.bufferMin >= 0 ? null : 'A service needs an item and how long it takes') },
  { name: 'serviceResources', kind: 'master', perm: MANAGE, readPerm: COUNTER, validate: (d) => (str(d.name) && oneOf(d.kind, ['staff', 'resource']) && Array.isArray(d.daysOff) && Array.isArray(d.variantIds) ? null : 'A column needs a name and a kind') },
  {
    name: 'appointments', kind: 'master', perm: 'services', readPerm: COUNTER, branched: true,
    validate: (d) => (str(d.no) && str(d.resourceId) && finite(d.start) && finite(d.end) && d.end > d.start && Array.isArray(d.services) && oneOf(d.status, ['booked', 'confirmed', 'arrived', 'in_service', 'completed', 'cancelled', 'no_show']) ? null : 'An appointment needs a number, a column, a start and an end'),
  },
  { name: 'packagePlans', kind: 'master', perm: MANAGE, readPerm: COUNTER, validate: (d) => (str(d.name) && finite(d.price) && d.price > 0 && finite(d.sessions) && d.sessions >= 1 && Number.isInteger(d.sessions) ? null : 'A package needs a name, a price and a number of sessions') },
  {
    name: 'packageSales', kind: 'ledger', perm: 'services', readPerm: COUNTER, branched: true,
    validate: (d) => (str(d.customerId) && str(d.no) && finite(d.price) && d.price > 0 && finite(d.taxable) && d.taxable > 0 && d.taxable <= d.price && finite(d.sessions) && d.sessions >= 1 && oneOf(d.mode, ['cash', 'upi', 'card', 'bank']) ? null : 'A package sale needs a customer, an amount, sessions and how it was paid'),
  },
  {
    // The counters are the server's: a phone cannot give itself sessions by editing them.
    name: 'customerPackages', kind: 'master', perm: 'services', readPerm: COUNTER, owned: ['sessionsUsed', 'recognised'], branched: true,
    validate: (d) => (str(d.customerId) && str(d.saleId) && finite(d.sessions) && d.sessions >= 1 && oneOf(d.status, ['active', 'frozen', 'expired']) ? null : 'A package needs a customer, a sale and sessions'),
    guard: packageGuard,
  },
  {
    name: 'packageUses', kind: 'ledger', perm: 'services', readPerm: COUNTER, branched: true,
    validate: (d) => (str(d.customerPackageId) && str(d.customerId) && oneOf(d.kind, ['use', 'reversal', 'expiry']) && finite(d.sessions) && finite(d.value) && finite(d.tax) && finite(d.date) ? null : 'A package use needs a package, a kind, sessions and the revenue'),
    guard: useGuard,
    effects: (d) => useEffects(d as unknown as PackageUse),
  },
  {
    name: 'jobCards', kind: 'master', perm: 'services', readPerm: COUNTER, branched: true,
    validate: (d) => (str(d.no) && str(d.partyName) && Array.isArray(d.lines) && Array.isArray(d.photos) && oneOf(d.status, ['received', 'estimated', 'approved', 'in_work', 'ready', 'delivered', 'rejected', 'cancelled']) ? null : 'A job card needs a number, a customer and its lines'),
  },
  { name: 'projects', kind: 'master', perm: MANAGE, readPerm: COUNTER, branched: true, validate: (d) => (str(d.name) && str(d.no) && oneOf(d.billing, ['hourly', 'fixed']) && finite(d.hourlyRate) && d.hourlyRate >= 0 ? null : 'A project needs a name and how it is billed') },
  { name: 'projectTasks', kind: 'master', perm: MANAGE, readPerm: COUNTER, validate: (d) => (str(d.projectId) && str(d.title) && oneOf(d.status, ['todo', 'doing', 'done']) ? null : 'A task needs a project and a title') },
  {
    name: 'timeEntries', kind: 'master', perm: 'services', readPerm: COUNTER, branched: true,
    validate: (d) => (str(d.projectId) && str(d.userId) && finite(d.date) && finite(d.minutes) && d.minutes >= 0 && finite(d.rate) && d.rate >= 0 ? null : 'A time entry needs a project, a person, a day and minutes'),
  },
  {
    name: 'fieldVisits', kind: 'master', perm: 'services', readPerm: COUNTER, branched: true,
    validate: (d) => (str(d.no) && str(d.userId) && finite(d.plannedAt) && oneOf(d.status, ['planned', 'checked_in', 'completed', 'cancelled']) && !!d.report && typeof d.report === 'object' ? null : 'A visit needs a number, a person, a planned time and a report'),
  },
)
