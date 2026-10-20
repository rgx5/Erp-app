import { gstinProblem, gstinState, isBillOfSupplyStore, stateName, STATE_CODES, supplyOptions, taxInfoOf, type BillTaxInfo } from '@/domain/gst'
import { round2 } from '@/domain/money'
import type { Bill, Customer, StoreSettings } from '@/domain/types'
import { fmtDate } from '@/domain/dates'
import type { CsvCell } from '@/domain/csv'

/**
 * The B2B side of a bill: who the buyer is, where the supply is made (the place of supply), and so whether the tax is CGST + SGST,
 * IGST, or none (a bill of supply). The decision itself is `supplyOptions` in `domain/gst.ts`; this file checks what the person
 * typed and says what the bill will be.
 */

export interface BuyerCheck {
  /** Stops the sale: something the law or the portal would not accept. */
  errors: string[]
  /** Worth knowing, but the sale can go ahead. */
  warnings: string[]
}

export type DocKind = 'tax_invoice' | 'bill_of_supply'

/** What the bill will be called and how it is taxed, given the shop, the customer and what was entered at checkout. */
export function supplySummary(store: Pick<StoreSettings, 'gstin' | 'registrationType'> | null | undefined, customer: Pick<Customer, 'gstin'> | null | undefined, info?: BillTaxInfo) {
  const supply = supplyOptions(store, customer?.gstin, info)
  const kind: DocKind = supply.noTax ? 'bill_of_supply' : 'tax_invoice'
  const buyerGstin = (info?.buyerGstin || customer?.gstin || '').trim().toUpperCase()
  const placeOfSupply = info?.placeOfSupply || gstinState(buyerGstin) || gstinState(store?.gstin) || ''
  const tax = supply.noTax ? 'No GST' : supply.interState ? 'IGST' : 'CGST + SGST'
  return { ...supply, kind, buyerGstin, placeOfSupply, tax, isB2B: !!buyerGstin && !supply.noTax }
}

/** Checks the buyer details typed at checkout. */
export function checkBuyer(store: StoreSettings | null | undefined, customer: Pick<Customer, 'gstin'> | null | undefined, info?: BillTaxInfo): BuyerCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const typed = (info?.buyerGstin ?? '').trim()
  const problem = gstinProblem(typed)
  if (problem) errors.push(`Buyer GSTIN: ${problem}`)
  const own = (customer?.gstin ?? '').trim()
  if (!typed && own) { const p = gstinProblem(own); if (p) warnings.push(`The customer’s saved GSTIN looks wrong. ${p}`) }
  if (info?.placeOfSupply && !STATE_CODES[info.placeOfSupply]) errors.push(`${info.placeOfSupply} is not a GST state code.`)
  const sellerState = gstinState(store?.gstin)
  const sum = supplySummary(store, customer, info)
  if (!sum.noTax && !sellerState) warnings.push('The shop’s own GSTIN is not set in Settings, so every sale is treated as within the state.')
  if (store?.registrationType === 'composition' && sellerState && sum.placeOfSupply && sum.placeOfSupply !== sellerState) {
    warnings.push('A composition dealer cannot make sales to another state. Check with your accountant before issuing this bill.')
  }
  if (info?.reverseCharge && !sum.buyerGstin) warnings.push('Reverse charge applies to sales to registered buyers; add the buyer’s GSTIN.')
  if (sum.kind === 'bill_of_supply' && sum.buyerGstin) warnings.push('A bill of supply charges no tax, so the buyer gets no input credit.')
  return { errors, warnings }
}

/**
 * What to record on the bill (`bill.ext.pricing`) given what was typed: the derived fields (`taxMode`, `interState`) are filled in so a
 * receipt, a return or the e-invoice screen never has to guess. Returns undefined when there is nothing to record (an ordinary retail
 * bill from a regular dealer).
 */
export function billTaxInfo(store: StoreSettings | null | undefined, customer: Pick<Customer, 'gstin'> | null | undefined, info?: BillTaxInfo): BillTaxInfo | undefined {
  const sum = supplySummary(store, customer, info)
  const out: BillTaxInfo = {}
  if (info?.buyerGstin?.trim()) out.buyerGstin = info.buyerGstin.trim().toUpperCase()
  if (info?.buyerName?.trim()) out.buyerName = info.buyerName.trim()
  if (info?.placeOfSupply) out.placeOfSupply = info.placeOfSupply
  if (info?.reverseCharge) out.reverseCharge = true
  if (info?.priceListId) out.priceListId = info.priceListId
  if (sum.noTax) out.taxMode = 'bill_of_supply'
  else if (Object.keys(out).length) out.taxMode = 'tax_invoice'
  if (sum.interState) out.interState = true
  return Object.keys(out).length ? out : undefined
}

