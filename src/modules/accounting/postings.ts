import type { Bill, DaySession, Expense, Purchase, StockMove } from '@/domain/types'
import { GST_PAYMENT_CATEGORY } from '@/domain/analytics'
import type { DataState } from '@/data/state'
import { expenseAccount, registerPostingRule, type Posting, type PostingLine } from '../postings'
import type { Voucher } from './types'
import './types'

/**
 * What the core documents mean to the books. Money is worked in whole paise so a posting always balances to the paisa.
 * Each rule returns ONE posting per document, so a document is never half-booked.
 */

const paise = (n: number | undefined) => Math.round((Number(n) || 0) * 100)
const rupees = (p: number) => p / 100

interface Acc { debit: number; credit: number; lines: PostingLine[] }
const book = (): Acc => ({ debit: 0, credit: 0, lines: [] })
function dr(a: Acc, account: string, p: number, party?: PostingLine['party']) {
  if (p <= 0) return
  a.debit += p; a.lines.push({ account, debit: rupees(p), ...(party ? { party } : {}) })
}
function cr(a: Acc, account: string, p: number, party?: PostingLine['party']) {
  if (p <= 0) return
  a.credit += p; a.lines.push({ account, credit: rupees(p), ...(party ? { party } : {}) })
}

/** How each way of paying is booked. Anything not listed lands in suspense, where it shows up as needing an account. */
const TENDER: Record<string, string> = {
  cash: 'cash', upi: 'upi', card: 'card', bank: 'bank', cheque: 'bank', wallet: 'wallet',
  giftcard: 'gift_cards', advance: 'advances_received', credit: 'store_credit', due: 'receivables',
}
const tenderAccount = (mode: string) => TENDER[mode] ?? 'suspense'
const EXPENSE_MODE: Record<string, string> = { cash: 'cash', card: 'card', upi: 'upi', bank: 'bank' }

type BillWithIgst = Bill & { igstTotal?: number }

/** A sale: customers pay (tenders) → Sales + GST, round-off, and the stock that left at cost. A credit note is the mirror image. */
export function billPosting(bill: Bill): Posting | null {
  if (bill.status === 'held') return null
  const credit = !!bill.refundOfBillId || bill.total < 0
  const total = Math.abs(paise(bill.total))
  if (total === 0 && !bill.items.length) return null
  const party = bill.customerId ? ({ type: 'customer', id: bill.customerId } as const) : undefined
  const a = book()

  // 1. The tender side (what the customer paid with / was refunded with)
  const tender = (account: string, p: number, withParty = false) => (credit ? cr : dr)(a, account, p, withParty ? party : undefined)
  let cash = 0
  for (const pay of bill.payments) {
    const p = Math.abs(paise(pay.amount))
    if (!p) continue
    if (pay.mode === 'cash') { cash += p; continue }
    tender(tenderAccount(pay.mode), p, pay.mode === 'due' || pay.mode === 'credit' || pay.mode === 'advance')
  }
  // Cash handed over in excess comes back as change.
  cash = Math.max(0, cash - (credit ? 0 : Math.abs(paise(bill.changeDue))))
  tender('cash', cash)
  if (!credit) tender('store_credit', Math.abs(paise(bill.creditUsed)), true)
  // Anything left between the bill and what was tendered is points redeemed (or, with no points, an oddity for suspense).
  const tendered = credit ? a.credit : a.debit
  const rest = total - tendered
  if (rest > 0) tender(!credit && bill.loyaltyRedeemed > 0 ? 'discounts' : 'suspense', rest)
  else if (rest < 0) (credit ? dr : cr)(a, 'suspense', -rest)

  // 2. The revenue side
  const side = credit ? dr : cr
  const other = credit ? cr : dr
  const cg = Math.abs(paise(bill.cgstTotal)), sg = Math.abs(paise(bill.sgstTotal)), ig = Math.abs(paise((bill as BillWithIgst).igstTotal))
  side(a, 'gst_output_cgst', cg); side(a, 'gst_output_sgst', sg); side(a, 'gst_output_igst', ig)
  const ro = paise(bill.roundOff)
  // total = subtotal + roundOff, so the sale itself is total − roundOff − GST.
  const sales = total - ro - cg - sg - ig
  if (ro > 0) side(a, 'round_off', ro); else if (ro < 0) other(a, 'round_off', -ro)
  if (sales >= 0) side(a, credit ? 'sales_returns' : 'sales', sales); else other(a, credit ? 'sales_returns' : 'sales', -sales)

  // 3. The stock that went out (or came back), at the cost recorded on the line
  const cogs = bill.items.reduce((s, i) => s + (i.cost && i.cost > 0 ? Math.round(Math.abs(i.qty) * i.cost * 100) : 0), 0)
  if (cogs > 0) {
    if (credit) { dr(a, 'inventory', cogs); cr(a, 'cogs', cogs) } else { dr(a, 'cogs', cogs); cr(a, 'inventory', cogs) }
  }

  if (a.lines.length < 2) return null
  return { date: bill.date, memo: `${credit ? 'Credit note' : 'Sale'} ${bill.no}`, lines: a.lines, ...(bill.branchId ? { branchId: bill.branchId } : {}) }
}

