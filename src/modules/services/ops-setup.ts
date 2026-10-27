import { nextItemBarcode } from '@/data/ops'
import { id } from '@/domain/ids'
import type { Category, Product, Variant } from '@/domain/types'
import { serviceItemId } from './logic/calendar'
import { settingsOf, settingsProblem } from './logic/settings'
import { isYmd } from './logic/time'
import { audit, need, OpError, type Changes, type DataState, type OpCtx } from './ops-shared'
import type { ResourceKind, ServiceItem, ServiceResource, ServiceSettings } from './types'

// ───────────────────────────── settings ─────────────────────────────

export function saveServiceSettings(state: DataState, patch: Partial<Omit<ServiceSettings, 'id'>>, ctx: OpCtx): { changes: Changes; settings: ServiceSettings } {
  const next: ServiceSettings = { ...settingsOf(state), ...patch, id: 'services' }
  next.reminderNote = next.reminderNote.trim()
  const why = settingsProblem(next)
  if (why) throw new OpError(why)
  next.workDays = [...new Set(next.workDays)].sort()
  return { settings: next, changes: { put: { serviceSettings: [next], audit: [audit(ctx, 'SERVICE_SETTINGS', Object.keys(patch).join(', ') || 'saved')] } } }
}

// ───────────────────────────── services (items with a duration) ─────────────────────────────

export interface ServiceItemDraft { variantId: string; durationMin: number; bufferMin: number; active: boolean }

/** How long a service takes and how much clean-up time it needs. The item itself (name, price, GST) is an ordinary item. */
export function saveServiceItem(state: DataState, d: ServiceItemDraft, ctx: OpCtx): { changes: Changes; item: ServiceItem } {
  const v = need(state.variants[d.variantId], 'item')
  if (!Number.isInteger(d.durationMin) || d.durationMin < 5 || d.durationMin > 960) throw new OpError('A service takes between 5 minutes and 16 hours.')
  if (!Number.isInteger(d.bufferMin) || d.bufferMin < 0 || d.bufferMin > 240) throw new OpError('Clean-up time is between 0 and 240 minutes.')
  const item: ServiceItem = { id: serviceItemId(d.variantId), variantId: d.variantId, durationMin: d.durationMin, bufferMin: d.bufferMin, active: d.active }
  return { item, changes: { put: { serviceItems: [item], audit: [audit(ctx, 'SERVICE_ITEM', `${v.sku}: ${item.durationMin} min`)] } } }
}

export function removeServiceItem(state: DataState, variantId: string, ctx: OpCtx): { changes: Changes } {
  need(state.serviceItems?.[serviceItemId(variantId)], 'service')
  return { changes: { del: { serviceItems: [serviceItemId(variantId)] }, put: { audit: [audit(ctx, 'SERVICE_ITEM_REMOVE', variantId)] } } }
}

// ───────────────────────────── staff & resources ─────────────────────────────

export interface ResourceDraft {
  /** A fixed id for a new column (so the same person is never added twice from two phones). */
  id?: string
  name: string; kind: ResourceKind; userId?: string; phone?: string; color?: string; openTime?: string; closeTime?: string; workDays?: number[]
  daysOff: string[]; variantIds: string[]; active: boolean
}

