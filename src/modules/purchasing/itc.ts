import { gstinProblem, gstinState } from '@/domain/gst'
import { round2 } from '@/domain/money'
import type { StoreSettings } from '@/domain/types'
import { listOf, type DataState } from '@/data/state'
import { live } from './reversal'
import type { InvoiceLine, ItcBlock, ItcResult, PurchaseInvoice } from './types'

/**
 * GST input credit (ITC) on purchases. This is the bookkeeping side: what the supplier charged, whether credit may be taken, and
 * the register an accountant files from. It does not talk to the GST portal — matching with GSTR-2B and filing GSTR-3B happen
 * outside this app. The rules here are the common ones for a small trader; an unusual case is the accountant's call.
 */

export const ITC_BLOCK_LABEL: Record<ItcBlock, string> = {
  none: 'Credit allowed',
  food: 'Food, beverages and catering',
  vehicle: 'Motor vehicles (not for resale or transport)',
  personal: 'Personal use',
  gifts: 'Gifts and free samples',
  works: 'Construction of a building',
  club: 'Club and health memberships',
  other: 'Other blocked credit',
}
export const ITC_BLOCKS = Object.keys(ITC_BLOCK_LABEL) as ItcBlock[]

export const GST_RATES = [0, 3, 5, 12, 18, 28]

/** CGST + SGST (half each) inside the state, IGST across states. */
export function splitTax(taxable: number, rate: number, interState: boolean): { cgst: number; sgst: number; igst: number } {
  if (interState) return { cgst: 0, sgst: 0, igst: round2((taxable * rate) / 100) }
  const half = round2((taxable * rate) / 200)
  return { cgst: half, sgst: half, igst: 0 }
}

export interface InvoiceLineDraft { description: string; hsn: string; taxable: number; rate: number }

export function buildInvoiceLines(drafts: InvoiceLineDraft[], interState: boolean): InvoiceLine[] {
  return drafts.map((l) => ({ description: l.description.trim(), hsn: l.hsn.trim(), taxable: round2(l.taxable), rate: l.rate, ...splitTax(round2(l.taxable), l.rate, interState) }))
}

export interface TaxTotals { taxable: number; cgst: number; sgst: number; igst: number; tax: number }
export function taxTotals(lines: Array<Pick<InvoiceLine, 'taxable' | 'cgst' | 'sgst' | 'igst'>>): TaxTotals {
  const taxable = round2(lines.reduce((s, l) => s + l.taxable, 0))
  const cgst = round2(lines.reduce((s, l) => s + l.cgst, 0))
  const sgst = round2(lines.reduce((s, l) => s + l.sgst, 0))
  const igst = round2(lines.reduce((s, l) => s + l.igst, 0))
  return { taxable, cgst, sgst, igst, tax: round2(cgst + sgst + igst) }
}

/** Is the supply across state lines? Known when both GSTINs are, otherwise treated as local (the retail default). */
export function isInterState(store: Pick<StoreSettings, 'gstin'> | null | undefined, supplierGstin: string | undefined): boolean {
  const mine = gstinState(store?.gstin)
  const theirs = gstinState(supplierGstin)
  return !!mine && !!theirs && mine !== theirs
}

/**
 * The financial year of a date ends on 31 March. Credit on its invoices must be claimed by 30 November after that year ends
 * (or the annual return, if earlier) — section 16(4). Returns the end of that day.
 */
export function itcDeadline(invoiceDate: number): number {
  const d = new Date(invoiceDate)
  const fyEnd = d.getMonth() >= 3 ? d.getFullYear() + 1 : d.getFullYear()
  return new Date(fyEnd, 10, 30, 23, 59, 59, 999).getTime()
}
export const itcExpired = (invoiceDate: number, asOf: number) => asOf > itcDeadline(invoiceDate)

export interface ItcInput {
  supplierGstin: string
  storeRegistration: StoreSettings['registrationType']
  blocked: ItcBlock
  cgst: number
  sgst: number
  igst: number
  invoiceDate: number
  asOf: number
}

