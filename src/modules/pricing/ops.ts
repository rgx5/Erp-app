import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { DEFAULT_SCALE, scaleLayoutProblem } from '@/domain/scale'
import { audit, OpError, type OpCtx } from '@/data/ops'
import { listOf, type Changes, type DataState } from '@/data/state'
import { normalVehicleNo, vehicleProblem, ewbNoProblem } from './eway'
import type { IrpAck } from './einvoice'
import { breakRuleProblem } from './prices'
import { promotionProblem } from './promotions'
import {
  eInvoiceId, ewayId, priceListItemId, type EInvoiceRecord, type EwayRecord, type PartyDetails, type PriceList, type PriceListItem, type PricingSettings, type Promotion, type QtyBreakRule, type Transport,
} from './types'
import './replication'

// ───────────────────────────── price lists ─────────────────────────────

export type PriceListDraft = Pick<PriceList, 'name' | 'tier' | 'basis' | 'pct' | 'roundTo'> & Partial<Pick<PriceList, 'active' | 'notes'>>

/** Creates a price list, or changes one. */
export function savePriceList(state: DataState, d: PriceListDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; list: PriceList } {
  const name = d.name.trim()
  if (!name) throw new OpError('Give the price list a name.')
  if (!Number.isFinite(d.pct) || d.pct < -100 || d.pct > 1000) throw new OpError('The percentage should be between −100 and 1000.')
  if (!(d.roundTo >= 0)) throw new OpError('Rounding cannot be negative.')
  const clash = listOf(state.priceLists).find((l) => l.id !== existingId && l.name.trim().toLowerCase() === name.toLowerCase())
  if (clash) throw new OpError(`There is already a price list called “${clash.name}”.`)
  const cur = existingId ? state.priceLists[existingId] : undefined
  if (existingId && !cur) throw new OpError('That price list no longer exists.')
  const list: PriceList = {
    ...(cur ?? {}), id: cur?.id ?? id('pl', ctx.now), name, tier: d.tier, basis: d.basis, pct: round2(d.pct), roundTo: d.roundTo,
    active: d.active ?? cur?.active ?? true, ...(d.notes?.trim() ? { notes: d.notes.trim() } : {}),
  }
  return { list, changes: { put: { priceLists: [list], audit: [audit(ctx, cur ? 'PRICE_LIST_EDIT' : 'PRICE_LIST_CREATE', name)] } } }
}

/** Sets (or clears, with `null`) items' own prices on a list. */
export function setListPrices(state: DataState, listId: string, entries: Array<{ variantId: string; price: number | null }>, ctx: OpCtx): { changes: Changes; set: number; cleared: number } {
  const list = state.priceLists[listId]
  if (!list) throw new OpError('That price list no longer exists.')
  const put: PriceListItem[] = []
  const del: string[] = []
  for (const e of entries) {
    if (!state.variants[e.variantId]) throw new OpError('One of the items no longer exists.')
    const key = priceListItemId(listId, e.variantId)
    if (e.price === null) { if (state.priceListItems[key]) del.push(key); continue }
    if (!Number.isFinite(e.price) || e.price < 0) throw new OpError('A price cannot be negative.')
    put.push({ id: key, listId, variantId: e.variantId, price: round2(e.price) })
  }
  if (!put.length && !del.length) return { changes: {}, set: 0, cleared: 0 }
  return {
    set: put.length, cleared: del.length,
    changes: { put: { ...(put.length ? { priceListItems: put } : {}), audit: [audit(ctx, 'PRICE_LIST_PRICES', `${list.name}: ${put.length} set${del.length ? `, ${del.length} cleared` : ''}`)] }, ...(del.length ? { del: { priceListItems: del } } : {}) },
  }
}

