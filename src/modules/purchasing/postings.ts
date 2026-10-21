import { expenseAccount, registerPostingRule, type AccountKey, type Posting, type PostingLine } from '@/modules/postings'
import type { LandedCost, PayMode, PurchaseInvoice, PurchaseReturn, SupplierPayment } from './types'

/**
 * What this module's documents mean to the books. Goods received (and what was paid when they arrived) are booked by the
 * accounting module's rule for `purchases`; these rules cover the rest.
 *
 *   • A supplier payment: Dr payables (the supplier), Cr cash / bank / UPI / card. Money beyond what was owed debits the same
 *     account, so the supplier's balance goes negative — an advance.
 *   • A purchase invoice: the tax is split into credit to claim (Dr GST input) and tax that cannot be claimed (part of the cost).
 *       standalone      Dr purchases / the expense, Dr GST input, Cr payables
 *       receipt-gross   the receipt already booked the whole bill into stock: move the claimable tax out of stock into GST input
 *       receipt-net     the receipt booked the goods before tax: book the tax (GST input + cost) and owe it to the supplier
 *   • A debit note: Dr payables, Cr stock at cost; the tax Cr GST input (credit given back) or Cr stock when it was never
 *     claimed. Money the supplier handed back at once: Dr cash / bank, Cr payables.
 *   • Landed cost: Dr stock (units in hand) and cost of goods sold (units sold), Dr GST input, Cr payables (the transporter /
 *     clearing agent) or Cr the way it was paid.
 *   • A reversal posts its original with debits and credits turned round.
 */
const MONEY: Record<PayMode, AccountKey> = { cash: 'cash', upi: 'upi', card: 'card', bank: 'bank', cheque: 'bank' }
const paise = (n: number | undefined) => Math.round((Number(n) || 0) * 100)
const rupees = (p: number) => p / 100

interface Acc { debit: number; credit: number; lines: PostingLine[] }
const book = (): Acc => ({ debit: 0, credit: 0, lines: [] })
function dr(a: Acc, account: AccountKey, p: number, party?: PostingLine['party']) {
  if (p <= 0) return
  a.debit += p; a.lines.push({ account, debit: rupees(p), ...(party ? { party } : {}) })
}
function cr(a: Acc, account: AccountKey, p: number, party?: PostingLine['party']) {
  if (p <= 0) return
  a.credit += p; a.lines.push({ account, credit: rupees(p), ...(party ? { party } : {}) })
}
const supplier = (id: string) => ({ type: 'supplier', id }) as const
const heads = (h: { cgst: number; sgst: number; igst: number }) => [
  ['gst_input_cgst', paise(h.cgst)], ['gst_input_sgst', paise(h.sgst)], ['gst_input_igst', paise(h.igst)],
] as Array<[AccountKey, number]>

/** The posting turned the other way round (for a reversal). */
export function reversed(p: Posting, memo: string): Posting {
  return { ...p, memo, lines: p.lines.map((l) => ({ account: l.account, ...(l.credit ? { debit: l.credit } : {}), ...(l.debit ? { credit: l.debit } : {}), ...(l.party ? { party: l.party } : {}) })) }
}
const finish = (a: Acc, date: number, memo: string, branchId: string | undefined, reverses: string | undefined): Posting | null => {
  if (a.lines.length < 2) return null
  const p: Posting = { date, memo, lines: a.lines, ...(branchId ? { branchId } : {}) }
  return reverses ? reversed(p, `Reversal — ${memo}`) : p
}

export function paymentPosting(p: SupplierPayment): Posting | null {
  if (!(p.amount > 0)) return null
  return finish({ debit: 0, credit: 0, lines: [{ account: 'payables', debit: p.amount, party: supplier(p.supplierId) }, { account: MONEY[p.mode] ?? 'cash', credit: p.amount }] },
    p.date, `Payment ${p.no}${p.ref ? ` · ${p.ref}` : ''}`, p.branchId, p.reverses)
}

export function invoicePosting(i: PurchaseInvoice): Posting | null {
  const a = book()
  const tax = paise(i.cgst) + paise(i.sgst) + paise(i.igst)
  const claim = i.itc.eligible ? paise(i.itc.cgst) + paise(i.itc.sgst) + paise(i.itc.igst) : 0
  const memo = `Purchase invoice ${i.no} · ${i.invoiceNo}`
  if (i.basis === 'standalone') {
    const cost = i.kind === 'goods' ? 'purchases' : expenseAccount(i.head || 'Other')
    dr(a, cost, paise(i.taxable) + (tax - claim))
    if (i.itc.eligible) for (const [k, p] of heads(i.itc)) dr(a, k, p)
    const ro = paise(i.roundOff)
    if (ro > 0) dr(a, 'round_off', ro); else if (ro < 0) cr(a, 'round_off', -ro)
    cr(a, 'payables', paise(i.payable), supplier(i.supplierId))
  } else if (i.basis === 'receipt-gross') {
    if (i.itc.eligible) for (const [k, p] of heads(i.itc)) dr(a, k, p)
    cr(a, 'inventory', claim)
  } else {
    const owe = paise(i.payable)
    if (i.itc.eligible) for (const [k, p] of heads(i.itc)) dr(a, k, p)
    if (owe - claim >= 0) dr(a, 'inventory', owe - claim); else cr(a, 'inventory', claim - owe)
    cr(a, 'payables', owe, supplier(i.supplierId))
  }
  return finish(a, i.invoiceDate, memo, i.branchId, i.reverses)
}

export function returnPosting(r: PurchaseReturn): Posting | null {
  if (!(r.total > 0)) return null
  const a = book()
  const tax = paise(r.cgst) + paise(r.sgst) + paise(r.igst)
  dr(a, 'payables', paise(r.total), supplier(r.supplierId))
  cr(a, 'inventory', paise(r.taxable) + (r.itcReversed ? 0 : tax))
  if (r.itcReversed) for (const [k, p] of heads(r)) cr(a, k, p)
  if (r.refund > 0) { dr(a, MONEY[r.refundMode ?? 'cash'] ?? 'cash', paise(r.refund)); cr(a, 'payables', paise(r.refund), supplier(r.supplierId)) }
  return finish(a, r.date, `Debit note ${r.no}`, r.branchId, r.reverses)
}

export function landedPosting(l: LandedCost): Posting | null {
  if (!(l.total > 0)) return null
  const a = book()
  const toStock = l.lines.reduce((s, x) => s + paise(x.toStock), 0)
  const toCogs = l.lines.reduce((s, x) => s + paise(x.toCogs), 0)
  dr(a, 'inventory', toStock)
  dr(a, 'cogs', toCogs)
  const itc = paise(l.itc)
  const half = Math.floor(itc / 2)
  if (l.interState) dr(a, 'gst_input_igst', itc)
  else { dr(a, 'gst_input_cgst', half); dr(a, 'gst_input_sgst', itc - half) }
  if (l.payeeId) cr(a, 'payables', paise(l.total), supplier(l.payeeId))
  else cr(a, MONEY[l.mode ?? 'cash'] ?? 'cash', paise(l.total))
  return finish(a, l.date, `Landed cost ${l.no}`, l.branchId, l.reverses)
}

registerPostingRule<SupplierPayment>('supplierPayments', (p) => paymentPosting(p))
registerPostingRule<PurchaseInvoice>('purchaseInvoices', (i) => invoicePosting(i))
registerPostingRule<PurchaseReturn>('purchaseReturns', (r) => returnPosting(r))
registerPostingRule<LandedCost>('landedCosts', (l) => landedPosting(l))
