import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import { audit, OpError, type OpCtx } from '@/data/ops'
import { applyChanges, listOf, mergeChanges, type Changes, type DataState } from '@/data/state'
import { nextNo } from '../numbering'
import { compareQuotes, quoteId, quotesFor } from './quotes'
import { savePurchaseOrder } from './ops'
import type { PurchaseOrder, Rfq, RfqQuote, SupplierPrice } from './types'
import './replication'

// ───────────────────────────── price lists ─────────────────────────────

export interface PriceDraft { supplierId: string; variantId: string; price: number; minQty?: number; validFrom?: number; validTo?: number; leadDays?: number; note?: string }

/** Adds or changes a supplier's price for an item at a quantity break (one row per supplier, item and minimum quantity). */
export function saveSupplierPrice(state: DataState, d: PriceDraft, ctx: OpCtx): { changes: Changes; price: SupplierPrice } {
  const s = state.suppliers[d.supplierId]
  if (!s) throw new OpError('Choose a supplier.')
  const v = state.variants[d.variantId]
  if (!v) throw new OpError('Choose an item.')
  if (!(d.price > 0)) throw new OpError('Enter the price.')
  const minQty = d.minQty && d.minQty > 0 ? d.minQty : 1
  if (d.validFrom && d.validTo && d.validTo < d.validFrom) throw new OpError('The price cannot end before it starts.')
  const same = listOf(state.supplierPrices).find((p) => p.supplierId === d.supplierId && p.variantId === d.variantId && p.minQty === minQty)
  const price: SupplierPrice = {
    id: same?.id ?? id('sx_', ctx.now), supplierId: d.supplierId, variantId: d.variantId, price: round2(d.price), minQty,
    ...(d.validFrom ? { validFrom: d.validFrom } : {}), ...(d.validTo ? { validTo: d.validTo } : {}), ...(d.leadDays ? { leadDays: d.leadDays } : {}), note: (d.note ?? '').trim(),
  }
  return { price, changes: { put: { supplierPrices: [price], audit: [audit(ctx, 'SUPPLIER_PRICE', `${s.name}: ${v.sku} ₹${price.price} from ${minQty}`)] } } }
}

export function deleteSupplierPrice(state: DataState, priceId: string, ctx: OpCtx): { changes: Changes } {
  const p = state.supplierPrices[priceId]
  if (!p) throw new OpError('That price no longer exists.')
  return { changes: { del: { supplierPrices: [priceId] }, put: { audit: [audit(ctx, 'SUPPLIER_PRICE_DELETE', `${state.suppliers[p.supplierId]?.name ?? 'Supplier'}: ${state.variants[p.variantId]?.sku ?? p.variantId}`)] } } }
}

// ───────────────────────────── requests for quotation ─────────────────────────────

export interface RfqDraft { title: string; items: Array<{ variantId: string; qty: number }>; supplierIds: string[]; closesOn?: number; notes?: string }

