import { listOf, type DataState } from '@/data/state'
import type { Bill, BillItem } from '@/domain/types'
import { gstinState, stateName, taxInfoOf } from '@/domain/gst'
import { round2 } from '@/domain/money'
import { fmtDate } from '@/domain/dates'
import { toCsv, type CsvCell } from '@/domain/csv'

/**
 * The data India's GST returns need, built from the bills already in the books. This is an export only: nothing here
 * talks to the GST portal, matches GSTR-2B, or files anything — a person (or the accountant) takes the file from here
 * into the return. ITC pulls from Purchasing's purchase-invoice register when that module is in use; where it is not,
 * the ITC section is simply empty, and the export says so rather than guessing.
 */

type BillWithIgst = Bill & { igstTotal?: number }
const inPeriod = (d: number, from: number, to: number) => d >= from && d <= to
const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + (x || 0), 0))

function billsInPeriod(state: DataState, from: number, to: number): Bill[] {
  return listOf(state.bills).filter((b) => b.status !== 'held' && inPeriod(b.date, from, to))
}

// ───────────────────────────── GSTR-1: outward supplies ─────────────────────────────

export interface Gstr1B2bRow {
  billId: string; no: string; date: number; kind: 'Tax invoice' | 'Credit note'
  buyerGstin: string; buyerName: string; placeOfSupply: string
  taxable: number; cgst: number; sgst: number; igst: number; total: number; reverseCharge: boolean
}
export interface Gstr1HsnRow { hsn: string; rate: number; qty: number; taxable: number; cgst: number; sgst: number; igst: number }
export interface Gstr1Data {
  from: number; to: number
  b2b: Gstr1B2bRow[]
  b2bTotals: { taxable: number; cgst: number; sgst: number; igst: number }
  /** Sales to buyers with no GSTIN, netted together (as the return wants it). */
  b2c: { taxable: number; cgst: number; sgst: number; igst: number }
  hsn: Gstr1HsnRow[]
  billOfSupplyCount: number
  notes: string[]
}

export function gstr1Data(state: DataState, from: number, to: number): Gstr1Data {
  const bills = billsInPeriod(state, from, to)
  const b2b: Gstr1B2bRow[] = []
  let b2cTaxable = 0, b2cCgst = 0, b2cSgst = 0, b2cIgst = 0
  let billOfSupplyCount = 0
  const hsnMap = new Map<string, Gstr1HsnRow>()
  const addHsn = (items: BillItem[], sign: number) => {
    for (const it of items) {
      const key = `${it.hsn || '—'}|${it.taxRate}`
      const row = hsnMap.get(key) ?? { hsn: it.hsn || '—', rate: it.taxRate, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
      row.qty = round2(row.qty + sign * it.qty)
      row.taxable = round2(row.taxable + sign * it.taxable)
      row.cgst = round2(row.cgst + sign * it.cgst)
      row.sgst = round2(row.sgst + sign * it.sgst)
      row.igst = round2(row.igst + sign * (it.igst ?? 0))
      hsnMap.set(key, row)
    }
  }
  for (const b of bills) {
    const sign = b.refundOfBillId || b.total < 0 ? -1 : 1
    const info = taxInfoOf(b)
    addHsn(b.items, sign)
    if (info.taxMode === 'bill_of_supply') { billOfSupplyCount++; continue }
    const customer = b.customerId ? state.customers[b.customerId] : null
    const gstin = (info.buyerGstin || customer?.gstin || '').trim().toUpperCase()
    const taxable = sum([b.taxableTotal]), cgst = sum([b.cgstTotal]), sgst = sum([b.sgstTotal]), igst = sum([(b as BillWithIgst).igstTotal ?? 0])
    if (gstin) {
      b2b.push({
        billId: b.id, no: b.no, date: b.date, kind: sign < 0 ? 'Credit note' : 'Tax invoice', buyerGstin: gstin, buyerName: info.buyerName || customer?.name || '',
        placeOfSupply: info.placeOfSupply || gstinState(gstin) || '', taxable, cgst, sgst, igst, total: sum([b.total]), reverseCharge: !!info.reverseCharge,
      })
    } else { b2cTaxable = round2(b2cTaxable + taxable); b2cCgst = round2(b2cCgst + cgst); b2cSgst = round2(b2cSgst + sgst); b2cIgst = round2(b2cIgst + igst) }
  }
  b2b.sort((a, b) => a.date - b.date)
  const hsn = [...hsnMap.values()].filter((r) => r.taxable || r.qty).sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate)
  const b2bTotals = { taxable: sum(b2b.map((r) => r.taxable)), cgst: sum(b2b.map((r) => r.cgst)), sgst: sum(b2b.map((r) => r.sgst)), igst: sum(b2b.map((r) => r.igst)) }
  return {
    from, to, b2b, b2bTotals, b2c: { taxable: b2cTaxable, cgst: b2cCgst, sgst: b2cSgst, igst: b2cIgst }, hsn, billOfSupplyCount,
    notes: ['Export only — nothing here is filed or sent to the GST portal.', 'Check buyer GSTINs and HSN codes against your actual invoices before using this in the return.'],
  }
}