export const sameTaxInfo = (a: BillTaxInfo | undefined, b: BillTaxInfo | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** A bill that went through the GST invoice section of checkout carries its tax info; others (a quotation turned into a bill) do not. */
export const hasTaxInfo = (bill: Pick<Bill, 'ext'>) => !!bill.ext?.pricing

/**
 * Whether a saved bill agrees with its own tax info — the same sale cannot be an IGST bill with CGST on its lines, or a bill of
 * supply that charged tax. Returns what is wrong, or null. (Only bills that carry tax info are checked.)
 */
export function taxInconsistency(bill: Bill, store: StoreSettings | null | undefined, customer: Pick<Customer, 'gstin'> | null | undefined): string | null {
  if (!hasTaxInfo(bill) || bill.status === 'held') return null
  const info = taxInfoOf(bill)
  const bad = checkBuyer(store, customer, info).errors
  if (bad.length) return bad[0]
  const want = supplyOptions(store, customer?.gstin, info)
  const hasIgst = bill.items.some((i) => i.igst !== undefined)
  const charged = round2(bill.taxTotal)
  if (want.noTax && charged !== 0) return 'This business issues bills of supply, which carry no tax — the bill has tax on it. Reopen the bill and try again.'
  if (!want.noTax && want.interState !== hasIgst && charged !== 0) {
    return want.interState
      ? 'The place of supply is in another state, so GST must be IGST — the bill still has CGST and SGST. Reopen the bill and try again.'
      : 'The place of supply is within the state, so GST must be CGST and SGST — the bill still has IGST. Reopen the bill and try again.'
  }
  return null
}

// ───────────────────────────── the B2B register ─────────────────────────────

export interface RegisterRow {
  billId: string
  no: string
  date: number
  kind: 'Tax invoice' | 'Bill of supply' | 'Credit note'
  buyerGstin: string
  buyerName: string
  placeOfSupply: string
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
  reverseCharge: boolean
}

const sgn = (b: Bill) => (b.total < 0 || b.refundOfBillId ? -1 : 1)

/** Every GST-registered-buyer invoice (and credit note) in a period, with its tax split: the working papers for the B2B part of GSTR-1. Walk-in retail bills are left out. */
export function b2bRegister(bills: Bill[], customers: Record<string, Customer>, from: number, to: number): RegisterRow[] {
  const rows: RegisterRow[] = []
  for (const b of bills) {
    if (b.status === 'held' || b.date < from || b.date > to) continue
    const info = taxInfoOf(b)
    const customer = b.customerId ? customers[b.customerId] : undefined
    const gstin = (info.buyerGstin || customer?.gstin || '').trim().toUpperCase()
    if (!gstin || info.taxMode === 'bill_of_supply') continue
    const s = sgn(b)
    const igst = round2(b.igstTotal ?? b.items.reduce((t, i) => t + (i.igst ?? 0), 0))
    rows.push({
      billId: b.id, no: b.no, date: b.date, kind: s < 0 ? 'Credit note' : 'Tax invoice', buyerGstin: gstin, buyerName: info.buyerName || customer?.name || '',
      placeOfSupply: info.placeOfSupply || gstinState(gstin), taxable: round2(s * Math.abs(b.taxableTotal)), cgst: round2(s * Math.abs(b.cgstTotal)),
      sgst: round2(s * Math.abs(b.sgstTotal)), igst: round2(s * Math.abs(igst)), total: round2(s * Math.abs(b.total)), reverseCharge: !!info.reverseCharge,
    })
  }
  return rows.sort((a, b) => a.date - b.date || a.no.localeCompare(b.no))
}

export function registerTotals(rows: RegisterRow[]) {
  const sum = (f: (r: RegisterRow) => number) => round2(rows.reduce((s, r) => s + f(r), 0))
  return { count: rows.length, taxable: sum((r) => r.taxable), cgst: sum((r) => r.cgst), sgst: sum((r) => r.sgst), igst: sum((r) => r.igst), total: sum((r) => r.total) }
}

export function registerCsv(rows: RegisterRow[]): CsvCell[][] {
  const head: CsvCell[] = ['Invoice no', 'Date', 'Type', 'Buyer GSTIN', 'Buyer', 'Place of supply', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Invoice value', 'Reverse charge']
  return [head, ...rows.map((r): CsvCell[] => [r.no, fmtDate(r.date), r.kind, r.buyerGstin, r.buyerName, r.placeOfSupply ? `${r.placeOfSupply}-${stateName(r.placeOfSupply)}` : '', r.taxable, r.cgst, r.sgst, r.igst, r.total, r.reverseCharge ? 'Y' : 'N'])]
}

export { isBillOfSupplyStore }