/** A column of the calendar: a stylist, a technician, a chair, a bay. */
export function saveResource(state: DataState, d: ResourceDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; resource: ServiceResource } {
  const name = d.name.trim()
  if (!name) throw new OpError('Give it a name.')
  if (d.userId && !state.users[d.userId]) throw new OpError('That login no longer exists.')
  const dup = Object.values(state.serviceResources ?? {}).some((r) => r.id !== existingId && r.name.trim().toLowerCase() === name.toLowerCase() && r.active)
  if (dup) throw new OpError(`There is already a column called ${name}.`)
  if ((d.openTime || d.closeTime) && settingsProblem({ ...settingsOf(state), openTime: d.openTime || settingsOf(state).openTime, closeTime: d.closeTime || settingsOf(state).closeTime })) throw new OpError('Opening time must be before closing time.')
  if (d.daysOff.some((x) => !isYmd(x))) throw new OpError('Days off look like 2026-11-14.')
  const cur = existingId ? need(state.serviceResources?.[existingId], 'column') : undefined
  if (!existingId && d.id && state.serviceResources?.[d.id]) throw new OpError(`${state.serviceResources[d.id].name} is already a column.`)
  const r: ServiceResource = {
    id: existingId ?? d.id ?? id('res', ctx.now), name, kind: d.kind, daysOff: [...new Set(d.daysOff)].sort(), variantIds: d.variantIds, active: d.active, createdAt: cur?.createdAt ?? ctx.now,
    ...(d.userId ? { userId: d.userId } : {}), ...(d.phone?.trim() ? { phone: d.phone.trim() } : {}), ...(d.color ? { color: d.color } : {}),
    ...(d.openTime ? { openTime: d.openTime } : {}), ...(d.closeTime ? { closeTime: d.closeTime } : {}), ...(d.workDays?.length ? { workDays: d.workDays } : {}),
  }
  return { resource: r, changes: { put: { serviceResources: [r], audit: [audit(ctx, existingId ? 'SERVICE_RESOURCE_EDIT' : 'SERVICE_RESOURCE_ADD', name)] } } }
}

export function deleteResource(state: DataState, resourceId: string, ctx: OpCtx): { changes: Changes } {
  const r = need(state.serviceResources?.[resourceId], 'column')
  if (Object.values(state.appointments ?? {}).some((a) => a.resourceId === resourceId)) throw new OpError(`${r.name} has bookings. Switch it off instead of deleting it.`)
  return { changes: { del: { serviceResources: [resourceId] }, put: { audit: [audit(ctx, 'SERVICE_RESOURCE_DELETE', r.name)] } } }
}

// ───────────────────────────── the two items work is billed on ─────────────────────────────

export type SpecialItem = 'labour' | 'hours'
const SPECIAL: Record<SpecialItem, { name: string; code: string; unit: string; hsn: string }> = {
  labour: { name: 'Labour', code: 'SVC-LABOUR', unit: 'pc', hsn: '9987' },
  hours: { name: 'Project hours', code: 'SVC-HOURS', unit: 'hr', hsn: '9983' },
}

/**
 * "Labour" (job cards) and "Project hours" (timesheets) are items with no stock, so a bill for them goes through the ordinary bill
 * path. They are made the first time they are needed (with fixed ids, so two phones never make two). Returns what to write, if anything.
 */
export function ensureSpecialItem(state: DataState, kind: SpecialItem, ctx: OpCtx): { variantId: string; changes: Changes } {
  const cfg = settingsOf(state)
  const wanted = kind === 'labour' ? cfg.labourVariantId : cfg.hoursVariantId
  if (wanted && state.variants[wanted]) return { variantId: wanted, changes: {} }
  const spec = SPECIAL[kind]
  const variantId = `var_svc_${kind}`
  if (state.variants[variantId]) return { variantId, changes: {} }
  const put: { categories?: Category[]; products?: Product[]; variants?: Variant[] } = {}
  const catId = 'cat_services'
  if (!state.categories[catId]) put.categories = [{ id: catId, name: 'Services', group: 'Services', config: { prefix: 'SV', unit: 'pc' } }]
  const productId = `prd_svc_${kind}`
  if (!state.products[productId]) {
    put.products = [{
      id: productId, styleCode: spec.code, name: spec.name, categoryId: catId, brand: '', fabric: '', season: '', hsn: spec.hsn, active: true, createdAt: ctx.now,
      unit: spec.unit, trackStock: false, noDiscount: false, gstRate: 18, ...(kind === 'hours' ? { fractional: true, step: 0.25, minQty: 0.25 } : {}),
    }]
  }
  put.variants = [{ id: variantId, productId, sku: spec.code, barcode: nextItemBarcode(state, ctx), size: '', color: '', cost: 0, mrp: 0, price: 0, stock: 0, reorderLevel: 0 }]
  return { variantId, changes: { put: put as Changes['put'] } }
}