/** Whether credit may be taken on an invoice, and how much of it, in words when not. */
export function itcFor(i: ItcInput): ItcResult {
  const none = (reason: string): ItcResult => ({ eligible: false, reason, cgst: 0, sgst: 0, igst: 0 })
  if (round2(i.cgst + i.sgst + i.igst) <= 0) return none('No GST was charged on this invoice.')
  if (i.storeRegistration === 'composition' || i.storeRegistration === 'unregistered') return none('Your business is not a regular GST taxpayer, so it cannot claim input credit.')
  if (!i.supplierGstin.trim()) return none('The supplier has no GSTIN, so there is no credit to claim.')
  const bad = gstinProblem(i.supplierGstin)
  if (bad) return none(`The supplier’s GSTIN is not valid. ${bad}`)
  if (i.blocked !== 'none') return none(`Credit is blocked: ${ITC_BLOCK_LABEL[i.blocked].toLowerCase()}.`)
  if (itcExpired(i.invoiceDate, i.asOf)) return none('The time limit to claim credit on this invoice (30 November after its financial year) has passed.')
  return { eligible: true, reason: '', cgst: i.cgst, sgst: i.sgst, igst: i.igst }
}

// ───────────────────────────── the register ─────────────────────────────

export interface Heads { cgst: number; sgst: number; igst: number; total: number }
const zero = (): Heads => ({ cgst: 0, sgst: 0, igst: 0, total: 0 })
const add = (a: Heads, b: { cgst: number; sgst: number; igst: number }): Heads => {
  const cgst = round2(a.cgst + b.cgst), sgst = round2(a.sgst + b.sgst), igst = round2(a.igst + b.igst)
  return { cgst, sgst, igst, total: round2(cgst + sgst + igst) }
}

export interface ItcRow {
  invoiceId: string
  no: string
  invoiceNo: string
  supplierId: string
  supplier: string
  gstin: string
  date: number
  taxable: number
  tax: Heads
  eligible: boolean
  reason: string
  /** The last day credit can be claimed on this invoice. */
  deadline: number
}

export interface ItcRegister {
  from: number
  to: number
  rows: ItcRow[]
  /** Credit that may be claimed. */
  eligible: Heads
  /** Tax charged on which no credit may be taken (it is part of the cost). */
  blocked: Heads
  /** Credit given back because goods were returned. */
  reversed: Heads
  /** Eligible − reversed: what the period contributes to the return. */
  net: Heads
  taxable: number
}

/** Purchase invoices dated within a period with the GST on them, split into credit to claim and credit blocked, less returns. */
export function itcRegister(state: DataState, from: number, to: number): ItcRegister {
  const rows: ItcRow[] = []
  let eligible = zero(), blocked = zero(), reversed = zero()
  let taxable = 0
  for (const inv of live(listOf(state.purchaseInvoices))) {
    if (inv.invoiceDate < from || inv.invoiceDate > to) continue
    const tax = add(zero(), inv)
    rows.push({
      invoiceId: inv.id, no: inv.no, invoiceNo: inv.invoiceNo, supplierId: inv.supplierId, supplier: state.suppliers[inv.supplierId]?.name ?? 'Supplier', gstin: inv.supplierGstin,
      date: inv.invoiceDate, taxable: inv.taxable, tax, eligible: inv.itc.eligible, reason: inv.itc.reason, deadline: itcDeadline(inv.invoiceDate),
    })
    taxable = round2(taxable + inv.taxable)
    if (inv.itc.eligible) eligible = add(eligible, inv.itc)
    else blocked = add(blocked, inv)
  }
  for (const r of live(listOf(state.purchaseReturns))) {
    if (!r.itcReversed || r.date < from || r.date > to) continue
    reversed = add(reversed, r)
  }
  rows.sort((a, b) => a.date - b.date)
  const net: Heads = { cgst: round2(eligible.cgst - reversed.cgst), sgst: round2(eligible.sgst - reversed.sgst), igst: round2(eligible.igst - reversed.igst), total: round2(eligible.total - reversed.total) }
  return { from, to, rows, eligible, blocked, reversed, net, taxable }
}

/** Eligible credit whose claim window closes within `days` and is still open — worth acting on. */
export function itcClosingSoon(state: DataState, asOf: number, days = 30): PurchaseInvoice[] {
  return live(listOf(state.purchaseInvoices)).filter((i) => i.itc.eligible && itcDeadline(i.invoiceDate) >= asOf && itcDeadline(i.invoiceDate) - asOf <= days * 86_400_000)
}
