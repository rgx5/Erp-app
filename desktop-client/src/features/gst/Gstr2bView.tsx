import { useState } from 'react'
import { query } from '@/api/client'
import { billHeader, page } from '@/api/schemas'
import { currentApi } from '@/auth/session'
import { formatDate, formatInr } from '@/domain/format'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { Alert, Button, Card, SelectField } from '@/ui/primitives'
import { parseGstr2b, reconcile, STATUS_LABEL, summarize, type BookBill, type RecRow, type RecStatus } from './gstr2b'

const monthEnd = (p: string): string => { const [y, m] = p.split('-').map(Number) as [number, number]; return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
async function loadBills(companyId: string, registrationId: string, from: string, to: string): Promise<BookBill[]> {
  const api = currentApi(); const out: BookBill[] = []; let cursor: string | undefined
  do {
    const p = await api.call(api.raw.GET('/v1/purchasing/bills', { params: { query: query({ limit: 200, cursor, companyId, from, to, status: 'posted' }) } }), page(billHeader))
    for (const b of p.items) if (b.gstRegistrationId === registrationId) out.push({ id: b.id, billNo: b.billNo, supplierInvoiceNo: b.supplierInvoiceNo, supplierInvoiceDate: b.supplierInvoiceDate, billDate: b.billDate, supplierGstin: b.supplierGstin, supplierName: b.supplierName, documentType: b.documentType, taxable: Number(b.taxableTotal), igst: Number(b.igstTotal), cgst: Number(b.cgstTotal), sgst: Number(b.sgstTotal), cess: Number(b.cessTotal), reverseCharge: b.reverseCharge, status: b.status })
    cursor = p.nextCursor ?? undefined
  } while (cursor)
  return out
}
const tone: Record<RecStatus, string> = { matched: 'text-good', mismatch: 'text-bad', possible: 'text-warn', only_2b: 'text-bad', only_books: 'text-warn' }
const tax = (x: { igst: number; cgst: number; sgst: number; cess: number }): number => Math.round((x.igst + x.cgst + x.sgst + x.cess) * 100) / 100

/** Choose the GSTR-2B file downloaded from the GST portal; every supplier invoice is checked against your purchase bills. */
export function Gstr2bView({ registrationId, period }: { registrationId: string; period: string }) {
  const ws = useWorkspace()
  const [rows, setRows] = useState<RecRow[] | null>(null); const [info, setInfo] = useState(''); const [problem, setProblem] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [filter, setFilter] = useState('')
  async function pick(file: File | undefined) {
    if (!file || !ws.company) return
    setProblem(null); setRows(null); setBusy(true)
    try {
      const parsed = parseGstr2b(JSON.parse(await file.text()))
      const p = parsed.period ?? period
      const start = new Date(`${p}-01T00:00:00Z`); start.setUTCMonth(start.getUTCMonth() - 12) // a supplier may file late: look back a year
      const bills = await loadBills(ws.company.id, registrationId, start.toISOString().slice(0, 10), monthEnd(p))
      const inPeriod = (b: BookBill): boolean => b.supplierInvoiceDate.slice(0, 7) === p || b.billDate.slice(0, 7) === p
      const all = reconcile(parsed.docs, bills)
      setRows(all.filter((r) => r.status !== 'only_books' || (r.book && inPeriod(r.book)))); setInfo(`${parsed.docs.length} documents in GSTR-2B for ${p}${parsed.gstin ? ` · ${parsed.gstin}` : ''}; ${bills.length} purchase bills checked.`)
    } catch (e) { setProblem(e instanceof SyntaxError ? 'This is not a JSON file. Download the GSTR-2B JSON from the portal and choose that.' : e instanceof Error ? e.message : 'Could not read the file.') } finally { setBusy(false) }
  }
  const shown = rows?.filter((r) => !filter || r.status === filter) ?? []
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-sm font-semibold">Check your purchases against GSTR-2B</h2>
        <p className="mb-3 text-xs text-muted">On the GST portal open Returns, GSTR-2B, and download the JSON for the month. Choose it here: nothing is sent anywhere. Credit is claimed on what the supplier reported, so every line that is not matched needs a look.</p>
        <input type="file" accept=".json,application/json" aria-label="GSTR-2B file" onChange={(e) => void pick(e.target.files?.[0])} disabled={busy} />
      </Card>
      {problem ? <Alert>{problem}</Alert> : null}
      {rows ? (<>
        <p className="text-sm text-muted">{info}</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{summarize(rows).map((s) => <button key={s.status} onClick={() => setFilter(filter === s.status ? '' : s.status)} className={`rounded-lg border bg-surface px-4 py-3 text-left ${filter === s.status ? 'border-brand' : 'border-line'}`}><p className="text-xs text-muted">{STATUS_LABEL[s.status]}</p><p className={`text-lg font-semibold ${tone[s.status]}`}>{s.count}</p><p className="num text-xs text-muted">tax {formatInr(String(s.status === 'only_books' ? s.bookTax : s.portalTax))}</p></button>)}</div>
        <Card>
          <div className="mb-2 flex items-center justify-between"><SelectField label="Show" value={filter} onChange={(e) => setFilter(e.target.value)} options={[{ value: '', label: 'Everything' }, ...(Object.keys(STATUS_LABEL) as RecStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] }))]} />
            <Button variant="secondary" onClick={() => download(`gstr2b-reconciliation-${period}.csv`, toCsv(['Result', 'Supplier GSTIN', 'Supplier', 'Document', 'Date', 'Portal taxable', 'Portal tax', 'Books taxable', 'Books tax', 'Note'], rows.map((r) => [STATUS_LABEL[r.status], r.gstin, r.supplier, r.number, r.date, r.two ? String(r.two.taxable) : '', r.two ? String(tax(r.two)) : '', r.book ? String(r.book.taxable) : '', r.book ? String(tax(r.book)) : '', [r.note, ...r.differences].join(' · ')])))}>Download CSV</Button></div>
          <div className="overflow-auto"><table className="w-full text-sm" aria-label="Reconciliation"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Result</th><th className="py-1">Supplier</th><th className="py-1">Document</th><th className="py-1">Date</th><th className="num py-1 text-right">Portal tax</th><th className="num py-1 text-right">Books tax</th><th className="py-1 pl-3">What to do</th></tr></thead>
            <tbody>{shown.map((r, i) => <tr key={i} className="border-t border-line/60 align-top"><td className={`py-1.5 font-medium ${tone[r.status]}`}>{STATUS_LABEL[r.status]}</td><td className="py-1.5">{r.supplier || '—'}<span className="block text-xs text-muted">{r.gstin}</span></td><td className="py-1.5">{r.number}{r.book && r.book.supplierInvoiceNo !== r.number ? <span className="block text-xs text-muted">books: {r.book.supplierInvoiceNo}</span> : null}</td><td className="py-1.5">{formatDate(r.date)}</td><td className="num py-1.5 text-right">{r.two ? formatInr(String(tax(r.two)), { symbol: false }) : '–'}</td><td className="num py-1.5 text-right">{r.book ? formatInr(String(tax(r.book)), { symbol: false }) : '–'}</td><td className="py-1.5 pl-3 text-xs">{r.note}{r.differences.map((d) => <span key={d} className="block text-bad">{d}</span>)}{r.two && !r.two.itcAvailable ? <span className="block text-warn">The portal says credit is not available{r.two.reason ? ` (${r.two.reason})` : ''}.</span> : null}</td></tr>)}</tbody></table></div>
        </Card>
      </>) : null}
    </div>
  )
}