export function createRfq(state: DataState, d: RfqDraft, ctx: OpCtx): { changes: Changes; rfq: Rfq } {
  if (!d.title.trim()) throw new OpError('Give the request a name.')
  const items: Rfq['items'] = []
  for (const l of d.items) {
    if (!state.variants[l.variantId]) throw new OpError('One of the items no longer exists.')
    if (!(l.qty > 0)) throw new OpError('Every item needs a quantity.')
    const dup = items.find((i) => i.variantId === l.variantId)
    if (dup) dup.qty += l.qty
    else items.push({ variantId: l.variantId, qty: l.qty })
  }
  if (!items.length) throw new OpError('Add at least one item to ask about.')
  const supplierIds = [...new Set(d.supplierIds)].filter((s) => state.suppliers[s])
  if (supplierIds.length < 1) throw new OpError('Choose the suppliers to ask.')
  const rfq: Rfq = {
    id: id('rfq_', ctx.now), no: nextNo('RFQ-', listOf(state.rfqs).map((r) => r.no), ctx), title: d.title.trim(), date: ctx.now, ...(d.closesOn ? { closesOn: d.closesOn } : {}),
    status: 'open', items, supplierIds, notes: (d.notes ?? '').trim(), poIds: [], createdBy: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  return { rfq, changes: { put: { rfqs: [rfq], audit: [audit(ctx, 'RFQ_CREATE', `${rfq.no} — ${rfq.title}, ${items.length} items, ${supplierIds.length} suppliers`)] } } }
}

export interface QuoteDraft { rfqId: string; supplierId: string; prices: Record<string, number>; freight?: number; leadDays?: number; validTill?: number; terms?: string }

/** Records (or replaces) one supplier's answer to a request. */
export function recordQuote(state: DataState, d: QuoteDraft, ctx: OpCtx): { changes: Changes; quote: RfqQuote } {
  const rfq = state.rfqs[d.rfqId]
  if (!rfq) throw new OpError('That request no longer exists.')
  if (rfq.status !== 'open') throw new OpError('This request is closed; quotes can no longer be added.')
  if (!state.suppliers[d.supplierId]) throw new OpError('Choose a supplier.')
  const prices: Record<string, number> = {}
  for (const it of rfq.items) {
    const p = d.prices[it.variantId]
    if (p === undefined || p === null || Number.isNaN(p)) continue
    if (!(p > 0)) throw new OpError('A price has to be more than zero (leave it blank when the supplier did not quote the item).')
    prices[it.variantId] = round2(p)
  }
  if (!Object.keys(prices).length) throw new OpError('Enter at least one price.')
  if ((d.freight ?? 0) < 0) throw new OpError('Freight cannot be negative.')
  const quote: RfqQuote = {
    id: quoteId(d.rfqId, d.supplierId), rfqId: d.rfqId, supplierId: d.supplierId, prices, freight: round2(d.freight ?? 0),
    ...(d.leadDays ? { leadDays: d.leadDays } : {}), ...(d.validTill ? { validTill: d.validTill } : {}), terms: (d.terms ?? '').trim(), date: ctx.now,
  }
  return { quote, changes: { put: { rfqQuotes: [quote], audit: [audit(ctx, 'RFQ_QUOTE', `${rfq.no} — ${state.suppliers[d.supplierId].name}`)] } } }
}

export type Award = { mode: 'cheapest-each' } | { mode: 'single'; supplierId: string }

/**
 * Turns the winning quotes into draft purchase orders (one per supplier) at the quoted prices, and marks the request awarded.
 * Orders are drafts: they still go through approval before being sent.
 */
export function awardRfq(state: DataState, rfqId: string, award: Award, ctx: OpCtx): { changes: Changes; orders: PurchaseOrder[] } {
  const rfq = state.rfqs[rfqId]
  if (!rfq) throw new OpError('That request no longer exists.')
  if (rfq.status !== 'open') throw new OpError('This request has already been awarded or closed.')
  const quotes = quotesFor(state, rfqId)
  const cmp = compareQuotes(rfq, quotes)
  const bySupplier = new Map<string, Array<{ variantId: string; qty: number; cost: number }>>()
  if (award.mode === 'single') {
    const col = cmp.columns.find((c) => c.supplierId === award.supplierId)
    if (!col) throw new OpError('That supplier has not quoted.')
    if (!col.complete) throw new OpError('That supplier did not quote every item — award item by item instead.')
    bySupplier.set(award.supplierId, rfq.items.map((i) => ({ variantId: i.variantId, qty: i.qty, cost: col.prices[i.variantId] as number })))
  } else {
    if (!cmp.split) throw new OpError('Not every item has a quote yet.')
    for (const l of cmp.split.lines) bySupplier.set(l.supplierId, [...(bySupplier.get(l.supplierId) ?? []), { variantId: l.variantId, qty: l.qty, cost: l.price }])
  }
  let working = state
  let changes: Changes = {}
  const orders: PurchaseOrder[] = []
  for (const [supplierId, items] of bySupplier) {
    const r = savePurchaseOrder(working, { supplierId, notes: `From ${rfq.no} — ${rfq.title}`, items }, undefined, { ...ctx, now: ctx.now + orders.length })
    orders.push(r.order)
    changes = mergeChanges(changes, r.changes)
    working = applyChanges(working, r.changes)
  }
  const done: Rfq = { ...rfq, status: 'awarded', poIds: orders.map((o) => o.id) }
  changes = mergeChanges(changes, { put: { rfqs: [done], audit: [audit(ctx, 'RFQ_AWARD', `${rfq.no} → ${orders.map((o) => o.no).join(', ')}`)] } })
  return { orders, changes }
}

export function closeRfq(state: DataState, rfqId: string, ctx: OpCtx): { changes: Changes } {
  const rfq = state.rfqs[rfqId]
  if (!rfq) throw new OpError('That request no longer exists.')
  if (rfq.status !== 'open') throw new OpError('This request is already closed.')
  return { changes: { put: { rfqs: [{ ...rfq, status: 'closed' }], audit: [audit(ctx, 'RFQ_CLOSE', rfq.no)] } } }
}
