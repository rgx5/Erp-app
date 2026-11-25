import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { EInvoicePanel } from '@/features/einvoice/EInvoicePanel'
import { useEInvoiceStatus } from '@/features/einvoice/api'
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Invoice } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { bridge } from '@/bridge'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { stateName } from '@/domain/india'
import { usePartyAddresses } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, CheckField, Spinner, TextField } from '@/ui/primitives'
import { z } from 'zod'
import { useRetailSettings } from '@/features/retail/queries'
import { invoiceHtml, type Seller } from './invoiceHtml'
import { DOC_LABEL } from './InvoicesPage'
import { useCancelInvoice, useInvoice, usePostNote } from './queries'

const cancelSchema = z.object({ cancelDate: z.string().min(1, 'Required'), reason: z.string().trim().min(1, 'A reason is required').max(300) })

function CancelDrawer({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const cancel = useCancelInvoice(invoice.id)
  const flash = useFlash()
  return (
    <Drawer title={`Cancel ${invoice.invoiceNo}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Alert tone="info">Cancelling reverses the accounting entry and brings the stock back. The number stays used and the document stays on record as cancelled. It cannot be cancelled once money has been allocated to it.</Alert>
        <SimpleForm schema={cancelSchema} defaults={{ cancelDate: todayIso(), reason: '' }} fields={['cancelDate', 'reason']} label="Cancel invoice" submit={async (v) => { await cancel.mutateAsync(v); flash.show(`${invoice.invoiceNo} was cancelled.`); onClose() }}>
          {({ register, errors }) => (<><TextField label="Cancellation date" type="date" error={errors.cancelDate?.message as string | undefined} {...register('cancelDate')} /><TextField label="Reason" error={errors.reason?.message as string | undefined} {...register('reason')} /></>)}
        </SimpleForm>
      </div>
    </Drawer>
  )
}

const noteSchema = z.object({ noteDate: z.string().min(1, 'Required'), reason: z.string().trim().min(1, 'A reason is required').max(300), quantities: z.record(z.string(), z.string()), prices: z.record(z.string(), z.string()), returnStock: z.boolean() })

function NoteDrawer({ invoice, kind, onClose }: { invoice: Invoice; kind: 'credit' | 'debit'; onClose: () => void }) {
  const post = usePostNote(kind)
  const navigate = useNavigate()
  const flash = useFlash()
  const key = useMemo(() => crypto.randomUUID(), [])
  return (
    <Drawer title={kind === 'credit' ? `Credit note against ${invoice.invoiceNo}` : `Debit note against ${invoice.invoiceNo}`} onClose={onClose} width={640}>
      <SimpleForm schema={noteSchema} defaults={{ noteDate: todayIso(), reason: '', quantities: {}, prices: {}, returnStock: true }} fields={['noteDate', 'reason', 'lines']} label={kind === 'credit' ? 'Issue credit note' : 'Issue debit note'}
        submit={async (v) => {
          const lines = invoice.lines.flatMap((l) => { const q = (v.quantities[l.id] ?? '').trim(); return q && Number(q) > 0 ? [{ originalLineId: l.id, quantity: q, ...((v.prices[l.id] ?? '').trim() ? { unitPrice: (v.prices[l.id] as string).trim() } : {}), ...(kind === 'credit' && !v.returnStock ? { returnStock: false } : {}) }] : [] })
          if (lines.length === 0) throw new ApiError(422, 'validation_failed', 'Enter a quantity on at least one line.')
          const note = await post.mutateAsync({ body: { originalInvoiceId: invoice.id, noteDate: v.noteDate, reason: v.reason.trim(), lines }, key })
          flash.show(`${note.invoiceNo} issued for ${formatInr(note.grandTotal)}.`)
          await navigate({ to: '/sales/invoices/$invoiceId', params: { invoiceId: note.id } })
        }}>
        {({ register, errors }) => (
          <>
            <p className="text-sm text-muted">Enter the quantity to {kind === 'credit' ? 'credit' : 'charge extra for'} on each line. Leave a line empty to leave it out. The price defaults to the original line's; it can be lowered, never raised.</p>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-1">Line</th><th className="num py-1 text-right">Original qty</th><th className="num py-1 text-right">Price</th><th className="py-1 pl-3">Quantity</th><th className="py-1 pl-3">Price (optional)</th></tr></thead>
              <tbody>
                {invoice.lines.map((l) => (
                  <tr key={l.id} className="border-t border-line/60">
                    <td className="py-1.5">{l.lineNo}. {l.description}</td><td className="num py-1.5 text-right">{Number(l.quantity)}</td><td className="num py-1.5 text-right">{formatInr(l.unitPrice, { symbol: false })}</td>
                    <td className="py-1.5 pl-3"><input aria-label={`Quantity for line ${l.lineNo}`} inputMode="decimal" className="h-8 w-24 rounded border border-line bg-surface px-2 text-right text-sm" {...register(`quantities.${l.id}` as never)} /></td>
                    <td className="py-1.5 pl-3"><input aria-label={`Price for line ${l.lineNo}`} inputMode="decimal" className="h-8 w-24 rounded border border-line bg-surface px-2 text-right text-sm" {...register(`prices.${l.id}` as never)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TextField label="Date" type="date" error={errors.noteDate?.message as string | undefined} {...register('noteDate')} />
            <TextField label="Reason" error={errors.reason?.message as string | undefined} {...register('reason')} />
            {kind === 'credit' ? <CheckField label="Bring returned goods back into stock" {...register('returnStock')} /> : null}
          </>
        )}
      </SimpleForm>
    </Drawer>
  )
}

/** Keyed by the document, so panels and messages opened on one never carry over to the next. */
export function InvoiceDetailPage() {
  const { invoiceId } = useParams({ from: '/app/sales/invoices/$invoiceId' })
  return <InvoiceDetail key={invoiceId} invoiceId={invoiceId} />
}

function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const q = useInvoice(invoiceId)
  const ws = useWorkspace()
  const perms = useSession((s) => s.me?.permissions ?? [])
  const addresses = usePartyAddresses(q.data?.customerId)
  const [panel, setPanel] = useState<'cancel' | 'credit' | 'debit' | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)

  const retail = useRetailSettings(ws.company?.id)
  const einv = useEInvoiceStatus(invoiceId)
  const seller: Seller | null = useMemo(() => {
    const inv = q.data
    if (!inv || !ws.company) return null
    const reg = ws.registrations.find((r) => r.id === inv.gstRegistrationId)
    const loc = ws.locations.find((l) => l.gstRegistrationId === inv.gstRegistrationId && l.isPrincipalPlace) ?? ws.locations.find((l) => l.gstRegistrationId === inv.gstRegistrationId)
    return { name: reg?.legalName ?? ws.company.legalName, tradeName: reg?.tradeName ?? ws.company.tradeName, gstin: reg?.gstin ?? '', stateCode: reg?.stateCode ?? '', address: loc ? [loc.address.line1, loc.address.line2 ?? '', loc.address.city, stateName(loc.address.stateCode), loc.address.pincode].filter(Boolean) : [], upiId: retail.data?.upiId ?? null }
  }, [q.data, ws.company, ws.registrations, ws.locations, retail.data?.upiId])

  if (q.isPending) return <Spinner />
  if (q.error || !q.data) return <Alert>{q.error?.message ?? 'Not found.'}</Alert>
  const inv = q.data
  const intra = inv.taxRegime === 'intra'
  const original = inv.documentType === 'tax_invoice' || inv.documentType === 'bill_of_supply'
  const posted = inv.status === 'posted'
  const billTo = (addresses.data ?? []).find((a) => a.kind === 'billing' && a.isDefault) ?? (addresses.data ?? []).find((a) => a.kind === 'billing')

  async function savePdf() {
    setPrintError(null)
    if (!seller) return
    try { const record = einv.data?.record?.status === 'active' ? einv.data.record : null
      const bill = einv.data?.eway.find((e) => e.status === 'active')
      await bridge.document.savePdf(invoiceHtml(inv, seller, billTo, { einvoice: record, ewayBillNo: bill?.billNo ?? null }), inv.invoiceNo.replaceAll('/', '-')) } catch (e) { setPrintError(e instanceof Error ? e.message : 'Could not create the PDF.') }
  }

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted"><Link to="/sales/invoices" className="underline">Sales invoices</Link></p>
          <h1 className="page-title">{DOC_LABEL[inv.documentType] ?? inv.documentType} {inv.invoiceNo} {!posted ? <span className="ml-2 rounded bg-bad/15 px-2 py-0.5 text-xs font-medium text-bad">Cancelled</span> : null}</h1>
          <p className="text-sm text-muted">{formatDate(inv.invoiceDate)} · {inv.customerName}{inv.customerGstin ? ` · ${inv.customerGstin}` : ''} · supply to {stateName(inv.placeOfSupply)}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => void savePdf()} disabled={!seller}>{window.onesync ? 'Save as PDF' : 'Print'}</Button>
          {posted && original && can(perms, 'receivables:post') ? <Link to="/sales/receipts" search={{ customerId: inv.customerId } as never} className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-3.5 text-sm font-medium hover:bg-canvas">Record receipt</Link> : null}
          {posted && original && can(perms, 'sales:post') ? <Button variant="secondary" onClick={() => setPanel('credit')}>Credit note</Button> : null}
          {posted && original && can(perms, 'sales:post') ? <Button variant="secondary" onClick={() => setPanel('debit')}>Debit note</Button> : null}
          {posted && can(perms, 'sales:cancel') ? <Button variant="secondary" onClick={() => setPanel('cancel')}>Cancel</Button> : null}
        </div>
      </div>
      {printError ? <Alert>{printError}</Alert> : null}
      {inv.warnings?.length ? <Alert>{inv.warnings.map((w) => w.message).join(' ')}</Alert> : null}
      {!posted ? <Alert>Cancelled on {inv.cancelDate ? formatDate(inv.cancelDate) : ''}: {inv.cancelReason}</Alert> : null}
      {inv.reason ? <Alert tone="info">Reason: {inv.reason}</Alert> : null}

      <Card>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1">#</th><th className="py-1">Description</th><th className="py-1">HSN/SAC</th><th className="num py-1 text-right">Qty</th><th className="num py-1 text-right">Price</th><th className="num py-1 text-right">Taxable</th>{intra ? <><th className="num py-1 text-right">CGST</th><th className="num py-1 text-right">SGST</th></> : <th className="num py-1 text-right">IGST</th>}<th className="num py-1 text-right">Total</th></tr></thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-t border-line/60">
                <td className="py-1.5">{l.lineNo}</td><td className="py-1.5">{l.description}</td><td className="py-1.5">{l.hsnSacCode}</td><td className="num py-1.5 text-right">{Number(l.quantity)}</td><td className="num py-1.5 text-right">{formatInr(l.unitPrice, { symbol: false })}</td>
                <td className="num py-1.5 text-right">{formatInr(l.taxableValue, { symbol: false })}</td>
                {intra ? <><td className="num py-1.5 text-right">{formatInr(l.cgstAmount, { symbol: false })} <span className="text-muted">({Number(l.cgstRate)}%)</span></td><td className="num py-1.5 text-right">{formatInr(l.sgstAmount, { symbol: false })} <span className="text-muted">({Number(l.sgstRate)}%)</span></td></> : <td className="num py-1.5 text-right">{formatInr(l.igstAmount, { symbol: false })} <span className="text-muted">({Number(l.igstRate)}%)</span></td>}
                <td className="num py-1.5 text-right">{formatInr(l.lineTotal, { symbol: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 flex w-72 flex-col gap-1 text-sm">
          <Total label="Taxable value" value={inv.taxableTotal} />
          {intra ? <><Total label="CGST" value={inv.cgstTotal} /><Total label="SGST" value={inv.sgstTotal} /></> : <Total label="IGST" value={inv.igstTotal} />}
          {Number(inv.cessTotal) ? <Total label="Cess" value={inv.cessTotal} /> : null}
          {Number(inv.roundOff) ? <Total label="Round off" value={inv.roundOff} /> : null}
          <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Grand total</dt><dd className="num">{formatInr(inv.grandTotal)}</dd></div>
        </dl>
      </Card>
      <EInvoicePanel invoiceId={inv.id} documentType={inv.documentType} posted={posted} />
      <Card><AttachmentsPanel entityType="sales_invoice" entityId={inv.id} canWrite={can(useSession.getState().me?.permissions ?? [], 'sales:post')} /></Card>
      {panel === 'cancel' ? <CancelDrawer invoice={inv} onClose={() => setPanel(null)} /> : null}
      {panel === 'credit' || panel === 'debit' ? <NoteDrawer invoice={inv} kind={panel} onClose={() => setPanel(null)} /> : null}
    </div>
  )
}

function Total({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><dt className="text-muted">{label}</dt><dd className="num">{formatInr(value)}</dd></div>
}
