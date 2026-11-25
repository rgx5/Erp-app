/** GSTR-2B reconciliation: what suppliers reported against your purchase bills. Pure functions; the screen supplies the portal's file and the books' bills. */

export interface Doc2b { kind: 'invoice' | 'credit_note' | 'debit_note'; gstin: string; supplier: string; number: string; date: string; value: number; taxable: number; igst: number; cgst: number; sgst: number; cess: number; itcAvailable: boolean; reverseCharge: boolean; reason: string | null }
export interface BookBill { id: string; billNo: string; supplierInvoiceNo: string; supplierInvoiceDate: string; billDate: string; supplierGstin: string | null; supplierName: string; documentType: string; taxable: number; igst: number; cgst: number; sgst: number; cess: number; reverseCharge: boolean; status: string }
export type RecStatus = 'matched' | 'mismatch' | 'possible' | 'only_2b' | 'only_books'
export interface RecRow { status: RecStatus; gstin: string; supplier: string; number: string; date: string; two?: Doc2b | undefined; book?: BookBill | undefined; differences: string[]; note: string }

const n = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0 }
const round = (v: number): number => Math.round(v * 100) / 100
/** 05-04-2026 or 2026-04-05 as 2026-04-05. */
export function portalDate(v: unknown): string {
  const s = String(v ?? '').trim()
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s
}
/** INV/0001, inv-1 and INV 0001 are the same number for matching. */
export const normNumber = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(?<=[A-Z])0+(?=\d)|^0+(?=\d)/g, '')

type Item = { rt?: number; txval?: number; igst?: number; iamt?: number; cgst?: number; camt?: number; sgst?: number; samt?: number; cess?: number; csamt?: number; itm_det?: Item }
type Items = Item[]
function sumItems(items: Items | undefined, fallback: { txval?: number; igst?: number; cgst?: number; sgst?: number; cess?: number }): { taxable: number; igst: number; cgst: number; sgst: number; cess: number } {
  if (!items || items.length === 0) return { taxable: n(fallback.txval), igst: n(fallback.igst), cgst: n(fallback.cgst), sgst: n(fallback.sgst), cess: n(fallback.cess) }
  const t = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
  for (const raw of items) { const i: Item = raw.itm_det ?? raw; t.taxable += n(i.txval); t.igst += n(i.igst ?? i.iamt); t.cgst += n(i.cgst ?? i.camt); t.sgst += n(i.sgst ?? i.samt); t.cess += n(i.cess ?? i.csamt) }
  return t
}

/** The portal's GSTR-2B JSON (as downloaded from the GST portal): invoices (b2b) and credit/debit notes (cdnr), in either of its layouts. */
export function parseGstr2b(json: unknown): { docs: Doc2b[]; period: string | null; gstin: string | null } {
  const root = (json as { data?: unknown })?.data ?? json
  const r = root as { gstin?: string; rtnprd?: string; docdata?: Record<string, unknown>; data?: { docdata?: Record<string, unknown> } }
  const dd = (r.docdata ?? r.data?.docdata) as { b2b?: unknown[]; cdnr?: unknown[] } | undefined
  if (!dd || (!Array.isArray(dd.b2b) && !Array.isArray(dd.cdnr))) throw new Error('This does not look like a GSTR-2B file from the GST portal. Download the JSON from the portal (Returns > GSTR-2B > Download) and choose that.')
  const docs: Doc2b[] = []
  for (const g of (dd.b2b ?? []) as { ctin?: string; trdnm?: string; inv?: Record<string, unknown>[] }[]) {
    for (const i of g.inv ?? []) {
      const s = sumItems((i['items'] ?? i['itms']) as Items | undefined, i as never)
      docs.push({ kind: 'invoice', gstin: String(g.ctin ?? ''), supplier: String(g.trdnm ?? ''), number: String(i['inum'] ?? ''), date: portalDate(i['dt'] ?? i['idt']), value: n(i['val']), ...s, itcAvailable: String(i['itcavl'] ?? 'Y').toUpperCase() !== 'N', reverseCharge: String(i['rev'] ?? i['rchrg'] ?? 'N').toUpperCase() === 'Y', reason: (i['rsn'] as string | undefined) ?? null })
    }
  }
  for (const g of (dd.cdnr ?? []) as { ctin?: string; trdnm?: string; nt?: Record<string, unknown>[] }[]) {
    for (const i of g.nt ?? []) {
      const s = sumItems((i['items'] ?? i['itms']) as Items | undefined, i as never)
      docs.push({ kind: String(i['typ'] ?? i['ntty'] ?? 'C').toUpperCase().startsWith('D') ? 'debit_note' : 'credit_note', gstin: String(g.ctin ?? ''), supplier: String(g.trdnm ?? ''), number: String(i['ntnum'] ?? i['nt_num'] ?? ''), date: portalDate(i['dt'] ?? i['nt_dt']), value: n(i['val']), ...s, itcAvailable: String(i['itcavl'] ?? 'Y').toUpperCase() !== 'N', reverseCharge: String(i['rev'] ?? 'N').toUpperCase() === 'Y', reason: (i['rsn'] as string | undefined) ?? null })
    }
  }
  return { docs, period: r.rtnprd ? `${r.rtnprd.slice(2)}-${r.rtnprd.slice(0, 2)}` : null, gstin: r.gstin ?? null }
}

