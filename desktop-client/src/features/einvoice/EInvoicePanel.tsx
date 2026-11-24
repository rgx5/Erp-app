import { useRef, useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate } from '@/domain/format'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, Spinner, TextField } from '@/ui/primitives'
import { downloadJson, EInvoiceError, useEInvoiceActions, useEInvoiceStatus, type Issue, type Transport } from './api'
import { parseReply } from './reply'

export const IssueList = ({ issues }: { issues: Issue[] }) => issues.length === 0 ? null : (
  <ul className="flex flex-col gap-1 text-sm">{issues.map((i, n) => <li key={n} className={i.blocking ? 'text-bad' : 'text-muted'}>{i.blocking ? '✗' : '•'} {i.message}</li>)}</ul>
)
const msg = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.')
const when = (iso: string): string => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })

const recordSchema = z.object({ irn: z.string().trim().length(64, 'The IRN is 64 characters'), ackNo: z.string().trim().min(1, 'Required'), ackDate: z.string().trim().min(8, 'Required'), signedQr: z.string().trim().min(10, 'Required') })
function RecordDrawer({ invoiceId, expected, onClose }: { invoiceId: string; expected: string | null; onClose: () => void }) {
  const a = useEInvoiceActions(invoiceId); const flash = useFlash()
  return (
    <Drawer title="Enter the IRN from the portal" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Alert tone="info">Copy these from the portal's invoice page. The IRN must match this invoice{expected ? <>: <span className="break-all font-mono text-xs">{expected}</span></> : ''}.</Alert>
        <SimpleForm schema={recordSchema} defaults={{ irn: '', ackNo: '', ackDate: '', signedQr: '' }} fields={['irn', 'ackNo', 'ackDate', 'signedQr']} label="Save" submit={async (v) => { await a.record.mutateAsync(v); flash.show('The IRN was recorded.'); onClose() }}>
          {({ register, errors }) => (<>
            <TextField label="IRN" error={errors.irn?.message as string | undefined} {...register('irn')} />
            <TextField label="Acknowledgement number" error={errors.ackNo?.message as string | undefined} {...register('ackNo')} />
            <TextField label="Acknowledgement date and time (2026-04-15 10:31:22)" error={errors.ackDate?.message as string | undefined} {...register('ackDate')} />
            <TextField label="Signed QR code text" error={errors.signedQr?.message as string | undefined} {...register('signedQr')} />
          </>)}
        </SimpleForm>
      </div>
    </Drawer>
  )
}

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'A reason is required').max(200) })
function CancelIrnDrawer({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const a = useEInvoiceActions(invoiceId); const flash = useFlash()
  return (
    <Drawer title="Record that the IRN was cancelled" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Alert tone="info">Cancel the IRN on the e-invoice portal first (it must be done within 24 hours of issue). Then record it here, so this invoice can be cancelled too.</Alert>
        <SimpleForm schema={reasonSchema} defaults={{ reason: '' }} fields={['reason']} label="Record cancellation" submit={async (v) => { await a.cancel.mutateAsync(v.reason); flash.show('The IRN is marked as cancelled.'); onClose() }}>
          {({ register, errors }) => <TextField label="Reason" error={errors.reason?.message as string | undefined} {...register('reason')} />}
        </SimpleForm>
      </div>
    </Drawer>
  )
}

const ewayFileSchema = z.object({ mode: z.enum(['road', 'rail', 'air', 'ship']), distanceKm: z.string().trim().regex(/^[0-9]{1,4}$/, 'Whole kilometres, 1 to 4000'), vehicleNo: z.string().trim().max(15), transporterId: z.string().trim().max(15), transporterName: z.string().trim().max(100), transDocNo: z.string().trim().max(15), transDocDate: z.string() })
const toTransport = (v: z.infer<typeof ewayFileSchema>): Transport => ({ mode: v.mode, distanceKm: Number(v.distanceKm), ...(v.vehicleNo ? { vehicleNo: v.vehicleNo } : {}), ...(v.transporterId ? { transporterId: v.transporterId.toUpperCase() } : {}), ...(v.transporterName ? { transporterName: v.transporterName } : {}), ...(v.transDocNo ? { transDocNo: v.transDocNo } : {}), ...(v.transDocDate ? { transDocDate: v.transDocDate } : {}) })

function EwayFileDrawer({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const a = useEInvoiceActions(invoiceId); const flash = useFlash(); const [issues, setIssues] = useState<Issue[]>([])
  return (
    <Drawer title="Prepare the e-way bill file" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Alert tone="info">Fill in the movement. The file is made only when the details are complete. Upload it on the e-way bill portal under Bulk Generation, then come back and record the number it gives.</Alert>
        <SimpleForm schema={ewayFileSchema} defaults={{ mode: 'road', distanceKm: '', vehicleNo: '', transporterId: '', transporterName: '', transDocNo: '', transDocDate: '' }} fields={['distanceKm', 'vehicleNo']} label="Make the e-way bill file"
          submit={async (v) => {
            setIssues([])
            try { const r = await a.ewayFile.mutateAsync(toTransport(v)); downloadJson(r.fileName, r.json); setIssues(r.issues.filter((i) => !i.blocking)); flash.show(`${r.fileName} was saved.`) } catch (e) { if (e instanceof EInvoiceError && Array.isArray(e.extra['issues'])) setIssues(e.extra['issues'] as Issue[]); throw e }
          }}>
          {({ register, errors }) => (<>
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Mode of transport</span>
              <select className="h-9 rounded-md border border-line bg-surface px-2" {...register('mode')}><option value="road">Road</option><option value="rail">Rail</option><option value="air">Air</option><option value="ship">Ship</option></select></label>
            <TextField label="Distance in km" inputMode="numeric" error={errors.distanceKm?.message as string | undefined} {...register('distanceKm')} />
            <TextField label="Vehicle number (road), e.g. MH12AB1234" error={errors.vehicleNo?.message as string | undefined} {...register('vehicleNo')} />
            <TextField label="Transporter's GSTIN (if no vehicle number yet)" error={errors.transporterId?.message as string | undefined} {...register('transporterId')} />
            <TextField label="Transporter's name" {...register('transporterName')} />
            <TextField label="Transport document number (rail, air, ship)" {...register('transDocNo')} />
            <TextField label="Transport document date" type="date" {...register('transDocDate')} />
          </>)}
        </SimpleForm>
        <IssueList issues={issues} />
      </div>
    </Drawer>
  )
}

const ewayRecordSchema = z.object({ billNo: z.string().trim().regex(/^[0-9]{12}$/, 'An e-way bill number is 12 digits'), billDate: z.string().trim().min(8, 'Required'), validUntil: z.string().trim(), vehicleNo: z.string().trim().max(15), distanceKm: z.string().trim().regex(/^([0-9]{1,4})?$/, 'Whole kilometres') })
function EwayRecordDrawer({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const a = useEInvoiceActions(invoiceId); const flash = useFlash()
  return (
    <Drawer title="Record the e-way bill number" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Alert tone="info">Type in what the e-way bill portal gave. A new number replaces the earlier one (for example after a change of vehicle).</Alert>
        <SimpleForm schema={ewayRecordSchema} defaults={{ billNo: '', billDate: '', validUntil: '', vehicleNo: '', distanceKm: '' }} fields={['billNo', 'billDate']} label="Save"
          submit={async (v) => { await a.ewayRecord.mutateAsync({ billNo: v.billNo, billDate: v.billDate, transportMode: 'road', ...(v.validUntil ? { validUntil: v.validUntil } : {}), ...(v.vehicleNo ? { vehicleNo: v.vehicleNo } : {}), ...(v.distanceKm ? { distanceKm: Number(v.distanceKm) } : {}) }); flash.show('The e-way bill was recorded.'); onClose() }}>
          {({ register, errors }) => (<>
            <TextField label="E-way bill number (12 digits)" inputMode="numeric" error={errors.billNo?.message as string | undefined} {...register('billNo')} />
            <TextField label="Generated on (2026-04-15 10:31:22)" error={errors.billDate?.message as string | undefined} {...register('billDate')} />
            <TextField label="Valid until (2026-04-18 23:59:00)" error={errors.validUntil?.message as string | undefined} {...register('validUntil')} />
            <TextField label="Vehicle number" {...register('vehicleNo')} />
            <TextField label="Distance in km" inputMode="numeric" error={errors.distanceKm?.message as string | undefined} {...register('distanceKm')} />
          </>)}
        </SimpleForm>
      </div>
    </Drawer>
  )
}

/** E-invoice and e-way bill for one invoice: the file for each government portal, and what the portal gave back. */
export function EInvoicePanel({ invoiceId, documentType, posted }: { invoiceId: string; documentType: string; posted: boolean }) {
  const q = useEInvoiceStatus(invoiceId); const a = useEInvoiceActions(invoiceId); const flash = useFlash()
  const perms = useSession((s) => s.me?.permissions ?? [])
  const [panel, setPanel] = useState<'record' | 'cancel' | 'eway-file' | 'eway-record' | null>(null)
  const [problem, setProblem] = useState<string | null>(null); const [skipped, setSkipped] = useState<Issue[]>([])
  const input = useRef<HTMLInputElement>(null)
  if (q.isPending) return <Card><Spinner /></Card>
  if (q.error || !q.data) return null
  const st = q.data; const canPost = can(perms, 'sales:post'); const canCancel = can(perms, 'sales:cancel')
  const rec = st.record?.status === 'active' ? st.record : null
  const eway = st.eway.find((e) => e.status === 'active')
  const ewayApplicable = posted && (documentType === 'tax_invoice' || documentType === 'bill_of_supply')
  if (!st.applicable && !ewayApplicable) return null

  async function makeFile() {
    setProblem(null); setSkipped([])
    try { const r = await a.file.mutateAsync([invoiceId]); downloadJson(r.fileName, r.invoices); flash.show(`${r.fileName} was saved. Upload it on the e-invoice portal.`) } catch (e) { setProblem(msg(e)); if (e instanceof EInvoiceError && Array.isArray(e.extra['skipped'])) setSkipped(((e.extra['skipped'] as { issues: Issue[] }[])[0]?.issues) ?? []) }
  }
  async function loadReply(f: File | undefined) {
    if (!f) return
    setProblem(null)
    try {
      const parsed = parseReply(await f.text())
      if (parsed.items.length === 0) { setProblem(parsed.rejected.length ? `The portal refused: ${parsed.rejected.map((r) => `${r.docNo} (${r.message})`).join('; ')}` : 'No IRN was found in this file.'); return }
      const r = await a.reply.mutateAsync(parsed.items)
      const mine = r.outcomes.find((o) => o.result === 'recorded' || o.result === 'already_recorded')
      if (mine) flash.show('The IRN was recorded.'); else setProblem(`This reply is not for this invoice (${r.outcomes[0]?.message ?? 'no match'}).`)
    } catch (e) { setProblem(msg(e)) } finally { if (input.current) input.current.value = '' }
  }

  return (
    <>
      {st.applicable ? (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-sm font-semibold">E-invoice (IRN)</h2>
              <p className="text-xs text-muted">The portal gives each invoice to a business, SEZ unit or exporter a reference number (IRN) and a QR code. This software prepares the file; you upload it on the portal.</p></div>
            {rec ? <span className="rounded bg-good/15 px-2 py-0.5 text-xs font-medium text-good">IRN recorded</span> : <span className="rounded bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">No IRN yet</span>}
          </div>
          {rec ? (
            <dl className="mt-3 grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted">IRN</dt><dd className="break-all font-mono text-xs">{rec.irn}</dd>
              <dt className="text-muted">Acknowledgement</dt><dd>No. {rec.ackNo} · {when(rec.ackDate)}</dd>
            </dl>
          ) : <div className="mt-3 flex flex-col gap-2"><IssueList issues={st.issues} /></div>}
          {problem ? <div className="mt-2"><Alert>{problem}</Alert></div> : null}
          {skipped.length ? <div className="mt-2"><IssueList issues={skipped} /></div> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {!rec && canPost ? <Button variant="secondary" onClick={() => void makeFile()} disabled={!st.canFile} busy={a.file.isPending}>Download file for the portal</Button> : null}
            {!rec && canPost ? <Button variant="secondary" onClick={() => input.current?.click()}>Load the portal's reply</Button> : null}
            {!rec && canPost ? <Button variant="secondary" onClick={() => setPanel('record')}>Enter the IRN by hand</Button> : null}
            {rec && canCancel ? <Button variant="secondary" onClick={() => setPanel('cancel')}>Record IRN cancellation</Button> : null}
            <input ref={input} type="file" accept="application/json,.json" aria-label="Portal reply file" className="hidden" onChange={(e) => void loadReply(e.target.files?.[0])} />
          </div>
        </Card>
      ) : null}
      {ewayApplicable ? (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-sm font-semibold">E-way bill</h2>
              <p className="text-xs text-muted">Needed when goods worth over ₹50,000 move. The software prepares the bulk-upload file; you upload it on the e-way bill portal and record the number.</p></div>
            {eway ? <span className="rounded bg-good/15 px-2 py-0.5 text-xs font-medium text-good">Bill recorded</span> : null}
          </div>
          {eway ? (
            <dl className="mt-3 grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted">E-way bill no.</dt><dd className="num">{eway.billNo}</dd>
              <dt className="text-muted">Generated</dt><dd>{when(eway.billDate)}{eway.validUntil ? ` · valid until ${formatDate(eway.validUntil.slice(0, 10))}` : ''}</dd>
              {eway.vehicleNo ? <><dt className="text-muted">Vehicle</dt><dd>{eway.vehicleNo}{eway.distanceKm ? ` · ${eway.distanceKm} km` : ''}</dd></> : null}
            </dl>
          ) : null}
          {canPost ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setPanel('eway-file')}>{eway ? 'Prepare a new file (change of vehicle)' : 'Prepare file for the portal'}</Button>
              <Button variant="secondary" onClick={() => setPanel('eway-record')}>Record the e-way bill number</Button>
              {eway ? <Button variant="secondary" onClick={() => void a.ewayCancel.mutateAsync().then(() => flash.show('The e-way bill was marked cancelled.')).catch((e) => setProblem(msg(e)))}>Mark cancelled</Button> : null}
            </div>
          ) : null}
        </Card>
      ) : null}
      {panel === 'record' ? <RecordDrawer invoiceId={invoiceId} expected={st.irn} onClose={() => setPanel(null)} /> : null}
      {panel === 'cancel' ? <CancelIrnDrawer invoiceId={invoiceId} onClose={() => setPanel(null)} /> : null}
      {panel === 'eway-file' ? <EwayFileDrawer invoiceId={invoiceId} onClose={() => setPanel(null)} /> : null}
      {panel === 'eway-record' ? <EwayRecordDrawer invoiceId={invoiceId} onClose={() => setPanel(null)} /> : null}
    </>
  )
}
