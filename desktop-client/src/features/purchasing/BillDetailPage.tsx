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
import { useBill, useCancelBill } from './queries'

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
          <h1 className="text-lg font-semibold">{BILL_TYPE[b.documentType] ?? b.documentType} {b.billNo} <MatchBadge status={b.matchStatus} /> {!posted ? <span className="ml-2 rounded bg-bad/15 px-2 py-0.5 text-xs font-medium text-bad">Cancelled</span> : null}</h1>
          <p className="text-sm text-muted">{formatDate(b.billDate)} · {b.supplierName}{b.supplierGstin ? ` · ${b.supplierGstin}` : ''} · supply to {stateName(b.placeOfSupply)} · supplier's invoice {b.supplierInvoiceNo} of {formatDate(b.supplierInvoiceDate)}{b.dueDate ? ` · due ${formatDate(b.dueDate)}` : ''}</p>
        </div>
        <div className="flex gap-2">
          {posted && can(perms, 'payables:post') ? <Link to="/purchasing/payments" search={{ supplierId: b.supplierId } as never} className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-3.5 text-sm font-medium hover:bg-canvas">Record payment</Link> : null}
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
