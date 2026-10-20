import { id } from '@/domain/ids'
import { round2 } from '@/domain/money'
import type { Bill } from '@/domain/types'
import { audit, OpError, processReturn, type OpCtx } from '@/data/ops'
import { listOf, mergeChanges, type Changes, type DataState } from '@/data/state'
import { localEffects, withEffects } from '@/replication/local'
import type { ReturnLine } from '@/domain/returns'
import { nextNo } from '../numbering'
import { findGiftCard, giftCardBalance, makeCode, normalizeCode } from './giftcards'
import { allocateOldestFirst, receivables } from './logic'
import type { Collection, CollectionMode, CreditSettings, CreditTopup, CustomerTerms, GiftCard, GiftCardTxn } from './types'
import './replication'

const MODES: CollectionMode[] = ['cash', 'upi', 'card', 'bank', 'cheque']
const need = (state: DataState, customerId: string) => {
  const c = state.customers[customerId]
  if (!c) throw new OpError('That customer no longer exists.')
  return c
}
const cleanMode = (m: string): CollectionMode => {
  if (!MODES.includes(m as CollectionMode)) throw new OpError('Choose how the money was received.')
  return m as CollectionMode
}

// ───────────────────────────── terms and settings ─────────────────────────────

export interface TermsDraft { creditLimit: number; creditDays: number; blocked: boolean; notes: string }

/** A customer's credit limit and days to pay. A limit of 0 means no limit. */
export function saveCustomerTerms(state: DataState, customerId: string, d: TermsDraft, ctx: OpCtx): { changes: Changes; terms: CustomerTerms } {
  const c = need(state, customerId)
  if (!(d.creditLimit >= 0)) throw new OpError('The credit limit cannot be negative.')
  if (!Number.isInteger(d.creditDays) || d.creditDays < 0 || d.creditDays > 365) throw new OpError('Days to pay must be a whole number from 0 to 365.')
  const terms: CustomerTerms = { id: customerId, customerId, creditLimit: round2(d.creditLimit), creditDays: d.creditDays, blocked: d.blocked, notes: d.notes.trim() }
  return { terms, changes: { put: { customerTerms: [terms], audit: [audit(ctx, 'CREDIT_TERMS', `${c.name}: limit ₹${terms.creditLimit || 'none'}, ${terms.creditDays} days${terms.blocked ? ', no credit' : ''}`)] } } }
}

export function saveCreditSettings(state: DataState, patch: Partial<Omit<CreditSettings, 'id'>>, ctx: OpCtx): { changes: Changes; settings: CreditSettings } {
  const cur: CreditSettings = state.creditSettings?.credit ?? { id: 'credit', upiId: '', payeeName: '', defaultDays: 30, reminderTone: 'polite' }
  const next: CreditSettings = { ...cur, ...patch, id: 'credit' }
  if (next.upiId && !/^[\w.\-]{2,}@[A-Za-z][\w.\-]{1,}$/.test(next.upiId.trim())) throw new OpError('A UPI id looks like shop@bank.')
  if (!Number.isInteger(next.defaultDays) || next.defaultDays < 0 || next.defaultDays > 365) throw new OpError('Days to pay must be a whole number from 0 to 365.')
  next.upiId = next.upiId.trim()
  next.payeeName = next.payeeName.trim()
  return { settings: next, changes: { put: { creditSettings: [next], audit: [audit(ctx, 'CREDIT_SETTINGS', Object.keys(patch).join(', '))] } } }
}

// ───────────────────────────── collections ─────────────────────────────

export interface CollectionDraft {
  customerId: string
  amount: number
  mode: CollectionMode
  ref?: string
  date?: number
  /** Which bills it settles; leave out to settle the oldest first. */
  allocations?: Array<{ billId: string; amount: number }>
  note?: string
}