/** Deletes a list with its prices; customers on it, and the shop's default, go back to the selling prices. */
export function deletePriceList(state: DataState, listId: string, ctx: OpCtx): { changes: Changes } {
  const list = state.priceLists[listId]
  if (!list) throw new OpError('That price list no longer exists.')
  const customers = listOf(state.customers).filter((c) => c.priceListId === listId).map(({ priceListId: _p, ...rest }) => { void _p; return rest as typeof state.customers[string] })
  const items = listOf(state.priceListItems).filter((i) => i.listId === listId).map((i) => i.id)
  const rules = listOf(state.qtyBreakRules).filter((r) => r.listId === listId)
  const settings = state.pricingSettings.settings
  const clearDefault = settings?.defaultListId === listId
  const changes: Changes = {
    del: { priceLists: [listId], ...(items.length ? { priceListItems: items } : {}) },
    put: {
      ...(customers.length ? { customers } : {}),
      // A rule made only for this list would otherwise start applying to everyone.
      ...(rules.length ? { qtyBreakRules: rules.map((r) => ({ ...r, active: false })) } : {}),
      ...(clearDefault ? { pricingSettings: [{ ...settings, defaultListId: undefined }] } : {}),
      audit: [audit(ctx, 'PRICE_LIST_DELETE', `${list.name}${customers.length ? ` — ${customers.length} customers moved to selling prices` : ''}`)],
    },
  }
  return { changes }
}

/** Puts a customer on a price list ('' = back to the shop's default). */
export function assignPriceList(state: DataState, customerId: string, listId: string, ctx: OpCtx): { changes: Changes } {
  const c = state.customers[customerId]
  if (!c) throw new OpError('That customer no longer exists.')
  if (listId && !state.priceLists[listId]) throw new OpError('That price list no longer exists.')
  if ((c.priceListId ?? '') === listId) return { changes: {} }
  const { priceListId: _old, ...rest } = c
  void _old
  const next = listId ? { ...rest, priceListId: listId } : rest
  return { changes: { put: { customers: [next as typeof c], audit: [audit(ctx, 'CUSTOMER_PRICE_LIST', `${c.name} → ${listId ? state.priceLists[listId].name : 'selling prices'}`)] } } }
}

// ───────────────────────────── quantity breaks ─────────────────────────────

export type BreakRuleDraft = Pick<QtyBreakRule, 'name' | 'target' | 'targetId' | 'listId' | 'breaks'> & Partial<Pick<QtyBreakRule, 'active'>>

export function saveBreakRule(state: DataState, d: BreakRuleDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; rule: QtyBreakRule } {
  const problem = breakRuleProblem(d)
  if (problem) throw new OpError(problem)
  if (d.listId && !state.priceLists[d.listId]) throw new OpError('That price list no longer exists.')
  const cur = existingId ? state.qtyBreakRules[existingId] : undefined
  if (existingId && !cur) throw new OpError('That rule no longer exists.')
  const rule: QtyBreakRule = {
    id: cur?.id ?? id('qb', ctx.now), name: d.name.trim() || 'Quantity break', target: d.target, targetId: d.target === 'all' ? '' : d.targetId, listId: d.listId,
    breaks: [...d.breaks].sort((a, b) => a.minQty - b.minQty).map((b) => ({ minQty: b.minQty, kind: b.kind, value: round2(b.value) })), active: d.active ?? cur?.active ?? true,
  }
  return { rule, changes: { put: { qtyBreakRules: [rule], audit: [audit(ctx, cur ? 'QTY_BREAK_EDIT' : 'QTY_BREAK_CREATE', rule.name)] } } }
}

export function deleteBreakRule(state: DataState, ruleId: string, ctx: OpCtx): { changes: Changes } {
  const r = state.qtyBreakRules[ruleId]
  if (!r) throw new OpError('That rule no longer exists.')
  return { changes: { del: { qtyBreakRules: [ruleId] }, put: { audit: [audit(ctx, 'QTY_BREAK_DELETE', r.name)] } } }
}

// ───────────────────────────── promotions ─────────────────────────────

/** A promotion as the editor holds it; the id is given when it is first saved. */
export type PromotionDraft = Promotion extends infer P ? (P extends Promotion ? Omit<P, 'id'> : never) : never