const TOL = 1
const taxOf = (x: { igst: number; cgst: number; sgst: number; cess: number }): number => round(x.igst + x.cgst + x.sgst + x.cess)
function diffs(a: Doc2b, b: BookBill): string[] {
  const out: string[] = []
  const chk = (label: string, x: number, y: number): void => { if (Math.abs(x - y) > TOL) out.push(`${label}: portal ${x.toFixed(2)}, books ${y.toFixed(2)}`) }
  chk('Taxable value', a.taxable, b.taxable); chk('IGST', a.igst, b.igst); chk('CGST', a.cgst, b.cgst); chk('SGST', a.sgst, b.sgst); chk('Cess', a.cess, b.cess)
  if (a.date !== b.supplierInvoiceDate) out.push(`Date: portal ${a.date}, books ${b.supplierInvoiceDate}`)
  return out
}

/** Pairs each portal document with a book bill: same supplier and the same number (matched or mismatch), or the same supplier, day and amount under another number (possible). The rest are listed on their own side. */
export function reconcile(docs: Doc2b[], bills: BookBill[]): RecRow[] {
  const rows: RecRow[] = []
  const live = bills.filter((b) => b.status === 'posted' && b.supplierGstin)
  const used = new Set<string>()
  const wantType = (d: Doc2b): string => (d.kind === 'invoice' ? 'bill' : 'debit_note')
  const same = (d: Doc2b, b: BookBill): boolean => b.supplierGstin === d.gstin && b.documentType === wantType(d)
  for (const d of docs) {
    let b = live.find((x) => !used.has(x.id) && same(d, x) && normNumber(x.supplierInvoiceNo) === normNumber(d.number))
    let status: RecStatus = 'matched'; let differences: string[] = []; let note = ''
    if (b) { differences = diffs(d, b); if (differences.length) { status = 'mismatch'; note = 'Same document, different figures: ask the supplier or correct the bill.' } }
    else {
      b = live.find((x) => !used.has(x.id) && same(d, x) && x.supplierInvoiceDate === d.date && Math.abs(x.taxable - d.taxable) <= TOL && Math.abs(taxOf(x) - taxOf(d)) <= TOL)
      if (b) { status = 'possible'; note = `Same supplier, date and amount, but the bill is numbered "${b.supplierInvoiceNo}".` }
      else { status = 'only_2b'; note = d.kind === 'invoice' ? 'The supplier reported it; it is not in your books. Record the bill to claim the credit.' : 'A note the supplier reported; it is not in your books.' }
    }
    if (b) used.add(b.id)
    rows.push({ status, gstin: d.gstin, supplier: d.supplier || b?.supplierName || '', number: d.number, date: d.date, two: d, book: b, differences, note })
  }
  for (const b of live) if (!used.has(b.id) && !b.reverseCharge) rows.push({ status: 'only_books', gstin: b.supplierGstin as string, supplier: b.supplierName, number: b.supplierInvoiceNo, date: b.supplierInvoiceDate, book: b, differences: [], note: 'In your books, not in the portal: the supplier may not have filed it. The credit is at risk until they do.' })
  const order: Record<RecStatus, number> = { mismatch: 0, only_2b: 1, only_books: 2, possible: 3, matched: 4 }
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.gstin.localeCompare(b.gstin) || a.number.localeCompare(b.number))
}

export function summarize(rows: RecRow[]): { status: RecStatus; count: number; portalTax: number; bookTax: number }[] {
  const out = new Map<RecStatus, { count: number; portalTax: number; bookTax: number }>()
  for (const r of rows) { const o = out.get(r.status) ?? { count: 0, portalTax: 0, bookTax: 0 }; o.count++; if (r.two) o.portalTax += r.two.kind === 'invoice' ? taxOf(r.two) : -taxOf(r.two); if (r.book) o.bookTax += r.book.documentType === 'debit_note' ? -taxOf(r.book) : taxOf(r.book); out.set(r.status, o) }
  return (['matched', 'mismatch', 'possible', 'only_2b', 'only_books'] as RecStatus[]).map((status) => ({ status, ...(out.get(status) ?? { count: 0, portalTax: 0, bookTax: 0 }), portalTax: round(out.get(status)?.portalTax ?? 0), bookTax: round(out.get(status)?.bookTax ?? 0) }))
}
export const STATUS_LABEL: Record<RecStatus, string> = { matched: 'Matched', mismatch: 'Figures differ', possible: 'Possible match', only_2b: 'In GSTR-2B only', only_books: 'In books only' }