/** Records money received from a customer, settles their oldest bills with it (or the ones chosen) and keeps any excess as an advance. */
export function recordCollection(state: DataState, d: CollectionDraft, ctx: OpCtx): { changes: Changes; collection: Collection } {
  const customer = need(state, d.customerId)
  const amount = round2(d.amount)
  if (!(amount > 0)) throw new OpError('Enter the amount received.')
  const mode = cleanMode(d.mode)
  const open = receivables(state).byCustomer[d.customerId]?.bills.filter((b) => b.outstanding > 0) ?? []

  let allocations: Collection['allocations']
  let advance: number
  if (d.allocations) {
    allocations = []
    for (const a of d.allocations) {
      const b = open.find((x) => x.billId === a.billId)
      if (!b) throw new OpError('One of those bills is not owed by this customer, or is already settled.')
      const amt = round2(a.amount)
      if (!(amt > 0)) continue
      if (amt > b.outstanding + 0.001) throw new OpError(`${b.no} only has ₹${b.outstanding} outstanding.`)
      allocations.push({ billId: a.billId, amount: amt })
    }
    const used = round2(allocations.reduce((s, a) => s + a.amount, 0))
    if (used > amount + 0.001) throw new OpError('You have allocated more than was received.')
    advance = round2(amount - used)
  } else ({ allocations, advance } = allocateOldestFirst(open, amount))

  const collection: Collection = {
    id: id('rc_', ctx.now), no: nextNo('RC-', listOf(state.collections).map((c) => c.no), ctx), customerId: d.customerId, amount, mode, ref: (d.ref ?? '').trim(),
    date: d.date ?? ctx.now, allocations, advance, note: (d.note ?? '').trim(), userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  const base: Changes = { put: { collections: [collection], audit: [audit(ctx, 'COLLECTION', `${collection.no} — ${customer.name} ₹${amount} by ${mode}${advance ? ` (₹${advance} advance)` : ''}`)] } }
  return { collection, changes: withEffects(state, base, ['collections'], ctx.now) }
}

// ───────────────────────────── returns against what is owed ─────────────────────────────

/**
 * A return for a bill that is still partly unpaid. What the customer owes comes down first (the credit note carries a negative
 * 'due' line); only the part that was really paid is refunded in cash. Use this instead of the ordinary return when something is
 * outstanding on the bill — otherwise the shop pays out cash for goods that were never paid for.
 */
export function returnOnAccount(state: DataState, billId: string, lines: ReturnLine[], ctx: OpCtx, reason = ''): { changes: Changes; creditNote: Bill; reducedDue: number; cashRefund: number } {
  const original = state.bills[billId]
  if (!original) throw new OpError('Original bill not found.')
  if (!original.customerId) throw new OpError('Only a bill with a customer can be on account.')
  const due = receivables(state).byCustomer[original.customerId]?.bills.find((b) => b.billId === billId)?.outstanding ?? 0
  if (!(due > 0)) throw new OpError('Nothing is owed on this bill — use the ordinary return.')

  const base = processReturn(state, billId, lines, 'cash', ctx, reason)
  const note = base.creditNote
  const value = round2(Math.abs(note.total))
  const against = round2(Math.min(value, due))
  const cash = round2(value - against)
  const creditNote: Bill = {
    ...note,
    payments: [...(cash > 0 ? [{ mode: 'cash' as const, amount: -cash }] : []), { mode: 'due', amount: -against }],
    paid: -cash,
    notes: `${note.notes} · ₹${against} taken off what is owed`,
  }
  const { outbox: _drop, ...rest } = base.changes
  void _drop
  // The customer and the original bill are recomputed from the final credit note, so every effect (points, dues) is applied once.
  const fx = localEffects(state, { put: { bills: [creditNote] } }, ['bills'], ctx.now)
  const audited: Changes = { put: { audit: [audit(ctx, 'RETURN_ON_ACCOUNT', `${creditNote.no} against ${original.no} — ₹${against} off dues${cash ? `, ₹${cash} cash back` : ''}`)] } }
  return { creditNote, reducedDue: against, cashRefund: cash, changes: mergeChanges(rest, { put: { bills: [creditNote] } }, fx, audited) }
}

// ───────────────────────────── gift cards ─────────────────────────────

export interface GiftCardDraft { value: number; mode: CollectionMode; code?: string; customerId?: string; expiresAt?: number; note?: string }

/** Sells (issues) a gift card: the value is loaded onto it and the money is taken in whatever way it was paid for. */
export function issueGiftCard(state: DataState, d: GiftCardDraft, ctx: OpCtx, rnd?: () => number): { changes: Changes; card: GiftCard; txn: GiftCardTxn } {
  const value = round2(d.value)
  if (!(value > 0)) throw new OpError('Enter the value of the card.')
  if (d.customerId) need(state, d.customerId)
  if (d.expiresAt && d.expiresAt < ctx.now) throw new OpError('The expiry date is in the past.')
  const taken = new Set(listOf(state.giftCards).map((g) => g.code))
  let code = d.code ? normalizeCode(d.code) : makeCode(taken, rnd)
  if (!/^[A-Z0-9-]{4,24}$/.test(code)) throw new OpError('A card code is 4–24 letters, numbers or dashes.')
  if (taken.has(code)) throw new OpError(`The code ${code} is already used by another card.`)
  const card: GiftCard = { id: id('gc_', ctx.now), code, value, ...(d.customerId ? { customerId: d.customerId } : {}), ...(d.expiresAt ? { expiresAt: d.expiresAt } : {}), note: (d.note ?? '').trim(), issuedAt: ctx.now, issuedBy: ctx.userId, active: true }
  const txn: GiftCardTxn = { id: id('gt_', ctx.now), cardId: card.id, type: 'issue', amount: value, mode: cleanMode(d.mode), date: ctx.now, userId: ctx.userId, note: 'Card issued', ...(ctx.branchId ? { branchId: ctx.branchId } : {}) }
  code = card.code
  return { card, txn, changes: { put: { giftCards: [card], giftCardTxns: [txn], audit: [audit(ctx, 'GIFTCARD_ISSUE', `${code} ₹${value}`)] } } }
}

/** Puts more money on an existing card. */
export function rechargeGiftCard(state: DataState, cardId: string, amount: number, mode: CollectionMode, ctx: OpCtx): { changes: Changes; txn: GiftCardTxn } {
  const card = state.giftCards[cardId]
  if (!card) throw new OpError('That gift card no longer exists.')
  if (!card.active) throw new OpError('This card has been cancelled.')
  const amt = round2(amount)
  if (!(amt > 0)) throw new OpError('Enter the amount to add.')
  const txn: GiftCardTxn = { id: id('gt_', ctx.now), cardId, type: 'issue', amount: amt, mode: cleanMode(mode), date: ctx.now, userId: ctx.userId, note: 'Recharged', ...(ctx.branchId ? { branchId: ctx.branchId } : {}) }
  return { txn, changes: { put: { giftCardTxns: [txn], audit: [audit(ctx, 'GIFTCARD_RECHARGE', `${card.code} +₹${amt}`)] } } }
}

/** Gives money back onto a card (a returned item that was paid for with it). */
export function refundToGiftCard(state: DataState, cardId: string, amount: number, billId: string | undefined, ctx: OpCtx): { changes: Changes; txn: GiftCardTxn } {
  const card = state.giftCards[cardId]
  if (!card) throw new OpError('That gift card no longer exists.')
  const amt = round2(amount)
  if (!(amt > 0)) throw new OpError('Enter the amount to give back.')
  const txn: GiftCardTxn = { id: id('gt_', ctx.now), cardId, type: 'refund', amount: amt, ...(billId ? { billId } : {}), date: ctx.now, userId: ctx.userId, note: 'Refund onto the card', ...(ctx.branchId ? { branchId: ctx.branchId } : {}) }
  return { txn, changes: { put: { giftCardTxns: [txn], audit: [audit(ctx, 'GIFTCARD_REFUND', `${card.code} +₹${amt}`)] } } }
}

/** Cancels a card so it can no longer be spent. Its history stays. */
export function cancelGiftCard(state: DataState, cardId: string, ctx: OpCtx): { changes: Changes } {
  const card = state.giftCards[cardId]
  if (!card) throw new OpError('That gift card no longer exists.')
  if (!card.active) throw new OpError('This card is already cancelled.')
  return { changes: { put: { giftCards: [{ ...card, active: false }], audit: [audit(ctx, 'GIFTCARD_CANCEL', `${card.code} (₹${giftCardBalance(state, cardId)} left)`)] } } }
}

/** The ledger entries that spending gift cards on a bill creates: one per gift-card tender, the card found by the code on the payment. */
export function redemptionsFor(state: DataState, bill: Bill, ctx: OpCtx): GiftCardTxn[] {
  const out: GiftCardTxn[] = []
  for (const p of bill.payments) {
    if (p.mode !== 'giftcard') continue
    const card = findGiftCard(state, p.ref ?? '')
    if (!card) throw new OpError(`The gift card ${p.ref ?? ''} was not found.`)
    out.push({ id: id('gt_', ctx.now), cardId: card.id, type: 'redeem', amount: round2(p.amount), billId: bill.id, date: bill.date, userId: ctx.userId, note: `Spent on ${bill.no}`, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) })
  }
  return out
}

// ───────────────────────────── store-credit top-up ─────────────────────────────

/** A customer pays money in and gets the same amount as store credit to spend later. */
export function topUpStoreCredit(state: DataState, d: { customerId: string; amount: number; mode: CollectionMode; ref?: string }, ctx: OpCtx): { changes: Changes; topup: CreditTopup } {
  const customer = need(state, d.customerId)
  const amount = round2(d.amount)
  if (!(amount > 0)) throw new OpError('Enter the amount paid in.')
  const topup: CreditTopup = {
    id: id('tu_', ctx.now), no: nextNo('TU-', listOf(state.creditTopups).map((t) => t.no), ctx), customerId: d.customerId, amount, mode: cleanMode(d.mode),
    ref: (d.ref ?? '').trim(), date: ctx.now, userId: ctx.userId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
  }
  const base: Changes = { put: { creditTopups: [topup], audit: [audit(ctx, 'CREDIT_TOPUP', `${topup.no} — ${customer.name} +₹${amount} store credit`)] } }
  return { topup, changes: withEffects(state, base, ['creditTopups'], ctx.now) }
}