export function savePromotion(state: DataState, d: PromotionDraft, existingId: string | undefined, ctx: OpCtx): { changes: Changes; promotion: Promotion } {
  const cur = existingId ? state.promotions[existingId] : undefined
  if (existingId && !cur) throw new OpError('That promotion no longer exists.')
  const promotion = { ...d, id: cur?.id ?? id('pr', ctx.now), name: d.name.trim() } as Promotion
  const problem = promotionProblem(promotion)
  if (problem) throw new OpError(problem)
  if (promotion.kind === 'bundle') for (const it of promotion.items) if (!state.variants[it.variantId]) throw new OpError('One of the bundle’s items no longer exists.')
  return { promotion, changes: { put: { promotions: [promotion], audit: [audit(ctx, cur ? 'PROMOTION_EDIT' : 'PROMOTION_CREATE', promotion.name)] } } }
}

export function setPromotionActive(state: DataState, promoId: string, active: boolean, ctx: OpCtx): { changes: Changes } {
  const p = state.promotions[promoId]
  if (!p) throw new OpError('That promotion no longer exists.')
  if (p.active === active) return { changes: {} }
  return { changes: { put: { promotions: [{ ...p, active }], audit: [audit(ctx, active ? 'PROMOTION_ON' : 'PROMOTION_OFF', p.name)] } } }
}

export function deletePromotion(state: DataState, promoId: string, ctx: OpCtx): { changes: Changes } {
  const p = state.promotions[promoId]
  if (!p) throw new OpError('That promotion no longer exists.')
  return { changes: { del: { promotions: [promoId] }, put: { audit: [audit(ctx, 'PROMOTION_DELETE', p.name)] } } }
}

// ───────────────────────────── settings ─────────────────────────────

export type SettingsPatch = Partial<Omit<PricingSettings, 'id'>>

/** Changes the pricing settings (scale labels, default list, e-invoice details). */
export function savePricingSettings(state: DataState, patch: SettingsPatch, ctx: OpCtx): { changes: Changes; settings: PricingSettings } {
  const cur = state.pricingSettings.settings
  const next: PricingSettings = { ...(cur ?? {}), ...patch, id: 'settings' }
  if (patch.scale) {
    const problem = scaleLayoutProblem({ ...DEFAULT_SCALE, ...patch.scale })
    if (problem) throw new OpError(problem)
  }
  if (next.defaultListId && !state.priceLists[next.defaultListId]) throw new OpError('That price list no longer exists.')
  if (next.sellerPin && !/^[1-9]\d{5}$/.test(next.sellerPin.trim())) throw new OpError('A pincode has 6 digits.')
  if (next.ewbThreshold !== undefined && !(next.ewbThreshold > 0)) throw new OpError('The e-way bill limit must be above zero.')
  if (!next.defaultListId) delete next.defaultListId
  return { settings: next, changes: { put: { pricingSettings: [next], audit: [audit(ctx, 'PRICING_SETTINGS', Object.keys(patch).join(', '))] } } }
}

// ───────────────────────────── e-invoice and e-way bill records ─────────────────────────────

const billFor = (state: DataState, billId: string) => {
  const b = state.bills[billId]
  if (!b) throw new OpError('That bill no longer exists.')
  if (b.status === 'held') throw new OpError('A parked bill is not an invoice yet.')
  return b
}

const cleanParty = (p: PartyDetails): PartyDetails => {
  const out: PartyDetails = {}
  for (const k of ['name', 'addr1', 'addr2', 'loc'] as const) if (p[k]?.trim()) out[k] = p[k]!.trim()
  const pin = (p.pin ?? '').replace(/\s/g, '')
  if (pin) {
    if (!/^[1-9]\d{5}$/.test(pin)) throw new OpError('A pincode has 6 digits.')
    out.pin = pin
  }
  return out
}