/** Goods received: stock in at cost, owed to the supplier; whatever was paid at the time settles part of it. */
export function purchasePosting(p: Purchase): Posting | null {
  const total = paise(p.total)
  if (total <= 0) return null
  const paid = Math.max(0, Math.min(paise(p.paid), total))
  const party = { type: 'supplier', id: p.supplierId } as const
  const a = book()
  dr(a, 'inventory', total)
  cr(a, 'payables', total, party)
  if (paid > 0) { dr(a, 'payables', paid, party); cr(a, 'cash', paid) }
  return { date: p.date, memo: `Goods received ${p.no}`, lines: a.lines, ...(p.branchId ? { branchId: p.branchId } : {}) }
}

/** An expense: the cost, and the way it was paid. GST paid to the government is a settlement of a liability, not a cost. */
export function expensePosting(e: Expense): Posting | null {
  const amt = paise(e.amount)
  if (amt <= 0) return null
  const a = book()
  dr(a, e.category === GST_PAYMENT_CATEGORY ? 'gst_paid' : expenseAccount(e.category || 'Other'), amt)
  cr(a, EXPENSE_MODE[e.mode] ?? 'cash', amt)
  return { date: e.date, memo: `${e.category}${e.vendor ? ` — ${e.vendor}` : ''}`, lines: a.lines }
}

/** Opening stock brings stock into the books at what it cost, against the owner's capital. Receipts, sales and counts post elsewhere. */
export function openingStockPosting(m: StockMove, state: DataState): Posting | null {
  if (m.type !== 'opening' || !(m.qty > 0)) return null
  const v = state.variants[m.variantId]
  if (!v) return null
  const trackStock = state.products[v.productId]?.trackStock !== false
  const value = trackStock ? Math.round(m.qty * (v.avgCost ?? v.cost) * 100) : 0
  if (value <= 0) return null
  const a = book()
  dr(a, 'inventory', value)
  cr(a, 'owner_capital', value)
  return { date: m.at, memo: `Opening stock ${v.sku}`, lines: a.lines }
}

/** A drawer that closed over or short: the cash account is brought to what was actually counted. */
export function sessionPosting(s: DaySession): Posting | null {
  const v = paise(s.variance)
  if (!s.closedAt || v === 0) return null
  const a = book()
  if (v > 0) { dr(a, 'cash', v); cr(a, 'cash_over_short', v) } else { dr(a, 'cash_over_short', -v); cr(a, 'cash', -v) }
  return { date: s.closedAt, memo: v > 0 ? 'Cash over at day close' : 'Cash short at day close', lines: a.lines }
}

/** A hand-made entry (receipt, payment, journal, contra, year-end closing): its lines are the posting. */
export function voucherPosting(v: Voucher): Posting | null {
  const lines: PostingLine[] = v.lines
    .filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)
    .map((l) => ({ account: l.account, ...(l.debit ? { debit: l.debit } : {}), ...(l.credit ? { credit: l.credit } : {}), ...(l.party ? { party: l.party } : {}) }))
  return lines.length >= 2 ? { date: v.date, memo: `${v.no}${v.narration ? ` — ${v.narration}` : ''}`, lines, ...(v.branchId ? { branchId: v.branchId } : {}) } : null
}

registerPostingRule<Bill>('bills', (b) => billPosting(b))
registerPostingRule<Purchase>('purchases', (p) => purchasePosting(p))
registerPostingRule<Expense>('expenses', (e) => expensePosting(e))
registerPostingRule<StockMove>('moves', (m, s) => openingStockPosting(m, s))
registerPostingRule<DaySession>('sessions', (s) => sessionPosting(s))
registerPostingRule<Voucher>('vouchers', (v) => voucherPosting(v))