export function gstr1B2bCsv(d: Gstr1Data) {
  const head: CsvCell[] = ['Invoice no', 'Date', 'Type', 'Buyer GSTIN', 'Buyer', 'Place of supply', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Invoice value', 'Reverse charge']
  const rows = d.b2b.map((r): CsvCell[] => [r.no, fmtDate(r.date), r.kind, r.buyerGstin, r.buyerName, r.placeOfSupply ? `${r.placeOfSupply}-${stateName(r.placeOfSupply)}` : '', r.taxable, r.cgst, r.sgst, r.igst, r.total, r.reverseCharge ? 'Y' : 'N'])
  return toCsv([head, ...rows])
}
export function gstr1HsnCsv(d: Gstr1Data) {
  const head: CsvCell[] = ['HSN', 'Rate %', 'Qty', 'Taxable value', 'CGST', 'SGST', 'IGST']
  return toCsv([head, ...d.hsn.map((r): CsvCell[] => [r.hsn, r.rate, r.qty, r.taxable, r.cgst, r.sgst, r.igst])])
}

// ───────────────────────────── GSTR-3B: the summary return ─────────────────────────────

/** A minimal, duck-typed view of Purchasing's purchase invoice register — read only, never imported. */
interface ItcLikeInvoice {
  id: string; invoiceDate: number; taxable: number; cgst: number; sgst: number; igst: number
  itc?: { eligible?: boolean }
  reverses?: string
}
function purchaseInvoicesOf(state: DataState): ItcLikeInvoice[] {
  const rec = (state as unknown as { purchaseInvoices?: Record<string, ItcLikeInvoice> }).purchaseInvoices
  if (!rec) return []
  const gone = new Set(Object.values(rec).filter((d) => d.reverses).map((d) => d.reverses as string))
  return Object.values(rec).filter((d) => !d.reverses && !gone.has(d.id))
}
export const itcSourceAvailable = (state: DataState) => !!(state as unknown as { purchaseInvoices?: unknown }).purchaseInvoices

export interface Gstr3bData {
  from: number; to: number
  outward: { taxable: number; cgst: number; sgst: number; igst: number }
  itc: { eligible: { cgst: number; sgst: number; igst: number }; blocked: { cgst: number; sgst: number; igst: number }; source: 'purchaseInvoices' | 'none' }
  netPayable: { cgst: number; sgst: number; igst: number }
  notes: string[]
}

export function gstr3bData(state: DataState, from: number, to: number): Gstr3bData {
  const bills = billsInPeriod(state, from, to).filter((b) => taxInfoOf(b).taxMode !== 'bill_of_supply')
  const outward = { taxable: sum(bills.map((b) => b.taxableTotal)), cgst: sum(bills.map((b) => b.cgstTotal)), sgst: sum(bills.map((b) => b.sgstTotal)), igst: sum(bills.map((b) => (b as BillWithIgst).igstTotal ?? 0)) }
  const invoices = purchaseInvoicesOf(state).filter((i) => inPeriod(i.invoiceDate, from, to))
  const eligible = invoices.filter((i) => i.itc?.eligible)
  const blocked = invoices.filter((i) => !i.itc?.eligible)
  const itc = {
    eligible: { cgst: sum(eligible.map((i) => i.cgst)), sgst: sum(eligible.map((i) => i.sgst)), igst: sum(eligible.map((i) => i.igst)) },
    blocked: { cgst: sum(blocked.map((i) => i.cgst)), sgst: sum(blocked.map((i) => i.sgst)), igst: sum(blocked.map((i) => i.igst)) },
    source: itcSourceAvailable(state) ? ('purchaseInvoices' as const) : ('none' as const),
  }
  const netPayable = { cgst: round2(outward.cgst - itc.eligible.cgst), sgst: round2(outward.sgst - itc.eligible.sgst), igst: round2(outward.igst - itc.eligible.igst) }
  return {
    from, to, outward, itc, netPayable,
    notes: [
      'Export only — nothing here is filed or sent to the GST portal.',
      itc.source === 'none' ? 'No purchase-invoice register was found, so section 4 (ITC) is blank — enter it from your purchase records.' : 'ITC is taken from the purchase invoices recorded in Purchasing.',
      'Reverse-charge inward supplies and nil-rated / exempt sales are not tracked here — add them by hand if they apply.',
    ],
  }
}

export function gstr3bCsv(d: Gstr3bData) {
  const rows: CsvCell[][] = [
    ['GSTR-3B summary', fmtDate(d.from), 'to', fmtDate(d.to)],
    [],
    ['3.1 Outward taxable supplies', 'Taxable value', 'CGST', 'SGST', 'IGST'],
    ['', d.outward.taxable, d.outward.cgst, d.outward.sgst, d.outward.igst],
    [],
    ['4. Eligible ITC', 'CGST', 'SGST', 'IGST'],
    ['Available', d.itc.eligible.cgst, d.itc.eligible.sgst, d.itc.eligible.igst],
    ['Blocked / ineligible', d.itc.blocked.cgst, d.itc.blocked.sgst, d.itc.blocked.igst],
    [],
    ['Net payable (outward − eligible ITC)', 'CGST', 'SGST', 'IGST'],
    ['', d.netPayable.cgst, d.netPayable.sgst, d.netPayable.igst],
  ]
  return toCsv(rows)
}

// ───────────────────────────── ITC register export ─────────────────────────────

export interface ItcExportRow { id: string; date: number; taxable: number; cgst: number; sgst: number; igst: number; eligible: boolean }
export interface ItcExportData { from: number; to: number; rows: ItcExportRow[]; eligible: { cgst: number; sgst: number; igst: number }; available: boolean; notes: string[] }

export function itcExportData(state: DataState, from: number, to: number): ItcExportData {
  const invoices = purchaseInvoicesOf(state).filter((i) => inPeriod(i.invoiceDate, from, to))
  const rows: ItcExportRow[] = invoices.map((i) => ({ id: i.id, date: i.invoiceDate, taxable: i.taxable, cgst: i.cgst, sgst: i.sgst, igst: i.igst, eligible: !!i.itc?.eligible })).sort((a, b) => a.date - b.date)
  const elig = rows.filter((r) => r.eligible)
  return {
    from, to, rows, eligible: { cgst: sum(elig.map((r) => r.cgst)), sgst: sum(elig.map((r) => r.sgst)), igst: sum(elig.map((r) => r.igst)) },
    available: itcSourceAvailable(state),
    notes: itcSourceAvailable(state) ? ['Export only — built from Purchasing’s purchase invoices.'] : ['No purchase-invoice register was found. Record purchase invoices (with GST) in Purchasing to get an ITC export.'],
  }
}
export function itcExportCsv(d: ItcExportData) {
  const head: CsvCell[] = ['Date', 'Taxable', 'CGST', 'SGST', 'IGST', 'Eligible']
  return toCsv([head, ...d.rows.map((r): CsvCell[] => [fmtDate(r.date), r.taxable, r.cgst, r.sgst, r.igst, r.eligible ? 'Y' : 'N'])])
}
