import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { stateName } from '@/domain/india'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, Spinner, TextField } from '@/ui/primitives'
import { BillTotals, MatchBadge, type MatchIssue } from './BillEditorPage'
import { BILL_TYPE } from './BillsPage'
import { usePostDebitNote } from './landedQueries'
import { useBill, useCancelBill } from './queries'
import { showQty } from '@/domain/quantity'
import { ApiError } from '@/api/errors'

const cancelSchema = z.object({ cancelDate: z.string().min(1, 'Required'), reason: z.string().trim().min(1, 'A reason is required').max(300) })

export function BillDetailPage() {
  const { billId } = useParams({ from: '/app/purchasing/bills/$billId' })
  return <BillDetail key={billId} billId={billId} />
}

function BillDetail({ billId }: { billId: string }) {
  const q = useBill(billId)
  const perms = useSession((s) => s.me?.permissions ?? [])
  const cancel = useCancelBill(billId)
  const flash = useFlash()
  const [cancelling, setCancelling] = useState(false)
  const [noting, setNoting] = useState(false)
  const debit = usePostDebitNote()
  const [dnDate, setDnDate] = useState(todayIso())
  const [dnReason, setDnReason] = useState('')
  const [dnQty, setDnQty] = useState<Record<string, string>>({})
  const [dnProblem, setDnProblem] = useState<string | null>(null)
  if (q.isPending) return <Spinner />
  if (q.error || !q.data) return <Alert>{q.error?.message ?? 'Not found.'}</Alert>
  const b = q.data
  const posted = b.status === 'posted'
  const intra = b.taxRegime === 'intra'
  const issues = Array.isArray(b.matchIssues) ? (b.matchIssues as MatchIssue[]) : []
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted"><Link to="/purchasing/bills" className="underline">Supplier bills</Link></p>
          <h1 className="page-title">{BILL_TYPE[b.documentType] ?? b.documentType} {b.billNo} <MatchBadge status={b.matchStatus} /> {!posted ? <span className="ml-2 rounded bg-bad/15 px-2 py-0.5 text-xs font-medium text-bad">Cancelled</span> : null}</h1>
          <p className="text-sm text-muted">{formatDate(b.billDate)} · {b.supplierName}{b.supplierGstin ? ` · ${b.supplierGstin}` : ''} · supply to {stateName(b.placeOfSupply)} · supplier's invoice {b.supplierInvoiceNo} of {formatDate(b.supplierInvoiceDate)}{b.dueDate ? ` · due ${formatDate(b.dueDate)}` : ''}</p>
        </div>
        <div className="flex gap-2">
          {posted && can(perms, 'payables:post') ? <Link to="/purchasing/payments" search={{ supplierId: b.supplierId } as never} className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-3.5 text-sm font-medium hover:bg-canvas">Record payment</Link> : null}
          {posted && b.documentType === 'bill' && can(perms, 'purchasing:post') ? <Button variant="secondary" onClick={() => { setDnProblem(null); setNoting(true) }}>Debit note</Button> : null}
          {posted && b.documentType === 'bill' && can(perms, 'purchasing:cancel') ? <Button variant="secondary" onClick={() => setCancelling(true)}>Cancel</Button> : null}
        </div>
      </div>
      {!posted ? <Alert>Cancelled on {b.cancelDate ? formatDate(b.cancelDate) : ''}: {b.cancelReason}</Alert> : null}
      {b.matchStatus === 'overridden' ? <Alert tone="info">Approved outside the price or quantity tolerance: {b.matchOverrideReason}</Alert> : null}
      {issues.length > 0 ? <Alert tone="info">{issues.map((i) => `Line ${i.lineNo}: ${i.kind} ${Number(i.actual)} against ${Number(i.expected)} (${Number(i.deviationPercent)}% over).`).join(' ')}</Alert> : null}
      <Card>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1">#</th><th className="py-1">Description</th><th className="py-1">HSN/SAC</th><th className="num py-1 text-right">Qty</th><th className="num py-1 text-right">Price</th><th className="num py-1 text-right">Taxable</th>{intra ? <><th className="num py-1 text-right">CGST</th><th className="num py-1 text-right">SGST</th></> : <th className="num py-1 text-right">IGST</th>}<th className="num py-1 text-right">Total</th></tr></thead>
          <tbody>
            {b.lines.map((l) => (
              <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{l.lineNo}</td><td className="py-1.5">{l.description}{!l.itcEligible ? <span className="ml-2 text-xs text-muted">(credit not claimed)</span> : null}</td><td className="py-1.5">{l.hsnSacCode}</td><td className="num py-1.5 text-right">{Number(l.quantity)}</td><td className="num py-1.5 text-right">{formatInr(l.unitPrice, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(l.taxableValue, { symbol: false })}</td>
                {intra ? <><td className="num py-1.5 text-right">{formatInr(l.cgstAmount, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(l.sgstAmount, { symbol: false })}</td></> : <td className="num py-1.5 text-right">{formatInr(l.igstAmount, { symbol: false })}</td>}
                <td className="num py-1.5 text-right">{formatInr(l.lineTotal, { symbol: false })}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="ml-auto mt-4 w-72"><BillTotals bill={b} /></div>
      </Card>
      {noting ? (
        <Drawer title={`Debit note against ${b.billNo}`} onClose={() => setNoting(false)} width={640}>
          <div className="flex flex-col gap-4">
            <Alert tone="info">Use a debit note when the supplier is to credit you: goods sent back, a price correction or a short supply. Choose the quantity on each line. It reduces what you owe and reverses the matching tax credit.</Alert>
            <table className="w-full text-sm" aria-label="Billed lines"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Line</th><th className="py-1 text-right">Billed</th><th className="py-1 text-right">Price</th><th className="w-28 py-1 text-right">Debit quantity</th></tr></thead>
              <tbody>{b.lines.map((l) => <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{l.lineNo} · {l.description}</td><td className="num py-1.5 text-right">{showQty(l.quantity)}</td><td className="num py-1.5 text-right">{formatInr(l.unitPrice, { symbol: false })}</td><td className="py-1"><input aria-label={`Debit quantity for line ${l.lineNo}`} inputMode="decimal" className="h-8 w-full rounded border border-line bg-surface px-2 text-right text-sm" value={dnQty[l.id] ?? ''} onChange={(e) => setDnQty({ ...dnQty, [l.id]: e.target.value })} /></td></tr>)}</tbody></table>
            <div className="grid grid-cols-2 gap-4"><TextField label="Date" type="date" value={dnDate} onChange={(e) => setDnDate(e.target.value)} /><TextField label="Reason" value={dnReason} onChange={(e) => setDnReason(e.target.value)} /></div>
            {dnProblem ? <Alert>{dnProblem}</Alert> : null}
            <Button busy={debit.isPending} disabled={!dnReason.trim() || !b.lines.some((l) => Number(dnQty[l.id] ?? 0) > 0)} onClick={async () => {
              setDnProblem(null)
              const lines = b.lines.filter((l) => Number(dnQty[l.id] ?? 0) > 0).map((l) => ({ originalLineId: l.id, quantity: dnQty[l.id] as string }))
              try { const n = await debit.mutateAsync({ key: crypto.randomUUID(), body: { originalBillId: b.id, noteDate: dnDate, reason: dnReason.trim(), lines } }); flash.show(`${n.billNo} posted for ${formatInr(n.grandTotal)}.`); setNoting(false) } catch (e) { setDnProblem(e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : 'Could not post the debit note.') }
            }}>Post debit note</Button>
          </div>
        </Drawer>
      ) : null}
      {cancelling ? (
        <Drawer title={`Cancel ${b.billNo}`} onClose={() => setCancelling(false)}>
          <div className="flex flex-col gap-4">
            <Alert tone="info">Cancelling reverses the accounting entry and puts the goods back to "received, not invoiced". It cannot be done once money has been allocated to the bill.</Alert>
            <SimpleForm schema={cancelSchema} defaults={{ cancelDate: todayIso(), reason: '' }} fields={['cancelDate', 'reason']} label="Cancel bill" submit={async (v) => { await cancel.mutateAsync(v); flash.show(`${b.billNo} was cancelled.`); setCancelling(false) }}>
              {({ register, errors }) => (<><TextField label="Cancellation date" type="date" error={errors.cancelDate?.message as string | undefined} {...register('cancelDate')} /><TextField label="Reason" error={errors.reason?.message as string | undefined} {...register('reason')} /></>)}
            </SimpleForm>
          </div>
        </Drawer>
      ) : null}
    </div>
  )
}