/** Saves the buyer details the portal needs (address, pincode) against a bill's e-invoice record. */
export function saveEInvoiceDetails(state: DataState, billId: string, buyer: PartyDetails, ctx: OpCtx): { changes: Changes; record: EInvoiceRecord } {
  const bill = billFor(state, billId)
  const cur = state.eInvoices[eInvoiceId(billId)]
  if (cur?.status === 'registered') throw new OpError('This invoice already has an IRN, so it cannot be changed. Cancel it on the portal first.')
  if (cur?.status === 'cancelled') throw new OpError('This e-invoice was cancelled on the portal. Issue a new bill instead.')
  const record: EInvoiceRecord = {
    ...(cur ?? { id: eInvoiceId(billId), billId, billNo: bill.no, docType: bill.refundOfBillId || bill.total < 0 ? 'CRN' : 'INV', status: 'prepared' as const, preparedAt: ctx.now, userId: ctx.userId }),
    buyer: cleanParty(buyer), ...(bill.branchId ? { branchId: bill.branchId } : {}),
  }
  return { record, changes: { put: { eInvoices: [record], audit: [audit(ctx, 'EINVOICE_PREPARE', bill.no)] } } }
}

/** Records what the portal answered for an invoice: the IRN, acknowledgement and signed QR. */
export function recordIrn(state: DataState, billId: string, ack: IrpAck, ctx: OpCtx): { changes: Changes; record: EInvoiceRecord } {
  const bill = billFor(state, billId)
  const irn = ack.irn.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(irn)) throw new OpError('An IRN is 64 letters and digits.')
  if (!ack.ackNo.trim()) throw new OpError('Enter the acknowledgement number the portal gave.')
  const cur = state.eInvoices[eInvoiceId(billId)]
  if (cur?.status === 'cancelled') throw new OpError('This e-invoice was cancelled on the portal. Issue a new bill instead.')
  if (cur?.status === 'registered' && cur.irn !== irn) throw new OpError('This invoice already has a different IRN recorded.')
  const dup = listOf(state.eInvoices).find((r) => r.irn === irn && r.billId !== billId)
  if (dup) throw new OpError(`That IRN is already recorded against ${dup.billNo}.`)
  const record: EInvoiceRecord = {
    ...(cur ?? { id: eInvoiceId(billId), billId, billNo: bill.no, docType: bill.refundOfBillId || bill.total < 0 ? 'CRN' : 'INV', preparedAt: ctx.now, userId: ctx.userId }),
    status: 'registered', irn, ackNo: ack.ackNo.trim(), ackDate: ack.ackDate?.trim() || undefined, signedQr: ack.signedQr || undefined, signedInvoice: ack.signedInvoice || undefined,
    registeredAt: cur?.registeredAt ?? ctx.now, ...(bill.branchId ? { branchId: bill.branchId } : {}),
  }
  return { record: stripUndefined(record), changes: { put: { eInvoices: [stripUndefined(record)], audit: [audit(ctx, 'EINVOICE_IRN', `${bill.no} — ${irn.slice(0, 12)}…`)] } } }
}

/** Notes that an e-invoice was cancelled on the portal (the portal allows it only within 24 hours of registration). */
export function cancelEInvoice(state: DataState, billId: string, reason: string, ctx: OpCtx): { changes: Changes; record: EInvoiceRecord } {
  const cur = state.eInvoices[eInvoiceId(billId)]
  if (!cur || cur.status !== 'registered') throw new OpError('Only an invoice with an IRN can be marked cancelled.')
  if (!reason.trim()) throw new OpError('Say why it was cancelled.')
  const record: EInvoiceRecord = { ...cur, status: 'cancelled', cancelledAt: ctx.now, cancelReason: reason.trim() }
  return { record, changes: { put: { eInvoices: [record], audit: [audit(ctx, 'EINVOICE_CANCEL', `${cur.billNo}: ${reason.trim()}`)] } } }
}

const stripUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

export interface EwayDetails { transport: Transport; shipTo?: PartyDetails }

