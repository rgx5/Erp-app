import { Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { ApiError } from '@/api/errors'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr } from '@/domain/format'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, Spinner } from '@/ui/primitives'
import { downloadJson, EInvoiceError, useEInvoiceActions, usePendingEInvoices, type Issue } from './api'
import { parseReply } from './reply'
import { IssueList } from './EInvoicePanel'

const DOC: Record<string, string> = { tax_invoice: 'Tax invoice', credit_note: 'Credit note', debit_note: 'Debit note' }
const msg = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.')

/** Many invoices at once: one file to upload on the e-invoice portal, and the portal's reply loaded back in one go. */
export function EInvoicingPage() {
  const perms = useSession((s) => s.me?.permissions ?? []); const canPost = can(perms, 'sales:post'); const flash = useFlash()
  const [state, setState] = useState<'pending' | 'issued' | 'all'>('pending'); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set()); const [problem, setProblem] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<{ invoiceNo: string; issues: Issue[] }[]>([])
  const q = usePendingEInvoices({ state, ...(from ? { from } : {}), ...(to ? { to } : {}) }); const a = useEInvoiceActions()
  const input = useRef<HTMLInputElement>(null)
  const rows = q.data?.items ?? []
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const todo = rows.filter((r) => !r.irn)
  const allPicked = todo.length > 0 && todo.every((r) => picked.has(r.id))

  async function makeFile() {
    setProblem(null); setNotice(null); setSkipped([])
    try {
      const r = await a.file.mutateAsync([...picked])
      downloadJson(r.fileName, r.invoices); setSkipped(r.skipped)
      setNotice(`${r.fileName} has ${r.included.length} invoice${r.included.length === 1 ? '' : 's'}.${r.skipped.length ? ` ${r.skipped.length} left out, see below.` : ''} Upload it on the e-invoice portal, download the portal's reply, then load it here.`)
    } catch (e) { setProblem(msg(e)); if (e instanceof EInvoiceError && Array.isArray(e.extra['skipped'])) setSkipped(e.extra['skipped'] as { invoiceNo: string; issues: Issue[] }[]) }
  }
  async function loadReply(f: File | undefined) {
    if (!f) return
    setProblem(null); setNotice(null)
    try {
      const parsed = parseReply(await f.text())
      if (parsed.items.length === 0) { setProblem(parsed.rejected.length ? `The portal refused: ${parsed.rejected.map((r) => `${r.docNo} (${r.message})`).join('; ')}` : 'No IRN was found in this file.'); return }
      const r = await a.reply.mutateAsync(parsed.items)
      const bad = r.outcomes.filter((o) => o.result === 'unmatched' || o.result === 'invalid')
      flash.show(`${r.recorded} IRN${r.recorded === 1 ? '' : 's'} recorded.`)
      setNotice(`${r.recorded} recorded, ${r.outcomes.filter((o) => o.result === 'already_recorded').length} already there.${parsed.rejected.length ? ` The portal refused ${parsed.rejected.length}: ${parsed.rejected.map((x) => `${x.docNo} (${x.message})`).join('; ')}.` : ''}${bad.length ? ` ${bad.length} did not match any invoice here.` : ''}`)
      setPicked(new Set())
    } catch (e) { setProblem(msg(e)) } finally { if (input.current) input.current.value = '' }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <h1 className="page-title">E-invoicing</h1>
        <p className="text-sm text-muted">Sales to businesses, SEZ units and exporters need an IRN from the government e-invoice portal. Choose invoices, download one file, upload it on the portal, then load the portal's reply here. The IRN and QR code then print on the invoice.</p>
      </div>
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Show</span>
            <select className="h-9 rounded-md border border-line bg-surface px-2" value={state} onChange={(e) => { setState(e.target.value as typeof state); setPicked(new Set()) }}><option value="pending">Waiting for an IRN</option><option value="issued">IRN recorded</option><option value="all">All</option></select></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-muted">From</span><input type="date" aria-label="From date" className="h-9 rounded-md border border-line bg-surface px-2" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-muted">To</span><input type="date" aria-label="To date" className="h-9 rounded-md border border-line bg-surface px-2" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <div className="ml-auto flex gap-2">
            {canPost ? <Button onClick={() => void makeFile()} disabled={picked.size === 0} busy={a.file.isPending}>Download file ({picked.size})</Button> : null}
            {canPost ? <Button variant="secondary" onClick={() => input.current?.click()}>Load the portal's reply</Button> : null}
            <input ref={input} type="file" accept="application/json,.json" aria-label="Portal reply file" className="hidden" onChange={(e) => void loadReply(e.target.files?.[0])} />
          </div>
        </div>
      </Card>
      {problem ? <Alert>{problem}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {skipped.length ? <Card><h2 className="mb-2 text-sm font-semibold">Left out of the file</h2><div className="flex flex-col gap-3">{skipped.map((s) => <div key={s.invoiceNo}><p className="text-sm font-medium">{s.invoiceNo}</p><IssueList issues={s.issues} /></div>)}</div></Card> : null}
      <Card>
        {q.isPending ? <Spinner /> : q.error ? <Alert>{q.error.message}</Alert> : rows.length === 0 ? <p className="text-sm text-muted">{state === 'pending' ? 'Nothing is waiting for an IRN.' : 'No invoices match.'}</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted">
              <th className="w-8 py-1">{canPost && todo.length > 0 ? <input type="checkbox" aria-label="Choose all" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(todo.map((r) => r.id)))} /> : null}</th>
              <th className="py-1">Document</th><th className="py-1">Date</th><th className="py-1">Customer</th><th className="num py-1 text-right">Total</th><th className="py-1 pl-3">IRN</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line/60">
                  <td className="py-1.5">{canPost && !r.irn ? <input type="checkbox" aria-label={`Choose ${r.invoiceNo}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /> : null}</td>
                  <td className="py-1.5"><Link to="/sales/invoices/$invoiceId" params={{ invoiceId: r.id }} className="underline">{r.invoiceNo}</Link> <span className="text-xs text-muted">{DOC[r.documentType] ?? r.documentType}</span></td>
                  <td className="py-1.5">{formatDate(r.invoiceDate)}</td><td className="py-1.5">{r.customerName}</td><td className="num py-1.5 text-right">{formatInr(r.grandTotal)}</td>
                  <td className="py-1.5 pl-3">{r.irn ? <span className="text-good" title={r.irn}>Recorded · Ack {r.ackNo}</span> : <span className="text-warn">Waiting</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
