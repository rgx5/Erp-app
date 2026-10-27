import type { Customer, Product, User, Variant } from '@/domain/types'
import { applyChanges, type Changes, type DataState } from '@/data/state'
import type { OpCtx } from '@/data/ops'
import { baseState as core, customer, ctx as coreCtx, NOW, owner, cashier, product, variant } from '@/data/__tests__/helpers'
import { registerBillHook, registerPaymentMethod } from '@/modules/registry'
import { saveAppointment, saveResource, saveServiceItem, saveServiceSettings, savePlan } from '../ops'
import { servicesBillHook } from '../hooks'
import { at } from '../logic/time'
import '../replication'

export { NOW, owner, cashier }
export const manager: User = { id: 'u_mgr', name: 'Mira Manager', role: 'manager', active: true, code: '03' }
export const ctx = (over: Partial<OpCtx> = {}): OpCtx => coreCtx(over)
export const mctx = (over: Partial<OpCtx> = {}): OpCtx => coreCtx({ userId: 'u_mgr', ...over })
export const cctx = (over: Partial<OpCtx> = {}): OpCtx => coreCtx({ userId: 'u_cash', ...over })

/** Midnight of the test "today". */
export const TODAY = new Date(NOW).setHours(0, 0, 0, 0)
export const DAY = 86_400_000
export const nextDay = (n: number) => new Date(new Date(TODAY).getFullYear(), new Date(TODAY).getMonth(), new Date(TODAY).getDate() + n).getTime()

// Services are items with no stock.
const svcProduct = (id: string, name: string, over: Partial<Product> = {}): Product => product({ id, styleCode: id.toUpperCase(), name, trackStock: false, hsn: '9997', gstRate: 18, ...over })
const svcVariant = (id: string, productId: string, price: number, over: Partial<Variant> = {}): Variant =>
  variant({ id, productId, sku: id.toUpperCase(), barcode: `22000000${id.length}${price}`.slice(0, 13), size: '', color: '', cost: 0, avgCost: undefined, mrp: price, price, stock: 0, ...over })

export const SVC = { cut: 'v_cut', spa: 'v_spa', color: 'v_color' }
export const PART = 'v_screen'
export const customer2: Customer = customer({ id: 'c2', name: 'Anil', phone: '9000000002' })

/** A salon-and-repair shop: services, a stocked part, two columns, a manager and a cashier. */
export function baseState(): DataState {
  const s = core()
  s.users = { ...s.users, [manager.id]: manager }
  s.products = {
    ...s.products,
    p_cut: svcProduct('p_cut', 'Haircut'), p_spa: svcProduct('p_spa', 'Hair spa'), p_color: svcProduct('p_color', 'Hair colour'),
    p_screen: product({ id: 'p_screen', styleCode: 'SCR-1', name: 'Phone screen', hsn: '8517', gstRate: 18 }),
  }
  s.variants = {
    ...s.variants,
    [SVC.cut]: svcVariant(SVC.cut, 'p_cut', 500), [SVC.spa]: svcVariant(SVC.spa, 'p_spa', 1200), [SVC.color]: svcVariant(SVC.color, 'p_color', 2400),
    [PART]: variant({ id: PART, productId: 'p_screen', sku: 'SCR-1', barcode: '2100000000099', size: '', color: '', cost: 900, avgCost: 900, mrp: 2500, price: 2000, stock: 5 }),
  }
  s.customers = { ...s.customers, c2: customer2 }
  return s
}

export const run = <R extends { changes: Changes }>(s: DataState, r: R): { state: DataState; result: R } => ({ state: applyChanges(s, r.changes), result: r })

/** The shop set up: hours, two columns, durations for the three services and a 5-session spa package. */
export function shopState(): DataState {
  let s = baseState()
  s = run(s, saveServiceSettings(s, { openTime: '09:00', closeTime: '20:00', workDays: [0, 1, 2, 3, 4, 5, 6], maxNoShows: 2, reminderLeadHours: 24 }, mctx())).state
  s = run(s, saveResource(s, { id: 'res_asha', name: 'Asha', kind: 'staff', daysOff: [], variantIds: [], active: true }, undefined, mctx())).state
  s = run(s, saveResource(s, { id: 'res_chair', name: 'Chair 2', kind: 'resource', daysOff: [], variantIds: [SVC.cut], active: true }, undefined, mctx())).state
  s = run(s, saveServiceItem(s, { variantId: SVC.cut, durationMin: 30, bufferMin: 10, active: true }, mctx())).state
  s = run(s, saveServiceItem(s, { variantId: SVC.spa, durationMin: 60, bufferMin: 0, active: true }, mctx())).state
  s = run(s, saveServiceItem(s, { variantId: SVC.color, durationMin: 90, bufferMin: 0, active: true }, mctx())).state
  s = run(s, savePlan(s, { name: 'Hair spa x5', price: 5900, sessions: 5, validityDays: 90, variantIds: [SVC.spa], gstRate: 18, notes: '', active: true }, undefined, mctx())).state
  return s
}

export const planId = (s: DataState) => Object.values(s.packagePlans)[0].id
/** Tomorrow at HH:MM. */
export const tomorrowAt = (t: string) => at(nextDay(1), t)
export const todayAt = (t: string) => at(TODAY, t)

export function bookDraft(over: Partial<Parameters<typeof saveAppointment>[1]> = {}): Parameters<typeof saveAppointment>[1] {
  return { customerId: 'c1', partyName: '', partyPhone: '', resourceId: 'res_asha', services: [{ variantId: SVC.cut }], start: tomorrowAt('11:00'), notes: '', ...over }
}

let registered = false
/** What index.tsx registers, for tests (they do not load the app's UI). */
export function registerForTests() {
  if (registered) return
  registered = true
  registerBillHook(servicesBillHook)
  registerPaymentMethod({ id: 'package', label: 'Package', icon: (() => null) as never, order: 60 })
}
registerForTests()