/** Saves the transport details (vehicle, distance, transporter) against a bill's e-way bill record. */
export function saveEwayDetails(state: DataState, billId: string, d: EwayDetails, ctx: OpCtx): { changes: Changes; record: EwayRecord } {
  const bill = billFor(state, billId)
  const cur = state.ewayBills[ewayId(billId)]
  if (cur?.status === 'generated') throw new OpError('This e-way bill already has a number, so it cannot be changed here. Update the vehicle on the e-way bill portal.')
  if (cur?.status === 'cancelled') throw new OpError('This e-way bill was cancelled. Make a new one on the portal and record it on a new bill.')
  const t = d.transport
  if (!(t.distanceKm >= 0 && t.distanceKm <= 4000)) throw new OpError('Distance is between 0 and 4000 km.')
  const vehicle = normalVehicleNo(t.vehicleNo ?? '')
  if (vehicle) { const p = vehicleProblem(vehicle); if (p) throw new OpError(p) }
  const transport: Transport = stripUndefined({
    mode: t.mode, distanceKm: Math.round(t.distanceKm), vehicleNo: vehicle || undefined, vehicleType: t.vehicleType, transporterId: t.transporterId?.trim().toUpperCase() || undefined,
    transporterName: t.transporterName?.trim() || undefined, transDocNo: t.transDocNo?.trim() || undefined, transDocDate: t.transDocDate?.trim() || undefined,
  })
  const record: EwayRecord = {
    ...(cur ?? { id: ewayId(billId), billId, billNo: bill.no, status: 'prepared' as const, preparedAt: ctx.now, userId: ctx.userId }),
    transport, ...(d.shipTo ? { shipTo: cleanParty(d.shipTo) } : {}), ...(bill.branchId ? { branchId: bill.branchId } : {}),
  }
  return { record, changes: { put: { ewayBills: [record], audit: [audit(ctx, 'EWAY_PREPARE', bill.no)] } } }
}

/** Records the e-way bill number the portal issued. */
export function recordEwayBill(state: DataState, billId: string, a: { ewbNo: string; validUpto?: string }, ctx: OpCtx): { changes: Changes; record: EwayRecord } {
  const bill = billFor(state, billId)
  const no = a.ewbNo.replace(/\s/g, '')
  const problem = ewbNoProblem(no)
  if (problem) throw new OpError(problem)
  if (a.validUpto && !/^\d{4}-\d{2}-\d{2}$/.test(a.validUpto)) throw new OpError('Write the validity date as YYYY-MM-DD.')
  const cur = state.ewayBills[ewayId(billId)]
  if (cur?.status === 'cancelled') throw new OpError('This e-way bill was cancelled.')
  if (cur?.status === 'generated' && cur.ewbNo !== no) throw new OpError('This bill already has a different e-way bill number recorded.')
  const dup = listOf(state.ewayBills).find((r) => r.ewbNo === no && r.billId !== billId)
  if (dup) throw new OpError(`That e-way bill number is already recorded against ${dup.billNo}.`)
  const record: EwayRecord = stripUndefined({
    ...(cur ?? { id: ewayId(billId), billId, billNo: bill.no, preparedAt: ctx.now, userId: ctx.userId, transport: { mode: 'road' as const, distanceKm: 0 } }),
    status: 'generated' as const, ewbNo: no, validUpto: a.validUpto || undefined, generatedAt: cur?.generatedAt ?? ctx.now, ...(bill.branchId ? { branchId: bill.branchId } : {}),
  })
  return { record, changes: { put: { ewayBills: [record], audit: [audit(ctx, 'EWAY_NUMBER', `${bill.no} — ${no}`)] } } }
}

export function cancelEwayBill(state: DataState, billId: string, reason: string, ctx: OpCtx): { changes: Changes; record: EwayRecord } {
  const cur = state.ewayBills[ewayId(billId)]
  if (!cur || cur.status !== 'generated') throw new OpError('Only an e-way bill with a number can be marked cancelled.')
  if (!reason.trim()) throw new OpError('Say why it was cancelled.')
  const record: EwayRecord = { ...cur, status: 'cancelled', cancelledAt: ctx.now, cancelReason: reason.trim() }
  return { record, changes: { put: { ewayBills: [record], audit: [audit(ctx, 'EWAY_CANCEL', `${cur.billNo}: ${reason.trim()}`)] } } }
}
